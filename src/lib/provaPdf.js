// PDFs da prova (gerados no aparelho, como a lista de presença):
//  * gerarFolhaProva  – prova em branco para imprimir (modo papel)
//  * gerarComprovante – comprovante individual com respostas, nota e assinatura do operador
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DOC } from '../documento.js';
import { LETRAS, minimoAcertos } from '../prova/correcao.js';

const W = 595.28, H = 841.89, M = 42, CW = W - 2 * M;
const PRETO = rgb(0.08, 0.08, 0.08);
const CINZA = rgb(0.37, 0.37, 0.37);
const LINHA = rgb(0.78, 0.78, 0.78);
const LARANJA = rgb(0.992, 0.412, 0.004); // #FD6901
const VERDE = rgb(0.11, 0.48, 0.30), VERDE_FUNDO = rgb(0.89, 0.96, 0.92);
const VERM = rgb(0.70, 0.15, 0.12), VERM_FUNDO = rgb(0.99, 0.89, 0.88);
const FUNDO = rgb(0.96, 0.96, 0.96);
const RODAPE_Y = 26;

const dataBR = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const fmt = quando => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' }).format(quando);

function criarEscritor(fonte) {
  const cache = new Map();
  const ok = c => {
    if (!cache.has(c)) { try { fonte.widthOfTextAtSize(c, 10); cache.set(c, true); } catch { cache.set(c, false); } }
    return cache.get(c);
  };
  return s => [...String(s == null ? '' : s).replace(/\s+/g, ' ')].map(c => (ok(c) ? c : '?')).join('');
}

// Página com cursor vertical e quebra automática
class Fluxo {
  constructor(pdf, ctx, cabecalho) {
    this.pdf = pdf; this.ctx = ctx; this.cabecalho = cabecalho; this.paginas = [];
    this.nova();
  }
  nova() {
    this.pag = this.pdf.addPage([W, H]);
    this.paginas.push(this.pag);
    this.y = this.cabecalho(this.pag, this.ctx);
  }
  garantir(alt) { if (this.y - alt < RODAPE_Y + 22) this.nova(); }
  fonte(negrito) { return negrito ? this.ctx.negrito : this.ctx.normal; }
  limpar(s, negrito) { return (negrito ? this.ctx.segN : this.ctx.seg)(s); }
  quebrar(str, tam, larg, negrito) {
    const f = this.fonte(negrito);
    const palavras = this.limpar(str, negrito).split(' ');
    const linhas = [];
    let atual = '';
    for (const p of palavras) {
      const teste = atual ? atual + ' ' + p : p;
      if (f.widthOfTextAtSize(teste, tam) <= larg || !atual) atual = teste;
      else { linhas.push(atual); atual = p; }
    }
    if (atual) linhas.push(atual);
    return linhas;
  }
  // escreve texto com quebra de linha; devolve a altura usada
  texto(str, { x = M, larg = CW, tam = 10, negrito = false, cor = PRETO, entre = 1.3, mover = true } = {}) {
    const linhas = this.quebrar(str, tam, larg, negrito);
    const alt = linhas.length * tam * entre;
    if (mover) this.garantir(alt);
    let y = this.y;
    for (const l of linhas) {
      y -= tam * entre;
      this.pag.drawText(l, { x, y: y + tam * (entre - 1) / 2 + 1, size: tam, font: this.fonte(negrito), color: cor });
    }
    if (mover) this.y -= alt;
    return alt;
  }
  espaco(n) { this.y -= n; }
}

// recuo: afasta logo e título das bordas (a folha da prova tem as marcas de leitura nos cantos)
function cabecalhoPadrao(titulo, subtitulo, recuo = 0) {
  return (pag, ctx) => {
    const topo = H - M + 8;
    if (ctx.logo) {
      const h = 30, w = ctx.logo.width * (h / ctx.logo.height);
      pag.drawImage(ctx.logo, { x: M + recuo, y: topo - h, width: w, height: h });
    }
    const t = ctx.segN(titulo);
    pag.drawText(t, { x: W - M - recuo - ctx.negrito.widthOfTextAtSize(t, 13), y: topo - 14, size: 13, font: ctx.negrito, color: PRETO });
    const s = ctx.seg(subtitulo);
    pag.drawText(s, { x: W - M - recuo - ctx.normal.widthOfTextAtSize(s, 8.5), y: topo - 27, size: 8.5, font: ctx.normal, color: CINZA });
    pag.drawRectangle({ x: M, y: topo - 40, width: CW, height: 3, color: LARANJA });
    return topo - 52;
  };
}

