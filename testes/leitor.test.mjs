// Teste da correção pela foto com "fotos" simuladas: a folha real gerada pelo app é marcada,
// convertida em imagem (pdftoppm) e deformada como uma foto de celular (perspectiva, giro,
// luz desigual, sombra, ruído, desfoque, fundo de mesa). O leitor precisa acertar as marcas.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { lerPagina, juntarLeituras } from '../src/lib/leitorFolha.js';
import { criarSimulador } from './simulador.mjs';
import { corrigir } from '../src/prova/correcao.js';
const { PROVA_PEMT } = await import('../../tools/prova-pemt.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FALHA', m); } };
const LETRAS = 'ABCD';

const sim = await criarSimulador(PROVA_PEMT);
const { mapa, folhaMarcada, rasterizar, fotografar } = sim;
ok(mapa.paginas === 2 && mapa.caixas.length === 40, `mapa da folha: ${mapa.paginas} páginas, ${mapa.caixas.length} caixinhas`);

const ret = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const gab = PROVA_PEMT.questoes.map(q => q.c);
const resp6 = gab.map((c, i) => (i < 6 ? c : (c + 1) % 4)); // 6 certas
const marcasDe = r => Object.fromEntries(r.map((k, q) => [q, k]));
const letras = arr => arr.map(k => (k === null ? '-' : LETRAS[k])).join('');
const daPagina = (r, p) => letras(mapa.caixas.filter(c => c.pagina === p && c.k === 0).map(c => r[c.q]));
const lidas = l => letras(Object.keys(l.respostas).map(Number).sort((a, b) => a - b).map(q => l.respostas[q].k));

const pdf6 = await folhaMarcada(marcasDe(resp6));
const p1 = rasterizar(pdf6, 0), p2 = rasterizar(pdf6, 1);

console.log('1) Fotos boas e difíceis (marcas pintadas)');
const casos = [
  ['reta, de cima', p1, 0, { cantos: ret(110, 120, 1090, 1500) }],
  ['inclinada com perspectiva e luz desigual', p1, 0, { cantos: [[160, 90], [1080, 170], [1030, 1520], [90, 1440]] }],
  ['girada uns 10 graus', p2, 1, { cantos: [[250, 80], [1150, 240], [960, 1560], [40, 1390]] }],
  ['de cabeça para baixo (180 graus)', p2, 1, { cantos: [[1080, 1500], [120, 1490], [140, 110], [1100, 100]] }],
  // o app processa a foto com até 2200 px no lado maior; folha ocupando ~45% da largura
  ['de longe (folha ocupando metade da foto) e com ruído', p1, 0, { W: 1650, H: 2200, cantos: ret(450, 560, 1200, 1620), ruido: 10 }],
  ['com sombra forte em faixa', p2, 1, { cantos: ret(100, 110, 1100, 1520), sombra: { x0: 500, x1: 820, f: 0.55 } }],
  ['pouca luz', p1, 0, { cantos: ret(110, 120, 1090, 1500), luz: [0.35, 0.55], fundo: 30 }]
];
for (const [nome, pg, pag, op] of casos) {
  const f = fotografar(pg, op);
  const t0 = Date.now();
  const l = lerPagina(f.g, f.w, f.h, mapa);
  const ms = Date.now() - t0;
  ok(l.ok && l.pagina === pag && lidas(l) === daPagina(resp6, pag) && !Object.values(l.respostas).some(r => r.duvida),
    `${nome}: página ${pag + 1} lida ${l.ok ? lidas(l) : l.erro} (esperado ${daPagina(resp6, pag)}) em ${ms} ms`);
}

console.log('2) Formas de marcar');
const pdfX = await folhaMarcada(marcasDe(resp6), 'x');
const fx = fotografar(rasterizar(pdfX, 0), { cantos: [[150, 100], [1070, 160], [1040, 1510], [100, 1450]] });
const lx = lerPagina(fx.g, fx.w, fx.h, mapa);
ok(lx.ok && lidas(lx) === daPagina(resp6, 0), `marcado com X: ${lx.ok ? lidas(lx) : lx.erro}`);
const pdfL = await folhaMarcada(marcasDe(resp6), 'lapis');
const fl = fotografar(rasterizar(pdfL, 1), { cantos: ret(110, 120, 1090, 1500) });
const ll = lerPagina(fl.g, fl.w, fl.h, mapa);
ok(ll.ok && lidas(ll) === daPagina(resp6, 1), `pintado a lápis (cinza claro): ${ll.ok ? lidas(ll) : ll.erro}`);

