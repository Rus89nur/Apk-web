const CACHE_NAME = 'gazprom-web-v306';
const IS_LOCALHOST = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css?v=303',
  './css/appearance.css?v=303',
  './js/appearance.js?v=272',
  './js/idb-connection.js?v=22',
  './js/file-utils.js?v=1',
  './js/data-store.js?v=28',
  './js/photo-store.js?v=31',
  './js/akt-utils.js?v=40',
  './js/toast.js?v=2',
  './js/mobile-overlay.js?v=40',
  './js/violation-search.js?v=3',
  './js/photo-lightbox.js?v=1',
  './js/wizard-violations-ui.js?v=2',
  './js/violation-templates.js?v=24',
  './js/violation-types.js?v=14',
  './js/violation-types-editor.js?v=13',
  './js/ml-image-service.js?v=6',
  './js/ml-training-wizard.js?v=10',
  './js/offline-status.js?v=1',
  './js/ui-bindings.js?v=41',
  './js/doc-generator.js?v=44',
  './js/template-builder-wizard.js?v=3',
  './js/defaults-bootstrap.js?v=15',
  './js/violation-registry.js?v=16',
  './js/catalog-service.js?v=4',
  './js/backup-import.js?v=32',
  './js/akt-search.js',
  './js/catalog-editor.js?v=22',
  './js/schedule-editor.js?v=3',
  './js/elimination-editor.js?v=12',
  './js/wizard-modals.js?v=66',
  './js/wizard.js?v=72',
  './js/spravka-utils.js?v=4',
  './js/spravka-wizard.js?v=14',
  './js/short-akt-form.js?v=9',
  './js/report-exporter.js?v=2',
  './js/reports-dashboard.js?v=20',
  './js/app.js?v=167',
  './assets/sample-demo.gazprombackup',
  './assets/defaults/manifest.json',
  './assets/defaults/violation-registry.json',
  './assets/defaults/akt-template.docx',
  './assets/defaults/Шаблон_справки_ПБ.docx',
  './assets/defaults/violation-registry.xlsx',
  './assets/vendor/xlsx.full.min.js',
  './assets/vendor/pizzip.min.js',
  './assets/vendor/docxtemplater.js',
];

self.addEventListener('install', (event) => {
  if (IS_LOCALHOST) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  if (IS_LOCALHOST) {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
        .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url))))
    );
    return;
  }
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'GAZPROM_SW_ACTIVATED', cache: CACHE_NAME });
        });
      })
  );
});

function isNavigateRequest(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

function isSwScript(url) {
  return /\/sw\.js(\?|$)/i.test(url.pathname);
}

async function offlineFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  if (isNavigateRequest(request)) {
    return (await caches.match('./index.html')) || (await caches.match('./'));
  }
  return undefined;
}

// Стратегия: Network First — свежий ответ с сети; кэш для офлайна.
// Shell (navigate/document) тоже кладём в CACHE_NAME, иначе после первого визита
// офлайн часто не открывается. sw.js в runtime-кэш не пишем.
self.addEventListener('fetch', (event) => {
  if (IS_LOCALHOST) return;
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const navigate = isNavigateRequest(request);
  const swJs = isSwScript(url);
  const isAppAsset =
    navigate ||
    swJs ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    /\.(js|css|html)(\?|$)/i.test(url.pathname);

  if (isAppAsset) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic' && !swJs) {
            const forRequest = response.clone();
            const forIndex = navigate ? response.clone() : null;
            const forRoot = navigate ? response.clone() : null;
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, forRequest);
              if (forIndex) cache.put('./index.html', forIndex);
              if (forRoot) cache.put('./', forRoot);
            });
          }
          return response;
        })
        .catch(() => offlineFallback(request))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => offlineFallback(request))
  );
});