function rodapes(paginas, ctx, extra, x = M) {
  paginas.forEach((pag, i) => {
    const s = ctx.seg(`${DOC.rodape} em ${ctx.geradoEm}${extra ? '  ·  ' + extra : ''}  ·  Página ${i + 1} de ${paginas.length}`);
    pag.drawText(s, { x, y: RODAPE_Y, size: 7, font: ctx.normal, color: CINZA });
  });
}

async function preparar(titulo, logo, quando) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(titulo);
  pdf.setAuthor(DOC.instituicao);
  pdf.setCreator('App Treinamento PEMT');
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  return {
    pdf,
    ctx: { normal, negrito, seg: criarEscritor(normal), segN: criarEscritor(negrito), logo: logo ? await pdf.embedPng(logo) : null, geradoEm: fmt(quando) }
  };
}

// Tabela rótulo / valor
function tabelaInfo(f, linhas, colRotulo = 110) {
  for (const [r, v] of linhas) {
    const tam = 9.5;
    const altV = f.quebrar(v, tam, CW - colRotulo - 12, false).length * tam * 1.3;
    const alt = Math.max(16, altV + 6);
    f.garantir(alt);
    f.pag.drawRectangle({ x: M, y: f.y - alt, width: colRotulo, height: alt, color: FUNDO, borderColor: LINHA, borderWidth: 0.6 });
    f.pag.drawRectangle({ x: M + colRotulo, y: f.y - alt, width: CW - colRotulo, height: alt, borderColor: LINHA, borderWidth: 0.6 });
    const y0 = f.y;
    f.y -= 3.5;
    f.texto(r, { x: M + 6, larg: colRotulo - 10, tam, negrito: true, mover: false });
    f.texto(v, { x: M + colRotulo + 6, larg: CW - colRotulo - 12, tam, mover: false });
    f.y = y0 - alt;
  }
}

function titulo(f, s) {
  f.garantir(30);
  f.espaco(10);
  f.texto(s.toLocaleUpperCase('pt-BR'), { tam: 9.5, negrito: true, cor: LARANJA });
  f.espaco(3);
}

function imagemNaCaixa(pag, img, x, topo, w, h) {
  const esc = Math.min(w / img.width, h / img.height);
  const iw = img.width * esc, ih = img.height * esc;
  pag.drawImage(img, { x: x + (w - iw) / 2, y: topo - h + (h - ih) / 2, width: iw, height: ih });
}

export const DESCRICAO_MODO = {
  qr: 'Pelo celular do operador (QR code)',
  papel: 'Prova em papel'
};

/**
 * Comprovante individual da prova respondida (QR code ou papel). Mostra as respostas e a nota reais
 * e o resultado final (aprovado/reprovado) informado em resultado.aprovado.
 * @param {object} d { prova, cliente, cidade, uf, data, instrutor, fabricantes[], maquinas[],
 *                     operador: { nome, cpf }, resultado: { modo: 'qr'|'papel', respostas, acertos, total, aprovado, em? } }
 * @param {Uint8Array|null} logo  PNG
 * @param {Uint8Array|null} assinatura PNG do operador
 * @param {Uint8Array|Uint8Array[]|null} folhas  JPEG(s) da folha de papel (opcional; uma página do PDF por foto)
 */
