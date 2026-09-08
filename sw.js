const CACHE = 'analysis-power-v6.0.0';
const LOCAL_ASSETS = [
  './','./index.html','./manifest.webmanifest','./css/styles.css','./css/power.css','./css/director.css','./js/constants.js','./js/utils.js','./js/csv.js','./js/xlsx-lite.js','./js/importer.js',
  './js/storage.js','./js/geo.js','./js/intelligence.js','./js/autopilot.js','./js/analytics.js','./js/public-context.js','./js/causal-context.js','./js/power.js','./js/director.js','./js/ui.js','./js/app.js','./config/store.json','./data/public-context.json','./data/public-context-history.json'
];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(LOCAL_ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('analysis-power-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  const relative = './' + url.pathname.slice(scope.length);
  if (!LOCAL_ASSETS.includes(relative)) return;
  url.search = '';
  const key = url.href;
  event.respondWith(fetch(event.request).then(resp => {
    if (resp.ok) { const copy = resp.clone(); event.waitUntil(caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {})); }
    return resp;
  }).catch(async () => (await caches.match(key)) || Response.error()));
});
