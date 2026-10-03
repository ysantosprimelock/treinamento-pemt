// Reduz a foto para no máximo 1280 px e JPEG ~72% (≈200–300 KB), mantendo a orientação.
export async function comprimir(arquivo, max = 1280, qualidade = 0.72) {
  let fonte, w, h, liberar = () => {};
  try {
    fonte = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    w = fonte.width; h = fonte.height;
    liberar = () => fonte.close && fonte.close();
  } catch {
    const url = URL.createObjectURL(arquivo);
    fonte = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = url; });
    w = fonte.naturalWidth; h = fonte.naturalHeight;
    liberar = () => URL.revokeObjectURL(url);
  }
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(fonte, 0, 0, c.width, c.height);
  liberar();
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', qualidade));
  if (!blob) throw new Error('Não foi possível processar a foto.');
  return blob;
}