export async function gerarComprovante(d, logo, assinatura, folhas = null, quando = new Date()) {
  const { pdf, ctx } = await preparar(`Comprovante de avaliação - ${d.operador.nome} - ${dataBR(d.data)}`, logo, quando);
  const f = new Fluxo(pdf, ctx, cabecalhoPadrao('COMPROVANTE DE AVALIAÇÃO TEÓRICA', 'Operador de Plataforma Elevatória Móvel de Trabalho (PEMT)'));
  const r = d.resultado;
  if (!(r.modo === 'qr' || r.modo === 'papel') || !Array.isArray(r.respostas)) throw new Error('Comprovante só para prova respondida (QR code ou papel).');

  titulo(f, 'Treinamento e operador');
  tabelaInfo(f, [
    ['Operador', d.operador.nome],
    ['CPF', d.operador.cpf],
    ['Cliente', d.cliente],
    ['Local e data', `${d.cidade} - ${d.uf}  ·  ${dataBR(d.data)}`],
    ['Equipamento', `${d.maquinas.join(' / ')}  —  ${d.fabricantes.map(x => x.toLocaleUpperCase('pt-BR')).join(' / ')}`],
    ['Instrutor', `${d.instrutor} / ${DOC.instituicao}`]
  ]);

  // Resultado
  f.espaco(12);
  const linhasRes = [];
  const pct = Math.round((r.acertos / r.total) * 100);
  const min = minimoAcertos(d.prova);
  linhasRes.push(`Acertos: ${r.acertos} de ${r.total} (${pct}%)  ·  Mínimo para aprovação: ${min} acertos (${Math.round(d.prova.notaMinima * 100)}%)`);
  linhasRes.push(`Forma de aplicação: ${DESCRICAO_MODO[r.modo]}${r.em ? `  ·  Respondida em: ${fmt(new Date(r.em))}` : ''}`);
  const altBox = 34 + linhasRes.length * 13;
  f.garantir(altBox);
  f.pag.drawRectangle({ x: M, y: f.y - altBox, width: CW, height: altBox, color: r.aprovado ? VERDE_FUNDO : VERM_FUNDO, borderColor: r.aprovado ? VERDE : VERM, borderWidth: 1 });
  const y0 = f.y;
  f.y -= 8;
  f.texto(`RESULTADO: ${r.aprovado ? 'APROVADO' : 'REPROVADO'}`, { x: M + 12, larg: CW - 24, tam: 15, negrito: true, cor: r.aprovado ? VERDE : VERM, mover: false });
  f.y -= 24;
  for (const l of linhasRes) { f.texto(l, { x: M + 12, larg: CW - 24, tam: 9.5, mover: false }); f.y -= 13; }
  f.y = y0 - altBox;

  // Respostas
  {
    titulo(f, 'Respostas');
    d.prova.questoes.forEach((q, i) => {
      const marcada = r.respostas[i];
      const certa = marcada === q.c;
      const veredito = certa ? 'CERTA' : 'ERRADA';
      const largV = ctx.negrito.widthOfTextAtSize(veredito, 9) + 12;
      const txtResp = `Resposta: ${LETRAS[marcada]}) ${q.a[marcada]}`;
      const txtCorr = certa ? '' : `Correta: ${LETRAS[q.c]}) ${q.a[q.c]}`;
      const nL = f.quebrar(`${i + 1}. ${q.p}`, 9.5, CW, true).length + f.quebrar(txtResp, 9, CW - 14 - largV, false).length +
        (txtCorr ? f.quebrar(txtCorr, 9, CW - 14 - largV, false).length : 0);
      f.garantir(nL * 11.5 + 6);
      f.texto(`${i + 1}. ${q.p}`, { tam: 9.5, negrito: true, entre: 1.2 });
      const topoResp = f.y;
      f.texto(txtResp, { x: M + 14, larg: CW - 14 - largV, tam: 9, entre: 1.25 });
      const v = ctx.segN(veredito);
      f.pag.drawText(v, { x: W - M - ctx.negrito.widthOfTextAtSize(v, 9), y: topoResp - 9.5, size: 9, font: ctx.negrito, color: certa ? VERDE : VERM });
      if (txtCorr) f.texto(txtCorr, { x: M + 14, larg: CW - 14 - largV, tam: 9, negrito: true, cor: VERDE, entre: 1.25 });
      f.espaco(2.5);
    });
  }

  // Assinaturas
  f.garantir(90);
  f.espaco(8);
  const larg = (CW - 30) / 2;
  const topoAss = f.y;
  if (assinatura) {
    const img = await pdf.embedPng(assinatura);
    imagemNaCaixa(f.pag, img, M, topoAss, larg, 40);
  }
  const yLinha = topoAss - 43;
  f.pag.drawLine({ start: { x: M, y: yLinha }, end: { x: M + larg, y: yLinha }, thickness: 0.7, color: PRETO });
  f.pag.drawLine({ start: { x: M + larg + 30, y: yLinha }, end: { x: W - M, y: yLinha }, thickness: 0.7, color: PRETO });
  f.y = yLinha - 2;
  const hNomeOp = f.texto(d.operador.nome, { x: M, larg, tam: 8.5, negrito: true, mover: false });
  const hNomeIn = f.texto(d.instrutor, { x: M + larg + 30, larg, tam: 8.5, negrito: true, mover: false });
  f.y -= Math.max(hNomeOp, hNomeIn) + 1;
  f.texto('Assinatura do operador', { x: M, larg, tam: 8, cor: CINZA, mover: false });
  f.texto(`Instrutor – ${DOC.instituicao}`, { x: M + larg + 30, larg, tam: 8, cor: CINZA, mover: false });
  f.y -= 14;

  // Foto(s) da folha (papel)
  const fotos = (Array.isArray(folhas) ? folhas : folhas ? [folhas] : []).filter(Boolean);
  for (let i = 0; i < fotos.length; i++) {
    f.nova();
    titulo(f, fotos.length > 1 ? `Folha de respostas (foto ${i + 1} de ${fotos.length})` : 'Folha de respostas (foto)');
    const img = await pdf.embedJpg(fotos[i]);
    const altDisp = f.y - RODAPE_Y - 24;
    imagemNaCaixa(f.pag, img, M, f.y - 4, CW, altDisp);
  }

  rodapes(f.paginas, ctx, `Prova ${d.prova.id}`);
  return pdf.save();
}

