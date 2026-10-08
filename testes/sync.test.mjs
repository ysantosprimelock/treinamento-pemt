import 'fake-indexeddb/auto';
import * as db from '../src/lib/db.js';
import { criarSync, classificarErro } from '../src/lib/sync.js';
import { cpfValido, mascaraCpf } from '../src/lib/cpf.js';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
const fx = n => new Uint8Array(fs.readFileSync(new URL('./fixtures/' + n, import.meta.url)));
const LOGO = new Uint8Array(fs.readFileSync(new URL('../public/logo-kimtech.png', import.meta.url)));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FALHA', m); } };

// ---- Supabase falso (controlável) ----
function supabaseFalso() {
  const s = {
    sessao: { user: { id: 'U1' } },
    uploads: [], rpcs: [],
    falharUploadNo: null,       // número da chamada de upload que deve falhar (1-based)
    erroUpload: { message: 'Failed to fetch' },
    erroRpc: null,
    contUpload: 0,
    auth: { getSession: async () => ({ data: { session: s.sessao } }) },
    provasBanco: [], leiturasProva: 0,
    from: tabela => tabela === 'provas'
      ? { select: () => ({ order: async () => { s.leiturasProva++; return { data: s.provasBanco, error: null }; } }) }
      : ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tabela === 'perfis' ? { nome: 'INSTRUTOR 01 TESTE' } : null, error: null }) }) }) }),
    storage: { from: (bucket) => ({ upload: async (caminho, blob, op) => {
      s.contUpload++;
      if (s.falharUploadNo && s.contUpload === s.falharUploadNo) return { data: null, error: s.erroUpload };
      s.uploads.push({ bucket, caminho, tam: blob.size, upsert: op.upsert, tipo: op.contentType, blob });
      return { data: { path: caminho }, error: null };
    } }) },
    rpc: async (nome, args) => {
      s.rpcs.push({ nome, args });
      if (s.erroRpc) return { data: null, error: s.erroRpc };
      return { data: { ok: true, id: args.p.id, ja_existia: false }, error: null };
    }
  };
  return s;
}

let relogio = 1_000_000;
const agora = () => relogio;

async function criarTreinamento(id, userId, nFotos = 3, nOps = 2, status = 'pronto') {
  const fotos = [];
  for (let i = 0; i < nFotos; i++) {
    const chave = `${id}:foto:${i}`;
    await db.put('arquivos', { chave, treinamentoId: id, tipo: 'foto', blob: new Blob([fx(`foto-${(i % 6) + 1}.jpg`)], { type: 'image/jpeg' }) });
    fotos.push(chave);
  }
  const operadores = [], assinaturas = {};
  const cpfs = ['529.982.247-25', '123.456.789-09', '111.444.777-35'];
  for (let i = 0; i < nOps; i++) {
    const k = `op${i}`;
    operadores.push({ k, nome: `Operador ${i} Silva`, cpf: cpfs[i], funcao: i ? '' : 'Operador' });
    const chave = `${id}:ass:${k}`;
    await db.put('arquivos', { chave, treinamentoId: id, tipo: 'assinatura', blob: new Blob([fx(`assinatura-${(i % 3) + 1}.png`)], { type: 'image/png' }) });
    assinaturas[k] = chave;
  }
  await db.put('treinamentos', { id, userId, status, criadoEm: relogio, finalizadoEm: relogio, cliente: ' ACME ', local: 'Pátio', cidade: 'Fortaleza', uf: 'CE', data: '2026-10-02', fabricantes: ['Skyjack'], maquinas: ['3219'], fotos, operadores, assinaturas });
}

console.log('0) CPF');
ok(cpfValido('529.982.247-25') && !cpfValido('529.982.247-24') && !cpfValido('111.111.111-11'), 'validação de CPF');
ok(mascaraCpf('52998224725') === '529.982.247-25', 'máscara de CPF');

