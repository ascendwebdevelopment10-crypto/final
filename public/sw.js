const CACHE_NAME = 'ascend-static-v1';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/ascend-icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ascend-static-') && key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

function offlinePage() {
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07100b"><title>Ascend — Offline</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#060908;color:#edf2ee;font:16px system-ui}.card{max-width:340px;margin:24px;padding:30px;border:1px solid rgba(180,255,210,.18);border-radius:20px;background:linear-gradient(145deg,rgba(28,43,34,.8),rgba(8,16,12,.72));box-shadow:0 25px 80px #0008;text-align:center}h1{font-size:22px}p{color:#8e9d93;line-height:1.6}button{border:0;border-radius:10px;padding:12px 18px;background:linear-gradient(120deg,#66f2a3,#5de6e6);color:#07100b;font-weight:700}</style></head><body><div class="card"><h1>Ascend is offline</h1><p>Your live outreach data stays private and is never stored for offline use. Reconnect to load the command center.</p><button onclick="location.reload()">Try again</button></div></body></html>`, {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}});
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(offlinePage));
    return;
  }

  if (url.pathname.startsWith('/api/') || url.pathname === '/dashboard') return;

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      return response;
    })));
  }
});
