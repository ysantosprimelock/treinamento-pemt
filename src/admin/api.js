// Acesso do painel admin ao Supabase. Tudo passa pelas regras do banco:
// as funções admin_* só respondem para perfis com papel = 'admin'.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from '../config.js';

// Sessão separada da do app do instrutor (outra chave no navegador): entrar ou sair do painel
// não troca o login do app instalado no mesmo aparelho.
export function criarClienteAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storageKey: 'pemt-admin-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
}

const FALTA_SQL = 'O banco ainda não tem as funções do painel. Rode o arquivo 09_agenda_avisos_admin.sql no Supabase.';

export function traduzirErro(e) {
  const msg = String((e && e.message) || e || 'Erro desconhecido');
  const code = e && e.code;
  let texto = msg;
  if (code === 'PGRST202' || code === '42883' || code === 'PGRST205' || code === '42P01' || /could not find the (function|table)/i.test(msg)) texto = FALTA_SQL;
  else if (/failed to fetch|network|load failed|fetch/i.test(msg)) texto = 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  else if (code === '28000' || /jwt|sess(ion|ão) expirada/i.test(msg)) texto = 'Sessão expirada. Entre de novo.';
  const x = new Error(texto);
  x.code = code;
  return x;
}

// Erro da função enviar-push em texto claro
export async function erroDaFuncao(e) {
  const nome = e && e.name;
  if (nome === 'FunctionsHttpError' && e.context) {
    const status = e.context.status;
    let corpo = null;
    try { corpo = await e.context.json(); } catch { /* sem corpo JSON */ }
    if (status === 404) return new Error('A função de avisos (enviar-push) ainda não está instalada no Supabase.');
    if (corpo && (corpo.erro || corpo.message || corpo.msg)) return new Error(corpo.erro || corpo.message || corpo.msg);
    return new Error(`A função de avisos respondeu com erro ${status}.`);
  }
  if (nome === 'FunctionsFetchError' || nome === 'FunctionsRelayError') {
    return new Error('Não foi possível falar com a função de avisos. Confira se ela está instalada no Supabase.');
  }
  return traduzirErro(e);
}

export function criarApi(sb) {
  const rpc = async (nome, args) => {
    const { data, error } = await sb.rpc(nome, args);
    if (error) throw traduzirErro(error);
    return data;
  };
  const tabela = async consulta => {
    const { data, error } = await consulta;
    if (error) throw traduzirErro(error);
    return data;
  };

  return {
    sb,
    ehAdmin: () => rpc('is_admin'),
    treinamentos: filtros => rpc('admin_treinamentos', { p: filtros || {} }),
    treinamento: id => rpc('admin_treinamento', { p_id: id }),
    operadores: busca => rpc('admin_operadores', { p_busca: busca }),
    instrutores: () => rpc('admin_instrutores'),
    clientePadrao: nome => rpc('admin_cliente_padrao', { p_cliente: nome }),
    vincular: (treinamentoId, agendamentoId) => rpc('agenda_vincular', { p: { treinamento_id: treinamentoId, agendamento_id: agendamentoId } }),
    desvincular: treinamentoId => rpc('agenda_desvincular', { p_treinamento: treinamentoId }),

    agendamentos: () => tabela(sb.from('agendamentos').select('*')
      .order('data_treinamento', { ascending: false }).order('horario', { ascending: true, nullsFirst: false }).limit(1000)),
    // Treinamentos que saíram de algum agendamento (para o link "ver treinamento")
    treinamentosLigados: () => tabela(sb.from('treinamentos').select('id, agendamento_id, data_treinamento, cliente')
      .not('agendamento_id', 'is', null).limit(5000)),

    salvarAgendamento: async ag => {
      const { id, ...dados } = ag;
      const q = id ? sb.from('agendamentos').update(dados).eq('id', id) : sb.from('agendamentos').insert(dados);
      return tabela(q.select('*').single());
    },
    marcarAviso: (id, resultado) => tabela(sb.from('agendamentos')
      .update({ avisado_em: new Date().toISOString(), aviso_resultado: resultado }).eq('id', id).select('*').single()),

    listas: async () => {
      const [f, m, c] = await Promise.all([
        sb.from('fabricantes').select('nome').order('nome'),
        sb.from('maquinas').select('modelo').order('modelo'),
        sb.from('clientes').select('nome').order('nome')
      ]);
      return {
        fabricantes: f.error ? [] : f.data.map(x => x.nome),
        maquinas: m.error ? [] : m.data.map(x => x.modelo),
        clientes: c.error ? [] : c.data.map(x => x.nome)
      };
    },

    // Links temporários (1 h) para fotos, assinaturas e PDFs do Storage privado: { caminho: url | null }
    urls: async caminhos => {
      const lista = [...new Set((caminhos || []).filter(Boolean))];
      if (!lista.length) return {};
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(lista, 3600);
      if (error) throw traduzirErro(error);
      const out = {};
      for (const x of data || []) out[x.path] = x.error ? null : x.signedUrl;
      return out;
    },

    // Aviso no celular dos instrutores (função enviar-push)
    avisar: async ({ usuarios, titulo, corpo, url, tag }) => {
      const { data, error } = await sb.functions.invoke('enviar-push', { body: { usuarios, titulo, corpo, url, tag } });
      if (error) throw await erroDaFuncao(error);
      return data;
    }
  };
}
