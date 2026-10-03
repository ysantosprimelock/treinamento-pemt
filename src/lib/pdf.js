// Lista de presença em PDF, no padrão do formulário FOR-OPE-01-2026 (A4 paisagem).
// Gerada no próprio aparelho na hora do envio, com os mesmos dados que vão para o banco.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DOC } from '../documento.js';

const LARG = 841.89;          // A4 paisagem
const ALT = 595.28;
const M = 28;                 // margem
const CW = LARG - 2 * M;      // largura útil
const PRETO = rgb(0, 0, 0);
const CINZA = rgb(0.85, 0.85, 0.85);
const AMARELO = rgb(1, 0.949, 0.8);   // #FFF2CC, como no modelo
const CINZA_TXT = rgb(0.35, 0.35, 0.35);

const COL_ROTULO = 262;               // coluna da logo / rótulos
const COL_CENTRO = 330;
const COL_DIR = CW - COL_ROTULO - COL_CENTRO;
const ALT_CAB = 52;
const ALT_INFO = 15;
const ALT_TAB_CAB = 16;
const ALT_LINHA = 34;
export const LINHAS_POR_PAGINA = 10;
const COLUNAS = [
  { t: 'Nº', w: 28, al: 'center' },
  { t: 'Nome Completo', w: 300 },
  { t: 'CPF', w: 110, al: 'center' },
  { t: 'Empresa', w: 190 },
  { t: 'Assinatura', w: CW - 28 - 300 - 110 - 190, al: 'center' }
];

function criarEscritor(fonte) {
  const cache = new Map();
  const ok = c => {
    if (!cache.has(c)) {
      try { fonte.widthOfTextAtSize(c, 10); cache.set(c, true); } catch { cache.set(c, false); }
    }
    return cache.get(c);
  };
  // troca caracteres que a fonte padrão do PDF não suporta (ex.: emoji) por '?'
  return s => [...String(s == null ? '' : s).replace(/\s+/g, ' ')].map(c => (ok(c) ? c : '?')).join('');
}

function caixa(pag, x, topo, w, h, fundo) {
  pag.drawRectangle({ x, y: topo - h, width: w, height: h, color: fundo, borderColor: PRETO, borderWidth: 0.6 });
}

function texto(pag, ctx, str, x, topo, w, h, { negrito = false, tam = 8.5, al = 'left', min = 6, cor = PRETO } = {}) {
  const fonte = negrito ? ctx.negrito : ctx.normal;
  const s = (negrito ? ctx.segN : ctx.seg)(str);
  const livre = w - 8;
  let t = tam;
  while (t > min && fonte.widthOfTextAtSize(s, t) > livre) t -= 0.25;
  let final = s;
  if (fonte.widthOfTextAtSize(final, t) > livre) {
    while (final.length && fonte.widthOfTextAtSize(final + '…', t) > livre) final = final.slice(0, -1);
    final += '…';
  }
  const tw = fonte.widthOfTextAtSize(final, t);
  const tx = al === 'center' ? x + (w - tw) / 2 : x + 4;
  const ty = topo - h + (h - t * 0.72) / 2;
  pag.drawText(final, { x: tx, y: ty, size: t, font: fonte, color: cor });
}

function imagemNaCaixa(pag, img, x, topo, w, h, folga) {
  const maxW = w - 2 * folga, maxH = h - 2 * folga;
  const esc = Math.min(maxW / img.width, maxH / img.height);
  const iw = img.width * esc, ih = img.height * esc;
  pag.drawImage(img, { x: x + (w - iw) / 2, y: topo - h + (h - ih) / 2, width: iw, height: ih });
}

function cabecalho(pag, ctx, titulo, numPag, totalPag) {
  const topo = ALT - M;
  // logo
  caixa(pag, M, topo, COL_ROTULO, ALT_CAB);
  if (ctx.logo) imagemNaCaixa(pag, ctx.logo, M, topo, COL_ROTULO, ALT_CAB, 7);
  // centro
  const xc = M + COL_ROTULO;
  caixa(pag, xc, topo, COL_CENTRO, ALT_CAB / 2);
  caixa(pag, xc, topo - ALT_CAB / 2, COL_CENTRO, ALT_CAB / 2);
  texto(pag, ctx, 'Formulário', xc, topo, COL_CENTRO, ALT_CAB / 2, { negrito: true, tam: 13, al: 'center' });
  texto(pag, ctx, titulo, xc, topo - ALT_CAB / 2, COL_CENTRO, ALT_CAB / 2, { negrito: true, tam: 11, al: 'center' });
  // controle do documento
  const xd = xc + COL_CENTRO;
  const linhas = [['Código:', DOC.codigo], ['Área:', DOC.area], ['Rev.:', DOC.revisao], ['Página:', `${numPag} de ${totalPag}`]];
  const h = ALT_CAB / 4;
  linhas.forEach(([r, v], i) => {
    caixa(pag, xd, topo - i * h, 52, h);
    caixa(pag, xd + 52, topo - i * h, COL_DIR - 52, h, AMARELO);
    texto(pag, ctx, r, xd, topo - i * h, 52, h, { negrito: true, tam: 7.5 });
    texto(pag, ctx, v, xd + 52, topo - i * h, COL_DIR - 52, h, { tam: 7.5 });
  });
  return topo - ALT_CAB;
}

