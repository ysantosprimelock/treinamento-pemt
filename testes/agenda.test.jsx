// Agenda (treinamentos agendados), avisos no celular e service worker.
// Telas num DOM simulado (jsdom) com banco local simulado (fake-indexeddb).
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://treinamento.kimtechmanutencao.com.br/' });
const g = globalThis;
g.window = dom.window; g.document = dom.window.document; g.localStorage = dom.window.localStorage;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
for (const k of ['HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLDialogElement']) g[k] = dom.window[k];
g.requestAnimationFrame = cb => setTimeout(cb, 0); g.cancelAnimationFrame = id => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;
URL.createObjectURL = () => 'blob:x'; URL.revokeObjectURL = () => {};
g.confirm = () => true; g.alert = () => {}; g.scrollTo = () => {}; dom.window.scrollTo = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = function () { g.__rolouPara = this.id; };

{ const f = await import('fake-indexeddb'); g.indexedDB = f.indexedDB; g.IDBKeyRange = f.IDBKeyRange; }
const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const fs = await import('node:fs');
const vm = await import('node:vm');
const db = await import('../src/lib/db.js');
const { hoje } = await import('../src/lib/util.js');
const { quando, rascunhoDeAgenda, juntarComLocais, baixarAgenda, agendaGuardada, horaCurta } = await import('../src/lib/agenda.js');
const { ativarAvisos, desligarAvisos, chaveParaBytes, permissaoAvisos } = await import('../src/lib/avisos.js');
const { VAPID_PUBLIC_KEY } = await import('../src/config.js');
const { criarSync } = await import('../src/lib/sync.js');
const Inicio = (await import('../src/telas/Inicio.jsx')).default;
const Editor = (await import('../src/telas/Editor.jsx')).default;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FALHA', m); } };
const espera = ms => new Promise(r => setTimeout(r, ms));
const txt = () => document.body.textContent;
const botao = rot => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === rot);
const clicar = async el => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); await act(async () => { await espera(30); }); };
const diaMais = n => { const d = new Date(hoje() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

console.log('1) Funções da agenda');
ok(quando(hoje()) === 'Hoje' && quando(diaMais(1)) === 'Amanhã' && quando(diaMais(-1)) === 'Data passou', 'Hoje / Amanhã / Data passou');
ok(quando('2030-01-05', '2029-12-01') === '05/01/2030', 'datas mais distantes aparecem por extenso');
ok(horaCurta('08:30:00') === '08:30' && horaCurta(null) === '', 'horário curto');
const AG = { id: 'AG1', cliente: 'ACME LTDA', data_treinamento: diaMais(1), horario: '08:00:00', local_treinamento: 'PÁTIO 3', cidade: 'FORTALEZA', uf: 'CE',
  email_cliente: 'sst@acme.com.br', fabricantes: ['Genie'], maquinas: ['GS-1930'], observacoes: 'Levar 2 cintos extras', status: 'agendado' };
const r = rascunhoDeAgenda(AG, 'U1', 123);
ok(r.cliente === 'ACME LTDA' && r.local === 'PÁTIO 3' && r.cidade === 'FORTALEZA' && r.uf === 'CE' && r.data === AG.data_treinamento && r.emailCliente === 'sst@acme.com.br', 'rascunho vem preenchido com cliente, local, cidade, UF, data e e-mail');
ok(r.fabricantes[0] === 'Genie' && r.maquinas[0] === 'GS-1930' && r.agendamentoId === 'AG1' && r.agendamento.horario === '08:00' && r.agendamento.observacoes === 'Levar 2 cintos extras', 'fabricantes, máquinas e ligação com o agendamento');
ok(r.operadores.length === 1 && !r.operadores[0].nome && r.status === 'rascunho' && r.userId === 'U1', 'operadores NÃO vêm do agendamento (instrutor cadastra em campo)');
r.fabricantes.push('X');
ok(AG.fabricantes.length === 1, 'rascunho não altera o agendamento guardado');
const jl = juntarComLocais([AG, { ...AG, id: 'AG2' }], [{ id: 'L1', userId: 'U1', agendamentoId: 'AG1', status: 'rascunho', atualizadoEm: 1 }, { id: 'L2', userId: 'U2', agendamentoId: 'AG2', status: 'rascunho' }], 'U1');
ok(jl[0].local && jl[0].local.id === 'L1' && jl[1].local === null, 'liga o rascunho local do próprio instrutor ao agendamento (ignora de outro usuário)');

console.log('2) Baixar a agenda do servidor');
function supaAgenda({ data = [], error = null } = {}) {
  const log = [];
  const cadeia = { select: c => { log.push(['select', c]); return cadeia; }, eq: (k, v) => { log.push(['eq', k, v]); return cadeia; },
    order: (k, o) => { log.push(['order', k, o]); return cadeia; }, then: (ok2, no) => Promise.resolve({ data, error }).then(ok2, no) };
  return { log, from: t => { log.push(['from', t]); return cadeia; } };
}
{
  const s = supaAgenda({ data: [AG] });
  const gg = await baixarAgenda(s, 'U1', 999);
  ok(gg.itens.length === 1 && gg.itens[0].id === 'AG1', 'traz os agendamentos');
  ok(s.log.some(x => x[0] === 'eq' && x[1] === 'instrutor_id' && x[2] === 'U1') && s.log.some(x => x[0] === 'eq' && x[1] === 'status' && x[2] === 'agendado'), 'filtra pelo instrutor logado e só "agendado" (admin também é instrutor)');
  ok(agendaGuardada('U1').itens[0].id === 'AG1' && agendaGuardada('U2').itens.length === 0, 'fica guardada no aparelho, separada por usuário');
  const sem = await baixarAgenda(supaAgenda({ error: { code: 'PGRST205', message: "Could not find the table 'public.agendamentos'" } }), 'U1');
  ok(sem.indisponivel === true && sem.itens.length === 0 && agendaGuardada('U1').itens.length === 1, 'banco sem o SQL 09: segue sem agenda e não apaga a guardada');
  let e = null; try { await baixarAgenda(supaAgenda({ error: { message: 'Failed to fetch' } }), 'U1'); } catch (x) { e = x; }
  ok(e && agendaGuardada('U1').itens.length === 1, 'sem internet: erro, e a lista guardada continua');
}

console.log('3) Tela inicial com agendados');
const root = createRoot(document.getElementById('root'));
const chamadas = { iniciar: [], abrir: [], avisos: 0, atualizar: 0 };
async function renderInicio(props = {}) {
  await act(async () => {
    root.render(<Inicio usuario={{ id: 'U1' }} nome="JOAQUIM" online={true} envio={{ rodando: false, msg: '' }} versao={Math.random()}
      aoNovo={() => {}} aoAbrir={id => chamadas.abrir.push(id)} aoEnviar={() => {}} aoCorrigir={() => {}} aoSair={() => {}}
      aoIniciarAgenda={ag => chamadas.iniciar.push(ag.id)} aoAtualizarAgenda={() => { chamadas.atualizar++; }} aoAtivarAvisos={() => { chamadas.avisos++; }} {...props} />);
  });
  await act(async () => { await espera(80); });
}
const AG_HOJE = { ...AG, id: 'AG0', cliente: 'BETA SA', data_treinamento: hoje(), horario: null, observacoes: null, maquinas: [] };
await renderInicio({ agenda: [AG_HOJE, AG], avisos: { estado: 'pedir' } });
ok(txt().includes('Agendados para você') && txt().includes('ACME LTDA') && txt().includes('BETA SA'), 'mostra os agendados');
ok(txt().includes('Hoje') && txt().includes('Amanhã') && txt().includes('às 08:00') && txt().includes('PÁTIO 3 — FORTALEZA/CE'), 'quando, horário e local');
ok(txt().includes('Levar 2 cintos extras') && txt().includes('Máquinas: GS-1930'), 'observação do admin e máquinas');
ok(botao('Novo treinamento (sem agendamento)'), 'botão de treinamento avulso continua');
await clicar([...document.querySelectorAll('#agenda-AG1 button')].find(b => b.textContent === 'Iniciar treinamento'));
ok(chamadas.iniciar[0] === 'AG1', 'Iniciar treinamento chama o agendamento certo');
ok(txt().includes('Receba aviso quando houver treinamento agendado'), 'convite para ativar avisos');
await clicar(botao('Ativar avisos'));
ok(chamadas.avisos === 1, 'botão Ativar avisos');
await clicar(botao('Atualizar'));
ok(chamadas.atualizar === 1, 'botão Atualizar a agenda');

await db.put('treinamentos', { id: 'L1', userId: 'U1', agendamentoId: 'AG1', status: 'rascunho', criadoEm: 1, atualizadoEm: 5, cliente: 'ACME LTDA', data: AG.data_treinamento, fotos: [], operadores: [{ k: 'a', nome: '', cpf: '' }] });
await db.put('treinamentos', { id: 'L9', userId: 'U1', agendamentoId: 'AG-SUMIU', status: 'rascunho', criadoEm: 1, atualizadoEm: 4, cliente: 'GAMA', data: hoje(), fotos: [], operadores: [] });
await renderInicio({ agenda: [AG_HOJE, AG], avisos: { estado: 'ativo' } });
ok([...document.querySelectorAll('#agenda-AG1 button')].some(b => b.textContent === 'Continuar') && document.querySelector('#agenda-AG1').textContent.includes('Em andamento'), 'agendamento já começado neste aparelho: Continuar');
await clicar([...document.querySelectorAll('#agenda-AG1 button')].find(b => b.textContent === 'Continuar'));
ok(chamadas.abrir[0] === 'L1', 'Continuar abre o rascunho existente (não cria outro)');
const emAndamento = [...document.querySelectorAll('.lista')].slice(1).map(l => l.textContent).join(' ');
ok(!emAndamento.includes('ACME LTDA') && emAndamento.includes('GAMA'), 'rascunho do agendamento não aparece duas vezes; o de agendamento cancelado continua em "Em andamento"');
ok(!txt().includes('Receba aviso'), 'avisos já ativos: sem convite');

await db.put('treinamentos', { id: 'L1', userId: 'U1', agendamentoId: 'AG1', status: 'pronto', criadoEm: 1, atualizadoEm: 6, finalizadoEm: 6, cliente: 'ACME LTDA', cidade: 'FORTALEZA', uf: 'CE', data: AG.data_treinamento, fotos: [], operadores: [] });
await renderInicio({ agenda: [AG] });
ok(document.querySelector('#agenda-AG1').textContent.includes('Aguardando envio') && !document.querySelector('#agenda-AG1 button'), 'finalizado e na fila: mostra a situação, sem botão');
await db.put('treinamentos', { id: 'L1', userId: 'U1', agendamentoId: 'AG1', status: 'enviado', enviadoEm: 7, criadoEm: 1, atualizadoEm: 7, cliente: 'ACME LTDA', data: AG.data_treinamento, fotos: [], operadores: [] });
await renderInicio({ agenda: [AG] });
ok(!document.querySelector('#agenda-AG1') && txt().includes('Nenhum treinamento agendado'), 'já enviado: sai da lista de agendados');
await renderInicio({ agenda: [{ ...AG, id: 'AGB', data_treinamento: diaMais(5) }, { ...AG_HOJE, id: 'AGA' }] });
ok([...document.querySelectorAll('.item.agenda')].map(e => e.id).join(',') === 'agenda-AGA,agenda-AGB', 'agendados em ordem de data (o mais próximo primeiro)');
await renderInicio({ agenda: [], avisos: { estado: 'bloqueado' } });
ok(txt().includes('Avisos desligados neste celular') && !txt().includes('Receba aviso'), 'avisos bloqueados: explica como ligar, sem ocupar o topo da tela');
await renderInicio({ agenda: null, avisos: { estado: 'pedir' } });
ok(!txt().includes('Agendados para você') && botao('Novo treinamento'), 'banco sem agenda: tela como antes');
await renderInicio({ agenda: [AG_HOJE], destaque: 'AG0' });
ok(document.querySelector('#agenda-AG0').classList.contains('destaque') && g.__rolouPara === 'agenda-AG0', 'aviso tocado: destaca e rola até o agendamento');
await renderInicio({ agenda: [{ ...AG, id: 'AGV', data_treinamento: diaMais(-2) }] });
ok(document.querySelector('#agenda-AGV .situ').textContent === 'Data passou' && document.querySelector('#agenda-AGV .situ').classList.contains('err'), 'agendamento com data passada fica em destaque vermelho');

console.log('4) Editor aberto a partir do agendamento');
const rasc = rascunhoDeAgenda(AG, 'U1');
await db.put('treinamentos', rasc);
await act(async () => { root.render(<Editor id={rasc.id} listas={{ fabricantes: ['Genie', 'JLG'], maquinas: [], clientes: [] }} aoVoltar={() => {}} aoFinalizar={() => {}} />); });
await act(async () => { await espera(100); });
ok(txt().includes('Agendado pela Kimtech') && txt().includes('às 08:00') && txt().includes('Levar 2 cintos extras'), 'mostra que veio do agendamento, com horário e observação');
ok(txt().includes('não é a de hoje'), 'alerta quando a data do agendamento não é hoje');
ok(document.querySelector('main input').value === 'ACME LTDA' && document.querySelector('main select').value === 'CE', 'campos da turma preenchidos');
ok(document.querySelector('.chip[aria-pressed="true"]')?.textContent === 'Genie' && document.querySelectorAll('.tags li').length === 1, 'fabricante marcado e máquina listada');
const rascHoje = rascunhoDeAgenda(AG_HOJE, 'U1');
await db.put('treinamentos', rascHoje);
await act(async () => { root.render(<Editor key="h" id={rascHoje.id} listas={{ fabricantes: [], maquinas: [], clientes: [] }} aoVoltar={() => {}} aoFinalizar={() => {}} />); });
await act(async () => { await espera(100); });
ok(txt().includes('Agendado pela Kimtech') && !txt().includes('não é a de hoje'), 'sem alerta de data quando o agendamento é hoje');
await act(async () => { root.render(<div />); });

console.log('5) Avisos no celular (inscrição)');
function janela(perm, { chaveAtual = null, falharSalvar = false } = {}) {
  const log = { pediu: 0, inscreveu: [], desinscreveu: 0, rpc: [] };
  let sub = chaveAtual ? {
    endpoint: 'https://fcm.googleapis.com/fcm/send/antigo', options: { applicationServerKey: chaveAtual.buffer },
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/antigo', keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }),
    unsubscribe: async () => { log.desinscreveu++; sub = null; return true; }
  } : null;
  const pushManager = {
    getSubscription: async () => sub,
    subscribe: async op => {
      log.inscreveu.push(op);
      sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/novo', options: op, toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/novo', keys: { p256dh: 'B'.repeat(87), auth: 'c'.repeat(22) } }), unsubscribe: async () => true };
      return sub;
    }
  };
  const reg = { pushManager };
  const w = {
    PushManager: function () {},
    Notification: { permission: perm, requestPermission: async () => { log.pediu++; w.Notification.permission = 'granted'; return 'granted'; } },
    navigator: { userAgent: 'Android Chrome', serviceWorker: { ready: Promise.resolve(reg), getRegistration: async () => reg } }
  };
  const supa = { rpc: async (nome, args) => { log.rpc.push({ nome, args }); return falharSalvar ? { data: null, error: { message: 'Failed to fetch' } } : { data: { ok: true }, error: null }; } };
  return { w, supa, log };
}
{
  ok(permissaoAvisos({}) === 'sem-suporte', 'navegador sem suporte: não oferece avisos');
  let j = janela('default');
  let res = await ativarAvisos(j.supa, { w: j.w });
  ok(res.estado === 'pedir' && j.log.pediu === 0 && j.log.rpc.length === 0, 'ao abrir o app, NÃO pergunta sozinho (só depois do toque)');
  res = await ativarAvisos(j.supa, { pedir: true, w: j.w });
  ok(res.ok && res.estado === 'ativo' && j.log.pediu === 1, 'toque em Ativar: pede permissão e ativa');
  const k = j.log.inscreveu[0].applicationServerKey;
  ok(j.log.inscreveu[0].userVisibleOnly === true && k.length === 65 && k[0] === 4 && k.every((x, i) => x === chaveParaBytes(VAPID_PUBLIC_KEY)[i]), 'inscreve com a chave pública VAPID do app');
  const salvo = j.log.rpc.find(x => x.nome === 'push_salvar');
  ok(salvo && salvo.args.p.endpoint.endsWith('/novo') && salvo.args.p.p256dh.length === 87 && salvo.args.p.auth.length === 22 && salvo.args.p.user_agent === 'Android Chrome', 'guarda a inscrição no banco (push_salvar)');
  j = janela('denied');
  res = await ativarAvisos(j.supa, { pedir: true, w: j.w });
  ok(res.estado === 'bloqueado' && j.log.inscreveu.length === 0, 'permissão negada: estado bloqueado');
  j = janela('granted', { chaveAtual: chaveParaBytes(VAPID_PUBLIC_KEY) });
  res = await ativarAvisos(j.supa, { w: j.w });
  ok(res.ok && j.log.inscreveu.length === 0 && j.log.rpc[0].args.p.endpoint.endsWith('/antigo'), 'já inscrito com a mesma chave: só renova no banco (usuário atual)');
  j = janela('granted', { chaveAtual: new Uint8Array(65).fill(4) });
  res = await ativarAvisos(j.supa, { w: j.w });
  ok(res.ok && j.log.desinscreveu === 1 && j.log.inscreveu.length === 1, 'chave do servidor trocada: refaz a inscrição');
  j = janela('granted', { falharSalvar: true });
  let e = null; try { await ativarAvisos(j.supa, { w: j.w }); } catch (x) { e = x; }
  ok(e && /fetch/.test(e.message), 'falha ao salvar no banco: erro (a tela mostra "tente de novo")');
  j = janela('granted', { chaveAtual: chaveParaBytes(VAPID_PUBLIC_KEY) });
  await desligarAvisos(j.supa, j.w);
  ok(j.log.rpc[0] && j.log.rpc[0].nome === 'push_remover' && j.log.rpc[0].args.p_endpoint.endsWith('/antigo'), 'ao sair, o aparelho deixa de receber avisos desse usuário');
}