// ---------------------------------------------------------------------------------------------
// Folha da prova para imprimir, preparada para correção pela foto (leitura óptica no celular).
// Cada página tem 4 quadrados pretos nos cantos (referência para endireitar a foto) e um código
// de 4 células no rodapé (identifica a página). O "mapa" diz onde está cada caixinha, em pontos
// do PDF (origem no canto inferior esquerdo); o leitor da foto usa este mesmo mapa.
// Mudou o desenho da folha? Aumente VERSAO_LEITURA: folhas antigas deixam de ser lidas pela foto.
// ---------------------------------------------------------------------------------------------
export const VERSAO_LEITURA = 1;
const MARCA = 20;            // lado do quadrado preto dos cantos
const MARCA_BORDA = 18;      // distância da borda do papel (cabe nas margens das impressoras)
const CEL = 10, CEL_PASSO = 14;
const CAIXA = 13;            // lado da caixinha de resposta

function desenharMarcasLeitura(pdf, pag, indice) {
  const lado = MARCA, b = MARCA_BORDA;
  const cantos = [[b, H - b - lado], [W - b - lado, H - b - lado], [W - b - lado, b], [b, b]]; // TL, TR, BR, BL (x, y do canto inferior esquerdo)
  for (const [x, y] of cantos) pag.drawRectangle({ x, y, width: lado, height: lado, color: rgb(0, 0, 0) });
  // código: [preto, bit0 da página, bit1 da página, branco]
  const bits = [1, indice & 1, (indice >> 1) & 1, 0];
  const x0 = W - 96;
  bits.forEach((v, i) => { if (v) pag.drawRectangle({ x: x0 + i * CEL_PASSO, y: 20, width: CEL, height: CEL, color: rgb(0, 0, 0) }); });
}

function mapaBase() {
  const c = MARCA_BORDA + MARCA / 2;
  return {
    versao: VERSAO_LEITURA, largura: W, altura: H,
    marcas: [{ x: c, y: H - c }, { x: W - c, y: H - c }, { x: W - c, y: c }, { x: c, y: c }], // centros: TL, TR, BR, BL
    marcaLado: MARCA,
    codigo: [0, 1, 2, 3].map(i => ({ x: W - 96 + i * CEL_PASSO + CEL / 2, y: 20 + CEL / 2 })),
    codigoLado: CEL,
    caixaLado: CAIXA,
    paginas: 0,
    caixas: [] // { q, k, pagina, x, y } = centro da caixinha
  };
}

