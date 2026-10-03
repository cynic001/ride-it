#!/usr/bin/env node
/**
 * tutorial-test.mjs — 튜토리얼(13번) 처음부터 끝까지 실제 입력으로 진행
 *   runs: keyboard(세로) · touch(세로, CDP 터치 이벤트) · touch(가로)
 *   단계마다: 설명 카드가 뜨면 게임이 멈추는지 / 아무것도 안 하거나 틀리게 하면 다음 단계로 안 넘어가는지(기다림·되감기 + 힌트)
 *   / 맞게 하면 넘어가는지 / 강조 테두리가 해당 버튼·게이지 위에 있는지 + 안내 문구가 입력 환경(키보드/터치) 기준인지
 *   끝: "준비 완료!" + rc_tutorial_done, 점수 기록(rc_progress) 없음. 건너뛰기·스테이지 선택 카드·설정 버튼으로 재진입
 * Usage: node tutorial-test.mjs [--out=dir] [--runs=keyboard,touch,touch-land] [--port=8133]
 */
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const OUT = path.resolve(args.out ?? '/tmp/ride-it-tutorial');
const RUNS = String(args.runs ?? 'keyboard,touch,touch-land').split(',');
const PORT = Number(args.port ?? 8133);
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.env': 'application/octet-stream', '.webmanifest': 'application/manifest+json', '.m4a': 'audio/mp4', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]) === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(PORT);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const pageErrors = [];

