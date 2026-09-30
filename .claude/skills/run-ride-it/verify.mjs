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
    if (args.pwa) {
      const man = await page.evaluate(async () => {
        const href = document.querySelector('link[rel=manifest]').href;
        const m = await (await fetch(href)).json();
        const icons = await Promise.all(m.icons.map(async i => (await fetch(new URL(i.src, href))).ok));
        return { name: m.name, display: m.display, icons: icons.every(Boolean), n: m.icons.length };
      });
      check('pwa manifest', man.display === 'fullscreen' && man.icons && man.n >= 2, JSON.stringify(man));
      const sw = await page.evaluate(async () => {
        const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 15000))]);
        if (!reg || !reg.active) return 'none';
        for (let i = 0; i < 50 && reg.active.state !== 'activated'; i++) await new Promise(r => setTimeout(r, 100)); // ready는 activating 중에도 풀림
        return reg.active.state;
      });
      check('service worker active', sw === 'activated', sw);
    }
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

    // BGM(F): 첫 제스처 후 실제 출력이 나오는지(마스터 게인 RMS), 사운드 토글 버튼으로 무음 전환되는지
    const rms = () => page.evaluate(() => new Promise(resolve => {
      const A = AudioManager;
      if (!A.ctx) return resolve(-1);
      if (!A.__an) { A.__an = A.ctx.createAnalyser(); A.__an.fftSize = 2048; A.masterGain.connect(A.__an); }
      const buf = new Float32Array(2048);
      let peak = 0, n = 0;
      const iv = setInterval(() => {
        A.__an.getFloatTimeDomainData(buf);
        peak = Math.max(peak, Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length));
        if (++n >= 25) { clearInterval(iv); resolve(peak); }
      }, 40);
    }));
    const bgmOn = await rms();
    check('bgm audible after first gesture', bgmOn > 0.005, `rms=${bgmOn.toFixed(4)} state=${await page.evaluate(() => AudioManager.ctx && AudioManager.ctx.state)}`);
    await page.locator('#audioBtn').click();
    await sleep(400);
    const bgmOff = await rms();
    check('sound toggle mutes bgm', bgmOff < 0.001, `rms=${bgmOff.toFixed(5)}`);
    await page.locator('#audioBtn').click();
    await sleep(300);

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
      if (s === STAGES[0]) check(`${tag} bgm ride mode after launch`, await page.evaluate(() => AudioManager._bgmMode === 'ride'));
      if (!launched) continue;

      // 밸런스 스와이프(하단) + 게이트 탭(상단)
      await page.mouse.move(187, 560); await page.mouse.down();
      for (let i = 1; i <= 6; i++) { await page.mouse.move(187 + i * 12, 560); await sleep(16); }
      const lean = await page.evaluate(() => Game.cart.leanInput);
      await page.mouse.up();
      check(`${tag} balance swipe`, lean > 0.5, `leanInput=${lean.toFixed(2)}`);
      // 게이트 탭: 화면 상단(150)과 중앙 약간 위(300 = 45%) 모두 게이트 판정으로 들어가야 함(하단 50%만 밸런스)
      await page.evaluate(() => { window.__gates = 0; if (!window.__gateHooked) { window.__gateHooked = true; window.addEventListener('gate-result', () => window.__gates++); } });
      await page.mouse.click(187, 150);
      await page.mouse.click(187, 300);
      const gates = await page.evaluate(() => window.__gates);
      check(`${tag} gate taps (top/upper-middle)`, gates === 2, `gate-result=${gates}`);
      await sleep(900);
      await shot(`${tag}_2_ride_3rd`);
      // 한 프레임 드로우콜 실측(그림자/포스트프로세싱 패스 포함) — Babylon SceneInstrumentation
      const dc = await page.evaluate(() => new Promise(resolve => {
        const ins = new BABYLON.SceneInstrumentation(Game.scene);
        setTimeout(() => {
          resolve({ drawCalls: ins.drawCallsCounter.current, activeMeshes: Game.scene.getActiveMeshes().length, instances: Game.scene.meshes.filter(m => m instanceof BABYLON.InstancedMesh).length });
          ins.dispose();
        }, 300);
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

    // 진행 저장(D): 새로고침 후에도 클리어 배지/최고 기록이 남아 있어야 함
    const prog = await page.evaluate(() => JSON.parse(localStorage.getItem('rc_progress') || '{}'));
    check('progress saved', Object.keys(prog).length === STAGES.length, JSON.stringify(prog));
    await page.reload({ waitUntil: 'load' });
    if (await page.locator('#titleScreen').count()) await page.locator('#titleScreen').click();
    await page.waitForSelector('.stage-btn');
    const badges = await page.locator('.stage-btn .badge.rank-badge').count();
    check('progress persists after reload', badges === STAGES.length, `rank badges=${badges}`);
    await sleep(400);
    await shot('10_stage_select_reloaded');

    if (args.pwa) {
      // 오프라인 재실행: 한 번 방문(+플레이한 스테이지 런타임 캐싱) 후 네트워크 차단 상태로 새로고침해 1스테이지 진입
      await ctx.setOffline(true);
      await page.reload({ waitUntil: 'load' });
      if (await page.locator('#titleScreen').count()) await page.locator('#titleScreen').click();
      await page.waitForSelector('.stage-btn', { timeout: 15000 });
      await page.locator('.stage-btn[data-index="0"]').click();
      const ok = await page.waitForSelector('#startBar', { timeout: 30000 }).then(() => true).catch(() => false);
      await sleep(800);
      await shot('11_offline_stage1');
      check('offline replay (stage 1)', ok);
      await ctx.setOffline(false);
    }

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
