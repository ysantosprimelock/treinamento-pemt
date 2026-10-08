// Leitura óptica da folha da prova pela foto (no próprio celular, sem internet, sem IA).
// Passos: 1) imagem em tons de cinza; 2) limiar adaptativo (aguenta sombra e luz desigual);
// 3) acha os 4 quadrados pretos dos cantos; 4) calcula a perspectiva (homografia) entre a folha
// impressa (mapa do PDF) e a foto; 5) confere a orientação e a página pelo código do rodapé e
// pelo contorno das caixinhas; 6) mede quanto de cada caixinha está pintado.
// Funções puras (sem DOM): rodam no navegador e nos testes.

const LIMIAR_MARCADA = 0.14;   // fração pintada a partir da qual a caixinha conta como marcada
const LIMIAR_FORTE = 0.45;     // marcação bem pintada (vence uma marca fraca na mesma questão)

export function paraCinza(rgba, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}

// Bradley-Roth: escuro se o pixel for t% mais escuro que a média da vizinhança
export function limiarAdaptativo(g, w, h, janela, t = 0.18) {
  const W1 = w + 1;
  const I = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let soma = 0;
    for (let x = 0; x < w; x++) {
      soma += g[y * w + x];
      I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + soma;
    }
  }
  const m = new Uint8Array(w * h);
  const r = janela >> 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = I[(y1 + 1) * W1 + x1 + 1] - I[y0 * W1 + x1 + 1] - I[(y1 + 1) * W1 + x0] + I[y0 * W1 + x0];
      m[y * w + x] = g[y * w + x] * area <= s * (1 - t) ? 1 : 0;
    }
  }
  return m;
}

// Componentes conectados das áreas escuras (bbox, área, centro)
export function componentes(m, w, h) {
  const rot = new Int32Array(w * h);
  const pilha = new Int32Array(w * h);
  const lista = [];
  let n = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || rot[i]) continue;
    n++;
    let topo = 0;
    pilha[topo++] = i;
    rot[i] = n;
    let area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (topo) {
      const p = pilha[--topo];
      const x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && m[p - 1] && !rot[p - 1]) { rot[p - 1] = n; pilha[topo++] = p - 1; }
      if (x < w - 1 && m[p + 1] && !rot[p + 1]) { rot[p + 1] = n; pilha[topo++] = p + 1; }
      if (y > 0 && m[p - w] && !rot[p - w]) { rot[p - w] = n; pilha[topo++] = p - w; }
      if (y < h - 1 && m[p + w] && !rot[p + w]) { rot[p + w] = n; pilha[topo++] = p + w; }
    }
    if (area >= 12) {
      const cx = sx / area, cy = sy / area;
      // momentos centrais: servem para reconhecer um quadrado cheio em qualquer ângulo
      const mxx = sxx / area - cx * cx, myy = syy / area - cy * cy, mxy = sxy / area - cx * cy;
      lista.push({ area, cx, cy, x0, y0, x1, y1, mxx, myy, mxy });
    }
  }
  return lista;
}

// Quadrados cheios com papel branco em volta (candidatos a marca de canto).
// O anel branco descarta manchas da mesa/fundo e caixinhas pintadas (que têm o contorno impresso em volta).
function quadradosCheios(comps, m, w, h) {
  const min = Math.min(w, h);
  return comps.filter(c => {
    const lado = Math.sqrt(c.area);
    if (lado < min * 0.008 || lado > min * 0.09) return false;
    // quadrado cheio (em qualquer giro): (Ixx+Iyy)/área² = 1/6 e sem alongamento
    const comp = (c.mxx + c.myy) / c.area;
    const tr = c.mxx + c.myy, det = c.mxx * c.myy - c.mxy * c.mxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const along = (tr / 2 + disc) / Math.max(1e-9, tr / 2 - disc);
    if (comp < 0.15 || comp > 0.2 || along > 1.6) return false;
    let esc = 0, tot = 0;
    for (const f of [0.85, 1.1]) {
      const r = lado * f;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * 2 * Math.PI;
        const x = Math.round(c.cx + r * Math.cos(a)), y = Math.round(c.cy + r * Math.sin(a));
        if (x < 0 || y < 0 || x >= w || y >= h) return false; // marca encostada na borda da foto
        tot++;
        if (m[y * w + x]) esc++;
      }
    }
    return esc / tot <= 0.12;
  });
}

const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

