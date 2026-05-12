const MEHFIL_SW_VERSION = "mehfil-pwa-v1";
const APP_SHELL_CACHE = `${MEHFIL_SW_VERSION}-shell`;

const APP_SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./offline.html",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== APP_SHELL_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  const isSupabase =
    url.hostname.includes("supabase.co");

  const isLrclib =
    url.hostname.includes("lrclib.net") ||
    url.hostname.includes("workers.dev");

  if (isSupabase || isLrclib) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();

          caches.open(APP_SHELL_CACHE).then(cache => {
            cache.put("./index.html", copy);
          });

          return response;
        })
        .catch(() => caches.match("./offline.html"))
    );

    return;
  }

  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) return cached;

        return fetch(request)
          .then(response => {
            if (!response || response.status !== 200) return response;

            const copy = response.clone();

            caches.open(APP_SHELL_CACHE).then(cache => {
              cache.put(request, copy);
            });

            return response;
          });
      })
  );
});