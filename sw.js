/**
 * sw.js — 오프라인 캐싱 서비스 워커
 * - 설치 시: 앱 셸(html/js/manifest/아이콘/하늘 .env)+Babylon CDN 선캐싱 — 스테이지별 glb는 처음 플레이할 때 런타임 캐싱
 * - html/js/manifest: 네트워크 우선(온라인이면 항상 최신), 오프라인이면 캐시
 * - 같은 출처 정적 에셋(glb/env/png 등): stale-while-revalidate — 캐시로 즉시 응답하고 백그라운드에서 다시 받아
 *   내용(ETag/Last-Modified/길이)이 바뀌었으면 캐시를 갱신하고 페이지에 'asset-updated'를 알림 → "새 버전이 있어요" 안내.
 *   예전(v1)엔 캐시 우선이라 같은 경로의 에셋이 바뀌어도 영영 옛 파일을 보여줄 수 있었음.
 * - CDN(버전 고정 URL)/폰트: 캐시 우선
 * 빌드 단계가 없어 배포마다 버전을 올리지 않아도 되도록 "내용 비교"로 새 버전을 감지함. CACHE 이름은 캐시 구조가
 * 바뀔 때만 올리면 됨(올리면 activate에서 이전 캐시 전부 삭제).
 */
const CACHE = 'ride-it-v5';
const CORE = [
  './',
  'index.html',
  'css/fonts.css', 'css/ui-tokens.css', 'css/ui.css', 'css/title.css', 'css/hud.css',
  'assets/fonts/NotoSansKR-subset.woff2', 'assets/fonts/Jua-subset.woff2',
  'manifest.webmanifest',
  'js/quality.js', 'js/style.js', 'js/audio.js', 'js/stages.js', 'js/track.js', 'js/cart.js',
  'js/camera.js', 'js/input.js', 'js/strings.js', 'js/popup.js', 'js/ui.js', 'js/title-logo-data.js', 'js/title.js', 'js/tutorial.js', 'js/main.js',
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
      .then(c => Promise.all([c.addAll(CORE.map(u => new Request(u, { cache: 'reload' }))), c.addAll(CDN.map(u => new Request(u, { mode: 'cors' })))]))
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

const signature = res => res && [res.headers.get('etag'), res.headers.get('last-modified'), res.headers.get('content-length')].join('|');

async function notifyUpdated(url) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'asset-updated', url }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  // 개발 전용 UI 키트(?ui-kit, js/ui-kit.js)는 캐시에 넣지 않고 항상 네트워크로
  if (url.searchParams.has('ui-kit') || url.searchParams.has('touch-debug') || /\/(ui-kit|touch-debug)\.(js|css)$/.test(url.pathname)) return;
  const networkFirst = sameOrigin && (req.mode === 'navigate' || /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/'));

  if (networkFirst) {
    e.respondWith(
      // cache:'no-cache' — GitHub Pages의 HTTP 캐시(max-age 600)를 거치지 않고 서버에 재확인(304면 가벼움). 안 하면
      // 배포 직후 최대 10분 동안 옛 js가 돌 수 있었음
      fetch(req, { cache: 'no-cache' }).then(res => put(req, res))
        .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
    );
    return;
  }
  if (sameOrigin) {
    // stale-while-revalidate + 변경 감지
    e.respondWith(caches.match(req).then(hit => {
      const refresh = fetch(req).then(res => {
        if (hit && res.ok && signature(res) !== signature(hit)) notifyUpdated(url.pathname);
        return put(req, res);
      });
      if (hit) {
        e.waitUntil(refresh.catch(() => {}));
        return hit;
      }
      return refresh;
    }));
    return;
  }
  // CDN(cdnjs/jsdelivr/Google Fonts): 캐시 우선
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => put(req, res))));
});
