// Service worker minimal : rend l'application installable et affiche une page
// claire hors connexion. Les données restent servies en direct par Google.
// Partage Android (« Partager › Gestion location ») : le fichier reçu est mis de côté
// ici, puis la page le transmet à l'application (import de l'export Booking).
const CACHE = 'location-v2';
const SHARE = 'gl-share';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SHARE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const file = form.getAll('file').find(f => f && typeof f !== 'string');
        if (file) {
          const c = await caches.open(SHARE);
          await c.put('./shared-file', new Response(file, { headers: { 'X-Name': encodeURIComponent(file.name || 'export') } }));
        }
      } catch (err) { /* la page dira qu'aucun fichier n'a été reçu */ }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