function linhasInfo(pag, ctx, topo, itens) {
  let y = topo;
  for (const [rotulo, valor] of itens) {
    caixa(pag, M, y, COL_ROTULO, ALT_INFO);
    caixa(pag, M + COL_ROTULO, y, CW - COL_ROTULO, ALT_INFO, AMARELO);
    texto(pag, ctx, rotulo, M, y, COL_ROTULO, ALT_INFO, { negrito: true });
    texto(pag, ctx, valor, M + COL_ROTULO, y, CW - COL_ROTULO, ALT_INFO);
    y -= ALT_INFO;
  }
  return y;
}

function rodape(pag, ctx) {
  texto(pag, ctx, `${DOC.rodape} em ${ctx.geradoEm}`, M, 22, CW, 10, { tam: 6.5, cor: CINZA_TXT, min: 5 });
}

function dataBR(iso) { return iso ? iso.split('-').reverse().join('/') : ''; }

/**
 * @param {object} d  { id, cliente, cidade, uf, data (AAAA-MM-DD), instrutor, fabricantes[], maquinas[],
 *                      operadores: [{ nome, cpf }] }
 * @param {Uint8Array[]} assinaturas  PNGs, na mesma ordem dos operadores
 * @param {Uint8Array[]} fotos        JPEGs
 * @param {Uint8Array|null} logo      PNG da logo
 * @param {Date} [quando]
 * @returns {Promise<Uint8Array>}
 */
export async function gerarListaPresenca(d, assinaturas, fotos, logo, quando = new Date()) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Lista de presença - ${d.cliente} - ${dataBR(d.data)}`);
  pdf.setAuthor(DOC.instituicao);
  pdf.setCreator('App Treinamento PEMT');

  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ctx = {
    normal, negrito, seg: criarEscritor(normal), segN: criarEscritor(negrito),
    logo: logo ? await pdf.embedPng(logo) : null,
    id: d.id,
    geradoEm: new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' }).format(quando)
  };

  const imgsAss = [];
  for (const a of assinaturas) imgsAss.push(await pdf.embedPng(a));
  const imgsFotos = [];
  for (const f of fotos) imgsFotos.push(await pdf.embedJpg(f));

  const nPagLista = Math.max(1, Math.ceil(d.operadores.length / LINHAS_POR_PAGINA));
  const total = nPagLista + (imgsFotos.length ? 1 : 0);

  const info = [
    ['Nome do treinamento:', DOC.nomeTreinamento],
    ['Instrutor/Instituição:', `${d.instrutor} / ${DOC.instituicao}`],
    ['Equipamento/Fabricante:', `${d.maquinas.join(' / ')}  —  ${d.fabricantes.map(f => f.toLocaleUpperCase('pt-BR')).join(' / ')}`],
    ['Cliente:', d.cliente],
    ['Local:', `${d.cidade} - ${d.uf}`],
    ['Data:', dataBR(d.data)],
    ['Carga Horária Total:', DOC.cargaHoraria]
  ];

  for (let p = 0; p < nPagLista; p++) {
    const pag = pdf.addPage([LARG, ALT]);
    let y = cabecalho(pag, ctx, 'Lista de Presença', p + 1, total);
    y = linhasInfo(pag, ctx, y, info);

    let x = M;
    for (const c of COLUNAS) {
      caixa(pag, x, y, c.w, ALT_TAB_CAB, CINZA);
      texto(pag, ctx, c.t, x, y, c.w, ALT_TAB_CAB, { negrito: true, al: 'center' });
      x += c.w;
    }
    y -= ALT_TAB_CAB;

    const ini = p * LINHAS_POR_PAGINA;
    const fim = Math.min(ini + LINHAS_POR_PAGINA, d.operadores.length);
    for (let i = ini; i < fim; i++) {
      const o = d.operadores[i];
      const valores = [String(i + 1), o.nome, o.cpf, d.cliente, ''];
      x = M;
      COLUNAS.forEach((c, k) => {
        caixa(pag, x, y, c.w, ALT_LINHA);
        if (k < 4) texto(pag, ctx, valores[k], x, y, c.w, ALT_LINHA, { al: c.al || 'left' });
        else if (imgsAss[i]) imagemNaCaixa(pag, imgsAss[i], x, y, c.w, ALT_LINHA, 2);
        x += c.w;
      });
      y -= ALT_LINHA;
    }
    rodape(pag, ctx);
  }

  if (imgsFotos.length) {
    const pag = pdf.addPage([LARG, ALT]);
    let y = cabecalho(pag, ctx, 'Registro Fotográfico', total, total);
    y = linhasInfo(pag, ctx, y, [['Cliente:', d.cliente], ['Local / Data:', `${d.cidade} - ${d.uf}  —  ${dataBR(d.data)}`]]);
    y -= 6;
    const cols = 3;
    const linhas = Math.ceil(imgsFotos.length / cols);
    const cw = CW / cols;
    const ch = Math.min(215, (y - 34) / Math.max(linhas, 2));
    imgsFotos.forEach((img, i) => {
      const cx = M + (i % cols) * cw;
      const cy = y - Math.floor(i / cols) * ch;
      caixa(pag, cx, cy, cw, ch);
      imagemNaCaixa(pag, img, cx, cy, cw, ch, 5);
    });
    rodape(pag, ctx);
  }

  return pdf.save();
}
