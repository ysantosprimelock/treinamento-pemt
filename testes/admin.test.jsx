// Painel admin num DOM simulado (jsdom), com o acesso ao banco simulado.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://treinamento.kimtechmanutencao.com.br/admin/' });
const g = globalThis;
g.window = dom.window; g.document = dom.window.document; g.localStorage = dom.window.localStorage;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
for (const k of ['HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HashChangeEvent']) g[k] = dom.window[k];
g.requestAnimationFrame = cb => setTimeout(cb, 0); g.cancelAnimationFrame = id => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;
let confirmar = true;
g.confirm = () => confirmar; g.alert = () => {}; dom.window.confirm = g.confirm;
const blobs = [];
URL.createObjectURL = b => { blobs.push(b); return 'blob:csv'; }; URL.revokeObjectURL = () => {};
dom.window.HTMLAnchorElement.prototype.click = function () { g.__baixou = this.download; };

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { hoje } = await import('../src/lib/util.js');
const AdminApp = (await import('../src/admin/AdminApp.jsx')).default;
const { lerRota } = await import('../src/admin/AdminApp.jsx');
const { filtrarAgenda, textoAviso, resumoAviso, urlApp } = await import('../src/admin/Agenda.jsx');
const { resultado, somarAnos, fmtCpf } = await import('../src/admin/comum.jsx');
const { traduzirErro, erroDaFuncao } = await import('../src/admin/api.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FALHA', m); } };
const espera = ms => new Promise(r => setTimeout(r, ms));
const txt = () => document.body.textContent;
const botao = (rot, base = document) => [...base.querySelectorAll('button, a.btn')].find(b => b.textContent.trim() === rot);
const clicar = async el => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); await act(async () => { await espera(40); }); };
const digitar = async (el, valor) => {
  const proto = el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, valor);
  await act(async () => { el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
};
const sair = async el => { await act(async () => { el.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })); el.dispatchEvent(new dom.window.FocusEvent('blur')); }); await act(async () => { await espera(40); }); };
const irPara = async h => { await act(async () => { dom.window.location.hash = h; dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange')); }); await act(async () => { await espera(60); }); };
const campo = rotulo => { const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim().startsWith(rotulo)); return l && l.querySelector('input, select, textarea'); };
const diaMais = n => { const d = new Date(hoje() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

console.log('1) Funções');
ok(lerRota('#/treinamentos/abc').aba === 'treinamentos' && lerRota('#/treinamentos/abc').id === 'abc' && lerRota('').aba === 'agenda' && lerRota('#/xyz').aba === 'agenda', 'rotas do painel');
ok(urlApp({ href: 'https://treinamento.kimtechmanutencao.com.br/admin/' }) === 'https://treinamento.kimtechmanutencao.com.br/', 'link do app a partir do painel');
ok(somarAnos('2026-10-27', 2) === '2028-10-27' && somarAnos('2028-02-29', 2) === '2030-02-28', 'validade de 2 anos (29/02 vira 28/02)');
ok(fmtCpf('52998224725') === '529.982.247-25', 'CPF formatado');
ok(resultado({ modo: 'qr', acertos: 6, total: 10, aprovado: true, decisao_instrutor: true }).txt === 'Aprovado pelo instrutor' && resultado({ modo: 'papel', acertos: 8, total: 10, aprovado: true, decisao_instrutor: null }).det === 'nota 8 de 10', 'resultado mostra a decisão do instrutor e a nota real');
ok(textoAviso({ cliente: 'ACME', data_treinamento: '2026-10-30', horario: '08:00:00', local_treinamento: 'PÁTIO 3', cidade: 'FORTALEZA', uf: 'CE' }, 'novo').corpo === 'ACME – 30/10/2026 às 08:00 – PÁTIO 3 — FORTALEZA/CE', 'texto do aviso no celular');
ok(resumoAviso({ aparelhos: 0 }) === 'nenhum celular com avisos ativos' && resumoAviso({ aparelhos: 2, enviados: 1, falhas: 1 }) === '1 de 2 celular(es), 1 falha(s)', 'resumo do aviso');
ok(/09_agenda_avisos_admin/.test(traduzirErro({ code: 'PGRST202', message: 'Could not find the function public.admin_treinamentos' }).message), 'banco sem o SQL 09: diz qual arquivo rodar');
{
  const e404 = await erroDaFuncao({ name: 'FunctionsHttpError', context: { status: 404, json: async () => ({}) } });
  const e403 = await erroDaFuncao({ name: 'FunctionsHttpError', context: { status: 403, json: async () => ({ erro: 'Acesso restrito ao administrador.' }) } });
  ok(/não está instalada/.test(e404.message) && e403.message === 'Acesso restrito ao administrador.', 'erros da função de avisos em texto claro');
}
{
  const ags = [{ status: 'agendado', data_treinamento: diaMais(3) }, { status: 'agendado', data_treinamento: diaMais(1), horario: '09:00' }, { status: 'agendado', data_treinamento: diaMais(-1) }, { status: 'realizado', data_treinamento: diaMais(-5) }, { status: 'cancelado', data_treinamento: diaMais(2) }];
  const p = filtrarAgenda(ags, 'proximos');
  ok(p.length === 2 && p[0].data_treinamento === diaMais(1), 'próximos: só agendados de hoje em diante, do mais próximo');
  ok(filtrarAgenda(ags, 'atrasados').length === 1 && filtrarAgenda(ags, 'realizados').length === 1 && filtrarAgenda(ags, 'cancelados').length === 1 && filtrarAgenda(ags, 'todos').length === 5, 'demais filtros');
}

// ---------- Banco simulado ----------
const INSTR = [
  { id: 'IA', nome: 'JOAQUIM LUIZ DE OLIVEIRA NETO', papel: 'instrutor', ativo: true, email: 'joaquim@kimtechmanutencao.com.br', treinamentos: 4, ultimo_treinamento: '2026-10-20', agendados: 1, aparelhos_aviso: 1, ultimo_acesso: '2026-10-26T12:00:00Z' },
  { id: 'IB', nome: 'RAFAEL VERAS', papel: 'instrutor', ativo: true, email: 'rafael@kimtechmanutencao.com.br', treinamentos: 1, ultimo_treinamento: null, agendados: 0, aparelhos_aviso: 0, ultimo_acesso: null },
  { id: 'ADM', nome: 'YURI', papel: 'admin', ativo: true, email: 'adm@kimtechmanutencao.com.br', treinamentos: 0, agendados: 0, aparelhos_aviso: 0 },
  { id: 'IX', nome: 'EX INSTRUTOR', papel: 'instrutor', ativo: false, email: 'x@k.com', treinamentos: 2, agendados: 0, aparelhos_aviso: 0 }
];
const TR = { id: 'T1', instrutor_id: 'IA', instrutor_nome: 'JOAQUIM LUIZ DE OLIVEIRA NETO', cliente: 'ACME LTDA', local_treinamento: 'PÁTIO 2', cidade: 'FORTALEZA', uf: 'CE', data_treinamento: '2026-10-20',
  email_cliente: 'sst@acme.com.br', enviado_em: '2026-10-20T18:00:00Z', criado_no_aparelho_em: '2026-10-20T13:00:00Z', drive_status: 'ok', drive_processado_em: '2026-10-20T18:05:00Z', drive_pasta_url: 'https://drive.google.com/x',
  cert_status: 'enviado', agendamento_id: null, n_participantes: 2, n_avaliados: 2, n_aprovados: 1, n_fotos: 2 };
const DETALHE = {
  treinamento: { ...TR },
  fabricantes_vinculados: ['Genie', 'JLG'], maquinas_vinculadas: ['GS-1930'],
  participantes: [
    { id: 'P1', ordem: 1, nome: 'MARIA DA SILVA', cpf: '52998224725', funcao: 'OPERADORA', assinatura_path: 'IA/T1/assinaturas/01.png',
      avaliacao: { modo: 'qr', prova_id: 'PEMT-1', respostas: [1, 0], acertos: 1, total: 2, aprovado: true, decisao_instrutor: true, comprovante_path: 'IA/T1/provas/01.pdf' } },
    { id: 'P2', ordem: 2, nome: 'JOSE SOUZA', cpf: '11144477735', funcao: null, assinatura_path: 'IA/T1/assinaturas/02.png', avaliacao: { modo: 'instrutor', decisao_instrutor: false, aprovado: false } }
  ],
  fotos: [{ ordem: 1, storage_path: 'IA/T1/fotos/01.jpg' }, { ordem: 2, storage_path: 'IA/T1/fotos/02.jpg' }],
  provas: { 'PEMT-1': { id: 'PEMT-1', questoes: [{ p: 'Antes de operar, o que fazer?', a: ['Nada', 'Inspeção pré-uso', 'Correr', 'Dormir'], c: 1 }, { p: 'Usar cinto?', a: ['Não', 'Sim'], c: 1 }] } },
  agendamento: null
};
function criarApiFalsa({ admin = true, falharAviso = null, aparelhos = 1 } = {}) {
  const log = { salvos: [], avisos: [], marcados: [], vinculos: [], buscas: [] };
  let sessao = { user: { id: 'ADM', email: 'adm@kimtechmanutencao.com.br' } };
  const ouvintes = [];
  let ags = [
    { id: 'AG1', cliente: 'BETA SA', data_treinamento: diaMais(2), horario: '08:00:00', local_treinamento: 'OBRA', cidade: 'MARACANAU', uf: 'CE', instrutor_id: 'IA', status: 'agendado', observacoes: 'Portaria 2', fabricantes: [], maquinas: [], avisado_em: null },
    { id: 'AG2', cliente: 'ACME LTDA', data_treinamento: '2026-10-20', horario: null, instrutor_id: 'IA', status: 'realizado', fabricantes: [], maquinas: [] },
    { id: 'AG3', cliente: 'GAMA', data_treinamento: diaMais(-3), instrutor_id: 'IB', status: 'agendado', fabricantes: [], maquinas: [] }
  ];
  const api = {
    log,
    sb: {
      auth: {
        getSession: async () => ({ data: { session: sessao } }),
        onAuthStateChange: fn => { ouvintes.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
        signOut: async () => { sessao = null; ouvintes.forEach(f => f('SIGNED_OUT', null)); },
        signInWithPassword: async () => ({ error: null })
      }
    },
    ehAdmin: async () => admin,
    instrutores: async () => INSTR,
    listas: async () => ({ fabricantes: ['Genie', 'JLG', 'Skyjack'], maquinas: ['3219'], clientes: ['ACME LTDA', 'BETA SA'] }),
    agendamentos: async () => ags.map(a => ({ ...a })),
    treinamentosLigados: async () => [{ id: 'T1', agendamento_id: 'AG2' }],
    clientePadrao: async nome => (nome.toUpperCase().includes('ACME') ? { local_treinamento: 'PÁTIO 2', cidade: 'FORTALEZA', uf: 'CE', email_cliente: 'sst@acme.com.br' } : null),
    salvarAgendamento: async dados => {
      log.salvos.push(dados);
      if (dados.id) { const i = ags.findIndex(a => a.id === dados.id); ags[i] = { ...ags[i], ...dados }; return { ...ags[i] }; }
      const novo = { ...dados, id: 'AGN', status: 'agendado' };
      ags.push(novo);
      return { ...novo };
    },
    marcarAviso: async (id, r) => { log.marcados.push({ id, r }); return {}; },
    avisar: async p => { log.avisos.push(p); if (falharAviso) throw new Error(falharAviso); return { aparelhos, enviados: aparelhos, falhas: 0, removidos: 0 }; },
    treinamentos: async f => { log.buscas.push(f); return [{ ...TR }, { ...TR, id: 'T2', cliente: 'BETA SA', drive_status: 'erro', n_participantes: 3, n_avaliados: 3, n_aprovados: 3, n_fotos: 3 }]; },
    treinamento: async () => JSON.parse(JSON.stringify(DETALHE)),
    urls: async caminhos => Object.fromEntries(caminhos.filter(Boolean).map(c => [c, c.includes('lista-presenca') ? 'https://x/lista.pdf' : 'https://x/' + c])),
    vincular: async (t, a) => { log.vinculos.push([t, a]); return { ok: true }; },
    desvincular: async () => ({ ok: true }),
    operadores: async b => (b.includes('maria') || b.includes('529') ? [{ participante_id: 'P1', nome: 'MARIA DA SILVA', cpf: '52998224725', funcao: 'OPERADORA', treinamento_id: 'T1', cliente: 'ACME LTDA', data_treinamento: '2023-10-20', cidade: 'FORTALEZA', uf: 'CE', instrutor_nome: 'JOAQUIM', aprovado: true, modo: 'qr', acertos: 8, total: 10, decisao_instrutor: null }] : [])
  };
  return api;
}

const root = createRoot(document.getElementById('root'));
async function montar(api) {
  await act(async () => { root.render(<AdminApp key={Math.random()} api={api} />); });
  await act(async () => { await espera(120); });
}

console.log('2) Acesso');
{
  const api = criarApiFalsa({ admin: false });
  await montar(api);
  ok(txt().includes('Sem acesso ao painel') && txt().includes('não é de administrador'), 'login que não é admin: sem acesso');
  await clicar(botao('Sair'));
  ok(txt().includes('Painel de treinamentos') && !!campo('E-mail'), 'ao sair, volta para a tela de entrar');
}

console.log('3) Agenda');
let api = criarApiFalsa();
await montar(api);
ok(txt().includes('Agenda') && [...document.querySelectorAll('.adm-abas a')].map(a => a.textContent).join('|') === 'Agenda|Treinamentos|Operadores|Instrutores', 'abas do painel');
ok(document.querySelector('.adm-abas a[aria-current="page"]').textContent === 'Agenda', 'abre na agenda');
ok(txt().includes('BETA SA') && txt().includes('Portaria 2') && !txt().includes('GAMA'), 'próximos agendamentos (sem os de data passada)');
const seg = [...document.querySelectorAll('.adm-seg')];
ok(seg.find(b => b.textContent.startsWith('Próximos')).textContent.endsWith('1') && seg.find(b => b.textContent.startsWith('Data passou')).textContent.endsWith('1'), 'contagem por situação');
await clicar(seg.find(b => b.textContent.startsWith('Realizados')));
ok(txt().includes('ACME LTDA') && botao('Ver treinamento') && botao('Ver treinamento').getAttribute('href') === '#/treinamentos/T1', 'realizado mostra link para o treinamento feito');
await clicar(seg.find(b => b.textContent.startsWith('Próximos')));

await clicar(botao('Novo agendamento'));
ok(txt().includes('Novo agendamento') && document.querySelector('[role="dialog"]'), 'abre o formulário');
await clicar(botao('Salvar agendamento'));
ok(txt().includes('Informe o cliente.') && txt().includes('Escolha o instrutor.') && api.log.salvos.length === 0, 'não salva sem cliente, data e instrutor');
await digitar(campo('Cliente'), 'acme ltda');
await sair(campo('Cliente'));
ok(campo('Cidade').value === 'FORTALEZA' && campo('UF').value === 'CE' && campo('E-mails').value === 'sst@acme.com.br', 'cliente já atendido: completa local, cidade, UF e e-mail');
await digitar(campo('Data'), diaMais(3));
await digitar(campo('Horário'), '07:30');
const opsInstr = [...campo('Instrutor').querySelectorAll('option')].map(o => o.textContent);
ok(opsInstr.some(o => o.startsWith('RAFAEL VERAS (sem avisos')) && !opsInstr.some(o => o.startsWith('EX INSTRUTOR')), 'lista de instrutores: só ativos, avisando quem não tem avisos no celular');
await digitar(campo('Instrutor'), 'IA');
await clicar([...document.querySelectorAll('[role="dialog"] .chip')].find(b => b.textContent === 'JLG'));
await digitar(document.querySelector('[role="dialog"] input[list="adm-maquinas"]'), 'gs-1930');
await clicar(document.querySelector('[role="dialog"] input[list="adm-maquinas"]').parentElement.querySelector('button'));
await digitar(campo('Observações'), 'Falar com Pedro na portaria');
await clicar(botao('Salvar agendamento'));
const s1 = api.log.salvos[0];
ok(s1 && s1.cliente === 'ACME LTDA' && s1.cidade === 'FORTALEZA' && s1.instrutor_id === 'IA' && s1.horario === '07:30' && s1.fabricantes[0] === 'JLG' && s1.maquinas[0] === 'GS-1930' && s1.observacoes === 'Falar com Pedro na portaria', 'salva o agendamento com todos os campos');
const a1 = api.log.avisos[0];
ok(a1 && a1.usuarios[0] === 'IA' && a1.titulo === 'Novo treinamento agendado' && a1.url === 'https://treinamento.kimtechmanutencao.com.br/?agenda=AGN' && a1.corpo.startsWith('ACME LTDA'), 'avisa o instrutor no celular com link para o agendamento');
ok(api.log.marcados[0] && api.log.marcados[0].r === '1 de 1 celular(es)', 'registra o resultado do aviso no agendamento');
ok(document.querySelector('.adm-msg').textContent.includes('Agendamento salvo. Aviso enviado para 1 de 1 celular(es).') && !document.querySelector('[role="dialog"]'), 'mensagem de confirmação e formulário fechado');

await clicar(botao('Editar'));
ok(campo('Cliente').value === 'BETA SA' && campo('Horário').value === '08:00', 'editar abre com os dados do agendamento');
await digitar(campo('Instrutor'), 'IB');
await clicar(botao('Salvar alterações'));
ok(api.log.salvos[1].id === 'AG1' && api.log.salvos[1].instrutor_id === 'IB', 'troca de instrutor salva');
ok(api.log.avisos[1].usuarios[0] === 'IB' && api.log.avisos[1].titulo === 'Novo treinamento agendado', 'novo instrutor recebe aviso de "novo treinamento"');

api = criarApiFalsa({ falharAviso: 'A função de avisos (enviar-push) ainda não está instalada no Supabase.' });
await montar(api);
await clicar(botao('Editar'));
await digitar(campo('Observações'), 'Mudou a portaria');
await clicar(botao('Salvar alterações'));
ok(api.log.salvos.length === 1 && document.querySelector('.adm-msg.err').textContent.includes('Alterações salvas. O aviso no celular não foi enviado: A função de avisos (enviar-push) ainda não está instalada'), 'aviso falhou: agendamento salvo mesmo assim, com o motivo');

api = criarApiFalsa({ aparelhos: 0 });
await montar(api);
await clicar(botao('Avisar instrutor'));
ok(document.querySelector('.adm-msg').textContent.includes('ainda não ativou os avisos'), 'instrutor sem celular inscrito: explica que ele verá ao abrir o app');
await clicar([...document.querySelectorAll('button.link')].find(b => b.textContent === 'Cancelar'));
await digitar(campo('Motivo'), 'cliente remarcou');
await clicar(botao('Cancelar agendamento'));
ok(api.log.salvos[0].status === 'cancelado' && api.log.salvos[0].motivo_cancelamento === 'cliente remarcou', 'cancela com motivo');
ok(api.log.avisos[1].titulo === 'Treinamento cancelado' && api.log.avisos[1].corpo.includes('cliente remarcou'), 'avisa o cancelamento');
await clicar([...document.querySelectorAll('.adm-seg')].find(b => b.textContent.startsWith('Cancelados')));
await clicar(botao('Reabrir'));
ok(api.log.salvos[1].status === 'agendado', 'reabre agendamento cancelado');

console.log('4) Treinamentos');
api = criarApiFalsa();
await montar(api);
await irPara('#/treinamentos');
ok(api.log.buscas[0] && api.log.buscas[0].ate === hoje() && api.log.buscas[0].de < hoje(), 'carrega os últimos 90 dias');
const tot = document.querySelector('.adm-totais').textContent;
ok(tot.includes('Turmas2') && tot.includes('Operadores treinados5') && tot.includes('4 de 5 avaliados (80%)') && tot.includes('Com erro no Drive1'), 'totais do período (turmas, operadores, aprovação, Drive)');
ok(txt().includes('Erro no Drive') && txt().includes('No Drive'), 'situação do Drive na lista');
await digitar(campo('Cliente, cidade'), '529.982');
await clicar(botao('Buscar'));
ok(api.log.buscas[1].busca === '529.982', 'busca por CPF/nome/cliente');
await clicar(botao('Exportar planilha (CSV)'));
const csvBytes = new Uint8Array(await blobs[blobs.length - 1].arrayBuffer());
const csv = new TextDecoder().decode(csvBytes);
ok(csvBytes[0] === 0xEF && csvBytes[1] === 0xBB && csvBytes[2] === 0xBF && csv.includes('Data;Cliente;Local') && csv.includes('20/10/2026;ACME LTDA') && g.__baixou.startsWith('treinamentos-'), 'exporta planilha CSV (Excel, com acentos)');

await irPara('#/treinamentos/T1');
ok(txt().includes('ACME LTDA') && txt().includes('Genie / JLG') && txt().includes('sst@acme.com.br'), 'detalhe: dados da turma');
ok(botao('Lista de presença (PDF)') && botao('Lista de presença (PDF)').getAttribute('href') === 'https://x/lista.pdf' && botao('Pasta no Drive'), 'abre a lista de presença em PDF e a pasta do Drive');
ok(document.querySelectorAll('.adm-foto img').length === 2, 'fotos da prática');
const linhas = [...document.querySelectorAll('.adm-presenca tbody tr')];
ok(linhas[0].textContent.includes('MARIA DA SILVA') && linhas[0].textContent.includes('529.982.247-25') && linhas[0].querySelector('.adm-assin img').getAttribute('src').endsWith('assinaturas/01.png'), 'lista de presença com CPF e assinatura de cada operador');
ok(linhas[0].textContent.includes('Aprovado pelo instrutor') && linhas[0].textContent.includes('nota 1 de 2') && linhas[0].textContent.includes('20/10/2028'), 'resultado com a nota real, decisão do instrutor e validade');
ok(linhas[1].textContent.includes('Reprovado pelo instrutor') && linhas[1].textContent.includes('Sem prova'), 'reprovação direta do instrutor');
ok(botao('Comprovante') && botao('Comprovante').getAttribute('href').endsWith('provas/01.pdf'), 'comprovante da prova');
await clicar(botao('Ver respostas'));
const resp = document.querySelector('.adm-respostas').textContent;
ok(resp.includes('Antes de operar') && resp.includes('Marcou: B) Inspeção pré-uso ✓') && resp.includes('Marcou: A) Não ✗') && resp.includes('Correta: B) Sim'), 'respostas questão por questão, com a correta');
ok(document.querySelector('.adm-auditoria').textContent.includes('cert_status') && document.querySelector('.adm-auditoria').textContent.includes('Criado no aparelho em'), 'auditoria mostra todos os campos gravados (inclusive os que o painel não conhece)');
await clicar(document.querySelector('.adm-foto'));
ok(document.querySelector('.adm-foto-grande') && document.querySelector('.adm-foto-grande').getAttribute('src').endsWith('fotos/01.jpg'), 'foto amplia ao tocar');
await clicar(document.querySelector('.adm-fechar'));
await clicar(botao('Ligar a um agendamento'));
await act(async () => { await espera(60); });
const sel = campo('Agendamento');
ok(sel && [...sel.options].some(o => o.value === 'AG2') && ![...sel.options].some(o => o.textContent.includes('cancel')), 'escolhe agendamento para ligar');
await digitar(sel, 'AG1');
await clicar(botao('Ligar'));
ok(api.log.vinculos[0] && api.log.vinculos[0][0] === 'T1' && api.log.vinculos[0][1] === 'AG1', 'liga o treinamento ao agendamento');
await clicar(botao('Exportar operadores (CSV)'));
const csv2 = await blobs[blobs.length - 1].text();
ok(csv2.includes('MARIA DA SILVA;529.982.247-25;OPERADORA;Celular (QR);1;2;Aprovado pelo instrutor;aprovou;20/10/2028'), 'exporta operadores com resultado e validade');

console.log('5) Operadores e instrutores');
await irPara('#/operadores');
await digitar(campo('Nome ou CPF'), 'ma');
await clicar(botao('Buscar'));
ok(txt().includes('pelo menos 3'), 'pede pelo menos 3 caracteres');
await digitar(campo('Nome ou CPF'), 'maria');
await clicar(botao('Buscar'));
ok(txt().includes('MARIA DA SILVA') && txt().includes('20/10/2025 (vencido)') && botao('Abrir treinamento').getAttribute('href') === '#/treinamentos/T1', 'histórico do operador com validade (vencido) e link');
await irPara('#/instrutores');
const li = [...document.querySelectorAll('.adm-tabela tbody tr')];
ok(li.length === 4 && li[0].textContent.includes('joaquim@kimtechmanutencao.com.br') && li[0].textContent.includes('1 celular') && li[1].textContent.includes('não ativou'), 'instrutores com e-mail e situação dos avisos');
ok(li[1].querySelector('button').disabled && !li[0].querySelector('button').disabled, 'teste de aviso só para quem tem celular inscrito');
await clicar(li[0].querySelector('button'));
ok(api.log.avisos.at(-1).titulo === 'Aviso de teste' && document.querySelector('.adm-msg').textContent.includes('Aviso de teste enviado para 1 de 1'), 'envia aviso de teste');

console.log(`\nResultado: ${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