console.log('6) Envio liga o treinamento ao agendamento');
function supaEnvio({ erroVinc = null, respVinc = { ok: true } } = {}) {
  const s = {
    rpcs: [],
    auth: { getSession: async () => ({ data: { session: { user: { id: 'U1' } } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { nome: 'JOAQUIM' }, error: null }) }) }) }),
    storage: { from: () => ({ upload: async c => ({ data: { path: c }, error: null }) }) },
    rpc: async (nome, args) => {
      s.rpcs.push({ nome, args });
      if (nome === 'agenda_vincular') return typeof erroVinc === 'function' ? erroVinc() : erroVinc ? { data: null, error: erroVinc } : { data: respVinc, error: null };
      return { data: { ok: true, id: args.p.id }, error: null };
    }
  };
  return s;
}
async function treinamentoPronto(id, agendamentoId) {
  const foto = new Blob([new Uint8Array(30)], { type: 'image/jpeg' });
  const ass = new Blob([new Uint8Array(30)], { type: 'image/png' });
  const fotos = [];
  for (let i = 0; i < 3; i++) { await db.put('arquivos', { chave: `${id}:f${i}`, treinamentoId: id, tipo: 'foto', blob: foto }); fotos.push(`${id}:f${i}`); }
  await db.put('arquivos', { chave: `${id}:a`, treinamentoId: id, tipo: 'assinatura', blob: ass });
  await db.put('arquivos', { chave: `${id}:pdf`, treinamentoId: id, tipo: 'pdf', blob: new Blob([new Uint8Array(10)], { type: 'application/pdf' }) });
  await db.put('treinamentos', { id, userId: 'U1', status: 'pronto', criadoEm: 1, finalizadoEm: 1, cliente: 'ACME LTDA', local: 'PÁTIO', cidade: 'FORTALEZA', uf: 'CE', data: '2026-10-28',
    fabricantes: ['Genie'], maquinas: ['GS-1930'], fotos, operadores: [{ k: 'o', nome: 'MARIA SILVA', cpf: '529.982.247-25', funcao: '' }], assinaturas: { o: `${id}:a` }, ...(agendamentoId ? { agendamentoId } : {}) });
}
{
  await treinamentoPronto('S1', 'AG1');
  let s = supaEnvio();
  await criarSync({ supabase: s, db }).sincronizar({ ignorarEspera: true });
  const iReg = s.rpcs.findIndex(x => x.nome === 'registrar_treinamento'), iVin = s.rpcs.findIndex(x => x.nome === 'agenda_vincular');
  ok(iReg >= 0 && iVin > iReg && s.rpcs[iVin].args.p.treinamento_id === 'S1' && s.rpcs[iVin].args.p.agendamento_id === 'AG1', 'depois do registro, liga ao agendamento');
  ok((await db.get('treinamentos', 'S1')).status === 'enviado', 'treinamento enviado');
  ok(!('agendamento_id' in s.rpcs[iReg].args.p), 'o registro do treinamento não mudou (mesmos dados de antes)');

  await treinamentoPronto('S2', 'AG2');
  let n = 0;
  s = supaEnvio({ erroVinc: () => (++n === 1 ? { data: null, error: { message: 'Failed to fetch' } } : { data: { ok: true }, error: null }) });
  const sync = criarSync({ supabase: s, db });
  await sync.sincronizar({ ignorarEspera: true });
  let t2 = await db.get('treinamentos', 'S2');
  ok(t2.status === 'erro' && t2.tipoErro === 'rede', 'queda de rede na ligação: fica na fila para tentar de novo');
  await sync.sincronizar({ ignorarEspera: true });
  t2 = await db.get('treinamentos', 'S2');
  ok(t2.status === 'enviado' && s.rpcs.filter(x => x.nome === 'agenda_vincular').length === 2, 'na nova tentativa, registra (sem duplicar) e liga');

  await treinamentoPronto('S3', 'AG3');
  s = supaEnvio({ erroVinc: { code: 'PGRST202', message: 'Could not find the function public.agenda_vincular(p) in the schema cache' } });
  await criarSync({ supabase: s, db }).sincronizar({ ignorarEspera: true });
  ok((await db.get('treinamentos', 'S3')).status === 'enviado', 'banco sem a função (SQL 09 não rodado): o treinamento é enviado mesmo assim');

  await treinamentoPronto('S4', 'AG4');
  s = supaEnvio({ respVinc: { ok: false, motivo: 'agendamento não encontrado' } });
  await criarSync({ supabase: s, db }).sincronizar({ ignorarEspera: true });
  ok((await db.get('treinamentos', 'S4')).status === 'enviado', 'agendamento apagado pelo admin: treinamento enviado mesmo assim');

  await treinamentoPronto('S5', null);
  s = supaEnvio();
  await criarSync({ supabase: s, db }).sincronizar({ ignorarEspera: true });
  ok((await db.get('treinamentos', 'S5')).status === 'enviado' && !s.rpcs.some(x => x.nome === 'agenda_vincular'), 'treinamento avulso: não chama a ligação');
}