// Ordena 4 pontos em volta do centro (TL, TR, BR, BL na foto) e confere se formam um quadrilátero convexo
function quadrilatero(pts, w, h) {
  const cx = pts.reduce((s, p) => s + p.cx, 0) / 4, cy = pts.reduce((s, p) => s + p.cy, 0) / 4;
  const ord = [...pts].sort((a, b) => Math.atan2(a.cy - cy, a.cx - cx) - Math.atan2(b.cy - cy, b.cx - cx));
  // começa pelo mais perto do canto superior esquerdo
  let i0 = 0;
  ord.forEach((p, i) => { if (p.cx + p.cy < ord[i0].cx + ord[i0].cy) i0 = i; });
  const q = [0, 1, 2, 3].map(i => ord[(i0 + i) % 4]);
  const P = q.map(p => [p.cx, p.cy]);
  const sinais = [0, 1, 2, 3].map(i => Math.sign(cruz(P[i], P[(i + 1) % 4], P[(i + 2) % 4])));
  if (!sinais.every(x => x === sinais[0] && x !== 0)) return null;
  let area = 0;
  for (let i = 0; i < 4; i++) area += P[i][0] * P[(i + 1) % 4][1] - P[(i + 1) % 4][0] * P[i][1];
  if (Math.abs(area) / 2 < 0.12 * w * h) return null; // folha pequena demais na foto
  const areas = q.map(c => c.area);
  if (Math.max(...areas) > 3.5 * Math.min(...areas)) return null;
  return q;
}

// Possíveis conjuntos de 4 marcas: primeiro os extremos da foto; se não servir, combinações
function* conjuntosDeCantos(cand, w, h) {
  const ext = [
    cand.reduce((a, c) => (c.cx + c.cy < a.cx + a.cy ? c : a)),
    cand.reduce((a, c) => (c.cx - c.cy > a.cx - a.cy ? c : a)),
    cand.reduce((a, c) => (c.cx + c.cy > a.cx + a.cy ? c : a)),
    cand.reduce((a, c) => (c.cx - c.cy < a.cx - a.cy ? c : a))
  ];
  if (new Set(ext).size === 4) { const q = quadrilatero(ext, w, h); if (q) yield q; }
  const lista = cand.slice(0, 14);
  const n = lista.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const q = quadrilatero([lista[a], lista[b], lista[c], lista[d]], w, h);
    if (q) yield q;
  }
}

// Homografia (DLT com 4 pontos): de (u,v) para (x,y)
export function homografia(de, para) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = de[i], [x, y] = para[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const s = b.map((v, i) => v / A[i][i]);
  return [s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], 1];
}

export function aplicar(Hm, u, v) {
  const d = Hm[6] * u + Hm[7] * v + Hm[8];
  return [(Hm[0] * u + Hm[1] * v + Hm[2]) / d, (Hm[3] * u + Hm[4] * v + Hm[5]) / d];
}

// Fração escura dentro de um quadrado da folha (u,v em pontos, v de cima para baixo)
function fracao(m, w, h, Hm, u, v, lado, inset = 0.22, n = 9) {
  const meio = (lado / 2) * (1 - inset);
  let esc = 0, tot = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const [x, y] = aplicar(Hm, u - meio + (2 * meio * i) / (n - 1), v - meio + (2 * meio * j) / (n - 1));
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
      tot++;
      if (m[yi * w + xi]) esc++;
    }
  }
  return tot ? esc / tot : 0;
}

// Fração escura no contorno impresso da caixinha (confere se o encaixe está certo)
function contorno(m, w, h, Hm, u, v, lado) {
  const r = lado / 2;
  let esc = 0, tot = 0;
  for (let i = 0; i < 12; i++) {
    const t = -r + (2 * r * i) / 11;
    for (const [a, b] of [[t, -r], [t, r], [-r, t], [r, t]]) {
      // procura a linha numa pequena faixa (tolerância de encaixe)
      let achou = false;
      for (const d of [-1.2, 0, 1.2]) {
        const [x, y] = aplicar(Hm, u + a + (a === r || a === -r ? d : 0), v + b + (b === r || b === -r ? d : 0));
        const xi = Math.round(x), yi = Math.round(y);
        if (xi >= 0 && yi >= 0 && xi < w && yi < h && m[yi * w + xi]) { achou = true; break; }
      }
      tot++;
      if (achou) esc++;
    }
  }
  return esc / tot;
}

/**
 * Lê uma foto de uma página da folha.
 * @param {Uint8Array} g  imagem em tons de cinza (w*h)
 * @param {object} mapa   mapa da folha (provaPdf.mapaFolha)
 * @returns {{ok:true, pagina, respostas: {[q]: {k, duvida, motivo, fr:number[]}}, Hm, cantos} | {ok:false, erro}}
 */
