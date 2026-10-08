// Simulador de "fotos" da folha da prova (usado nos testes do leitor e no teste no navegador).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument, rgb } from 'pdf-lib';
import { gerarFolhaProva, mapaFolha } from '../src/lib/provaPdf.js';
import { homografia, aplicar } from '../src/lib/leitorFolha.js';

export async function criarSimulador(prova) {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'leitor-'));
  const mapa = await mapaFolha(prova);
  const folhaBytes = await gerarFolhaProva(prova, null);

  // Marca as respostas no PDF. marcas: { q: k | [k1,k2] }, estilo: 'pinta' | 'x' | 'lapis'
  async function folhaMarcada(marcas, estilo = 'pinta') {
    const doc = await PDFDocument.load(folhaBytes);
    const pags = doc.getPages();
    let sem = 7;
    const rnd = () => { sem = (sem * 9301 + 49297) % 233280; return sem / 233280 - 0.5; };
    for (const [q, ks] of Object.entries(marcas)) {
      for (const k of [].concat(ks)) {
        const c = mapa.caixas.find(x => x.q === Number(q) && x.k === k);
        const p = pags[c.pagina];
        const dx = rnd() * 2, dy = rnd() * 2;
        if (estilo === 'x') {
          const r = 5.5;
          p.drawLine({ start: { x: c.x - r + dx, y: c.y - r + dy }, end: { x: c.x + r + dx, y: c.y + r + dy }, thickness: 1.4, color: rgb(0.1, 0.12, 0.4) });
          p.drawLine({ start: { x: c.x - r + dx, y: c.y + r + dy }, end: { x: c.x + r + dx, y: c.y - r + dy }, thickness: 1.4, color: rgb(0.1, 0.12, 0.4) });
        } else {
          const cor = estilo === 'lapis' ? rgb(0.6, 0.6, 0.6) : rgb(0.12, 0.15, 0.35);
          p.drawRectangle({ x: c.x - 4.8 + dx, y: c.y - 4.8 + dy, width: 9.6, height: 9.6, color: cor });
        }
      }
    }
    return doc.save();
  }

  // PDF -> imagem cinza (PGM) de uma página
  function rasterizar(bytes, pagina, dpi = 150) {
    const arq = path.join(TMP, `f-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(arq, bytes);
    const saida = arq.replace('.pdf', '');
    execFileSync('pdftoppm', ['-r', String(dpi), '-gray', '-f', String(pagina + 1), '-l', String(pagina + 1), '-singlefile', arq, saida]);
    const buf = fs.readFileSync(saida + '.pgm');
    // P5\n<w> <h>\n255\n<dados>
    let pos = 0; const campos = [];
    while (campos.length < 4) {
      while (/\s/.test(String.fromCharCode(buf[pos]))) pos++;
      let s = ''; while (!/\s/.test(String.fromCharCode(buf[pos]))) s += String.fromCharCode(buf[pos++]);
      campos.push(s);
    }
    pos++;
    return { w: Number(campos[1]), h: Number(campos[2]), g: new Uint8Array(buf.subarray(pos, pos + Number(campos[1]) * Number(campos[2]))) };
  }

  // Simula a foto: destino = posição dos 4 cantos da página na foto (TL, TR, BR, BL)
  function fotografar(pg, { W = 1200, H = 1600, cantos, fundo = 60, luz = [0.62, 1.05], sombra = null, ruido = 7, borrar = true, sem = 3 }) {
    const src = [[0, 0], [pg.w, 0], [pg.w, pg.h], [0, pg.h]];
    const inv = homografia(cantos, src);
    const out = new Uint8Array(W * H);
    let s = sem;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [u, v] = aplicar(inv, x, y);
        let val;
        if (u >= 0 && v >= 0 && u < pg.w - 1 && v < pg.h - 1) {
          const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = y0 * pg.w + x0;
          val = pg.g[i] * (1 - fx) * (1 - fy) + pg.g[i + 1] * fx * (1 - fy) + pg.g[i + pg.w] * (1 - fx) * fy + pg.g[i + pg.w + 1] * fx * fy;
        } else {
          val = fundo + 25 * Math.sin(x / 37) * Math.cos(y / 53); // mesa com textura
        }
        let f = luz[0] + (luz[1] - luz[0]) * (x / W * 0.6 + y / H * 0.4);
        if (sombra) { // sombra com borda suave (penumbra), como a sombra real do celular
          const pen = sombra.pen || 50;
          const dentro = Math.min(1, Math.max(0, (x - sombra.x0) / pen), Math.max(0, (sombra.x1 - x) / pen));
          f *= 1 - (1 - sombra.f) * dentro;
        }
        val = val * f + (rnd() + rnd() + rnd() - 1.5) * ruido;
        out[y * W + x] = Math.max(0, Math.min(255, val));
      }
    }
    if (!borrar) return { g: out, w: W, h: H };
    const b = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let t = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) t += out[(y + dy) * W + x + dx];
      b[y * W + x] = t / 9;
    }
    return { g: b, w: W, h: H };
  }


  const limpar = () => fs.rmSync(TMP, { recursive: true, force: true });
  return { mapa, folhaMarcada, rasterizar, fotografar, limpar, TMP };
}
