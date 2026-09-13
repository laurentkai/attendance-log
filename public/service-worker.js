const CACHE_PREFIX = 'attendance-log-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v15`;
const OFFLINE_URL = '/offline.html';
const STATIC_ASSETS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/i18n/en.json',
  '/i18n/fr.json',
  '/vendor/bootstrap/css/bootstrap.min.css',
  '/vendor/bootstrap/js/bootstrap.bundle.min.js',
  '/css/styles.css',
  '/js/backup-settings.js',
  '/js/i18n.js',
  '/js/classes.js',
  '/js/live-attendance.js',
  '/js/otp-resend.js',
  '/js/pwa.js',
  '/js/security.js',
  '/js/student-qr-print.js',
  '/js/print-design-alignment.js',
  '/js/print-design-editor.js',
  '/js/privacy-center.js',
  '/js/user-actions-dropdown.js',
  '/icons/attendance-log-192.png',
  '/icons/attendance-log-512.png',
  '/icons/attendance-log-maskable-512.png',
  '/icons/apple-touch-icon.png',
];
const STATIC_PATHS = new Set(STATIC_ASSETS);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(cacheNames
        .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirstStatic(request, pathname) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = new Request(new URL(pathname, self.location.origin), {
    credentials: 'same-origin',
  });

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (error) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
    throw error;
  }
}

function languageFromHeader(header = '') {
  const supported = new Set(['en', 'fr']);
  return String(header).split(',')
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(';');
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith('q='));
      const quality = qualityParameter ? Number.parseFloat(qualityParameter.trim().slice(2)) : 1;
      return { language: tag.toLowerCase().split('-')[0], quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => supported.has(entry.language) && entry.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index)[0]?.language || 'en';
}

async function offlineTextResponse(request) {
  const language = languageFromHeader(request.headers.get('Accept-Language') || '');
  const resource = await caches.match(`/i18n/${language}.json`) || await caches.match('/i18n/en.json');
  let message = 'Attendance Log is offline. Reconnect, then try again.';
  if (resource) {
    try {
      const translations = await resource.json();
      message = `${translations['pwa.offline.heading']} ${translations['pwa.offline.retry_help']}`;
    } catch (_error) { /* Keep the canonical English emergency fallback. */ }
  }
  return new Response(message, { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (
        (await caches.match(OFFLINE_URL))
        || offlineTextResponse(request)
      )),
    );
    return;
  }

  if (STATIC_PATHS.has(url.pathname)) {
    event.respondWith(networkFirstStatic(request, url.pathname));
  }
});
