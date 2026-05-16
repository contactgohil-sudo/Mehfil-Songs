const CACHE_NAME = "mehfil-pwa-cache-v5";

const CORE_ASSETS = [
  "./",
  "./index-mehfil-worker-ready-fixed.html",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      await Promise.all(
        CORE_ASSETS.map(async url => {
          try {
            const response = await fetch(url, { cache: "reload" });

            if (response && response.ok) {
              await cache.put(url, response.clone());
            }
          } catch (error) {
            console.warn("Mehfil cache skipped:", url, error);
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();

      await Promise.all(
        names
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

    if (request.mode === "navigate") {
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      const cached =
        await cache.match("./index-mehfil-worker-ready-fixed.html") ||
        await cache.match("./") ||
        await cache.match(request);

      const networkUpdate = fetch(request)
        .then(response => {
          if (response && response.ok) {
            cache.put("./index-mehfil-worker-ready-fixed.html", response.clone()).catch(() => {});
            cache.put(request, response.clone()).catch(() => {});
          }

          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkUpdate);
        return cached;
      }

      const network = await networkUpdate;

      return network || new Response("Mehfil is offline. Please open once with internet.", {
        status: 503,
        headers: {
          "Content-Type": "text/plain"
        }
      });
    })()
  );

  return;
}

  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, copy).catch(() => {});
          });
        }

        return response;
      });
    })
  );
});
