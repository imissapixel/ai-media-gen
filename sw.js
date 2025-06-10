const CACHE_NAME = 'ai-media-gen-v1';
const urlsToCache = [
  '/manifest.json'
  // Note: Main app routes are handled by authentication middleware
];

// Install Service Worker
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch
self.addEventListener('fetch', function(event) {
  // Skip authentication routes and let server handle them
  if (event.request.url.includes('/login') || 
      event.request.url.includes('/logout') || 
      event.request.url.includes('/health')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Cache hit - return response
        if (response) {
          return response;
        }

        return fetch(event.request).then(
          function(response) {
            // Don't cache authentication-related responses or errors
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Skip caching HTML responses that might contain auth redirects
            if (response.headers.get('content-type') && 
                response.headers.get('content-type').includes('text/html')) {
              return response;
            }

            // IMPORTANT: Clone the response. A response is a stream
            // and because we want the browser to consume the response
            // as well as the cache consuming the response, we need
            // to clone it so we have two streams.
            var responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(function(cache) {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
    );
});

// Activate
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Handle background sync for offline functionality
self.addEventListener('sync', function(event) {
  if (event.tag == 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

function doBackgroundSync() {
  // Handle any background tasks here
  console.log('Background sync triggered');
}