console.log('1) Sem internet: nada se perde');
const sb = supabaseFalso();
let chamadasLogo = 0;
const sync = criarSync({ supabase: sb, db, agora, carregarLogo: async () => { chamadasLogo++; return LOGO; } });
await criarTreinamento('T1', 'U1');
sb.falharUploadNo = 1;
let r = await sync.sincronizar();
let t1 = await db.get('treinamentos', 'T1');
ok(r.falhas === 1 && t1.status === 'erro' && t1.tipoErro === 'rede', 'falha de rede marca "erro/rede", não "enviado"');
ok((await db.arquivosDe('T1')).length === 5, 'as 3 fotos e 2 assinaturas continuam no aparelho');
ok(sb.rpcs.length === 0, 'não registrou no banco sem os arquivos');
ok(t1.proximaTentativa > relogio, 'agendou nova tentativa');
r = await sync.sincronizar();
ok(r.enviados === 0 && sb.contUpload === 1, 'respeita o intervalo antes de tentar de novo (tentativa automática)');

console.log('2) Internet volta (ignorarEspera)');
sb.falharUploadNo = null;
r = await sync.sincronizar({ ignorarEspera: true });
t1 = await db.get('treinamentos', 'T1');
ok(r.enviados === 1 && t1.status === 'enviado', 'enviado após a internet voltar');
ok(sb.uploads.length === 6 && sb.uploads.every(u => u.upsert && u.bucket === 'treinamentos'), '6 arquivos enviados ao bucket (3 fotos, 2 assinaturas, 1 PDF), com upsert');
const upPdf = sb.uploads.find(u => u.caminho === 'U1/T1/lista-presenca.pdf');
ok(upPdf && upPdf.tipo === 'application/pdf', 'PDF enviado em U1/T1/lista-presenca.pdf');
const docPdf = await PDFDocument.load(new Uint8Array(await upPdf.blob.arrayBuffer()));
ok(docPdf.getPageCount() === 2, 'PDF válido com 2 páginas (lista + fotos)');
ok(sb.uploads.findIndex(u => u.caminho.endsWith('.pdf')) < sb.uploads.length && sb.rpcs.length === 1, 'PDF sobe antes do registro no banco');
const p = sb.rpcs[0].args.p;
ok(sb.rpcs.length === 1 && sb.rpcs[0].nome === 'registrar_treinamento', 'registrar_treinamento chamado 1 vez');
ok(JSON.stringify(p.fotos) === JSON.stringify(['U1/T1/fotos/01.jpg', 'U1/T1/fotos/02.jpg', 'U1/T1/fotos/03.jpg']), 'caminhos das fotos no padrão do banco: ' + p.fotos[0]);
ok(p.participantes[1].assinatura_path === 'U1/T1/assinaturas/02.png' && p.participantes[0].cpf === '529.982.247-25', 'caminhos das assinaturas e CPF corretos');
ok(p.cliente === 'ACME' && p.id === 'T1' && typeof p.criado_no_aparelho_em === 'string', 'payload limpo (cliente sem espaços, id, data do aparelho)');
ok(p.email_cliente === '', 'payload envia e-mail do cliente (vazio quando não informado)');
const { listaEmails } = await import('../src/lib/util.js');
ok(listaEmails(' A@x.com; b@y.com,,a@X.com  c@z.com ').join(', ') === 'a@x.com, b@y.com, c@z.com', 'lista de e-mails normalizada (separadores, repetidos, minúsculas)');
ok((await db.arquivosDe('T1')).length === 6, 'cópia local mantida depois do envio (fotos, assinaturas e PDF)');

console.log('3) Queda no meio do envio: retoma sem reenviar o que já subiu');
await criarTreinamento('T2', 'U1');
const antes = sb.uploads.length;
sb.contUpload = 0; sb.falharUploadNo = 3; // 2 fotos sobem, a 3ª falha
await sync.sincronizar({ ignorarEspera: true });
ok(sb.uploads.length - antes === 2 && (await db.get('treinamentos', 'T2')).status === 'erro', 'parou na 3ª foto, 2 já no servidor');
sb.falharUploadNo = null;
await sync.sincronizar({ ignorarEspera: true });
ok(sb.uploads.length - antes === 6, 'na retomada enviou só o que faltava (total 6, sem repetir)');
ok((await db.get('treinamentos', 'T2')).status === 'enviado', 'T2 enviado');

