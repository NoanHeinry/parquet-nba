// Service Worker de Parquet pour le fonctionnement PWA et la mise en cache.

const CACHE_NAME = "parquet-v1";
const API_CACHE_NAME = "parquet-api-v1";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./fonts/archivo.woff",
  "./fonts/big-shoulders-display.woff",
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
  "./js/notifications.js",
  "./js/views/home.js",
  "./js/views/game.js",
  "./js/views/teams.js",
  "./js/views/team.js",
  "./js/views/players.js",
  "./js/views/player.js",
  "./js/views/standings.js",
  "./js/views/leaders.js",
  "./js/views/compare.js",
  "./js/views/playoffs.js",
  "./js/views/status.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== API_CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Requêtes API : Network-First avec repli sur cache si le serveur est momentanément inaccessible
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes.ok) {
            const clone = networkRes.clone();
            caches.open(API_CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached) return cached;
            return new Response(
              JSON.stringify({
                error: "Serveur Parquet local hors ligne",
                offline: true,
              }),
              {
                status: 503,
                headers: { "Content-Type": "application/json; charset=utf-8" },
              }
            );
          })
        )
    );
    return;
  }

  // Requêtes CDN NBA (logos / photos) : Cache-first avec mise en cache dynamique
  if (url.hostname === "cdn.nba.com") {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Fichiers statiques de l'application : Stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes.ok) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => {
          // Si navigation HTML hors ligne, renvoyer la page racine index.html
          if (req.mode === "navigate") {
            return caches.match("./index.html");
          }
          return null;
        });

      return cachedRes || fetchPromise;
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
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
