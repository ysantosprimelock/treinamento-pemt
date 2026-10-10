// Teste de fumaça das telas: renderiza Editor e Inicio num DOM simulado (jsdom) com banco local simulado.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://exemplo.github.io/app/' });
const g = globalThis;
g.window = dom.window; g.document = dom.window.document; g.localStorage = dom.window.localStorage;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
for (const k of ['HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLDialogElement']) g[k] = dom.window[k];
g.requestAnimationFrame = cb => setTimeout(cb, 0); g.cancelAnimationFrame = id => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;
let nUrl = 0; URL.createObjectURL = () => `blob:${++nUrl}`; URL.revokeObjectURL = () => {};
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLElement.prototype.setPointerCapture = function () {};
dom.window.HTMLCanvasElement.prototype.getContext = () => ({ setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {}, drawImage() {} });
dom.window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob([new Uint8Array(20)], { type: 'image/jpeg' })); };
g.createImageBitmap = async () => ({ width: 1600, height: 2200, close() {} });
g.confirm = () => true; g.alert = () => {}; g.scrollTo = () => {}; dom.window.scrollTo = () => {};

{ const f = await import('fake-indexeddb'); g.indexedDB = f.indexedDB; g.IDBKeyRange = f.IDBKeyRange; }
const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const db = await import('../src/lib/db.js');
const Editor = (await import('../src/telas/Editor.jsx')).default;
const Inicio = (await import('../src/telas/Inicio.jsx')).default;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FALHA', m); } };
const espera = ms => new Promise(r => setTimeout(r, ms));
const txt = () => document.body.textContent;
const botao = rot => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === rot);
const clicar = async el => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); await act(async () => { await espera(30); }); };
const digitar = async (el, valor) => {
  const proto = el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, valor);
  await act(async () => { el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
};

// Treinamento novo (vazio)
await db.put('treinamentos', { id: 'N1', userId: 'U1', status: 'rascunho', criadoEm: 1, atualizadoEm: 1, cliente: '', local: '', cidade: '', uf: '', data: '2026-10-02', fabricantes: [], maquinas: [], fotos: [], operadores: [{ k: 'a', nome: '', cpf: '', funcao: '' }], assinaturas: {} });

const root = createRoot(document.getElementById('root'));
let finalizou = false, voltou = false;
const listas = { fabricantes: ['Genie', 'JLG', 'Skyjack'], maquinas: ['3219'], clientes: ['ACME'] };

console.log('1) Editor: etapa Turma');
await act(async () => { root.render(<Editor id="N1" listas={listas} aoVoltar={() => { voltou = true; }} aoFinalizar={() => { finalizou = true; }} />); });
await act(async () => { await espera(80); });
ok(txt().includes('Dados da turma'), 'renderiza a etapa 1');
await clicar(botao('Avançar'));
ok(txt().includes('Informe o cliente.') && txt().includes('Marque ao menos um fabricante.'), 'bloqueia avanço com campos vazios e lista os erros');

const inputs = () => [...document.querySelectorAll('main input')];
await digitar(inputs()[0], 'acme logística');
await digitar(inputs()[1], 'pátio 2');
await digitar(inputs()[2], 'fortaleza');
await digitar(document.querySelector('main select'), 'CE');
const campoEmail = () => document.querySelector('input[inputmode="email"]');
await digitar(campoEmail(), 'Compras@ACME.com.br, sst@acme');
ok(txt().includes('E-mail incompleto ou inválido: sst@acme'), 'aponta qual e-mail da lista está inválido');
await clicar(botao('Avançar'));
ok(txt().includes('E-mail do cliente inválido: sst@acme'), 'não avança com e-mail inválido na lista');
await digitar(campoEmail(), 'Compras@ACME.com.br; sst@acme.com.br, compras@acme.com.br');
await clicar([...document.querySelectorAll('.chip')].find(b => b.textContent === 'JLG'));
ok(document.querySelector('.chip[aria-pressed="true"]')?.textContent === 'JLG', 'marca fabricante');
const inMaq = document.querySelector('input[list="dl-maquinas"]');
await digitar(inMaq, '3219');
await clicar(inMaq.parentElement.querySelector('button'));
await digitar(document.querySelector('input[list="dl-maquinas"]'), 'gs-1930');
await clicar(document.querySelector('input[list="dl-maquinas"]').parentElement.querySelector('button'));
ok(document.querySelectorAll('.tags li').length === 2, 'adiciona duas máquinas');
ok([...document.querySelectorAll('.tags li span')].map(e => e.textContent).join('|') === '3219|GS-1930', 'máquinas ficam em MAIÚSCULAS (gs-1930 → GS-1930)');
await act(async () => { await espera(400); });
let salvo = await db.get('treinamentos', 'N1');
ok(salvo.cliente === 'ACME LOGÍSTICA' && salvo.local === 'PÁTIO 2' && salvo.cidade === 'FORTALEZA', 'cliente, local e cidade gravados em MAIÚSCULAS (com acento)');
ok(salvo.uf === 'CE' && salvo.fabricantes[0] === 'JLG' && salvo.maquinas.length === 2, 'cada alteração é salva no aparelho (IndexedDB)');
ok(salvo.emailCliente === 'compras@acme.com.br; sst@acme.com.br, compras@acme.com.br', 'e-mails salvos em minúsculas enquanto digita');
ok(!!document.querySelector('header img.cab-logo[alt="Kimtech"]'), 'cabeçalho com a logo da Kimtech');
await clicar(botao('Avançar'));
ok(txt().includes('Operadores') && !!document.querySelector('.op'), 'avança para Operadores (2ª etapa: CPF antes da prova)');
ok([...document.querySelectorAll('.passos li')].map(l => l.textContent).join('|') === '1 Turma|2 Operadores|3 Prova|4 Fotos|5 Assinaturas', 'etapas na nova ordem: fotos depois da prova');
await clicar(botao('Avançar'));
ok(txt().includes('Operador 1: informe o nome completo.'), 'não avança sem operador preenchido');
await act(async () => { root.unmount(); });
ok(voltou === false, 'nada inesperado ao desmontar');

console.log('2) Editor: operadores, assinaturas e finalização');
const fotos = [];
for (let i = 0; i < 3; i++) { const chave = `C1:foto:${i}`; await db.put('arquivos', { chave, treinamentoId: 'C1', tipo: 'foto', blob: new Blob([new Uint8Array(10)]) }); fotos.push(chave); }
await db.put('treinamentos', { id: 'C1', userId: 'U1', status: 'rascunho', criadoEm: 1, atualizadoEm: 1, cliente: 'ACME', local: 'Pátio', cidade: 'Fortaleza', uf: 'CE', data: '2026-10-02', fabricantes: ['JLG'], maquinas: ['3219'], fotos, operadores: [{ k: 'a', nome: 'João da Silva', cpf: '529.982.247-25', funcao: '' }], assinaturas: {} });
const root2 = createRoot(document.getElementById('root'));
// API falsa da prova pelo QR code
const { PROVA_PEMT } = await import('../../tools/prova-pemt.js');
const { guardarProvas, _limparProvas, provaAtual } = await import('../src/prova/index.js');
const linhaBanco = { id: PROVA_PEMT.id, titulo: PROVA_PEMT.titulo, nota_minima: '0.700', questoes: PROVA_PEMT.questoes };
_limparProvas(); // aparelho ainda sem a prova (primeiro uso depois da atualização)
const chamadas = { abrir: [], resultados: 0, baixar: 0, assinatura: [] };
const PNG_B64 = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4));
let resultadosQr = [];
const apiFalsa = {
  abrirSessao: async t => { chamadas.abrir.push(t.operadores.map(o => o.cpf)); return { token: 'tok123', expira_em: '2026-10-08T23:00:00Z' }; },
  resultados: async () => { chamadas.resultados++; return resultadosQr; },
  baixarProvas: async () => { chamadas.baixar++; return guardarProvas([linhaBanco]); },
  assinatura: async (id, cpf) => { chamadas.assinatura.push(cpf); return { cpf, em: '2026-10-08T10:01:00Z', png: PNG_B64 }; }
};
const respQr = PROVA_PEMT.questoes.map((q, i) => (i < 8 ? q.c : (q.c + 1) % 4));
resultadosQr = [{ cpf: '52998224725', tentativa_id: 'TT1', prova_id: 'PEMT-1', respostas: respQr, acertos: 8, total: 10, aprovado: true, em: '2026-10-08T10:00:00Z', tentativas: 2, assinatura_em: '2026-10-08T10:01:00Z' }];
const renderEditor = (r, extra = {}) => act(async () => { r.render(<Editor id="C1" listas={listas} api={apiFalsa} online={true} carregarLogo={async () => null} aoVoltar={() => {}} aoFinalizar={() => { finalizou = true; }} {...extra} />); });
await renderEditor(root2);
await act(async () => { await espera(80); });
await clicar(botao('Avançar'));
ok(txt().includes('Operadores') && document.querySelectorAll('.op').length === 1, 'etapa Operadores com 1 operador');
await clicar(botao('+ Adicionar operador'));
const cpfIn = [...document.querySelectorAll('input[inputmode="numeric"]')][1];
const nomeIn = [...document.querySelectorAll('.op')][1].querySelector('input');
await digitar(nomeIn, 'maria souza');
await digitar(cpfIn, '12345678900');
ok(txt().includes('CPF inválido. Confira os números.'), 'aponta CPF inválido enquanto digita');
await digitar([...document.querySelectorAll('input[inputmode="numeric"]')][1], '12345678909');
ok([...document.querySelectorAll('input[inputmode="numeric"]')][1].value === '123.456.789-09', 'aplica máscara de CPF');
await clicar(botao('Avançar'));
ok(txt().includes('Pelo celular (QR code)') && txt().includes('No papel'), 'Prova vem logo depois dos operadores (QR code e papel)');
ok(chamadas.baixar === 1 && txt().includes('10 questões. Para passar: 7 acertos') && provaAtual().id === 'PEMT-1', 'prova que não estava no aparelho é baixada sozinha (com internet)');
ok(JSON.parse(localStorage.getItem('pemt.provas.v1')).provas['PEMT-1'].questoes.length === 10, 'prova fica guardada no aparelho para usar sem internet');
ok([...document.querySelectorAll('.res-lista .res')].every(e => e.textContent === 'Aguardando prova'), 'operadores começam aguardando a prova');
await clicar(botao('Avançar'));
ok(txt().includes('Falta o resultado da prova de 2 operador(es)'), 'não avança sem resultado de todos');

