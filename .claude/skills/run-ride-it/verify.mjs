#!/usr/bin/env node
/**
 * verify.mjs — 전체 화면 흐름 검증 (실제 pointer 이벤트 기반, SE2 뷰포트 375x667@2x)
 *
 * 흐름: (최초 방문) 조작법 → 닫기 → 스테이지 선택 → [크레딧] → 스테이지별:
 *   로딩 → 스타트 바 드래그/플릭(page.mouse) → 주행(◀ ▶ 누르고 있기, BOOST 탭) → 1인칭 토글 →
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
const BASE = args.base ? String(args.base).replace(/\/$/, '') : null; // 실서버 검증: --base=https://cynic001.github.io/ride-it
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream',
  '.env': 'application/octet-stream', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.m4a': 'audio/mp4',
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
  const server = BASE ? { close() {} } : await startServer();
  const base = BASE || `http://localhost:${PORT}`;
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
    // 처음 실행: 튜토리얼 권유(예전 자동 조작법 안내 대체) → 건너뛰기. 조작법 화면은 ? 버튼으로
    await page.waitForSelector('#tutorialAsk', { timeout: 10000 });
    await sleep(400);
    await shot('01_tutorial_ask');
    await page.locator('#tutAskNo').click();
    check('first-run tutorial prompt answered once', await page.evaluate(() => localStorage.getItem('rc_tutorial_asked') === '1' && !document.getElementById('tutorialAsk')));
    await page.locator('#howtoBtn').click();
    await page.waitForSelector('#howtoOverlay');
    await sleep(300);
    await shot('01_howto');
    await page.locator('#howtoCloseBtn').click();
    await page.waitForSelector('.stage-btn');
    await sleep(400);
    await shot('02_stage_select');
    check('stage select (tutorial card + 5 stages)', (await page.locator('.stage-btn[data-index]').count()) === 5 && (await page.locator('#tutorialStageBtn').count()) === 1);

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
    // 녹음 효과음 로드/디코딩(스테이지 선택 전이라 직접 요청) — 9개 모두 받아져야 함
    await page.evaluate(() => AudioManager.preloadSamples());
    await sleep(1500);
    const nS = await page.evaluate(() => Object.keys(AudioManager._samples).length);
    check('sfx samples decoded', nS === 9, `${nS}/9`);
    check('bgm audible after first gesture', bgmOn > 0.005, `rms=${bgmOn.toFixed(4)} state=${await page.evaluate(() => AudioManager.ctx && AudioManager.ctx.state)}`);
    // 오디오가 멈춘 경우(iOS 백그라운드 복귀·전화 끼어들기 등) 다음 탭에서 다시 살아나야 함
    await page.evaluate(() => AudioManager.ctx.suspend());
    await sleep(100);
    await page.mouse.click(10, 10);
    await sleep(200);
    const st = await page.evaluate(() => AudioManager.ctx.state);
    check('audio re-unlocks on next tap after suspend', st === 'running', st);
    await page.locator('#settingsBtn').click();
    await page.locator('[data-setting="audio"] [data-value="off"]').click();
    await sleep(400);
    const bgmOff = await rms();
    check('sound toggle mutes bgm', bgmOff < 0.001, `rms=${bgmOff.toFixed(5)}`);
    await page.locator('[data-setting="audio"] [data-value="on"]').click();
    await page.locator('#settingsCloseBtn').click();
    await sleep(300);

    // 설정(톱니바퀴) → 크레딧
    await page.locator('#settingsBtn').click();
    await page.waitForSelector('#settingsOverlay');
    await sleep(400);
    await shot('03_settings');
    await page.locator('#graphicsBtn').click();
    await page.waitForSelector('#graphicsOverlay');
    await page.locator('.gfx-opt[data-group="style"][data-value="pastel"]').click();
    const gsaved = await page.evaluate(() => [localStorage.getItem('rc_style'), StyleManager.current]);
    await page.locator('.gfx-opt[data-group="style"][data-value="toon"]').click();
    await sleep(300);
    await shot('03a_graphics');
    check('graphics popup saves style', gsaved[0] === 'pastel' && gsaved[1] === 'pastel', JSON.stringify(gsaved));
    await page.locator('#graphicsCloseBtn').click();
    await page.locator('#creditsBtn').click();
    await page.waitForSelector('#creditsOverlay');
    await sleep(400);
    await shot('03b_credits');
    await page.locator('#creditsCloseBtn').click();
    await page.locator('#settingsCloseBtn').click();
    await sleep(300);

    for (const s of STAGES) {
      const tag = `s${s + 1}`;
      await page.locator(`.stage-btn[data-index="${s}"]`).click();
      await page.waitForSelector('#stageStartBtn');
      await sleep(300);
      if (s === STAGES[0]) await shot(`${tag}_00_detail`);
      check(`${tag} detail screen (no auto start)`, await page.evaluate(() => !Game.track || !document.getElementById('startBar')));
      await page.locator('#stageStartBtn').click();
      await sleep(150);
      if (await page.locator('#loadingOverlay').count()) await shot(`${tag}_0_loading`);
      await page.waitForSelector('#startBar', { timeout: 30000 });
      await sleep(800);
      await shot(`${tag}_1_start`);

      // 스타트 바: 핸들을 잡고 아래로 당겼다가 위로 빠르게 밀어 올리기(손을 떼기 전에 발사돼야 함)
      const h = await page.locator('#startBarHandle').boundingBox();
      const x0 = h.x + h.width / 2, y0 = h.y + h.height / 2;
      if (s === STAGES[0]) {
        // 위로 밀지 않고 떼면 발사 취소
        await page.mouse.move(x0, y0); await page.mouse.down();
        for (let i = 1; i <= 6; i++) { await page.mouse.move(x0, y0 + i * 12); await sleep(30); }
        await page.mouse.up(); await sleep(200);
        check(`${tag} release without push-up cancels`, await page.evaluate(() => !Game.cart.launched));
      }
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(x0, y0 + i * 12); await sleep(16); }
      if (s === STAGES[0]) { await sleep(100); await shot(`${tag}_1b_pulling`); }
      for (let i = 1; i <= 5; i++) { await page.mouse.move(x0, y0 + 144 - i * 24); await sleep(8); }
      const launchedBeforeRelease = await page.evaluate(() => Game.cart.launched);
      await page.mouse.up();
      check(`${tag} launch fires on flick-up (before release)`, launchedBeforeRelease);
      await sleep(100);
      const launched = await page.evaluate(() => Game.cart.launched);
      check(`${tag} launch via start bar`, launched);
      if (s === STAGES[0]) check(`${tag} bgm ride mode after launch`, await page.evaluate(() => AudioManager._bgmMode === 'ride'));
      // 최고속도 상한: 속도를 강제로 올려도 기본 속도×1.5에서 멈추고 HUD 속도계가 강조되어야 함
      await page.evaluate(() => { Game.cart.speed = 999; });
      await sleep(400); // 첫 스테이지는 셰이더 컴파일로 프레임이 한 번 길게 멈출 수 있어 여유
      const cap = await page.evaluate(() => ({ kmh: Game.cart.speed * 3.6, cap: Game.cart.maxSpeedMs * 3.6, capped: document.getElementById('speedo').classList.contains('capped') }));
      check(`${tag} speed cap`, cap.kmh <= cap.cap + 0.01 && cap.capped, `${cap.kmh.toFixed(1)}/${cap.cap.toFixed(1)}km/h highlight=${cap.capped}`);
      // 부스터 타이어: 기본 속도 30%로 떨어뜨리면 1.5초 안에 보조 추진이 걸려 60% 이상으로 복귀해야 함
      await page.evaluate(() => { Game.cart.speed = Game.cart.baseSpeedMs * 0.3; });
      await sleep(1500);
      const asg = await page.evaluate(() => ({ at: Game.cart.assistTime, r: Game.cart.speed / Game.cart.baseSpeedMs }));
      check(`${tag} booster assist`, asg.at > 0 && asg.r >= 0.6, `assist=${asg.at.toFixed(2)}s speed=${(asg.r * 100).toFixed(0)}% of base`);
      if (!launched) continue;

      // 양손 조작(13번): 왼쪽 아래 ▶ 누르고 있기 = 밸런스(0.3초 램프), 떼면 중립 복귀
      await page.waitForSelector('#driveControls.on');
      const rb_ = await page.locator('#leanRightBtn').boundingBox();
      const bb = await page.locator('#boostBtn').boundingBox();
      const px = bb.x + bb.width / 2, py = bb.y + bb.height / 2; // 부스트 버튼 중심(아래 게이트 정타 탭에 사용)
      await page.mouse.move(rb_.x + rb_.width / 2, rb_.y + rb_.height / 2); await page.mouse.down();
      await sleep(450);
      const lean = await page.evaluate(() => Game.cart.leanInput);
      if (s === STAGES[0]) await shot(`${tag}_2b_lean_btn`);
      await page.mouse.up();
      await sleep(450);
      const leanAfter = await page.evaluate(() => Game.cart.leanInput);
      check(`${tag} ▶ hold = balance, release = neutral`, lean > 0.95 && Math.abs(leanAfter) < 0.01, `lean=${lean.toFixed(2)} → ${leanAfter.toFixed(2)}`);
      if (s === STAGES[0]) {
        // 키보드 →: 0.3초 램프로 1.0, 짧게 톡 = 중간 값, 떼면 부드럽게 0
        await page.keyboard.down('ArrowRight'); await sleep(90);
        const kMid = await page.evaluate(() => Game.cart.leanInput);
        await sleep(350);
        const kFull = await page.evaluate(() => Game.cart.leanInput);
        await page.keyboard.up('ArrowRight'); await sleep(100);
        const kDecay = await page.evaluate(() => Game.cart.leanInput);
        await sleep(400);
        const kZero = await page.evaluate(() => Game.cart.leanInput);
        check(`${tag} key ramp (0.3s → 1.0, release → 0)`, kMid > 0.1 && kMid < 0.8 && kFull > 0.99 && kDecay > 0.2 && kDecay < 0.9 && Math.abs(kZero) < 0.01,
          `90ms=${kMid.toFixed(2)} 440ms=${kFull.toFixed(2)} +100ms=${kDecay.toFixed(2)} +500ms=${kZero.toFixed(2)}`);
        // 밸런스 1.5초 유지 판정(13번): 커브 시작으로 옮겨 진행을 아주 느리게 → 커브 방향 키를 0.7초 누름(진행도 ≈0.47) → 떼면 범위를 벗어나 0으로
        // → 다시 holdSec+0.4초 누름 → balance-judge(good, 1.0은 Perfect 범위 밖) 1회
        const bal = await page.evaluate(() => {
          const c = Game.cart, seg = Game.track.segmentRanges.find(x => x.requiredLean > 0);
          window.__bj = []; if (!window.__bjHooked) { window.__bjHooked = true; window.addEventListener('balance-judge', e => window.__bj.push(e.detail)); }
          c._finalizeCurve(); c.t = seg.tStart + 0.003; Cart.speedScale = 0.02; window.__bj = [];
          return { key: seg.curveDirection === 'left' ? 'ArrowLeft' : 'ArrowRight', hold: c.balanceRule.holdSec };
        });
        await page.keyboard.down(bal.key); await sleep(700);
        const b1 = await page.evaluate(() => ({ p: Game.cart.balanceState && Game.cart.balanceState.progress, on: document.getElementById('balGauge').classList.contains('on'), inn: document.getElementById('balGauge').classList.contains('in') }));
        if (s === STAGES[0]) await shot(`${tag}_2e_balance_in`);
        await page.keyboard.up(bal.key); await sleep(450);
        const b2 = await page.evaluate(() => Game.cart.balanceState && Game.cart.balanceState.progress);
        if (s === STAGES[0]) await shot(`${tag}_2f_balance_out`);
        await page.keyboard.down(bal.key); await sleep(bal.hold * 1000 + 400);
        const b3 = await page.evaluate(() => ({ j: window.__bj.slice(), done: Game.cart.balanceState && Game.cart.balanceState.done, txt: document.getElementById('balResult').textContent }));
        await page.keyboard.up(bal.key);
        await page.evaluate(() => { Cart.speedScale = GAME_SPEED_SCALE; });
        check(`${tag} balance: hold builds progress, leaving resets, ${bal.hold}s hold confirms`, b1.on && b1.inn && b1.p > 0.25 && b1.p < 0.75 && b2 === 0 && b3.j.length === 1 && b3.j[0] === 'good' && b3.done === 'good' && b3.txt === 'GOOD',
          `0.7s→${(b1.p ?? -1).toFixed(2)} release→${b2} hold→${JSON.stringify(b3)}`);
        const g = await page.evaluate(() => ['#balBand', '#balPerfect', '#balCursor', '#balProg', '#balDir'].map(q => !!document.querySelector(q)));
        check(`${tag} balance gauge: band + perfect + cursor + progress + direction`, g.every(Boolean), JSON.stringify(g));
      }
      // BOOST 버튼 = 부스트(게이트 판정 이벤트) — 누를 때마다 1회
      await page.evaluate(() => { window.__gates = 0; if (!window.__gateHooked) { window.__gateHooked = true; window.addEventListener('gate-result', () => window.__gates++); } });
      await page.mouse.click(px, py);
      await page.mouse.click(px, py);
      const gates = await page.evaluate(() => window.__gates);
      check(`${tag} BOOST taps = boost`, gates === 2, `gate-result=${gates}`);
      check(`${tag} no hands-up / pad controls`, await page.evaluate(() => !document.getElementById('handsBtn') && !document.getElementById('thumbPad')));
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

      const viewBefore = await page.evaluate(() => Game.camera.mode);
      await page.locator('#cameraToggleBtn').click();
      await sleep(900);
      await shot(`${tag}_3_ride_toggled`);
      // 자동 전환(부스트/급하강) 도중엔 읽는 순간과 누르는 순간 사이에 화면이 바뀔 수 있으므로, "수동 전환이 걸렸고 그 목표 시점에 도달했는지"로 확인
      const tog = await page.evaluate(() => { const c = Game.camera; return { active: c._clock < c._manualUntil, target: c._manualTarget ? 'first' : 'third', mode: c.mode }; });
      check(`${tag} camera button switches view temporarily`, tog.active && tog.mode === tog.target, `${viewBefore} → ${tog.mode} (target ${tog.target})`);

      await page.locator('#pauseBtn').click();
      await sleep(350);
      const t1 = await page.evaluate(() => Game.cart.t);
      await sleep(400);
      const t2 = await page.evaluate(() => Game.cart.t);
      check(`${tag} pause freezes`, t1 === t2);
      if (s === STAGES[0]) await shot(`${tag}_4_pause`);
      await page.locator('#resumeBtn').click();
      await sleep(300);

      // 게이트 가이드 ↔ 시간 기준 판정 일치: 판정 오차≈0 순간까지 고정 스텝으로 진행 → 마커/구간 위치가 판정값과
      // 같은지 확인 → 그 상태에서 실제 마우스 탭 → Perfect여야 함
      const gg = await page.evaluate(() => {
        Game.engine.stopRenderLoop();
        const c = Game.cart;
        let g = null, approaching = null; // 이미 지나친 미판정 게이트가 아니라, 다가오는(err<-0.1을 거친) 게이트를 대상으로
        for (let i = 0; i < 60 * 120; i++) {
          g = c.gateTiming();
          if (g && g.err < -0.1) approaching = g.key;
          if (g && g.key === approaching && g.err >= -0.008) break;
          Game._fixedUpdate(1 / 60);
          if (c.isFinished) return null;
        }
        UI.updateHUD(c, Game.track);
        const A = (id, k) => parseFloat(document.getElementById(id).getAttribute(k));
        return { err: g.err, type: g.type, good: g.good, perfect: g.perfect, ring: A('gatePopRing', 'r'), expRing: 30 * (1 - g.err / 0.8),
          goodW: A('gatePopGood', 'stroke-width'), perfW: A('gatePopPerfect', 'stroke-width'), on: document.getElementById('gatePop').classList.contains('on'), n: c._gateResults.length };
      });
      if (gg) {
        if (s === STAGES[0]) await shot(`${tag}_2c_timing_pop`);
        await page.mouse.click(px, py);
        const res = await page.evaluate(() => { const r = Game.cart._gateResults; return r.length ? r[r.length - 1].result : 'none'; });
        await sleep(120);
        const shown = await page.evaluate(() => document.getElementById('gatePopResult').textContent);
        if (s === STAGES[0]) await shot(`${tag}_2d_pop_result`);
        check(`${tag} timing popup matches timing judge`, gg.on && Math.abs(gg.ring - gg.expRing) < 0.05 && Math.abs(gg.goodW - 75 * gg.good) < 0.02 && Math.abs(gg.perfW - 75 * gg.perfect) < 0.02,
          `err=${gg.err.toFixed(3)}s ring=${gg.ring}/${gg.expRing.toFixed(2)} good=${gg.goodW} perfect=${gg.perfW}`);
        check(`${tag} BOOST at ring overlap → perfect, shown in popup`, res === 'perfect' && shown === 'PERFECT!', `${gg.type} → ${res} / "${shown}"`);
      }
      await page.evaluate(() => { if (!Game.cart.isFinished) { Game.lastTime = performance.now(); Game.engine.runRenderLoop(() => Game._loop()); } });

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
      const sc = await page.evaluate(() => { const b = Game.cart.scoreBreakdown; return { score: Game.cart.score, sum: b.gate + b.balance + (b.balancePerfect || 0) + (b.airtime || 0) + b.comboBonus + b.finishBonus + (b.mashBonus || 0), rows: document.querySelectorAll('.bd-row').length }; });
      check(`${tag} result screen + score breakdown`, Math.abs(sc.score - sc.sum) < 0.5 && sc.rows >= 4, `score=${sc.score.toFixed(1)} sum=${sc.sum.toFixed(1)} rows=${sc.rows}`);
      await page.locator('#stageSelectBtn').click();
      await page.waitForSelector('.stage-btn');
      await sleep(300);
    }
    await shot('09_stage_select_after');

    await multiTouchTest(browser, base, pageErrors);

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
      await page.locator('#stageStartBtn').click();
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
/** 양손 동시 터치(13번 2-5): 실제 터치 이벤트(CDP Input.dispatchTouchEvent → 브라우저가 pointer 이벤트로 변환)로
 * 두 손가락 시나리오를 돌려 서로 끊거나 바꾸지 않는지 확인. 키보드 ← + ↑ 동시 입력도 */
