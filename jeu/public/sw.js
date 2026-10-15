// Service worker d'Urbasim : le jeu s'installe et se rouvre même sans réseau.
//  - page (navigation) : réseau d'abord, donc toujours la dernière version en ligne ; cache en secours hors ligne ;
//  - fichiers du jeu (noms avec empreinte, donc immuables) : cache d'abord ;
//  - fonds de carte : cache en secours, rafraîchi en arrière-plan (les zones déjà vues restent disponibles hors ligne).
const VERSION = 'urbasim-v1';
const APP = `${VERSION}-app`;
const TILES = `${VERSION}-tiles`;
const MAX_TILES = 400;

// À l'installation : la page et ses fichiers (repérés dans le HTML) sont mis en cache, pour que même la première
// visite fonctionne ensuite hors ligne.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(APP);
        const home = new URL('./', self.location.href);
        const res = await fetch(home.href, { cache: 'reload' });
        const html = await res.clone().text();
        await cache.put(home.href, res);
        const files = [...html.matchAll(/(?:src|href)="(\.?\/?(?:assets|icons)\/[^"]+|\.?\/?manifest\.webmanifest)"/g)].map((m) => new URL(m[1], home).href);
        await Promise.all(files.map((f) => cache.add(f).catch(() => undefined)));
      } catch {
        /* hors ligne ou erreur réseau : le cache se remplira à l'usage */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(APP).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, { ignoreVary: true }).then((r) => r || caches.match(new URL('./', self.location.href).href, { ignoreVary: true }))),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(APP).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (/basemaps\.cartocdn\.com|tile\.openstreetmap\.org/.test(url.hostname)) {
    event.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(req, { ignoreVary: true });
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') {
              cache.put(req, res.clone());
              trim(TILES, MAX_TILES);
            }
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
  }
});
