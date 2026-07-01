/* AUTUS Builder — Service Worker (offline + 업데이트 프롬프트) */
/* VERSION은 배포 시 pre-commit 훅이 자동으로 갱신 → 변경 감지 트리거 */
const VERSION = '20260701-214318';
const CACHE = 'autus-builder-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // 자동 업그레이드: 새 버전을 즉시 활성화(skipWaiting). 페이지 쪽에서 '안 끊기게' 반영.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 페이지에서 '업데이트' 누르면 SKIP_WAITING 메시지 → 즉시 활성화
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// 네비게이션 = 네트워크 우선(최신 우선), 실패 시 캐시. 정적자산 = 캐시 우선.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 실공고 데이터는 항상 최신(네트워크 우선), 실패 시 캐시
  if (new URL(req.url).pathname.endsWith('/opps.json')) {
    e.respondWith(
      fetch(req).then(res => { const c = res.clone(); caches.open(CACHE).then(ch => ch.put(req, c)); return res; })
        .catch(() => caches.match(req))
    );
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => hit))
  );
});
