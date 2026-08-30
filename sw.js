/* Service worker: app shell cached for offline use; map tiles cached as
 * you browse so previously seen areas keep working underground. */
var APP_CACHE = "subway-app-v1";
var TILE_CACHE = "subway-tiles-v1";
var TILE_LIMIT = 1200; // ~tens of MB max; oldest entries trimmed

var APP_ASSETS = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "data/subway_data.js",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(APP_CACHE).then(function (c) { return c.addAll(APP_ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== APP_CACHE && k !== TILE_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function trimTiles(cache) {
  cache.keys().then(function (keys) {
    if (keys.length <= TILE_LIMIT) return;
    var toDelete = keys.slice(0, keys.length - TILE_LIMIT);
    toDelete.forEach(function (req) { cache.delete(req); });
  });
}

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Map tiles: cache-first, fill the cache as tiles are seen.
  if (url.hostname.indexOf("basemaps.cartocdn.com") !== -1) {
    e.respondWith(
      caches.open(TILE_CACHE).then(function (cache) {
        return cache.match(e.request).then(function (hit) {
          if (hit) return hit;
          return fetch(e.request).then(function (resp) {
            if (resp && resp.status === 200) {
              cache.put(e.request, resp.clone());
              trimTiles(cache);
            }
            return resp;
          });
        });
      })
    );
    return;
  }

  // App shell: stale-while-revalidate — instant loads, updates in background.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(APP_CACHE).then(function (cache) {
        return cache.match(e.request).then(function (hit) {
          var refresh = fetch(e.request).then(function (resp) {
            if (resp && resp.status === 200) cache.put(e.request, resp.clone());
            return resp;
          }).catch(function () { return hit; });
          return hit || refresh;
        });
      })
    );
  }
});
