// 서비스 워커 오프라인 점검: 온라인에서 한 번 방문(+1단계 로드) → 오프라인으로 새로고침 → 타이틀·글꼴·엔진·스테이지 로딩 확인
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './polish-lib.mjs';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.json': 'application/json', '.m4a': 'audio/mp4', '.webmanifest': 'application/json', '.png': 'image/png', '.env': 'application/octet-stream' };
const server = http.createServer((req, res) => { const p = decodeURIComponent(req.url.split('?')[0]); fs.readFile(path.join(ROOT, p === '/' ? '/index.html' : p), (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise(r => server.listen(8271, r));
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 375, height: 667 } });
await ctx.addInitScript(() => { localStorage.setItem('rc_howto_seen', '1'); localStorage.setItem('rc_tutorial_asked', '1'); localStorage.setItem('rc_quality', 'low'); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
let ok = true; const check = (n, v, d = '') => { ok = ok && v; console.log(`${v ? 'PASS' : 'FAIL'} ${n}${v ? '' : ' — ' + d}`); };
await page.goto('http://localhost:8271/index.html'); await page.waitForFunction(() => window.UI && window.STAGES && window.Game && Game.scene, null, { timeout: 60000 });
await page.evaluate(async () => { await navigator.serviceWorker.ready; });
await page.waitForFunction(async () => { const ks = await caches.keys(); return ks.some(k => k.startsWith('ride-it-')); }, null, { timeout: 30000 });
const online = await page.evaluate(async () => { const ks = await caches.keys(); const c = await caches.open(ks.find(k => k.startsWith('ride-it-'))); return { name: ks.join(','), n: (await c.keys()).length }; });
check(`서비스 워커 캐시 ${online.name}에 ${online.n}개 파일`, /ride-it-v6/.test(online.name) && online.n >= 20, JSON.stringify(online));
await page.evaluate(() => Game.loadStage(0)); await page.waitForSelector('#startBar', { timeout: 60000 }); // 모델·소리 런타임 캐시
await page.evaluate(() => Game.exitToStageSelect(true)); await page.waitForTimeout(500);
await page.reload(); await page.waitForTimeout(1500); // SW가 제어하는 상태로 한 번 더(런타임 캐시 채움)
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' }).catch(e => errors.push('reload:' + e.message));
await page.waitForSelector('#titleStart', { timeout: 30000 });
const off = await page.evaluate(async () => { await document.fonts.ready; return { babylon: typeof BABYLON !== 'undefined', noto: document.fonts.check('16px "Noto Sans KR"'), jua: document.fonts.check('20px "Jua"'), loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) }; });
check('오프라인: 타이틀이 뜨고 엔진·글꼴이 캐시에서 로드됨', off.babylon && off.noto && off.jua, JSON.stringify(off));
await page.click('#titleStart'); await page.waitForSelector('.stage-select', { timeout: 10000 });
await page.click('.stage-btn[data-index="0"]'); await page.click('#stageStartBtn');
await page.waitForSelector('#startBar', { timeout: 60000 }).then(() => check('오프라인: 1단계가 로딩되어 스타트 화면까지 도착', true), e => check('오프라인: 1단계가 로딩되어 스타트 화면까지 도착', false, e.message.split('\n')[0]));
check('page error 0', errors.length === 0, errors.join('|'));
await b.close(); server.close(); process.exit(ok ? 0 : 1);
