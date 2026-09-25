// Service worker: lets the app open with no signal, and stops the phone
// running stale scripts after a deploy.
//
// Strategy is network-first. Online, every file is fetched from the server
// with cache: 'no-cache', which revalidates past GitHub Pages' 10-minute
// HTTP cache, so a deploy is picked up on the next load and all files come
// from the same deploy. Each response is stored. Offline, or when the
// network takes longer than NETWORK_TIMEOUT_MS (a weak signal in a practice
// room), the stored copy is served instead.

const CACHE = 'woodshed';
const NETWORK_TIMEOUT_MS = 3000;

// Everything the app needs, cached at install so the very first visit is
// enough to work offline. tests/offline.spec.js fails if a file in public/
// is missing from this list.
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/midi.js', 'js/music.js', 'js/audio.js', 'js/events.js', 'js/drill.js',
  'js/notation.js', 'js/weakspots.js', 'js/backup.js',
  'js/levels.js', 'js/scoring.js', 'js/heatmap.js', 'js/summary.js', 'js/sync.js', 'js/scales.js', 'js/tempo.js', 'js/scalelevels.js', 'js/rangemap.js', 'js/scaletempo.js', 'fonts/realbook.woff2', 'fonts/symbols.woff2',
  'fonts/REALBOOK-LICENSE.txt', 'fonts/DEJAVU-LICENSE.txt',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(a => new Request(a, { cache: 'no-cache' })));
    // Take over straight away instead of waiting for every tab to close.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  e.respondWith(networkFirst(request.url));
});

async function networkFirst(url) {
  const cache = await caches.open(CACHE);
  try {
    // Fetch by URL, not by the original Request: navigation requests can't
    // be re-issued with a new cache mode.
    const res = await withTimeout(fetch(url, { cache: 'no-cache' }), NETWORK_TIMEOUT_MS);
    if (res.ok) await cache.put(url, res.clone());
    return res;
  } catch {
    const cached = await cache.match(url, { ignoreSearch: true });
    return cached || Response.error();
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      err => { clearTimeout(timer); reject(err); });
  });
}
