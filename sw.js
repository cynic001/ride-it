/**
 * sw.js — 오프라인 캐싱 서비스 워커
 * - 설치 시: 앱 셸(html/js/manifest/아이콘/하늘 .env)만 선캐싱 — 스테이지별 glb는 처음 플레이할 때 런타임 캐싱
 *   (초기 다운로드를 늘리지 않기 위해 5스테이지 에셋 전체 선캐싱은 하지 않음)
 * - html/js: 네트워크 우선(배포 업데이트가 바로 반영), 오프라인이면 캐시
 * - glb/env/png/폰트/CDN(Babylon.js): 캐시 우선(내용이 바뀌지 않는 정적 에셋)
 * 캐시 구조를 바꾸거나 선캐싱 목록이 달라지면 CACHE 버전을 올릴 것.
 */
const CACHE = 'ride-it-v1';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'js/quality.js', 'js/audio.js', 'js/stages.js', 'js/track.js', 'js/cart.js',
  'js/camera.js', 'js/input.js', 'js/ui.js', 'js/main.js',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/vendor/polyhaven/sky_256.env',
  'assets/vendor/kenney-coaster-kit/Textures/colormap.png',
  'assets/icons/apple-touch-icon.png', 'assets/icons/favicon-64.png',
];
// 엔진(CDN)도 선캐싱 — 첫 방문 때는 SW가 페이지를 제어하기 전에 스크립트가 이미 받아져 런타임 캐싱에 안 걸리므로,
// 선캐싱하지 않으면 "한 번 방문 후 오프라인"에서 엔진이 없어 실행 불가. index.html의 버전과 맞출 것
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/babylonjs/7.25.0/babylon.js',
  'https://cdn.jsdelivr.net/npm/babylonjs-loaders@7.25.0/babylonjs.loaders.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all([c.addAll(CORE), c.addAll(CDN.map(u => new Request(u, { mode: 'cors' })))]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = (req, res) => {
  // opaque(교차 출처 no-cors 스크립트)도 캐싱 — 상태코드를 볼 수 없으므로 opaque는 그대로 저장
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const networkFirst = sameOrigin && (req.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/'));

  if (networkFirst) {
    e.respondWith(
      fetch(req).then(res => put(req, res))
        .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
    );
    return;
  }
  // 정적 에셋 + CDN(cdnjs/jsdelivr/Google Fonts): 캐시 우선
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => put(req, res))));
});