console.log('7) Service worker: notificação');
{
  const handlers = {};
  const mostradas = [], mensagens = [], abertas = [], focadas = [];
  let janelas = [];
  const ctx = {
    self: null, URL, console, Promise,
    caches: { open: async () => ({ addAll: async () => {}, put: async () => {} }), keys: async () => [], match: async () => undefined },
    fetch: async () => ({ ok: true, clone() { return this; } })
  };
  ctx.self = {
    location: new URL('https://treinamento.kimtechmanutencao.com.br/sw.js'),
    registration: { scope: 'https://treinamento.kimtechmanutencao.com.br/', showNotification: async (t, o) => { mostradas.push({ t, o }); } },
    clients: {
      matchAll: async () => janelas, claim: async () => {},
      openWindow: async u => { abertas.push(u); }
    },
    skipWaiting: async () => {},
    addEventListener: (tipo, fn) => { handlers[tipo] = fn; }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), ctx);
  const disparar = async (tipo, ev) => { let p = null; await handlers[tipo]({ ...ev, waitUntil: x => { p = x; } }); await p; };
  janelas = [{ url: 'https://treinamento.kimtechmanutencao.com.br/', postMessage: m => mensagens.push(m), focus: async () => { focadas.push(1); } }];
  await disparar('push', { data: { json: () => ({ titulo: 'Novo treinamento agendado', corpo: 'ACME LTDA – amanhã às 08:00', url: 'https://treinamento.kimtechmanutencao.com.br/?agenda=AG1', tag: 'agenda-AG1' }) } });
  ok(mostradas[0] && mostradas[0].t === 'Novo treinamento agendado' && mostradas[0].o.body.includes('ACME') && mostradas[0].o.tag === 'agenda-AG1' && mostradas[0].o.badge === './badge-96.png', 'mostra a notificação com título, texto e ícone');
  ok(mensagens[0] && mensagens[0].tipo === 'aviso', 'app aberto recebe sinal para atualizar a agenda');
  await disparar('push', { data: { json: () => { throw new Error('x'); }, text: () => 'texto simples' } });
  ok(mostradas[1] && mostradas[1].t === 'Treinamento PEMT' && mostradas[1].o.body === 'texto simples', 'aviso fora do formato ainda aparece');
  const notif = { data: { url: 'https://treinamento.kimtechmanutencao.com.br/?agenda=AG1' }, close() { this.fechada = true; } };
  await disparar('notificationclick', { notification: notif });
  ok(notif.fechada && focadas.length === 1 && mensagens.some(m => m.tipo === 'abrir' && m.url.endsWith('?agenda=AG1')), 'tocar com o app aberto: foca o app e abre o agendamento');
  janelas = [{ url: 'https://treinamento.kimtechmanutencao.com.br/admin/', postMessage: () => {}, focus: async () => { focadas.push('admin'); } }];
  await disparar('notificationclick', { notification: { data: { url: 'https://site-estranho.com/x' }, close() {} } });
  ok(abertas[0] === 'https://treinamento.kimtechmanutencao.com.br/' && !focadas.includes('admin'), 'app fechado: abre o app (nunca outro site nem a página admin)');
}

console.log(`\nResultado: ${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