async function multiTouchTest(browser, base, pageErrors) {
  const tctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await tctx.addInitScript(q => { localStorage.setItem('rc_quality', q); localStorage.setItem('rc_howto_seen', '1'); localStorage.setItem('rc_tutorial_done', '1'); localStorage.setItem('rc_tutorial_asked', '1'); }, QUALITY);
  const tp = await tctx.newPage();
  tp.on('pageerror', e => pageErrors.push('[touch] ' + e.message));
  const cdp = await tctx.newCDPSession(tp);
  const pts = new Map(); // 지금 화면에 닿아 있는 손가락 id → [x, y]
  const send = type => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts].map(([id, [x, y]]) => ({ id, x, y, radiusX: 6, radiusY: 6, force: 1 })) });
  const down = async (id, x, y) => { pts.set(id, [x, y]); await send('touchStart'); };
  const move = async (id, x, y) => { pts.set(id, [x, y]); await send('touchMove'); };
  // CDP touchEnd의 touchPoints = 이번에 떼는 손가락(남은 손가락을 넘기면 엉뚱한 손가락이 떼어짐 — 실측)
  const up = async (...ids) => { const gone = ids.map(id => ({ id, x: pts.get(id)[0], y: pts.get(id)[1], radiusX: 6, radiusY: 6, force: 1 })); ids.forEach(i => pts.delete(i)); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: gone }); };
  const center = async sel => { const b = await tp.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const st = () => tp.evaluate(() => ({ lean: Game.cart.leanInput, boosts: window.__boosts, pressed: [...document.querySelectorAll('.ctl-btn.pressed')].map(e => e.id).join(','), zoom: visualViewport.scale }));
  try {
    await tp.goto(`${base}/index.html`, { waitUntil: 'load' });
    if (await tp.locator('#titleScreen').count()) await tp.locator('#titleScreen').tap();
    await tp.waitForSelector('.stage-btn');
    await tp.locator('.stage-btn[data-index="0"]').tap();
    await tp.locator('#stageStartBtn').tap();
    await tp.waitForSelector('#startBar', { timeout: 30000 });
    await sleep(600);
    await tp.keyboard.down('ArrowDown'); await sleep(500); await tp.keyboard.up('ArrowDown'); await tp.keyboard.press('ArrowUp');
    await tp.waitForSelector('#driveControls.on');
    // 게이트/뒤로 떨어지기와 무관한 직선 구간에서 반복 테스트 — 진행을 멈춰 둠(입력·leanInput 램프는 그대로 돌아감)
    await tp.evaluate(() => { window.__boosts = 0; window.addEventListener('gate-result', () => window.__boosts++); Game.cart.t = 0.001; Cart.speedScale = 0; });
    const R = await center('#leanRightBtn'), L = await center('#leanLeftBtn'), B = await center('#boostBtn');
    // A) ▶ 누른 채 BOOST 탭 → ▶ 유지, 부스트 1회
    await down(0, ...R); await sleep(400);
    await down(1, ...B); await sleep(60); await up(1); await sleep(300);
    let a = await st();
    check('touch A: hold ▶ + tap BOOST → lean kept, 1 boost', a.lean > 0.99 && a.boosts === 1 && a.pressed === 'leanRightBtn', JSON.stringify(a));
    await up(0); await sleep(450);
    a = await st();
    check('touch A2: release ▶ → neutral, nothing stuck', Math.abs(a.lean) < 0.01 && !a.pressed, JSON.stringify(a));
    // B) BOOST 누른 채 ◀ 누르기 → 왼쪽으로 기울고, ◀ 먼저 떼면 BOOST는 계속 눌린 상태(추가 부스트 없음)
    await down(1, ...B); await sleep(60);
    await down(0, ...L); await sleep(400);
    let b = await st();
    check('touch B: hold BOOST + hold ◀ → lean left, boost once', b.lean < -0.99 && b.boosts === 2 && b.pressed.includes('leanLeftBtn') && b.pressed.includes('boostBtn'), JSON.stringify(b));
    await up(0); await sleep(450);
    b = await st();
    check('touch B2: release ◀ first → BOOST still pressed, lean neutral', Math.abs(b.lean) < 0.01 && b.pressed === 'boostBtn' && b.boosts === 2, JSON.stringify(b));
    await up(1); await sleep(100);
    // C) ▶ + BOOST를 같은 순간에 떼기
    await down(0, ...R); await down(1, ...B); await sleep(400);
    await up(0, 1); await sleep(450);
    const c = await st();
    check('touch C: release both at once → nothing stuck', Math.abs(c.lean) < 0.01 && !c.pressed && c.boosts === 3, JSON.stringify(c));
    // D) ▶를 누른 채 버튼 밖으로 미끄러져도 유지(버튼 단위 캡처), 밖에서 떼면 해제
    await down(0, ...R); await sleep(200);
    await move(0, R[0] + 20, R[1] - 70); await sleep(300);
    const d = await st();
    await up(0); await sleep(450);
    const d2 = await st();
    check('touch D: slide off ▶ keeps input, release outside clears', d.lean > 0.99 && d.pressed === 'leanRightBtn' && Math.abs(d2.lean) < 0.01 && !d2.pressed, `${JSON.stringify(d)} → ${JSON.stringify(d2)}`);
    // E) 두 손가락 벌리기(핀치) — 페이지 확대 없음
    await down(0, ...L); await down(1, ...B);
    for (let i = 1; i <= 6; i++) { await move(0, L[0] - i * 3, L[1] - i * 10); await move(1, B[0] + i * 3, B[1] - i * 10); await sleep(16); }
    await up(0, 1); await sleep(300);
    const e = await st();
    check('touch E: two-finger spread → no zoom, nothing stuck', e.zoom === 1 && !e.pressed && Math.abs(e.lean) < 0.01, JSON.stringify(e));
    // G) ◀ 누른 채 ▶를 눌렀다 떼면 다시 ◀로(예전 코드는 ◀ 입력이 사라짐 — 진단 1-2)
    await down(0, ...L); await sleep(350);
    await down(1, ...R); await sleep(700);
    const g1 = await st();
    await up(1); await sleep(700);
    const g2 = await st();
    await up(0); await sleep(450);
    check('touch G: hold ◀, press/release ▶ → back to ◀', g1.lean > 0.99 && g2.lean < -0.99 && g2.pressed === 'leanLeftBtn', `${g1.lean.toFixed(2)} → ${g2.lean.toFixed(2)} ${g2.pressed}`);
    // F) 키보드 ← 누른 채 ↑ → 왼쪽 유지 + 부스트 1회
    const n0 = (await st()).boosts;
    await tp.keyboard.down('ArrowLeft'); await sleep(400); await tp.keyboard.press('ArrowUp'); await sleep(200);
    const f = await st();
    await tp.keyboard.up('ArrowLeft');
    check('keys: hold ← + press ↑ → lean left kept, 1 boost', f.lean < -0.99 && f.boosts === n0 + 1, JSON.stringify(f));
    // H) 회전(13번 2-6): ▶를 누른 채 가로로 → 눌려 있던 입력 안전 해제, 조작은 양쪽 끝(가운데 150px 이상 비움), 겹침·화면 밖 없음, 회전 안내 없음
    const layout = () => tp.evaluate(() => {
      const r = el => { const b = (typeof el === 'string' ? document.querySelector(el) : el).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      const box = { L: r('#leanLeftBtn'), R: r('#leanRightBtn'), B: r('#boostBtn'), G: r('#balGauge'), P: r('#gatePop'), C: r('.hud-controls'), T: r('.hud-row') };
      const W = innerWidth, H = innerHeight;
      const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const inView = Object.values(box).every(x => x.l >= 0 && x.t >= 0 && x.r <= W && x.b <= H);
      const overlaps = [['P', 'C'], ['P', 'T'], ['G', 'B'], ['R', 'B'], ['G', 'P']].filter(([a, b]) => hit(box[a], box[b])).map(x => x.join(''));
      return { W, H, gap: Math.round(box.B.l - box.R.r), inView, overlaps, rotate: !!document.getElementById('rotateWarning') };
    });
    await down(0, ...R); await sleep(350);
    await tp.setViewportSize({ width: 667, height: 375 }); await sleep(600);
    const h1 = await st();
    const lay = await layout();
    await tp.evaluate(() => { const c = Game.cart, g = Game.track.gateCenters()[0]; c.t = g.t - 0.006; Cart.speedScale = 0; c.leanInput = 0.6; Game._fixedUpdate(1 / 60); UI.updateHUD(c, Game.track); });
    await sleep(250);
    await tp.screenshot({ path: path.join(OUT, 'touch_landscape.png') });
    check('rotate: held ▶ released on rotation, landscape layout OK', Math.abs(h1.lean) < 0.01 && !h1.pressed && lay.inView && !lay.overlaps.length && lay.gap >= 150 && !lay.rotate, `${JSON.stringify(h1)} ${JSON.stringify(lay)}`);
    await up(0);
    await tp.setViewportSize({ width: 375, height: 667 }); await sleep(500);
    const lay2 = await layout();
    check('rotate back: portrait layout OK', lay2.inView && !lay2.overlaps.length && lay2.gap >= 60, JSON.stringify(lay2));
    await tp.screenshot({ path: path.join(OUT, 'touch_multi.png') });
  } catch (err) {
    check('multi-touch flow', false, err.message.split('\n')[0]);
  } finally {
    await tctx.close();
  }
}
main();
