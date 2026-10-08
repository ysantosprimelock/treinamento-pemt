// Ponte entre a câmera do celular e o leitor da folha (leitorFolha.js). Só roda no navegador.
import { paraCinza, lerPagina, aplicar } from './leitorFolha.js';

const LADO_PROCESSAMENTO = 2200; // px no lado maior (equilíbrio entre precisão e velocidade no celular)
const LADO_PREVIA = 900;

async function abrirImagem(arquivo) {
  try {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    return { fonte: bmp, w: bmp.width, h: bmp.height, liberar: () => bmp.close && bmp.close() };
  } catch {
    const url = URL.createObjectURL(arquivo);
    const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    return { fonte: im, w: im.naturalWidth, h: im.naturalHeight, liberar: () => URL.revokeObjectURL(url) };
  }
}

/**
 * Lê uma foto de uma página da prova.
 * @returns {Promise<{leitura, previa: string (dataURL com as marcas lidas), blob: Blob (JPEG para o comprovante)}>}
 */
export async function lerFotoDaProva(arquivo, mapa) {
  const { fonte, w, h, liberar } = await abrirImagem(arquivo);
  try {
    const s = Math.min(1, LADO_PROCESSAMENTO / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(fonte, 0, 0, c.width, c.height);
    const dados = ctx.getImageData(0, 0, c.width, c.height);
    const leitura = lerPagina(paraCinza(dados.data, c.width, c.height), c.width, c.height, mapa);

    // prévia: a foto com as caixinhas lidas em verde e as dúvidas em laranja
    const sp = Math.min(1, LADO_PREVIA / Math.max(c.width, c.height));
    const p = document.createElement('canvas');
    p.width = Math.round(c.width * sp); p.height = Math.round(c.height * sp);
    const pc = p.getContext('2d');
    pc.drawImage(c, 0, 0, p.width, p.height);
    if (leitura.ok) {
      const lado = mapa.caixaLado;
      for (const cx of mapa.caixas.filter(x => x.pagina === leitura.pagina)) {
        const r = leitura.respostas[cx.q];
        const escolhida = r && !r.duvida && r.k === cx.k;
        if (!escolhida && !(r && r.duvida)) continue;
        const v = mapa.altura - cx.y;
        const pts = [[cx.x - lado, v - lado], [cx.x + lado, v - lado], [cx.x + lado, v + lado], [cx.x - lado, v + lado]]
          .map(([u, vv]) => aplicar(leitura.Hm, u, vv).map(z => z * sp));
        pc.beginPath();
        pts.forEach(([x, y], i) => (i ? pc.lineTo(x, y) : pc.moveTo(x, y)));
        pc.closePath();
        pc.lineWidth = Math.max(2, 3 * sp * 2);
        pc.strokeStyle = escolhida ? '#1C7A4D' : '#E07800';
        pc.stroke();
      }
    }
    const previa = p.toDataURL('image/jpeg', 0.8);

    // cópia da foto para o comprovante (≈1600 px, JPEG)
    const sc = Math.min(1, 1600 / Math.max(c.width, c.height));
    const k = document.createElement('canvas');
    k.width = Math.round(c.width * sc); k.height = Math.round(c.height * sc);
    k.getContext('2d').drawImage(c, 0, 0, k.width, k.height);
    const blob = await new Promise(ok => k.toBlob(ok, 'image/jpeg', 0.75));
    return { leitura, previa, blob };
  } finally {
    liberar();
  }
}