console.log('4) Servidor recusa (validação): fica para correção, não insiste sozinho');
await criarTreinamento('T3', 'U1');
sb.erroRpc = { code: 'P0001', message: 'Operador 1: CPF inválido.' };
await sync.sincronizar({ ignorarEspera: true });
let t3 = await db.get('treinamentos', 'T3');
ok(t3.status === 'erro' && t3.tipoErro === 'correcao' && t3.erro.includes('CPF inválido'), 'marcado "precisa de correção" com a mensagem do servidor');
const rpcsAntes = sb.rpcs.length;
await sync.sincronizar({ ignorarEspera: true });
ok(sb.rpcs.length === rpcsAntes, 'tentativa automática ignora os que precisam de correção');
sb.erroRpc = null;
await sync.sincronizar({ ignorarEspera: true, incluirCorrecao: true });
ok((await db.get('treinamentos', 'T3')).status === 'enviado', '"Enviar agora" (manual) tenta de novo e envia');

console.log('5) Outro instrutor / sem sessão / rascunho');
await criarTreinamento('T4', 'U2');
await criarTreinamento('T5', 'U1', 3, 1, 'rascunho');
const up0 = sb.uploads.length;
await sync.sincronizar({ ignorarEspera: true, incluirCorrecao: true });
ok((await db.get('treinamentos', 'T4')).status === 'pronto', 'treinamento de outro instrutor não é enviado com a sessão atual');
ok((await db.get('treinamentos', 'T5')).status === 'rascunho' && sb.uploads.length === up0, 'rascunho não é enviado');
sb.sessao = null;
r = await sync.sincronizar({ ignorarEspera: true });
ok(r.semSessao === true, 'sem sessão: não tenta enviar e avisa para entrar de novo');
sb.sessao = { user: { id: 'U1' } };

console.log('6) App fechado no meio do envio (status "enviando")');
await criarTreinamento('T6', 'U1', 3, 1, 'enviando');
await sync.sincronizar();
ok((await db.get('treinamentos', 'T6')).status === 'enviado', 'retomado e enviado');

console.log('7) Arquivo faltando no aparelho');
await criarTreinamento('T7', 'U1');
await db.del('arquivos', 'T7:foto:1');
await sync.sincronizar({ ignorarEspera: true });
let t7 = await db.get('treinamentos', 'T7');
ok(t7.status === 'erro' && t7.tipoErro === 'correcao' && /Foto 2/.test(t7.erro), 'detecta foto ausente e não registra incompleto');

console.log('8) Envio simultâneo');
await criarTreinamento('T8', 'U1');
const [a, b] = await Promise.all([sync.sincronizar({ ignorarEspera: true }), sync.sincronizar({ ignorarEspera: true })]);
ok([a.msg, b.msg].includes('Envio já em andamento.'), 'segunda chamada simultânea não duplica o envio');
ok(sb.rpcs.filter(x => x.args.p.id === 'T8').length === 1, 'T8 registrado uma única vez');

console.log('9) Limpeza de enviados antigos');
relogio += 8 * 24 * 60 * 60 * 1000;
const n = await sync.limparEnviadosAntigos(7);
ok(n >= 4 && !(await db.get('treinamentos', 'T1')) && (await db.arquivosDe('T1')).length === 0, `apaga enviados com mais de 7 dias e seus arquivos (${n})`);
ok(!!(await db.get('treinamentos', 'T4')) && !!(await db.get('treinamentos', 'T7')) && !!(await db.get('treinamentos', 'T5')), 'NÃO apaga pendentes, com erro ou rascunhos');

console.log('9b) Logo e PDF');
ok(chamadasLogo === 1, 'logo carregada uma única vez por sessão do app');
await criarTreinamento('T9', 'U1');
sb.contUpload = 0; sb.falharUploadNo = 6; // falha justamente no upload do PDF
await sync.sincronizar({ ignorarEspera: true });
ok((await db.get('treinamentos', 'T9')).status === 'erro' && !sb.rpcs.some(x => x.args.p.id === 'T9'), 'se o PDF não sobe, não registra no banco');
ok(!!(await db.get('arquivos', 'T9:pdf')), 'PDF gerado fica guardado no aparelho para a próxima tentativa');
sb.falharUploadNo = null;
await sync.sincronizar({ ignorarEspera: true });
ok((await db.get('treinamentos', 'T9')).status === 'enviado', 'na nova tentativa sobe o PDF guardado e registra');

