// Chamadas ao banco ligadas à prova pelo QR code.
// Instrutor (logado): abrirSessao, resultados.  Operador (sem login): publica, identificar, responder.
import { provaAtual, baixarProvas } from '../prova/index.js';

function erro(e) {
  const x = new Error((e && e.message) || 'Falha de comunicação com o servidor.');
  x.code = e && e.code;
  return x;
}

export function criarProvaApi(supabase) {
  const rpc = async (nome, args) => {
    const { data, error } = await supabase.rpc(nome, args);
    if (error) throw erro(error);
    return data;
  };
  return {
    abrirSessao: t => rpc('prova_abrir_sessao', {
      p: {
        treinamento_id: t.id, prova_id: provaAtual() ? provaAtual().id : null, cliente: (t.cliente || '').trim(), data: t.data,
        operadores: t.operadores.map(o => ({ cpf: o.cpf, nome: o.nome }))
      }
    }),
    resultados: id => rpc('prova_resultados', { p_treinamento: id }),
    baixarProvas: () => baixarProvas(supabase),
    publica: token => rpc('prova_publica', { p_token: token }),
    identificar: (token, cpf) => rpc('prova_identificar', { p_token: token, p_cpf: cpf }),
    responder: (token, cpf, respostas) => rpc('prova_responder', { p_token: token, p_cpf: cpf, p_respostas: respostas })
  };
}

// Endereço que vai no QR code (a mesma página do app, com ?prova=<token>)
export function linkProva(token, loc = window.location) {
  const caminho = loc.pathname.replace(/index\.html$/, '');
  return `${loc.origin}${caminho}?prova=${encodeURIComponent(token)}`;
}

export const soDigitos = s => String(s || '').replace(/\D/g, '');

// Junta os resultados do QR code (melhor tentativa por CPF) ao treinamento local.
// Não mexe em quem já tem prova lançada no papel. A decisão do instrutor fica à parte (t.decisoes).
// Devolve o novo objeto "provas" ou null se nada mudou.
export function aplicarResultadosQr(t, lista) {
  const provas = { ...(t.provas || {}) };
  let mudou = false;
  for (const r of lista || []) {
    const op = t.operadores.find(o => soDigitos(o.cpf) === r.cpf);
    if (!op) continue;
    const atual = provas[op.k];
    if (atual && atual.modo !== 'qr') continue;
    if (atual && atual.tentativaId === r.tentativa_id && atual.tentativas === r.tentativas) continue;
    provas[op.k] = {
      modo: 'qr', provaId: r.prova_id, tentativaId: r.tentativa_id, respostas: r.respostas,
      acertos: r.acertos, total: r.total, aprovado: r.aprovado, em: Date.parse(r.em), tentativas: r.tentativas, cpf: r.cpf
    };
    mudou = true;
  }
  return mudou ? provas : null;
}