async function montarFolha(prova, logo, quando) {
  const { pdf, ctx } = await preparar('Prova - Operador de PEMT', logo, quando);
  const RECUO = 14;
  const f = new Fluxo(pdf, ctx, cabecalhoPadrao('AVALIAÇÃO TEÓRICA', 'Operador de Plataforma Elevatória Móvel de Trabalho (PEMT)', RECUO));
  const mapa = mapaBase();

  const campo = (rotulo, x, larg) => {
    f.pag.drawText(ctx.segN(rotulo), { x, y: f.y - 16, size: 11, font: ctx.negrito, color: PRETO });
    const xi = x + ctx.negrito.widthOfTextAtSize(rotulo, 11) + 6;
    f.pag.drawLine({ start: { x: xi, y: f.y - 18 }, end: { x: x + larg, y: f.y - 18 }, thickness: 0.7, color: PRETO });
  };
  f.espaco(4);
  campo('Nome completo:', M, CW); f.espaco(26);
  campo('CPF:', M, CW * 0.55); campo('Data:', M + CW * 0.6, CW * 0.4); f.espaco(26);
  campo('Empresa:', M, CW); f.espaco(30);

  const min = minimoAcertos(prova);
  f.pag.drawRectangle({ x: M, y: f.y - 36, width: CW, height: 36, color: FUNDO, borderColor: LINHA, borderWidth: 0.6 });
  const y0 = f.y;
  f.y -= 6;
  f.texto(`PINTE o quadradinho de UMA resposta por questão. Para passar, acerte pelo menos ${min} das ${prova.questoes.length} questões.`, { x: M + 10, larg: CW - 20, tam: 10.5, negrito: true, mover: false });
  f.y = y0 - 48;

  const ENTRE = 1.6, TAM = 11;
  prova.questoes.forEach((q, i) => {
    const alt = f.quebrar(`${i + 1}. ${q.p}`, 11.5, CW, true).length * 11.5 * 1.35 + 2 +
      q.a.reduce((s2, a) => s2 + f.quebrar(a, TAM, CW - 50, false).length * TAM * ENTRE + 2, 0) + 10;
    f.garantir(alt);
    f.texto(`${i + 1}. ${q.p}`, { tam: 11.5, negrito: true, entre: 1.35 });
    f.espaco(2);
    q.a.forEach((a, k) => {
      const topo = f.y;
      const cy = topo - (TAM * ENTRE) / 2;
      const bx = M + 10, by = cy - CAIXA / 2;
      f.pag.drawRectangle({ x: bx, y: by, width: CAIXA, height: CAIXA, borderColor: PRETO, borderWidth: 1 });
      mapa.caixas.push({ q: i, k, pagina: f.paginas.length - 1, x: bx + CAIXA / 2, y: cy });
      f.pag.drawText(`${LETRAS[k]})`, { x: M + 30, y: cy - 4, size: TAM, font: ctx.negrito, color: PRETO });
      f.texto(a, { x: M + 48, larg: CW - 50, tam: TAM, entre: ENTRE });
      f.espaco(2);
    });
    f.espaco(8);
  });

  f.garantir(70);
  f.espaco(18);
  campo('Acertos:', M, 150);
  f.pag.drawText(ctx.seg(`de ${prova.questoes.length}`), { x: M + 156, y: f.y - 16, size: 11, font: ctx.normal, color: PRETO });
  campo('Assinatura do operador:', M + 210, CW - 210);
  f.espaco(30);
  f.paginas.forEach((pag, i) => desenharMarcasLeitura(pdf, pag, i));
  mapa.paginas = f.paginas.length;
  rodapes(f.paginas, ctx, `Prova ${prova.id} · leitura v${VERSAO_LEITURA}`, M + RECUO);
  return { pdf, mapa };
}

/** Prova em branco para imprimir (com as marcas para correção pela foto). */
export async function gerarFolhaProva(prova, logo, quando = new Date()) {
  const { pdf } = await montarFolha(prova, logo, quando);
  return pdf.save();
}

/** Onde fica cada caixinha da folha impressa desta prova (para o leitor da foto). */
export async function mapaFolha(prova) {
  const { mapa } = await montarFolha(prova, null, new Date(0));
  return mapa;
}
