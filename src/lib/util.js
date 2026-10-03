export const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function hoje() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export const fmtData = iso => (iso ? iso.split('-').reverse().join('/') : '');
export const fmtDataHora = ms => (ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const nk = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const palavras = s => String(s || '').trim().split(/\s+/).filter(Boolean);

// Adiciona sem duplicar (ignora maiúsculas/acentos); usa a grafia já cadastrada, se houver.
export function comUnico(lista, valor, base = []) {
  const v = String(valor || '').replace(/\s+/g, ' ').trim();
  if (!v || lista.some(x => nk(x) === nk(v))) return lista;
  const oficial = base.find(x => nk(x) === nk(v));
  return [...lista, oficial || v];
}

export function lsGet(k, padrao) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch { return padrao; }
}
export function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem espaço */ }
}
