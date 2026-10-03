// Armazenamento no aparelho (IndexedDB). As gravações usam durabilidade "strict"
// (o navegador só confirma depois de gravar em disco), para não perder dados.
const NOME = 'pemt';
const VERSAO = 1;
let conexao = null;

function abrir() {
  if (!conexao) {
    conexao = new Promise((ok, no) => {
      const r = indexedDB.open(NOME, VERSAO);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('treinamentos')) db.createObjectStore('treinamentos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('arquivos')) {
          const s = db.createObjectStore('arquivos', { keyPath: 'chave' });
          s.createIndex('porTreinamento', 'treinamentoId');
        }
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => { conexao = null; no(r.error); };
    });
  }
  return conexao;
}

const pedido = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const concluir = t => new Promise((ok, no) => {
  t.oncomplete = () => ok();
  t.onerror = () => no(t.error);
  t.onabort = () => no(t.error || new Error('Gravação no aparelho cancelada.'));
});
const escrita = (db, lojas) => db.transaction(lojas, 'readwrite', { durability: 'strict' });

export async function put(loja, valor) {
  const db = await abrir();
  const t = escrita(db, loja);
  t.objectStore(loja).put(valor);
  await concluir(t);
}

export async function get(loja, chave) {
  const db = await abrir();
  return pedido(db.transaction(loja).objectStore(loja).get(chave));
}

export async function todos(loja) {
  const db = await abrir();
  return pedido(db.transaction(loja).objectStore(loja).getAll());
}

export async function del(loja, chave) {
  const db = await abrir();
  const t = escrita(db, loja);
  t.objectStore(loja).delete(chave);
  await concluir(t);
}

export async function arquivosDe(treinamentoId) {
  const db = await abrir();
  return pedido(db.transaction('arquivos').objectStore('arquivos').index('porTreinamento').getAll(treinamentoId));
}

export async function apagarTreinamento(id) {
  const db = await abrir();
  const t = escrita(db, ['treinamentos', 'arquivos']);
  t.objectStore('treinamentos').delete(id);
  const r = t.objectStore('arquivos').index('porTreinamento').getAllKeys(id);
  r.onsuccess = () => { for (const k of r.result) t.objectStore('arquivos').delete(k); };
  await concluir(t);
}
