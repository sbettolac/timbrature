// Tiene pronta l'app per aprirla subito. Prova sempre prima la versione online,
// cosi' gli aggiornamenti arrivano da soli. Le timbrature non passano da qui.
const CACHE = 'timbrature-v2';
const FILES = ['./', './index.html', './app.js', './config.js', './styles.css',
               './manifest.webmanifest', './icone/icona-192.png', './icone/logo-marcos.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