console.log('2b) Prova pelo QR code');
await clicar(botao('Mostrar QR code da prova'));
await act(async () => { await espera(150); });
ok(chamadas.abrir.length === 1 && chamadas.abrir[0].join() === '529.982.247-25,123.456.789-09', 'abre a sessão no servidor com os CPFs da turma');
ok(!!document.querySelector('.qr img[src^="data:image/png"]'), 'mostra o QR code');
const { linkProva } = await import('../src/lib/provaApi.js');
ok(linkProva('tok123', { origin: 'https://ysantosprimelock.github.io', pathname: '/treinamento-pemt/index.html' }) === 'https://ysantosprimelock.github.io/treinamento-pemt/?prova=tok123', 'link do QR aponta para o próprio app com ?prova=');
ok(chamadas.resultados >= 1 && txt().includes('Aprovado · 8 de 10 · celular'), 'resultado do celular aparece sozinho (8 de 10, aprovado)');
ok(chamadas.assinatura.join() === '52998224725' && txt().includes('Assinou no celular'), 'assinatura feita no celular do operador é baixada junto com o resultado');
await act(async () => { await espera(400); });
{ const c = await db.get('treinamentos', 'C1'); const blob = (await db.get('arquivos', 'C1:ass:a') || {}).blob;
  ok(c.assinaturas.a === 'C1:ass:a' && c.assinaturasQr.a === '2026-10-08T10:01:00Z' && blob && blob.size === 12, 'assinatura do celular guardada no aparelho como a do operador 1 (PNG)'); }
