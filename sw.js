// sw.js - PWA Service Worker
const CACHE_NAME = 'guild-pwa-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // 실시간 웹소켓 및 REST API의 최신 데이터 유지를 위해 네트워크 우선 통신
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