console.log('3) Dúvidas vão para o instrutor decidir');
const duv = marcasDe(resp6); duv[1] = [0, 2]; delete duv[3];
const pdfD = await folhaMarcada(duv);
const fd = fotografar(rasterizar(pdfD, 0), { cantos: ret(110, 120, 1090, 1500) });
const ld = lerPagina(fd.g, fd.w, fd.h, mapa);
ok(ld.ok && ld.respostas[1].duvida && ld.respostas[1].motivo === 'mais de uma marcada', 'questão com duas marcadas: dúvida');
ok(ld.ok && ld.respostas[3].duvida && ld.respostas[3].motivo === 'em branco', 'questão em branco: dúvida');
ok(ld.ok && !ld.respostas[0].duvida && ld.respostas[0].k === resp6[0], 'as outras questões continuam lidas');

console.log('4) Duas páginas juntas e correção');
const l1 = lerPagina(...(f => [f.g, f.w, f.h])(fotografar(p1, { cantos: ret(110, 120, 1090, 1500) })), mapa);
const l2 = lerPagina(...(f => [f.g, f.w, f.h])(fotografar(p2, { cantos: [[1080, 1500], [120, 1490], [140, 110], [1100, 100]] })), mapa);
const junto = juntarLeituras([l2, l1], 10); // ordem das fotos não importa
ok(letras(junto.respostas) === letras(resp6) && junto.duvidas.length === 0, `10 respostas juntas: ${letras(junto.respostas)}`);
const nota = corrigir({ ...PROVA_PEMT }, junto.respostas);
ok(nota.acertos === 6 && nota.aprovado === false, 'corrige: 6 de 10 → reprovado');
const so1 = juntarLeituras([l1], 10);
ok(so1.duvidas.filter(d => d.motivo === 'página não fotografada').length === mapa.caixas.filter(c => c.pagina === 1 && c.k === 0).length, 'faltou a página 2: avisa quais questões faltam');

console.log('5) Fotos que não servem');
const vazio = new Uint8Array(1200 * 1600).fill(200);
ok(!lerPagina(vazio, 1200, 1600, mapa).ok, 'foto sem folha: recusa com mensagem');
const semMarcas = { ...p1, g: p1.g.slice() };
// cobre os quadrados dos cantos (folha antiga, sem marcas)
const esc = p1.w / 595.28;
for (const mc of mapa.marcas) {
  const cx = mc.x * esc, cy = (mapa.altura - mc.y) * esc, r = 14 * esc;
  for (let y = Math.max(0, cy - r) | 0; y < Math.min(p1.h, cy + r); y++) for (let x = Math.max(0, cx - r) | 0; x < Math.min(p1.w, cx + r); x++) semMarcas.g[y * p1.w + x] = 255;
}
const fsm = fotografar(semMarcas, { cantos: ret(110, 120, 1090, 1500) });
const lsm = lerPagina(fsm.g, fsm.w, fsm.h, mapa);
ok(!lsm.ok, `folha sem os quadrados dos cantos: recusa (${lsm.erro || 'leu indevidamente'})`);
const pequena = fotografar(p1, { cantos: ret(430, 560, 770, 1040) }); // folha minúscula na foto
const lp = lerPagina(pequena.g, pequena.w, pequena.h, mapa);
ok(!lp.ok || lidas(lp) === daPagina(resp6, 0), `folha muito pequena na foto: recusa ou lê certo, nunca errado (${lp.ok ? 'leu ' + lidas(lp) : lp.erro})`);
const cortada = fotografar(p1, { cantos: ret(-200, 120, 1090, 1500) }); // canto esquerdo fora da foto
const lc = lerPagina(cortada.g, cortada.w, cortada.h, mapa);
ok(!lc.ok || lidas(lc) === daPagina(resp6, 0), `folha cortada na foto: recusa ou lê certo, nunca errado (${lc.ok ? 'leu ' + lidas(lc) : lc.erro})`);

