// Provas guardadas no aparelho do instrutor.
// O gabarito fica no banco (o código do app é público). Depois do login o app baixa as provas
// (baixarProvas) e guarda no aparelho, para aplicar e corrigir a prova em papel sem internet.
// Comprovantes de provas antigas usam a versão em que foram respondidas (provaPorId).
export { LETRAS, minimoAcertos, corrigir, resultadoFinal } from './correcao.js';

const CHAVE = 'pemt.provas.v1';
let cache = ler();

function ler() {
  try {
    const x = JSON.parse(globalThis.localStorage.getItem(CHAVE) || 'null');
    if (x && x.provas && typeof x.provas === 'object') return x;
  } catch { /* sem armazenamento */ }
  return { provas: {}, atual: null };
}

function normalizar(r) {
  return { id: r.id, titulo: r.titulo, notaMinima: Number(r.nota_minima ?? r.notaMinima), questoes: r.questoes };
}

const valida = p => p && p.id && Number.isFinite(p.notaMinima) && Array.isArray(p.questoes) && p.questoes.length > 0 &&
  p.questoes.every(q => q && typeof q.p === 'string' && Array.isArray(q.a) && Number.isInteger(q.c));

// linhas: registros da tabela provas, em ordem de criação (a última é a atual)
export function guardarProvas(linhas) {
  const provas = { ...cache.provas };
  let atual = cache.atual;
  for (const r of linhas || []) {
    const p = normalizar(r);
    if (!valida(p)) continue;
    provas[p.id] = p;
    atual = p.id;
  }
  cache = { provas, atual };
  try { globalThis.localStorage.setItem(CHAVE, JSON.stringify(cache)); } catch { /* fica só na memória */ }
  return provaAtual();
}

export const provaPorId = id => (id && cache.provas[id]) || null;
export const provaAtual = () => provaPorId(cache.atual);

export async function baixarProvas(supabase) {
  const { data, error } = await supabase.from('provas').select('id, titulo, nota_minima, questoes, criada_em').order('criada_em', { ascending: true });
  if (error) throw error;
  if (!data || !data.length) throw new Error('Nenhuma prova cadastrada no banco. Rode o arquivo 06_provas.sql.');
  return guardarProvas(data);
}

// Prova de uma versão; se não estiver no aparelho, baixa (usado no envio, que já está online)
export async function garantirProva(supabase, id) {
  if (provaPorId(id)) return provaPorId(id);
  await baixarProvas(supabase);
  const p = provaPorId(id);
  if (!p) throw new Error(`Prova ${id} não encontrada no banco.`);
  return p;
}

// Só para os testes
export function _limparProvas() {
  cache = { provas: {}, atual: null };
  try { globalThis.localStorage.removeItem(CHAVE); } catch { /* ignore */ }
}
