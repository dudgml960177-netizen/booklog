// 북로그 서비스 워커
// 온라인 우선 앱이므로 데이터/페이지는 캐시하지 않고,
// 오프라인일 때만 안내 페이지와 아이콘을 제공한다.
const CACHE = 'booklog-offline-v1';
const OFFLINE_ASSETS = [
  '/offline.html',
  '/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 알림 클릭 → 앱 창으로 포커스(없으면 새로 열기)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cls) => {
      for (const c of cls) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 페이지 이동(navigation): 네트워크 우선, 실패 시 오프라인 페이지
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // 그 외 요청: 네트워크 우선, 실패 시 캐시된 아이콘 등이 있으면 제공
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
