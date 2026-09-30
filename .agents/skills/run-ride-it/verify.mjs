#!/usr/bin/env node
/**
 * verify.mjs — 전체 화면 흐름 검증 (실제 pointer 이벤트 기반, SE2 뷰포트 375x667@2x)
 *
 * 흐름: (최초 방문) 조작법 → 닫기 → 스테이지 선택 → [크레딧] → 스테이지별:
 *   로딩 → 스타트 바 드래그/플릭(page.mouse) → 주행(하단 스와이프, 상단 탭) → 1인칭 토글 →
 *   일시정지/재개 → 결과 화면(cart.t를 끝 근처로 점프) → 스테이지 선택 복귀
 * 각 단계 스크린샷을 --out 디렉터리에 저장하고, pageerror가 1건이라도 있으면 exit 1.
 *
 * --probe: 스테이지별 t=0/0.25/0.5/0.75 지점 3인칭/1인칭 정지 스크린샷(배치 점검용) 추가
 *
 * Usage: node verify.mjs [--out=dir] [--stages=0,1,2,3,4] [--quality=low|medium|high] [--probe] [--port=8124]
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const OUT = path.resolve(args.out ?? '/tmp/ride-it-verify');
const STAGES = String(args.stages ?? '0,1,2,3,4').split(',').map(Number);
const QUALITY = args.quality ?? 'high';
const PORT = Number(args.port ?? 8124);
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream',
  '.env': 'application/octet-stream', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};
const bytesByExt = {};
function startServer() {
  const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(ROOT, reqPath === '/' ? '/index.html' : reqPath);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(filePath);
      bytesByExt[ext] = (bytesByExt[ext] || 0) + data.length;
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => { server.on('error', reject); server.listen(PORT, () => resolve(server)); });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const server = await startServer();
  const base = `http://localhost:${PORT}`;
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await ctx.addInitScript(q => {
    localStorage.setItem('rc_quality', q);
    if (!sessionStorage.getItem('verify_init')) { // 첫 로드에서만 저장소 초기화 → 최초 방문 흐름(조작법 자동 표시) 재현
      sessionStorage.setItem('verify_init', '1');
      for (const k of Object.keys(localStorage)) if (k !== 'rc_quality') localStorage.removeItem(k);
    }
  }, QUALITY);
  const shot = async name => page.screenshot({ path: path.join(OUT, `${name}.png`) });

  try {
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    // 타이틀 화면(있으면) — 탭해서 진행
    if (await page.locator('#titleScreen').count()) {
      await sleep(600);
      await shot('00_title');
      await page.locator('#titleScreen').click();
    }
    await page.waitForSelector('#howtoOverlay', { timeout: 10000 });
    await sleep(400);
    await shot('01_howto');
    await page.locator('#howtoCloseBtn').click();
    await page.waitForSelector('.stage-btn');
    await sleep(400);
    await shot('02_stage_select');
    check('stage select', (await page.locator('.stage-btn').count()) === 5);

    if (await page.locator('#creditsBtn').count()) {
      await page.locator('#creditsBtn').click();
      await page.waitForSelector('#creditsOverlay');
      await sleep(400);
      await shot('03_credits');
      await page.locator('#creditsCloseBtn').click();
      await sleep(300);
    }

    for (const s of STAGES) {
      const tag = `s${s + 1}`;
      await page.locator(`.stage-btn[data-index="${s}"]`).click();
      await sleep(150);
      if (await page.locator('#loadingOverlay').count()) await shot(`${tag}_0_loading`);
      await page.waitForSelector('#startBar', { timeout: 30000 });
      await sleep(800);
      await shot(`${tag}_1_start`);

      // 스타트 바: 핸들을 잡고 오른쪽으로 끌다가 빠르게 놓기(플릭)
      const h = await page.locator('#startBarHandle').boundingBox();
      const x0 = h.x + h.width / 2, y0 = h.y + h.height / 2;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(x0 + i * 13, y0); await sleep(16); }
      await page.mouse.up();
      await sleep(100);
      const launched = await page.evaluate(() => Game.cart.launched);
      check(`${tag} launch via start bar`, launched);
      if (!launched) continue;

      // 밸런스 스와이프(하단) + 게이트 탭(상단)
      await page.mouse.move(187, 560); await page.mouse.down();
      for (let i = 1; i <= 6; i++) { await page.mouse.move(187 + i * 12, 560); await sleep(16); }
      const lean = await page.evaluate(() => Game.cart.leanInput);
      await page.mouse.up();
      check(`${tag} balance swipe`, lean > 0.5, `leanInput=${lean.toFixed(2)}`);
      await page.mouse.click(187, 150);
      await sleep(900);
      await shot(`${tag}_2_ride_3rd`);
      // 한 프레임 드로우콜 실측 — gl draw* 호출을 직접 세서 그림자/포스트프로세싱 패스까지 포함
      const dc = await page.evaluate(() => new Promise(resolve => {
        const gl = Game.engine._gl;
        const names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'];
        const orig = {};
        let n = 0;
        names.forEach(k => { orig[k] = gl[k]; gl[k] = function (...a) { n++; return orig[k].apply(this, a); }; });
        Game.scene.onAfterRenderObservable.addOnce(() => {
          n = 0;
          Game.scene.onAfterRenderObservable.addOnce(() => {
            names.forEach(k => { gl[k] = orig[k]; });
            resolve({ drawCalls: n, activeMeshes: Game.scene.getActiveMeshes().length, instances: Game.scene.meshes.filter(m => m instanceof BABYLON.InstancedMesh).length });
          });
        });
      }));
      console.log(`[verify] ${tag} frame`, JSON.stringify(dc));

      await page.locator('#cameraToggleBtn').click();
      await sleep(900);
      await shot(`${tag}_3_ride_1st`);
      check(`${tag} camera toggle`, await page.evaluate(() => Game.camera.mode === 'first'));
      await page.locator('#cameraToggleBtn').click();

      await page.locator('#pauseBtn').click();
      await sleep(350);
      const t1 = await page.evaluate(() => Game.cart.t);
      await sleep(400);
      const t2 = await page.evaluate(() => Game.cart.t);
      check(`${tag} pause freezes`, t1 === t2);
      if (s === STAGES[0]) await shot(`${tag}_4_pause`);
      await page.locator('#resumeBtn').click();
      await sleep(300);

      if (args.probe) {
        for (const pt of [0, 0.25, 0.5, 0.75]) {
          for (const mode of ['third', 'first']) {
            await page.evaluate(({ pt, mode }) => {
              Game.engine.stopRenderLoop();
              const c = Game.cart, cam = Game.camera;
              c.t = pt;
              cam.mode = mode;
              cam._transitionT = 1;
              for (let i = 0; i < 120; i++) cam.update(Game.track, c, 1 / 60);
              Game._updateCartMesh();
              Game.scene.render();
            }, { pt, mode });
            await sleep(100);
            await shot(`${tag}_probe_t${String(pt).replace('.', '')}_${mode}`);
          }
        }
        await page.evaluate(() => { Game.lastTime = performance.now(); Game.engine.runRenderLoop(() => Game._loop()); });
      }

      // 결과 화면: 끝 직전으로 점프해 실제 루프가 완주 처리하게 함
      await page.evaluate(() => { Game.cart.currentLap = Game.cart.totalLaps; Game.cart.t = 0.9995; });
      await page.waitForSelector('#retryBtn', { timeout: 10000 });
      await sleep(700);
      await shot(`${tag}_5_result`);
      check(`${tag} result screen`, true);
      await page.locator('#stageSelectBtn').click();
      await page.waitForSelector('.stage-btn');
      await sleep(300);
    }
    await shot('09_stage_select_after');

    const draw = await page.evaluate(() => ({
      meshes: Game.scene.meshes.length,
      activeIndices: Game.engine._drawCalls ? Game.engine._drawCalls.current : null,
    }));
    console.log('[verify] scene', JSON.stringify(draw));
  } catch (e) {
    check('flow', false, e.message.split('\n')[0]);
    await shot('ZZ_failure').catch(() => {});
  } finally {
    console.log('[verify] bytes served by ext', JSON.stringify(bytesByExt));
    console.log('--- page errors ---\n' + (pageErrors.join('\n') || 'NONE'));
    console.log('--- console errors ---\n' + (consoleErrors.join('\n') || 'NONE'));
    await browser.close();
    server.close();
    const failed = results.filter(r => !r.ok).length + pageErrors.length;
    console.log(`[verify] ${results.length - results.filter(r => !r.ok).length}/${results.length} checks passed, pageErrors=${pageErrors.length} → ${OUT}`);
    process.exit(failed ? 1 : 0);
  }
}
main();
