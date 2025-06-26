// Service Worker for SWCP Tracker
const CACHE_NAME = 'swcp-tracker-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/auth.js',
  '/auth-controller.js',
  '/startup.js',
  '/firebase-config.js'
];

// Install event - cache resources
self.addEventListener('install', function(event) {
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Background sync for activity analysis
self.addEventListener('sync', event => {
  if (event.tag === 'analyze-activities') {
    event.waitUntil(syncAnalyzeActivities());
  }
});

async function syncAnalyzeActivities() {
  // This would sync pending activity analyses when back online
  console.log('Background sync: analyzing activities');
} 