const NF = Number(process.env.FOTOS || 60);
console.log('6) Teste de estresse: ' + NF + ' fotos aleatórias (giro, perspectiva, distância, luz, sombra, ruído, X ou pintado)');
let semente = 12345;
const aleat = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
const pdfs = {};
let certas = 0, duvidas = 0, erradas = 0, recusadas = 0, foraDaFoto = 0; const encs = [];
const margens = { marcada: 1, vazia: 0 };
for (let n = 0; n < NF; n++) {
  const resp = gab.map(() => Math.floor(aleat() * 4));
  const estilo = aleat() < 0.35 ? 'x' : 'pinta';
  const chave = estilo + letras(resp);
  pdfs[chave] = pdfs[chave] || await folhaMarcada(marcasDe(resp), estilo);
  const pag = aleat() < 0.5 ? 0 : 1;
  const pg = rasterizar(pdfs[chave], pag, 110 + Math.floor(aleat() * 60));
  const lado = 0.55 + aleat() * 0.37;          // tamanho da folha na foto
  const ang = (aleat() - 0.5) * 0.5 + (aleat() < 0.15 ? Math.PI : 0); // até ±14° ou de cabeça para baixo
  const cx = 600 + (aleat() - 0.5) * 120, cy = 800 + (aleat() - 0.5) * 140;
  const hw = 600 * lado, hh = hw * 1.414;
  const base = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y], i) => {
    const pers = 1 + (aleat() - 0.5) * 0.16; // perspectiva
    return [cx + (x * Math.cos(ang) - y * Math.sin(ang)) * pers, cy + (x * Math.sin(ang) + y * Math.cos(ang)) * pers];
  });
  const lmin = 0.35 + aleat() * 0.4;
  const f = fotografar(pg, { cantos: base, luz: [lmin, lmin + 0.2 + aleat() * 0.3], ruido: 4 + aleat() * 10, fundo: 20 + aleat() * 120,
    sombra: aleat() < 0.4 ? { x0: aleat() * 800, x1: 400 + aleat() * 800, f: 0.5 + aleat() * 0.3 } : null, sem: n + 11 });
  const l = lerPagina(f.g, f.w, f.h, mapa);
  const dentro = base.every(([x, y]) => x > 15 && y > 15 && x < 1185 && y < 1585);
  if (!l.ok) { recusadas++; if (process.env.DEBUG) console.log('     recusada', n, dentro ? 'folha inteira na foto' : 'folha saindo da foto', '-', l.erro); if (!dentro) foraDaFoto++; if (process.env.DEBUG && dentro) fs.writeFileSync(`${process.env.DEBUG}/caso-${n}.pgm`, Buffer.concat([Buffer.from(`P5\n${f.w} ${f.h}\n255\n`), Buffer.from(f.g)])); continue; }
  encs.push(l.enc);
  if (process.env.DEBUG && n === 41) fs.writeFileSync(`${process.env.DEBUG}/caso-${n}.pgm`, Buffer.concat([Buffer.from(`P5\n${f.w} ${f.h}\n255\n`), Buffer.from(f.g)]));
  if (l.pagina !== pag) { erradas++; console.log('     página errada no caso', n); continue; }
  for (const [q, r] of Object.entries(l.respostas)) {
    const certo = resp[Number(q)];
    r.fr.forEach((v, k) => { if (k === certo) margens.marcada = Math.min(margens.marcada, v); else margens.vazia = Math.max(margens.vazia, v); });
    if (r.duvida) { duvidas++; if (process.env.DEBUG) console.log(`     dúvida caso ${n} q${Number(q) + 1} (${r.motivo}) certo=${LETRAS[certo]} fr=${r.fr} enc=${l.enc} ${estilo}`); }
    else if (r.k === certo) certas++;
    else { erradas++; console.log(`     LEITURA ERRADA caso ${n} questão ${Number(q) + 1}: leu ${LETRAS[r.k]}, era ${LETRAS[certo]}`, r.fr); }
  }
}
console.log(`     questões lidas certas: ${certas} · em dúvida: ${duvidas} · ERRADAS: ${erradas} · fotos recusadas: ${recusadas} de ${NF} (${foraDaFoto} com a folha saindo da foto)`);
console.log(`     encaixe das caixinhas (aceita a partir de 0.75): menor ${Math.min(...encs)} · mediana ${encs.sort()[encs.length >> 1]}`);
console.log(`     menor fração numa caixinha marcada: ${margens.marcada.toFixed(2)} · maior numa vazia: ${margens.vazia.toFixed(2)} (limite: 0.14)`);
ok(erradas === 0, 'nenhuma leitura errada (o que o leitor não tem certeza vira dúvida para o instrutor)');
ok(recusadas - foraDaFoto <= 3 && duvidas <= certas * 0.03, `com a folha inteira na foto, quase tudo lido sozinho (recusadas ${recusadas - foraDaFoto} de ${NF - foraDaFoto}, dúvidas ${duvidas} de ${certas + duvidas} questões)`);

sim.limpar();
console.log(`\nResultado: ${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
