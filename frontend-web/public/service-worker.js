const CACHE_NAME = 'spotlight-mock-exams-v1';
const EXAM_CACHE = 'spotlight-exams-v1';
const API_CACHE = 'spotlight-api-v1';
const STALE_WHILE_REVALIDATE_CACHE = 'spotlight-swr-v1';

const URLS_TO_CACHE = [
  '/',
  '/academy/mock-exams',
  '/styles/globals.css',
  '/fonts/inter.woff2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const API_PATTERNS = [
  /\/api\/mock-exams\//,
  /\/api\/academy\/assessment\//,
];

// Installation event - cache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE).catch((err) => {
        console.warn('Failed to cache some URLs:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activation event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => {
            return (
              cacheName !== CACHE_NAME &&
              cacheName !== EXAM_CACHE &&
              cacheName !== API_CACHE &&
              cacheName !== STALE_WHILE_REVALIDATE_CACHE
            );
          })
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome extensions
  if (url.protocol === 'chrome-extension:') {
    return;
  }

  // API requests - network first with cache fallback
  if (API_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // Exam pages and assets - cache first with network fallback
  if (url.pathname.includes('/mock-exams/')) {
    event.respondWith(cacheFirstStrategy(request, EXAM_CACHE));
    return;
  }

  // Everything else - stale while revalidate
  event.respondWith(staleWhileRevalidateStrategy(request));
});

/**
 * Cache first strategy: serve from cache, update in background
 */
async function cacheFirstStrategy(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    if (cached) {
      // Update cache in background
      updateCache(request, cacheName);
      return cached;
    }

    // Not in cache, try network
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return offlineFallback(request);
  }
}

/**
 * Network first strategy: try network, fall back to cache
 */
async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

/**
 * Stale while revalidate: serve cached, update in background
 */
async function staleWhileRevalidateStrategy(request) {
  const cache = await caches.open(STALE_WHILE_REVALIDATE_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  });

  return cached || fetchPromise.catch(() => offlineFallback(request));
}

/**
 * Update cache in background
 */
async function updateCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response);
    }
  } catch (error) {
    // Silently fail - user already has cached version
  }
}

/**
 * Offline fallback
 */
function offlineFallback(request) {
  // For API requests, return offline indicator
  if (API_PATTERNS.some((pattern) => pattern.test(new URL(request.url).pathname))) {
    return new Response(
      JSON.stringify({
        error: 'Offline - No cached data available',
        offline: true,
      }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // For pages, return offline page
  return caches.match('/offline') || new Response('Offline', { status: 503 });
}

/**
 * Handle messages from clients
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(event.data.cacheName);
  }
});
