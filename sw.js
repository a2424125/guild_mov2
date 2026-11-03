// ========================================================
// [길드톡 메신저] 고속 캐싱 & PWA 서비스 워커 (sw.js)
// ========================================================

const CACHE_NAME = 'guildtalk-core-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/style.css',
  '/icon.png'
];

// 1. 설치 단계: 핵심 기본 정적 자원을 미리 스마트폰에 캐싱하여 로딩 속도 극대화
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Pre-cache warning:', err);
      });
    })
  );
  self.skipWaiting();
});

// 2. 활성화 단계: 이전 버전의 낡은 캐시 말끔히 청소
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. 통신 단계: Supabase 실시간 데이터는 무조건 네트워크 통신, 정적 화면 파일은 고속 캐시 반환
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 실시간 DB API 통신(Supabase)이나 POST 요청은 절대 캐시하지 않고 통과
  if (url.hostname.includes('supabase.co') || event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // 캐시된 자원이 있으면 0.1초 만에 즉시 화면을 띄우고 백그라운드 갱신
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