await clicar(botao('Atualizar resultados'));
await act(async () => { await espera(80); });
ok(chamadas.assinatura.length === 1, 'não baixa de novo a assinatura que já está no aparelho');

console.log('2c) Prova em papel e decisão do instrutor');
const linhas = () => [...document.querySelectorAll('.res-lista li')];
await clicar([...linhas()[1].querySelectorAll('button')].find(b => b.textContent === 'Lançar à mão'));
ok(!!document.querySelector('dialog .papel'), 'abre a tela para lançar as respostas do papel');
await clicar(botao('Salvar respostas'));
ok(txt().includes('Marque a resposta da(s) questão(ões): 1, 2, 3'), 'exige todas as respostas');
const grupos = [...document.querySelectorAll('.papel-bts')];
for (let i = 0; i < 10; i++) {
  const q = PROVA_PEMT.questoes[i];
  const marcar = i < 6 ? q.c : (q.c + 1) % 4;
  await clicar(grupos[i].querySelectorAll('button')[marcar]);
}
await clicar(botao('Salvar respostas'));
ok(!document.querySelector('dialog .papel') && linhas()[1].textContent.includes('Reprovado · 6 de 10 · papel'), 'papel corrigido no aparelho: 6 de 10 → reprovado');
await act(async () => { await espera(400); });
let cp = await db.get('treinamentos', 'C1');
const kMaria = cp.operadores[1].k;
ok(cp.provas[kMaria].modo === 'papel' && cp.provas[kMaria].respostas.length === 10 && cp.provas[kMaria].aprovado === false, 'respostas do papel salvas no aparelho');
const bt = (i, r) => [...linhas()[i].querySelectorAll('button')].find(b => b.textContent === r);
await clicar(bt(1, 'Aprovar'));
ok(linhas()[1].textContent.includes('Aprovado por você · prova: 6 de 10 · papel'), 'instrutor aprova quem não passou; a nota real continua guardada');
await clicar(bt(1, 'Aprovar'));
ok(linhas()[1].textContent.includes('Reprovado · 6 de 10 · papel'), 'tocar de novo desfaz a decisão (volta a valer a nota)');
await clicar(bt(1, 'Aprovar'));
await clicar(bt(0, 'Reprovar'));
ok(linhas()[0].textContent.includes('Reprovado por você · prova: 8 de 10 · celular'), 'instrutor pode reprovar quem passou na prova');
await clicar(bt(0, 'Reprovar'));
ok(linhas()[0].textContent.includes('Aprovado · 8 de 10 · celular'), 'e desfazer');
resultadosQr = [...resultadosQr, { cpf: '12345678909', tentativa_id: 'TT9', prova_id: 'PEMT-1', respostas: respQr, acertos: 2, total: 10, aprovado: false, em: '2026-10-08T10:05:00Z', tentativas: 1 }];
await clicar(botao('Atualizar resultados'));
await act(async () => { await espera(100); });
ok(linhas()[1].textContent.includes('Aprovado por você · prova: 6 de 10 · papel'), 'resultado do celular não sobrescreve o papel nem a decisão do instrutor');

