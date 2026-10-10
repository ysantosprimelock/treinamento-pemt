// Service worker: deixa o app instalável e abre mesmo sem internet.
// "Rede primeiro": sempre busca a versão nova; usa o que está guardado só se a rede falhar.
// Não intercepta nada do Supabase (outra origem) nem envios (POST).
const VERSAO = 'pemt-v5';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(['./', './index.html', './manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(r)
      .then(res => {
        if (res.ok) { const copia = res.clone(); caches.open(VERSAO).then(c => c.put(r, copia)); }
        return res;
      })
      .catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
