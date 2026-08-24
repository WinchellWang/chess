const CACHE_NAME = 'chess-arena-v2';

const APP_SHELL = [
  './',
  './index.html',
  './about.md',
  './manifest.webmanifest',
  './styles.css?v=20260822-9',
  './app.js?v=20260822-4',
  './vendor/chess.js',
  './assets/chess-logo.svg',
  './assets/chess-pwa-icon.svg',
  './assets/pieces/white_pawn.svg',
  './assets/pieces/white_rook.svg',
  './assets/pieces/white_knight.svg',
  './assets/pieces/white_bishop.svg',
  './assets/pieces/white_queen.svg',
  './assets/pieces/white_king.svg',
  './assets/pieces/black_pawn.svg',
  './assets/pieces/black_rook.svg',
  './assets/pieces/black_knight.svg',
  './assets/pieces/black_bishop.svg',
  './assets/pieces/black_queen.svg',
  './assets/pieces/black_king.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(APP_SHELL.map(async (url) => {
        try {
          await cache.add(url);
        } catch (error) {
          console.warn('Unable to precache ' + url + ':', error);
        }
      })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('chess-arena-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  const networkResponse = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await networkResponse;
  if (response) {
    return response;
  }

  if (request.mode === 'navigate') {
    return cache.match('./index.html');
  }

  return new Response('Offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