console.log('9c) Provas: comprovantes e avaliações');
const { PROVA_PEMT } = await import('../../tools/prova-pemt.js');
const { _limparProvas, provaPorId } = await import('../src/prova/index.js');
const { execFileSync } = await import('node:child_process');
_limparProvas(); // aparelho ainda sem a prova: o envio baixa do banco
sb.provasBanco = [{ id: PROVA_PEMT.id, titulo: PROVA_PEMT.titulo, nota_minima: '0.700', questoes: PROVA_PEMT.questoes, criada_em: '2026-10-08' }];
await criarTreinamento('P1', 'U1', 3, 3);
const resp8 = PROVA_PEMT.questoes.map((q, i) => (i < 8 ? q.c : (q.c + 1) % 4));
const resp6 = PROVA_PEMT.questoes.map((q, i) => (i < 6 ? q.c : (q.c + 1) % 4));
await db.put('arquivos', { chave: 'P1:folha:op1:x-0', treinamentoId: 'P1', tipo: 'folha', blob: new Blob([fx('foto-2.jpg')], { type: 'image/jpeg' }) });
await db.put('arquivos', { chave: 'P1:folha:op1:x-1', treinamentoId: 'P1', tipo: 'folha', blob: new Blob([fx('foto-3.jpg')], { type: 'image/jpeg' }) });
let p1 = await db.get('treinamentos', 'P1');
await db.put('treinamentos', { ...p1,
  provas: {
    op0: { modo: 'qr', provaId: 'PEMT-1', tentativaId: 'TT1', respostas: resp8, acertos: 8, total: 10, aprovado: true, em: relogio },
    op1: { modo: 'papel', provaId: 'PEMT-1', respostas: resp6, acertos: 6, total: 10, aprovado: false, em: relogio, folhas: ['P1:folha:op1:x-0', 'P1:folha:op1:x-1'], lidoPorFoto: true }
  },
  decisoes: {
    op1: { aprovado: true, em: relogio },  // fez a prova, não passou, instrutor aprovou
    op2: { aprovado: false, em: relogio }  // não fez prova, instrutor reprovou
  } });