console.log('2d) Correção pela foto');
// leitor falso: devolve o que "leu" em cada foto (o leitor real é testado em leitor.test.mjs)
const gabT = PROVA_PEMT.questoes.map(q => q.c);
const resp8 = gabT.map((c, i) => (i < 8 ? c : (c + 1) % 4));
const leituras = [
  { ok: true, pagina: 1, respostas: Object.fromEntries([5, 6, 7, 8, 9].map(q => [q, { k: resp8[q], duvida: false }])) },
  { ok: true, pagina: 0, respostas: Object.fromEntries([0, 1, 2, 3, 4].map(q => [q, q === 1 ? { k: null, duvida: true, motivo: 'mais de uma marcada' } : { k: resp8[q], duvida: false }])) }
];
let nFoto = 0;
const lerFotoFalso = async () => ({ leitura: leituras[nFoto++], previa: 'data:image/png;base64,iVBORw0KGgo=', blob: new Blob([new Uint8Array(30)], { type: 'image/jpeg' }) });
const lerFotoRuim = async () => ({ leitura: { ok: false, erro: 'Não encontrei os 4 quadrados pretos dos cantos.' } });
let leitorAtual = lerFotoRuim;
await renderEditor(root2, { lerFoto: (...a) => leitorAtual(...a), obterMapa: async () => ({ paginas: 2 }) });
await act(async () => { await espera(50); });
const fotoInput = () => document.querySelector('dialog input[type=file]');
const mandarFoto = async () => {
  Object.defineProperty(fotoInput(), 'files', { value: [new dom.window.File([new Uint8Array(10)], 'f.jpg', { type: 'image/jpeg' })], configurable: true });
  await act(async () => { fotoInput().dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  await act(async () => { await espera(50); });
};
await clicar(bt(1, 'Corrigir pela foto'));
ok(!!document.querySelector('dialog .foto-pags') && txt().includes('4 quadrados pretos'), 'abre a correção pela foto com a orientação para fotografar');
await mandarFoto();
ok(txt().includes('Não encontrei os 4 quadrados pretos'), 'foto ruim: explica o problema e deixa tirar outra');
leitorAtual = lerFotoFalso;
await mandarFoto();
ok(txt().includes('Página 2 lida. Agora fotografe a página 1.'), 'lê a página 2 primeiro (ordem não importa) e pede a outra');
await mandarFoto();
ok(txt().includes('Falta decidir 1 questão') && txt().includes('2 (mais de uma marcada)') && botao('Confirmar').disabled, 'questão em dúvida fica destacada e trava o Confirmar');
ok(document.querySelectorAll('dialog .papel li.duvida').length === 1, 'só a questão em dúvida aparece destacada');
await clicar(document.querySelectorAll('dialog .papel-bts')[1].querySelectorAll('button')[resp8[1]]);
ok(txt().includes('APROVADO') && txt().includes('8 de 10 acertos') && !botao('Confirmar').disabled, 'instrutor decide a dúvida: resultado sai na hora (8 de 10, APROVADO)');
await clicar(botao('Confirmar'));
await act(async () => { await espera(400); });
cp = await db.get('treinamentos', 'C1');
const pm = cp.provas[kMaria];
ok(!document.querySelector('dialog .foto-pags') && pm.modo === 'papel' && pm.acertos === 8 && pm.lidoPorFoto === true && pm.folhas.length === 2, 'salva: prova em papel lida pela foto, 8 acertos, 2 fotos da folha');
ok((await db.arquivosDe('C1')).filter(a => a.tipo === 'folha').length === 2, 'as 2 fotos ficam guardadas no aparelho (para o comprovante)');
await clicar(botao('Avançar'));
ok(txt().includes('Fotos da prática') && document.querySelectorAll('.grade figure').length === 3 && document.querySelectorAll('.roteiro li').length === 5 && !txt().includes('Plaqueta'), 'Fotos vem depois da prova, com o roteiro de 5 fotos da prática (sem plaqueta)');
await clicar(botao('Avançar'));
ok(txt().includes('Assinaturas') && txt().includes('1 de 2 assinaturas'), 'etapa Assinaturas mostra 1 de 2 (a do celular já conta)');
ok([...document.querySelectorAll('.assin li')][0].textContent.includes('Assinou no celular dele') && [...document.querySelectorAll('.assin li')][1].textContent.includes('Assinar'), 'mostra quem assinou no celular e quem assina aqui (prova no papel)');
ok(txt().includes('touchpad'), 'orienta assinar pelo touchpad no notebook');
ok(txt().includes('2 aprovado(s) de 2'), 'resumo mostra o resultado da prova');
await clicar(botao('Finalizar e enviar'));
ok([...document.querySelectorAll('.assin b')].map(e => e.textContent).includes('MARIA SOUZA'), 'nome do operador em MAIÚSCULAS');
ok(txt().includes('Faltam 1 assinatura(s): MARIA SOUZA.') && !finalizou, 'não finaliza sem todas as assinaturas');
await clicar(botao('Assinar'));
ok(!!document.querySelector('dialog canvas.pad'), 'abre o quadro de assinatura');
await clicar(botao('Cancelar'));
// simula assinatura salva para o 2º operador (espera o salvamento automático de 300 ms)
await act(async () => { await espera(400); });
let c1 = await db.get('treinamentos', 'C1');
const k2 = c1.operadores[1].k;
await db.put('arquivos', { chave: `C1:ass:${k2}`, treinamentoId: 'C1', tipo: 'assinatura', blob: new Blob([new Uint8Array(10)]) });
await act(async () => { root2.unmount(); });
c1 = await db.get('treinamentos', 'C1');
await db.put('treinamentos', { ...c1, assinaturas: { ...c1.assinaturas, [k2]: `C1:ass:${k2}` } });
const root3 = createRoot(document.getElementById('root'));
await renderEditor(root3);
await act(async () => { await espera(80); });
for (let i = 0; i < 4; i++) await clicar(botao('Avançar'));
await clicar(botao('Finalizar e enviar'));
c1 = await db.get('treinamentos', 'C1');
ok(finalizou && c1.status === 'pronto' && c1.finalizadoEm > 0 && c1.operadores.length === 2, 'finaliza: status "pronto" gravado no aparelho e volta ao início');
ok(c1.operadores[0].nome === 'JOÃO DA SILVA' && c1.cliente === 'ACME', 'ao finalizar, dados antigos em minúsculas também viram MAIÚSCULAS');
ok(c1.provas[c1.operadores[0].k].modo === 'qr' && c1.provas[c1.operadores[0].k].tentativaId === 'TT1' && !c1.decisoes[c1.operadores[0].k], 'operador 1: prova do celular, sem decisão');
ok(c1.assinaturas.a === 'C1:ass:a' && !!c1.assinaturasQr.a, 'operador 1: assinatura do celular segue no treinamento finalizado');
ok(c1.provas[c1.operadores[1].k].modo === 'papel' && c1.provas[c1.operadores[1].k].acertos === 8 && c1.decisoes[c1.operadores[1].k].aprovado === true, 'operador 2: prova de papel (lida pela foto) + decisão do instrutor, guardadas separadas');
await act(async () => { root3.unmount(); });

console.log('3) Início');
const root4 = createRoot(document.getElementById('root'));
await act(async () => { root4.render(<Inicio usuario={{ id: 'U1' }} nome="Instrutor 01 Teste" online={true} envio={{ rodando: false, msg: '' }} versao={0}
  aoNovo={() => {}} aoAbrir={() => {}} aoEnviar={() => {}} aoCorrigir={() => {}} aoSair={() => {}} />); });
await act(async () => { await espera(80); });
ok(txt().includes('Instrutor 01 Teste') && txt().includes('Conectado'), 'cabeçalho com nome e conexão');
ok(document.querySelector('.contador').textContent.startsWith('1'), 'contador: 1 aguardando envio');
ok(txt().includes('Em andamento') && txt().includes('Aguardando envio'), 'listas de rascunhos e fila');
ok(!botao('Enviar agora').disabled, 'botão "Enviar agora" ativo com pendente e internet');
await act(async () => { root4.unmount(); });

console.log('4) Regras da prova');
const { aplicarResultadosQr } = await import('../src/lib/provaApi.js');
const tR = { operadores: [{ k: 'x', cpf: '529.982.247-25' }, { k: 'y', cpf: '123.456.789-09' }], provas: { y: { modo: 'papel', aprovado: false } } };
const nov = aplicarResultadosQr(tR, [{ cpf: '52998224725', tentativa_id: 'A', acertos: 9, total: 10, aprovado: true, em: '2026-10-08T10:00:00Z', tentativas: 1 },
  { cpf: '12345678909', tentativa_id: 'B', acertos: 10, total: 10, aprovado: true, em: '2026-10-08T10:00:00Z', tentativas: 1 },
  { cpf: '11144477735', tentativa_id: 'C', acertos: 10, total: 10, aprovado: true, em: '2026-10-08T10:00:00Z', tentativas: 1 }]);
ok(nov.x.tentativaId === 'A' && nov.y.modo === 'papel' && Object.keys(nov).length === 2, 'QR: aplica por CPF, respeita o papel e ignora CPF fora da turma');
ok(aplicarResultadosQr({ ...tR, provas: nov }, [{ cpf: '52998224725', tentativa_id: 'A', tentativas: 1 }]) === null, 'QR: sem novidade não regrava');
const { assinaturasPendentes } = await import('../src/lib/provaApi.js');
const listaAss = [{ cpf: '52998224725', assinatura_em: 'E1' }, { cpf: '12345678909', assinatura_em: 'E2' }, { cpf: '11144477735', assinatura_em: 'E3' }];
ok(assinaturasPendentes(tR, listaAss).map(p => p.k).join() === 'x,y', 'assinaturas do celular: baixa as da turma, ignora CPF de fora');
ok(assinaturasPendentes({ ...tR, assinaturas: { x: 'k1' } }, listaAss).map(p => p.k).join() === 'y', 'assinatura colhida no aparelho do instrutor vale (não é substituída)');
ok(assinaturasPendentes({ ...tR, assinaturas: { x: 'k1', y: 'k2' }, assinaturasQr: { x: 'E1', y: 'antiga' } }, listaAss).map(p => p.k).join() === 'y', 'baixa de novo só se o operador assinou outra vez');
const { corrigir, minimoAcertos, resultadoFinal } = await import('../src/prova/correcao.js');
ok(resultadoFinal(undefined, undefined) === null && resultadoFinal({ aprovado: false }, undefined) === false && resultadoFinal({ aprovado: false }, { aprovado: true }) === true
  && resultadoFinal(undefined, { aprovado: false }) === false, 'resultado final: decisão do instrutor vale sobre a nota');
ok(minimoAcertos(PROVA_PEMT) === 7 && corrigir(PROVA_PEMT, PROVA_PEMT.questoes.map(q => q.c)).acertos === 10, 'mínimo 7 de 10; gabarito completo = 10');
let errou = false; try { corrigir(PROVA_PEMT, [0]); } catch { errou = true; }
ok(errou, 'correção recusa prova incompleta');
const letrasCertas = PROVA_PEMT.questoes.map(q => 'ABCD'[q.c]).join('');
ok(new Set(letrasCertas).size === 4 && !/(.)\1\1/.test(letrasCertas), `gabarito variado, sem 3 iguais seguidas (${letrasCertas})`);

console.log('5) Página do operador (QR code)');
const ProvaAluno = (await import('../src/telas/ProvaAluno.jsx')).default;
const semGabarito = pv => ({ ...pv, questoes: pv.questoes.map(q => ({ p: q.p, a: q.a })) });
const envios = [];
const apiAluno = {
  publica: async tk => { if (tk !== 'tok123') throw new Error('Link da prova inválido ou vencido.'); return { ...semGabarito(PROVA_PEMT), cliente: 'ACME', data: '2026-10-08', minimo_acertos: 7 }; },
  identificar: async (tk, c) => { if (c.replace(/\D/g, '') !== '52998224725') throw new Error('CPF não encontrado nesta turma.'); return { primeiro_nome: 'JOÃO' }; },
  responder: async (tk, c, r) => { envios.push(r); const x = corrigir(PROVA_PEMT, r); return { ...x, minimo_acertos: 7 }; },
  assinar: async (tk, c, png) => { assinaturasAluno.push({ tk, c, png }); return { ok: true }; }
};
const assinaturasAluno = [];
const rabiscar = async () => {
  const cv = document.querySelector('dialog canvas.pad');
  const ev = (tipo, x, y) => act(async () => { cv.dispatchEvent(new dom.window.MouseEvent(tipo, { bubbles: true, clientX: x, clientY: y })); });
  await ev('pointerdown', 5, 5);
  for (let i = 0; i < 15; i++) await ev('pointermove', 10 + i * 4, 10 + (i % 3) * 5);
  await ev('pointerup', 70, 20);
};
const root5 = createRoot(document.getElementById('root'));
await act(async () => { root5.render(<ProvaAluno token="tok123" api={apiAluno} />); });
await act(async () => { await espera(80); });
ok(txt().includes('Digite o seu CPF') && txt().includes('acerte 7') && txt().includes('ACME'), 'abre pedindo o CPF, com o cliente e o mínimo');
const inCpf = () => document.querySelector('.aluno-cpf input');
await digitar(inCpf(), '12345678909');
await clicar(botao('Continuar'));
ok(txt().includes('CPF não encontrado nesta turma.'), 'CPF fora da turma: mensagem clara');
await digitar(inCpf(), '52998224725');
await clicar(botao('Continuar'));
ok(txt().includes('Você é JOÃO?'), 'confirma o primeiro nome antes de começar');
await clicar(botao('Sim, começar'));
let conferiuBloqueio = false;
const responderTudo = async acertos => {
  for (let i = 0; i < 10; i++) {
    if (!conferiuBloqueio) { ok(botao('Próxima').disabled, '"Próxima" só libera depois de marcar'); conferiuBloqueio = true; }
    const q = PROVA_PEMT.questoes[i];
    await clicar(document.querySelectorAll('.opcao')[i < acertos ? q.c : (q.c + 1) % 4]);
    await clicar(botao(i < 9 ? 'Próxima' : 'Conferir'));
  }
};
await responderTudo(5);
ok(txt().includes('Conferir respostas') && document.querySelectorAll('.revisao button').length === 10, 'tela de conferência com as 10 respostas');
await clicar(botao('Enviar prova'));
ok(txt().includes('NÃO PASSOU') && txt().includes('acertou 5') && !!botao('Fazer a prova de novo'), 'resultado: não passou, com opção de refazer');
ok(!!botao('Assinar a lista de presença') && txt().includes('Se o instrutor pediu para encerrar'), 'quem não passou também pode assinar, se o instrutor encerrar');
ok(Array.isArray(envios[0]) && envios[0].length === 10 && envios[0].every(Number.isInteger), 'envia 10 respostas (índices)');
await clicar(botao('Fazer a prova de novo'));
await responderTudo(10);
await clicar(botao('Enviar prova'));
ok(txt().includes('APROVADO') && txt().includes('acertou 10') && !botao('Fazer a prova de novo'), 'refaz e passa; aprovado não vê botão de refazer');
ok(txt().includes('Último passo') && !!botao('Assinar a lista de presença'), 'ao terminar a prova, pede a assinatura da lista de presença');
await clicar(botao('Assinar a lista de presença'));
ok(!!document.querySelector('dialog canvas.pad') && !!botao('Enviar assinatura'), 'abre o quadro de assinatura no celular do operador');
await rabiscar();
await clicar(botao('Enviar assinatura'));
await act(async () => { await espera(50); });
ok(assinaturasAluno.length === 1 && assinaturasAluno[0].tk === 'tok123' && assinaturasAluno[0].c === '529.982.247-25' && assinaturasAluno[0].png.startsWith('data:image/'), 'envia a assinatura com o token e o CPF');
ok(txt().includes('Assinatura enviada ao instrutor') && !document.querySelector('dialog canvas.pad'), 'confirma o envio e libera para fechar');
await act(async () => { root5.unmount(); });
const root6 = createRoot(document.getElementById('root'));
await act(async () => { root6.render(<ProvaAluno token="vencido" api={apiAluno} />); });
await act(async () => { await espera(50); });
ok(txt().includes('Não foi possível abrir a prova') && txt().includes('inválido ou vencido'), 'link vencido: mensagem clara');
await act(async () => { root6.unmount(); });

console.log(`\nResultado: ${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
