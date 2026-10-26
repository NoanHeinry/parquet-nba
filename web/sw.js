// Service Worker de Parquet : installation en application (PWA) et fonctionnement hors ligne.
//
// Le serveur Parquet tourne sur la même machine ou le même réseau : le réseau est donc
// toujours essayé en premier, et le cache ne sert que de secours quand le serveur est arrêté.
// Ainsi, une mise à jour du code est visible dès le lancement suivant, sans mélange de versions.

const VERSION = "1.3.0";
const STATIC_CACHE = `parquet-static-${VERSION}`;
const API_CACHE = `parquet-api-${VERSION}`;
const API_CACHE_MAX = 150;

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./fonts/oswald.woff",
  "./fonts/barlow-400.woff",
  "./fonts/barlow-600.woff",
  "./fonts/barlow-700.woff",
  "./img/icon.svg",
  "./img/icon-192.png",
  "./img/icon-512.png",
  "./img/apple-touch-icon.png",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/api.js",
  "./js/dom.js",
  "./js/router.js",
  "./js/format.js",
  "./js/teams.js",
  "./js/search.js",
  "./js/charts.js",
  "./js/components.js",
  "./js/icons.js",
  "./js/spoiler.js",
  "./js/notifications.js",
  "./js/views/home.js",
  "./js/views/recap.js",
  "./js/views/game.js",
  "./js/views/multi.js",
  "./js/views/teams.js",
  "./js/views/team.js",
  "./js/views/players.js",
  "./js/views/player.js",
  "./js/views/standings.js",
  "./js/views/playoffs.js",
  "./js/views/leaders.js",
  "./js/views/compare.js",
  "./js/views/status.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== API_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Garde seulement les réponses d'API les plus récentes.
async function trimApiCache() {
  const cache = await caches.open(API_CACHE);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - API_CACHE_MAX))) await cache.delete(key);
}

async function networkFirst(req, cacheName, { trim = false, offlineFallback } = {}) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(req, res.clone());
      if (trim) trimApiCache();
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (offlineFallback) return offlineFallback();
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Logos et photos de NBA.com : laissés au cache HTTP du navigateur.
  if (url.origin !== self.location.origin) return;

  // Export de calendrier : jamais mis en cache.
  if (url.pathname.endsWith(".ics")) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      networkFirst(req, API_CACHE, {
        trim: true,
        offlineFallback: () =>
          new Response(JSON.stringify({ error: "Le serveur Parquet est arrêté. Relance-le sur ton ordinateur.", offline: true }), {
            status: 503,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          }),
      })
    );
    return;
  }

  event.respondWith(
    networkFirst(req, STATIC_CACHE, {
      offlineFallback: () => (req.mode === "navigate" ? caches.match("./index.html") : Response.error()),
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "./";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
      return undefined;
    })
  );
});