async function run(browser, mode) {
  const land = mode === 'touch-land', touch = mode.startsWith('touch');
  const ctx = await browser.newContext({ viewport: land ? { width: 667, height: 375 } : { width: 375, height: 667 }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('t_init')) { sessionStorage.setItem('t_init', '1'); localStorage.clear(); localStorage.setItem('rc_quality', 'low'); } });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(`[${mode}] ${e.message} @ ${(e.stack || '').split('\n').slice(1, 4).join(' | ')}`));
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  const tag = mode;
  const shot = n => page.screenshot({ path: path.join(OUT, `${tag}_${n}.png`) });
  const pts = new Map();
  const tStart = async (id, x, y) => { pts.set(id, [x, y]); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...pts].map(([i, [a, b]]) => ({ id: i, x: a, y: b })) }); };
  const tMove = async (id, x, y) => { pts.set(id, [x, y]); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [...pts].map(([i, [a, b]]) => ({ id: i, x: a, y: b })) }); };
  const tEnd = async id => { const [x, y] = pts.get(id); pts.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, x, y }] }); };
  const center = async sel => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const tap = async sel => { if (touch) { const [x, y] = await center(sel); await tStart(9, x, y); await sleep(40); await tEnd(9); } else await page.locator(sel).click(); };
  const state = () => page.evaluate(() => ({ step: Tutorial.step, hold: Tutorial.hold, t: Game.cart.t, tScale: Game.cart.tScale, card: !!document.getElementById('tutCard'),
    banner: (document.getElementById('tutBanner') || {}).textContent || '', hint: !!document.querySelector('#tutBanner.hint') }));
  const waitFor = async (fn, ms = 20000, arg) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
  /** 강조 테두리가 지정 대상 위에 있는지(테두리 중심이 대상 사각형 안) */
  const focusOk = () => page.evaluate(() => {
    const f = Tutorial._focus; if (!f) return { ok: false, why: 'no focus' };
    const rings = [...document.querySelectorAll('.tut-ring')];
    const bad = f.sels.filter((sel, i) => { const t = document.querySelector(sel); const r = rings[i]; if (!t || !r) return true;
      const a = t.getBoundingClientRect(), b = r.getBoundingClientRect(); const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      return !(cx >= a.left && cx <= a.right && cy >= a.top && cy <= a.bottom) || b.right > innerWidth + 8 || b.bottom > innerHeight + 8; });
    return { ok: !bad.length, sels: f.sels, bad, rects: bad.map((sel, i) => { const t = document.querySelector(sel).getBoundingClientRect(), r = rings[f.sels.indexOf(sel)].getBoundingClientRect(); return [t.left, t.top, t.right, t.bottom, r.left, r.top, r.right, r.bottom].map(Math.round); }), ih: innerHeight };
  });
  // 설명 카드는 글이 길면 페이지로 나뉨 — 확인 버튼이 보일 때까지 '다음'(키보드는 Enter)을 누름
  const okCard = async () => {
    for (let i = 0; i < 12; i++) {
      if (!(await page.$('#tutCard'))) return;
      if (touch) { const ok = await page.$('#tutOkBtn'); if (ok && await ok.isVisible()) { await tap('#tutOkBtn'); return; } await tap('#tutCard .popup-next'); }
      else await page.keyboard.press('Enter');
      await sleep(120);
    }
  };
  // 밸런스: 커브 방향(이 트랙은 오른쪽) 버튼/키 누르고 있기
  const leanDown = async () => { if (touch) { const r = await page.locator('#balRail').boundingBox(); await tStart(1, r.x + r.width * 0.85, r.y + r.height / 2); } else await page.keyboard.down('ArrowRight'); }; // 바 오른쪽(+0.7) 또는 → 키
  const leanUp = async () => { if (touch) await tEnd(1); else await page.keyboard.up('ArrowRight'); };
  const boost = async () => { if (touch) { const [x, y] = await center('#boostBtn'); await tStart(2, x, y); await sleep(30); await tEnd(2); } else await page.keyboard.press('ArrowUp'); };
  /** 다가오는 게이트의 판정 오차가 target초가 되는 순간 부스트(실제 입력) */
  const boostAt = async (target = 0) => {
    await waitFor(tg => { const g = Game.cart.gateTiming(); return g && g.err >= tg - 0.03 && g.err < 0.3; }, 30000, target);
    await boost();
  };

  try {
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await tap('#titleStart');
    await page.waitForSelector('#tutorialAsk', { timeout: 10000 });
    if (mode === 'keyboard') await shot('00_ask');
    for (let i = 0; i < 6 && !(await page.locator('#tutAskYes').isVisible().catch(() => false)); i++) await tap('.popup-next'); // 권유 팝업도 가로에서는 페이지로 나뉨
    await tap('#tutAskYes');
    await page.waitForSelector('#tutBanner.on', { timeout: 30000 });
    await sleep(500);

    // 1) 출발 — 안내는 입력 환경 기준, 강조 = 스타트 바
    let s = await state();
    const f1 = await focusOk();
    check(`${tag} 1 start: banner + focus on start bar`, s.step === 'start' && f1.ok && (touch ? /당겼다가/.test(s.banner) : /↓/.test(s.banner)), `${s.banner} ${JSON.stringify(f1)}`);
    await shot('01_start');
    if (touch) {
      const [x, y] = await center('#startBarHandle');
      await tStart(0, x, y); for (let i = 1; i <= 6; i++) { await tMove(0, x, y + i * 12); await sleep(30); } await tEnd(0); await sleep(300); // 위로 안 밀고 떼기 = 취소
      check(`${tag} 1 start: release without push-up does not advance`, (await state()).step === 'start' && !(await page.evaluate(() => Game.cart.launched)));
      await tStart(0, x, y); for (let i = 1; i <= 10; i++) { await tMove(0, x, y + i * 12); await sleep(16); }
      for (let i = 1; i <= 5; i++) { await tMove(0, x, y + 120 - i * 26); await sleep(8); } await tEnd(0);
    } else {
      await page.keyboard.press('ArrowUp'); await sleep(200); // 충전 없이 ↑ = 출발 안 함
      check(`${tag} 1 start: ↑ without charge does not advance`, (await state()).step === 'start');
      await page.keyboard.down('ArrowDown'); await sleep(500); await page.keyboard.up('ArrowDown'); await page.keyboard.press('ArrowUp');
    }
    await waitFor(() => Tutorial.step === 'balance', 5000);
    check(`${tag} 1 start → 2 balance after launch`, true);

    // 2) 밸런스 — 카드(그림) 동안 정지, 아무것도 안 하면 커브 끝에서 기다림 + 힌트, 1.5초 유지하면 다음
    await waitFor(() => !!document.getElementById('tutCard'));
    const c0 = await state(); await sleep(400); const c1 = await state();
    check(`${tag} 2 balance: card pauses the ride`, c0.hold && c1.t === c0.t && await page.locator('#tutCard svg.diagram').count() === 1);
    await sleep(450);
    await shot('02_balance_card');
    await okCard();
    await sleep(300);
    const f2 = await focusOk();
    check(`${tag} 2 balance: focus on balance bar`, f2.ok && f2.sels.includes('#balGauge'), JSON.stringify(f2));
    await shot('02_balance_play');
    await waitFor(() => Game.cart.tScale === 0, 30000); // 그냥 두면 커브 85% 지점에서 멈춰 기다림
    await sleep(300);
    s = await state();
    check(`${tag} 2 balance: no input → waits in curve with hint, no advance`, s.step === 'balance' && s.hint, s.banner);
    await shot('02_balance_wait');
    await leanDown();
    await waitFor(() => Tutorial.step === 'boost', 4000);
    await leanUp();
    check(`${tag} 2 balance → 3 boost after 1.5s hold`, true);

    // 3) 부스트 — 카드(팝업 그림), 일부러 일찍 눌러 실패 → 되감기 + 힌트, 정타 → 다음
    await waitFor(() => !!document.getElementById('tutCard'), 30000);
    await sleep(450);
    await shot('03_boost_card');
    await okCard();
    await sleep(200);
    const f3 = await focusOk();
    check(`${tag} 3 boost: focus on the top ring + BOOST button`, f3.ok && f3.sels.includes('#gatePop'), JSON.stringify(f3));
    await boostAt(-0.32); // Good 범위(±0.25초) 밖 — 너무 일찍
    await sleep(300);
    s = await state();
    check(`${tag} 3 boost: early tap → retry with hint, no advance`, s.step === 'boost' && s.hint && /빨랐/.test(s.banner), s.banner);
    await shot('03_boost_retry');
    await waitFor(() => { const g = Game.cart.gateTiming(); return g && g.err > -0.6 && g.err < -0.15; }, 30000);
    await shot('03_boost_popup');
    await boostAt(0);
    await waitFor(() => Tutorial.step === 'combo', 3000);
    check(`${tag} 3 boost → 4 combo on good/perfect`, true);

    // 4) 동시 조작 — 밸런스 없이 부스트만 = 실패(되감기), 밸런스 유지하면서 부스트 = 다음
    await waitFor(() => !!document.getElementById('tutCard'), 30000);
    await sleep(450);
    await shot('04_combo_card');
    await okCard();
    await boostAt(0);
    await sleep(300);
    s = await state();
    check(`${tag} 4 combo: boost without balance → retry with hint`, s.step === 'combo' && s.hint && /초록 띠/.test(s.banner), s.banner);
    await leanDown();
    await sleep(500);
    await sleep(500);
    await shot('04_combo_both');
    await boostAt(0);
    await waitFor(() => Tutorial.step === 'rollback', 3000);
    await leanUp();
    check(`${tag} 4 combo → 5 rollback with balance held + boost (two inputs at once)`, true);

    // 5) 뒤로 떨어지기 — 연타해야만 올라감(자동 도움 없음)
    await waitFor(() => !!document.getElementById('tutCard'), 30000);
    await sleep(450);
    await shot('05_rollback_card');
    await okCard();
    await waitFor(() => Game.cart.rollback && Game.cart.rollback.phase === 'mash', 30000);
    await sleep(2500); // 연타 안 하면 그대로(올라가지 않음)
    s = await state();
    const rb = await page.evaluate(() => ({ phase: Game.cart.rollback && Game.cart.rollback.phase, t: Game.cart.t, valley: Game.track.rollbackZone.tValley }));
    check(`${tag} 5 rollback: no mashing → stays at valley`, s.step === 'rollback' && rb.phase === 'mash' && rb.t - rb.valley < 0.003, JSON.stringify(rb));
    await shot('05_rollback_mash');
    for (let i = 0; i < 80 && (await page.evaluate(() => Tutorial.step)) === 'rollback'; i++) { await boost(); await sleep(70); }
    check(`${tag} 5 rollback → 6 finish after mashing`, (await page.evaluate(() => Tutorial.step)) === 'finish');

    // 6) 피니쉬 — 카드 → 아치 통과 → 준비 완료
    await waitFor(() => !!document.getElementById('tutCard'), 30000);
    await sleep(450);
    await shot('06_finish_card');
    await okCard();
    await page.waitForSelector('#tutorialDone', { timeout: 30000 });
    await sleep(500);
    await shot('07_done');
    const st = await page.evaluate(() => ({ done: localStorage.getItem('rc_tutorial_done'), progress: localStorage.getItem('rc_progress') }));
    check(`${tag} 7 done screen, rc_tutorial_done=1, no score saved`, st.done === '1' && !st.progress, JSON.stringify(st));

    if (mode === 'keyboard') {
      // 완료 → 1단계 바로
      await tap('#tutGoStage1');
      await page.waitForSelector('#startBar', { timeout: 30000 });
      check(`${tag} done → stage 1 loads`, await page.evaluate(() => Game.track.stageData.id === 1 && !Game.tutorialMode));
      // 재진입: 스테이지 선택 카드 → 건너뛰기
      await page.evaluate(() => Game.exitToStageSelect());
      await page.waitForSelector('#tutorialStageBtn');
      check(`${tag} stage select: tutorial card shows 완료`, (await page.locator('#tutorialStageBtn .badge.clear').count()) === 1);
      await tap('#tutorialStageBtn');
      await page.waitForSelector('#tutSkipBtn', { timeout: 30000 });
      await sleep(400);
      await tap('#tutSkipBtn');
      await page.waitForSelector('#tutorialStageBtn', { timeout: 10000 });
      check(`${tag} skip → stage select, tutorial ended, nothing saved`, await page.evaluate(() => !Tutorial.active && !Game.tutorialMode && !localStorage.getItem('rc_progress')));
      // 재진입: 설정 → 튜토리얼 다시 하기
      await tap('#settingsBtn');
      for (let i = 0; i < 8 && !(await page.locator('#settingsTutorialBtn').isVisible().catch(() => false)); i++) await tap('.popup-next'); // 설정 팝업은 페이지로 나뉨
      await tap('#settingsTutorialBtn');
      await page.waitForSelector('#tutBanner.on', { timeout: 30000 });
      check(`${tag} settings → tutorial re-entry`, await page.evaluate(() => Tutorial.active && Tutorial.step === 'start'));
    }
  } catch (e) {
    check(`${tag} flow`, false, e.message.split('\n')[0]);
    await shot('ZZ_fail').catch(() => {});
    console.log(JSON.stringify(await state().catch(() => null)));
  }
  await ctx.close();
}

const BROWSER = process.argv.includes('--browser=webkit') ? 'webkit' : 'chromium'; // WebKit(iPhone Safari 엔진) 검증용
const browser = BROWSER === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--use-angle=metal'] });
for (const m of RUNS) { if (BROWSER === 'webkit' && m.startsWith('touch')) { console.log(`SKIP ${m} — CDP 터치는 Chromium 전용(WebKit은 verify-polish.mjs의 합성 PointerEvent 시나리오로 대체)`); continue; } await run(browser, m); }
await browser.close();
server.close();
console.log('--- page errors ---\n' + (pageErrors.join('\n') || 'NONE'));
const failed = results.filter(r => !r.ok).length;
console.log(`[tutorial] ${results.length - failed}/${results.length} checks passed, pageErrors=${pageErrors.length} → ${OUT}`);
process.exit(failed || pageErrors.length ? 1 : 0);