export function lerPagina(g, w, h, mapa) {
  const janela = Math.max(31, Math.round(Math.max(w, h) / 12) | 1);
  const m = limiarAdaptativo(g, w, h, janela);
  let cand = quadradosCheios(componentes(m, w, h), m, w, h);
  if (cand.length < 4) return { ok: false, erro: 'Não encontrei os 4 quadrados pretos dos cantos. Fotografe a folha inteira, com um pouco de mesa em volta.' };
  // os maiores primeiro (as marcas dos cantos são os maiores quadrados cheios da folha)
  cand = cand.sort((a, b) => b.area - a.area);

  const H0 = mapa.altura;
  const pdfCantos = mapa.marcas.map(p => [p.x, H0 - p.y]); // v de cima para baixo
  let melhor = null;
  let tentativas = 0;
  for (const ext of conjuntosDeCantos(cand, w, h)) {
    if (++tentativas > 400) break;
    for (let r = 0; r < 4; r++) {
      const fotoCantos = [0, 1, 2, 3].map(j => { const c = ext[(j + r) % 4]; return [c.cx, c.cy]; });
      const Hm = homografia(pdfCantos, fotoCantos);
      if (!Hm) continue;
      // tamanho previsto das marcas tem de bater com o tamanho visto na foto
      const ladoPrev = pdfCantos.map(([u, v]) => {
        const a = aplicar(Hm, u - mapa.marcaLado / 2, v), b = aplicar(Hm, u + mapa.marcaLado / 2, v);
        const c = aplicar(Hm, u, v - mapa.marcaLado / 2), d = aplicar(Hm, u, v + mapa.marcaLado / 2);
        return Math.hypot(a[0] - b[0], a[1] - b[1]) * Math.hypot(c[0] - d[0], c[1] - d[1]);
      });
      if (ladoPrev.some((a2, j) => { const real = ext[(j + r) % 4].area; return a2 / real > 2 || real / a2 > 2; })) continue;
      // margens laterais da folha são papel em branco
      const margens = [0.25, 0.5, 0.75].flatMap(t => [[mapa.marcas[0].x, H0 * t], [mapa.marcas[1].x, H0 * t]]);
      if (margens.some(([u, v]) => fracao(m, w, h, Hm, u, v, 10, 0, 5) > 0.08)) continue;
      const cod = mapa.codigo.map(c => fracao(m, w, h, Hm, c.x, H0 - c.y, mapa.codigoLado, 0.25, 5));
      if (!(cod[0] > 0.55 && cod[3] < 0.2 && [cod[1], cod[2]].every(x => x > 0.55 || x < 0.2))) continue;
      const pagina = (cod[1] > 0.55 ? 1 : 0) + (cod[2] > 0.55 ? 2 : 0);
      if (pagina >= mapa.paginas) continue;
      const caixas = mapa.caixas.filter(c => c.pagina === pagina);
      if (!caixas.length) continue;
      const enc = caixas.reduce((s2, c) => s2 + contorno(m, w, h, Hm, c.x, H0 - c.y, mapa.caixaLado), 0) / caixas.length;
      if (!melhor || enc > melhor.enc) melhor = { Hm, pagina, caixas, enc, fotoCantos };
    }
    if (melhor && melhor.enc >= 0.8) break; // encaixe claro: não precisa testar outras combinações
  }
  if (!melhor) return { ok: false, erro: 'Não consegui ler esta foto. Confira se a página inteira aparece, com os 4 quadrados pretos dos cantos, de cima e nítida, e se é a prova impressa pelo app.' };
  if (melhor.enc < 0.75) return { ok: false, erro: 'A foto ficou torta ou tremida demais para ler as caixinhas. Tire de novo, de cima, com a folha inteira aparecendo.' };

  const respostas = {};
  const porQ = {};
  for (const c of melhor.caixas) (porQ[c.q] = porQ[c.q] || []).push(c);
  for (const q of Object.keys(porQ)) {
    const cx = porQ[q].sort((a, b) => a.k - b.k);
    const fr = cx.map(c => fracao(m, w, h, melhor.Hm, c.x, H0 - c.y, mapa.caixaLado));
    const ordem = fr.map((f, k) => [f, k]).sort((a, b) => b[0] - a[0]);
    const marcadas = ordem.filter(([f]) => f >= LIMIAR_MARCADA);
    let k = null, duvida = false, motivo = '';
    if (!marcadas.length) { duvida = true; motivo = 'em branco'; }
    else if (marcadas.length === 1) k = marcadas[0][1];
    else if (marcadas[0][0] >= LIMIAR_FORTE && marcadas[1][0] < marcadas[0][0] * 0.45) k = marcadas[0][1];
    else { duvida = true; motivo = 'mais de uma marcada'; k = null; }
    respostas[q] = { k, duvida, motivo, fr: fr.map(x => Math.round(x * 100) / 100) };
  }
  return { ok: true, pagina: melhor.pagina, respostas, Hm: melhor.Hm, cantos: melhor.fotoCantos, enc: Math.round(melhor.enc * 100) / 100 };
}

// Junta as páginas lidas: respostas (índice ou null) e as questões em dúvida
export function juntarLeituras(leituras, nQuestoes) {
  const respostas = Array.from({ length: nQuestoes }, () => null);
  const duvidas = [];
  const lidas = new Set();
  for (const l of leituras) {
    if (!l || !l.ok) continue;
    for (const [q, r] of Object.entries(l.respostas)) {
      const i = Number(q);
      lidas.add(i);
      respostas[i] = r.k;
      if (r.duvida) duvidas.push({ q: i, motivo: r.motivo });
    }
  }
  for (let i = 0; i < nQuestoes; i++) if (!lidas.has(i)) duvidas.push({ q: i, motivo: 'página não fotografada' });
  return { respostas, duvidas: duvidas.sort((a, b) => a.q - b.q) };
}
