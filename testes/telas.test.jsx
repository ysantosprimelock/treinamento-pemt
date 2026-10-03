// Teste de fumaça das telas: renderiza Editor e Inicio num DOM simulado (jsdom) com banco local simulado.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://exemplo.github.io/app/' });
const g = globalThis;
g.window = dom.window; g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
for (const k of ['HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLDialogElement']) g[k] = dom.window[k];
g.requestAnimationFrame = cb => setTimeout(cb, 0); g.cancelAnimationFrame = id => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;
let nUrl = 0; URL.createObjectURL = () => `blob:${++nUrl}`; URL.revokeObjectURL = () => {};
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLCanvasElement.prototype.getContext = () => ({ setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {}, drawImage() {} });
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
const inEmail = document.querySelector('input[type="email"]');
await digitar(inEmail, ' Compras@ACME ');
ok(txt().includes('E-mail incompleto ou inválido.'), 'aponta e-mail inválido enquanto digita');
await clicar(botao('Avançar'));
ok(txt().includes('E-mail do cliente inválido'), 'não avança com e-mail inválido');
await digitar(document.querySelector('input[type="email"]'), 'Compras@ACME.com.br');
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
ok(salvo.emailCliente === 'compras@acme.com.br', 'e-mail do cliente salvo em minúsculas');
ok(!!document.querySelector('header img.cab-logo[alt="Kimtech"]'), 'cabeçalho com a logo da Kimtech');
await clicar(botao('Avançar'));
ok(txt().includes('Fotos do treinamento'), 'avança para Fotos');
await clicar(botao('Avançar'));
ok(txt().includes('Adicione de 3 a 6 fotos'), 'exige no mínimo 3 fotos');
await act(async () => { root.unmount(); });
ok(voltou === false, 'nada inesperado ao desmontar');

console.log('2) Editor: operadores, assinaturas e finalização');
const fotos = [];
for (let i = 0; i < 3; i++) { const chave = `C1:foto:${i}`; await db.put('arquivos', { chave, treinamentoId: 'C1', tipo: 'foto', blob: new Blob([new Uint8Array(10)]) }); fotos.push(chave); }
await db.put('arquivos', { chave: 'C1:ass:a', treinamentoId: 'C1', tipo: 'assinatura', blob: new Blob([new Uint8Array(10)]) });
await db.put('treinamentos', { id: 'C1', userId: 'U1', status: 'rascunho', criadoEm: 1, atualizadoEm: 1, cliente: 'ACME', local: 'Pátio', cidade: 'Fortaleza', uf: 'CE', data: '2026-10-02', fabricantes: ['JLG'], maquinas: ['3219'], fotos, operadores: [{ k: 'a', nome: 'João da Silva', cpf: '529.982.247-25', funcao: '' }], assinaturas: { a: 'C1:ass:a' } });
const root2 = createRoot(document.getElementById('root'));
await act(async () => { root2.render(<Editor id="C1" listas={listas} aoVoltar={() => {}} aoFinalizar={() => { finalizou = true; }} />); });
await act(async () => { await espera(80); });
await clicar(botao('Avançar')); await clicar(botao('Avançar'));
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
ok(txt().includes('Assinaturas') && txt().includes('1 de 2 assinaturas'), 'etapa Assinar mostra 1 de 2');
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
await act(async () => { root3.render(<Editor id="C1" listas={listas} aoVoltar={() => {}} aoFinalizar={() => { finalizou = true; }} />); });
await act(async () => { await espera(80); });
for (let i = 0; i < 3; i++) await clicar(botao('Avançar'));
await clicar(botao('Finalizar e enviar'));
c1 = await db.get('treinamentos', 'C1');
ok(finalizou && c1.status === 'pronto' && c1.finalizadoEm > 0 && c1.operadores.length === 2, 'finaliza: status "pronto" gravado no aparelho e volta ao início');
ok(c1.operadores[0].nome === 'JOÃO DA SILVA' && c1.cliente === 'ACME', 'ao finalizar, dados antigos em minúsculas também viram MAIÚSCULAS');
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

console.log(`\nResultado: ${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
