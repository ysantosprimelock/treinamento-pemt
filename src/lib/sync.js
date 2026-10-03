// Fila de envio ao Supabase.
// Regras de segurança dos dados:
//  * O treinamento só vira "enviado" depois que o banco confirma o registro.
//  * Nada é apagado do aparelho em caso de falha.
//  * Arquivos já enviados não são reenviados (economiza dados em sinal fraco).
//  * O mesmo treinamento reenviado nunca duplica (id gerado no aparelho + função idempotente no banco).
import { BUCKET, DIAS_MANTER_ENVIADOS } from '../config.js';

const pad2 = n => String(n).padStart(2, '0');
const MINUTO = 60 * 1000;

export function classificarErro(err) {
  const msg = String((err && err.message) || err || 'Erro desconhecido');
  const code = err && err.code;
  if (code === 'LOCAL') return { tipo: 'correcao', msg };
  if (code === 'P0001' || code === '42501' || code === '22P02' || code === '23514' || code === '23505') return { tipo: 'correcao', msg };
  if (code === '28000' || /jwt|token|sess(ion|ão)|not authenticated|401/i.test(msg)) {
    return { tipo: 'sessao', msg: 'Sessão expirada. Entre novamente para enviar.' };
  }
  if (/fetch|network|rede|timeout|aborted|abort|load failed|connection|conex/i.test(msg)) {
    return { tipo: 'rede', msg: 'Sem conexão com o servidor. O app tenta de novo sozinho.' };
  }
  return { tipo: 'outro', msg };
}

function erroLocal(msg) {
  const e = new Error(msg);
  e.code = 'LOCAL';
  return e;
}

export function criarSync({ supabase, db, agora = () => Date.now() }) {
  let rodando = false;

  async function subir(arquivo, caminho, tipo) {
    if (arquivo.enviadoPath === caminho) return; // já está no servidor
    const { error } = await supabase.storage.from(BUCKET).upload(caminho, arquivo.blob, { upsert: true, contentType: tipo });
    if (error) throw error;
    arquivo.enviadoPath = caminho;
    await db.put('arquivos', arquivo);
  }

  async function enviarUm(t, uid) {
    t.status = 'enviando';
    t.tentativas = (t.tentativas || 0) + 1;
    t.ultimaTentativa = agora();
    await db.put('treinamentos', t);

    const arquivos = Object.fromEntries((await db.arquivosDe(t.id)).map(a => [a.chave, a]));
    const base = `${uid}/${t.id}/`;

    const fotos = [];
    for (let i = 0; i < t.fotos.length; i++) {
      const a = arquivos[t.fotos[i]];
      if (!a) throw erroLocal(`Foto ${i + 1} não encontrada no aparelho.`);
      const caminho = `${base}fotos/${pad2(i + 1)}.jpg`;
      await subir(a, caminho, 'image/jpeg');
      fotos.push(caminho);
    }

    const participantes = [];
    for (let i = 0; i < t.operadores.length; i++) {
      const o = t.operadores[i];
      const a = arquivos[(t.assinaturas || {})[o.k]];
      if (!a) throw erroLocal(`Assinatura de ${o.nome || 'operador ' + (i + 1)} não encontrada no aparelho.`);
      const caminho = `${base}assinaturas/${pad2(i + 1)}.png`;
      await subir(a, caminho, 'image/png');
      participantes.push({ nome: o.nome.trim(), cpf: o.cpf, funcao: (o.funcao || '').trim(), assinatura_path: caminho });
    }

    const payload = {
      id: t.id,
      cliente: t.cliente.trim(),
      local: t.local.trim(),
      cidade: t.cidade.trim(),
      uf: t.uf,
      data: t.data,
      criado_no_aparelho_em: new Date(t.criadoEm).toISOString(),
      fabricantes: t.fabricantes,
      maquinas: t.maquinas,
      fotos,
      participantes
    };
    const { data, error } = await supabase.rpc('registrar_treinamento', { p: payload });
    if (error) throw error;
    if (!data || data.ok !== true) throw new Error('Resposta inesperada do servidor.');

    t.status = 'enviado';
    t.enviadoEm = agora();
    t.erro = null;
    t.tipoErro = null;
    t.proximaTentativa = 0;
    await db.put('treinamentos', t);
  }

  // ignorarEspera: não respeita o intervalo entre tentativas (ex.: internet voltou)
  // incluirCorrecao: tenta também os que o servidor recusou (botão "Enviar agora")
  async function sincronizar({ ignorarEspera = false, incluirCorrecao = false } = {}) {
    if (rodando) return { enviados: 0, falhas: 0, msg: 'Envio já em andamento.' };
    rodando = true;
    try {
      const { data } = await supabase.auth.getSession();
      const sessao = data && data.session;
      if (!sessao) return { enviados: 0, falhas: 0, semSessao: true, msg: 'Entre novamente para enviar os pendentes.' };
      const uid = sessao.user.id;

      const fila = (await db.todos('treinamentos'))
        .filter(t => t.userId === uid && ['pronto', 'enviando', 'erro'].includes(t.status))
        .filter(t => incluirCorrecao || t.tipoErro !== 'correcao')
        .filter(t => ignorarEspera || !t.proximaTentativa || t.proximaTentativa <= agora())
        .sort((a, b) => (a.finalizadoEm || 0) - (b.finalizadoEm || 0));

      let enviados = 0, falhas = 0, ultimaMsg = '';
      for (const t of fila) {
        try {
          await enviarUm(t, uid);
          enviados++;
        } catch (err) {
          falhas++;
          const c = classificarErro(err);
          t.status = 'erro';
          t.erro = c.msg;
          t.tipoErro = c.tipo;
          const espera = Math.min(30, 2 ** Math.max(0, Math.min((t.tentativas || 1) - 1, 5))) * MINUTO;
          t.proximaTentativa = c.tipo === 'correcao' ? 0 : agora() + espera;
          await db.put('treinamentos', t);
          ultimaMsg = c.msg;
          if (c.tipo === 'rede' || c.tipo === 'sessao') break; // sem conexão/sessão: não adianta tentar os próximos agora
        }
      }

      let msg = '';
      if (enviados) msg = `${enviados} treinamento(s) enviado(s).`;
      if (falhas) msg = (msg ? msg + ' ' : '') + ultimaMsg;
      return { enviados, falhas, msg };
    } finally {
      rodando = false;
    }
  }

  // Apaga do aparelho os treinamentos já confirmados pelo servidor há mais de N dias.
  async function limparEnviadosAntigos(dias = DIAS_MANTER_ENVIADOS) {
    const limite = agora() - dias * 24 * 60 * MINUTO;
    const velhos = (await db.todos('treinamentos')).filter(t => t.status === 'enviado' && t.enviadoEm && t.enviadoEm < limite);
    for (const t of velhos) await db.apagarTreinamento(t.id);
    return velhos.length;
  }

  return { sincronizar, limparEnviadosAntigos, enviarUm };
}
