// Service worker: deixa o app instalável, abre mesmo sem internet e mostra os avisos (push).
// "Rede primeiro": sempre busca a versão nova; usa o que está guardado só se a rede falhar.
// Não intercepta nada do Supabase (outra origem) nem envios (POST).
const VERSAO = 'pemt-v6';

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

// ---------- Avisos (push) ----------
// Conteúdo enviado pela função enviar-push: { titulo, corpo, url, tag }
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corpo: e.data ? e.data.text() : '' }; }
  const titulo = d.titulo || 'Treinamento PEMT';
  const opcoes = {
    body: d.corpo || '',
    icon: './icon-192.png',
    badge: './badge-96.png',
    tag: d.tag || 'agenda',
    renotify: true,
    lang: 'pt-BR',
    data: { url: d.url || './' }
  };
  e.waitUntil(Promise.all([
    self.registration.showNotification(titulo, opcoes),
    // App aberto: atualiza a lista de agendados na hora
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(cs => cs.forEach(c => c.postMessage({ tipo: 'aviso', dados: d })))
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope);
  if (alvo.origin !== self.location.origin) alvo.href = self.registration.scope;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const app = cs.find(c => new URL(c.url).origin === alvo.origin && !new URL(c.url).pathname.includes('/admin'));
      if (app) {
        app.postMessage({ tipo: 'abrir', url: alvo.href });
        return app.focus();
      }
      return self.clients.openWindow(alvo.href);
    })
  );
});