const upAntes = sb.uploads.length;
sb.contUpload = 0; sb.falharUploadNo = 8; // 3 fotos + 3 assinaturas + 1º comprovante sobem; o 2º falha
await sync.sincronizar({ ignorarEspera: true });
ok((await db.get('treinamentos', 'P1')).status === 'erro' && !sb.rpcs.some(x => x.args.p.id === 'P1'), 'falha no meio dos comprovantes: não registra');
ok(!!(await db.get('arquivos', 'P1:comp:op0')) && !!(await db.get('arquivos', 'P1:comp:op1')), 'comprovantes gerados ficam guardados no aparelho');
ok(sb.leiturasProva === 1 && !!provaPorId('PEMT-1'), 'prova que não estava no aparelho foi baixada do banco (uma vez)');
sb.falharUploadNo = null;
await sync.sincronizar({ ignorarEspera: true });
ok((await db.get('treinamentos', 'P1')).status === 'enviado', 'na retomada envia e registra');
const novos = sb.uploads.slice(upAntes).map(u => u.caminho);
ok(['U1/P1/provas/01.pdf', 'U1/P1/provas/02.pdf'].every(c => novos.filter(x => x === c).length === 1), 'um comprovante por prova respondida em U1/P1/provas/NN.pdf, sem reenviar');
ok(!novos.includes('U1/P1/provas/03.pdf') && !(await db.get('arquivos', 'P1:comp:op2')), 'quem não fez prova não tem comprovante');
const pp = sb.rpcs.find(x => x.args.p.id === 'P1').args.p;
const [a0, a1, a2] = pp.participantes.map(x => x.avaliacao);
ok(a0.modo === 'qr' && a0.tentativa_id === 'TT1' && a0.comprovante_path === 'U1/P1/provas/01.pdf' && !('respostas' in a0) && a0.decisao_instrutor === null, 'QR: envia só a tentativa (o banco usa a resposta guardada nele), sem decisão');
ok(a1.modo === 'papel' && a1.prova_id === 'PEMT-1' && a1.respostas.join() === resp6.join() && !('acertos' in a1) && a1.decisao_instrutor === true, 'papel: envia as respostas reais (o banco corrige de novo) e a decisão do instrutor');
ok(a2.modo === 'instrutor' && a2.decisao_instrutor === false && !('comprovante_path' in a2) && typeof a2.em === 'string', 'sem prova: envia só a decisão do instrutor');
const docComp = async c => PDFDocument.load(new Uint8Array(await sb.uploads.find(u => u.caminho === c).blob.arrayBuffer()));
ok((await docComp('U1/P1/provas/01.pdf')).getPageCount() === 1, 'comprovante QR: PDF válido de 1 página');
const nPagPapel = (await docComp('U1/P1/provas/02.pdf')).getPageCount();
ok(nPagPapel === 3, `comprovante papel: respostas + uma página por foto da folha (${nPagPapel} páginas)`);
const listaP1 = sb.uploads.filter(u => u.caminho === 'U1/P1/lista-presenca.pdf').pop();
const arqLista = new URL('./.lista-com-resultado.pdf', import.meta.url), arqComp = new URL('./.comprovante-papel.pdf', import.meta.url);
fs.writeFileSync(arqLista, new Uint8Array(await listaP1.blob.arrayBuffer()));
fs.writeFileSync(arqComp, new Uint8Array(await sb.uploads.find(u => u.caminho === 'U1/P1/provas/02.pdf').blob.arrayBuffer()));
fs.writeFileSync(new URL('./.comprovante-qr.pdf', import.meta.url), new Uint8Array(await sb.uploads.find(u => u.caminho === 'U1/P1/provas/01.pdf').blob.arrayBuffer()));
let txtComp = '', txtLista = '';
try {
  txtComp = execFileSync('pdftotext', ['-layout', arqComp.pathname, '-'], { encoding: 'utf8' });
  txtLista = execFileSync('pdftotext', ['-layout', arqLista.pathname, '-'], { encoding: 'utf8' });
} catch { /* sem pdftotext */ }
if (txtComp) {
  ok(/RESULTADO: APROVADO/.test(txtComp) && /Acertos: 6 de 10/.test(txtComp), 'comprovante da aprovação pelo instrutor: nota real (6 de 10) e resultado APROVADO');
  ok(!/aprovad[oa] (manualmente|pelo instrutor)|decis[aã]o do instrutor|aprova[cç][aã]o manual/i.test(txtComp), 'comprovante não menciona decisão/aprovação manual');
  ok(/Forma de aplica..o: Prova em papel/.test(txtComp), 'comprovante informa a forma de aplicação (papel)');
  const linhas = txtLista.split('\n');
  const linhaDe = n => linhas.find(l => l.includes(n)) || '';
  ok(/APROVADO/.test(linhaDe('Operador 0 Silva')) && /APROVADO/.test(linhaDe('Operador 1 Silva')) && /REPROVADO/.test(linhaDe('Operador 2 Silva')), 'lista de presença: resultado final de cada operador');
} else ok(false, 'pdftotext indisponível para conferir o texto dos PDFs');
ok(!pp.participantes.some(x => 'aprovado' in x), 'payload sem campo "aprovado" solto (o banco decide)');
const t1Antigo = sb.rpcs.find(x => x.args.p.id === 'T2').args.p;
ok(t1Antigo.participantes.every(x => !('avaliacao' in x)), 'treinamento sem prova (versão antiga) segue sem avaliação');

console.log('10) Classificação de erros');
ok(classificarErro({ message: 'TypeError: Failed to fetch' }).tipo === 'rede', 'Failed to fetch = rede');
ok(classificarErro({ code: 'P0001', message: 'x' }).tipo === 'correcao', 'P0001 = correção');
ok(classificarErro({ message: 'JWT expired' }).tipo === 'sessao', 'JWT expired = sessão');

console.log(`\nResultado: ${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
