// 부스트 + 균형 바 멀티터치 검증 (진짜 터치: Chromium CDP Input.dispatchTouchEvent → 브라우저가 pointer 이벤트로 변환)
//   node touch-multi.mjs [--browser=chromium|webkit] [--tag=before|after]
//   Chromium: 시나리오 a~h × 세로/가로. WebKit: CDP 터치가 없어 PointerEvent를 직접 쏘는 "로직 검증"만 — 실기기(iOS) 대체 불가.
//   구조 점검(영역 간격·elementFromPoint·touch-action·리스너)도 같이 출력.
import { start, loadStage } from './polish-lib.mjs';
const BROWSER = (process.argv.find(a => a.startsWith('--browser=')) || '--browser=chromium').split('=')[1];
const TAG = (process.argv.find(a => a.startsWith('--tag=')) || '--tag=run').split('=')[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} [${BROWSER}] ${name}${ok ? '' : ' — ' + detail}`); };

async function setup(w, h) {
  const { page, errors, close } = await start({ browser: BROWSER, w, h, init: { rc_derail: 'off', rc_quality: 'low' } });
  await loadStage(page, 0);
  await page.evaluate(() => { Game.input._launch(1, 1); });
  await page.waitForSelector('#driveControls.on');
  await page.evaluate(() => {
    window.__boosts = 0; window.__mash = 0;
    window.addEventListener('gate-result', () => window.__boosts++); window.addEventListener('mash-tap', () => window.__mash++);
    Game.cart.t = 0.001; Cart.speedScale = 0; // 진행 정지(입력·leanInput 램프는 그대로)
  });
  return { page, errors, close };
}

/** 한 손가락(역할)만 pointercancel — 앱이 기억하는 그 손가락의 pointerId로, 그 역할 요소에 직접 발생(브라우저가 실제로 보내는 것과 같은 이벤트) */
const synthCancel = (page, role) => page.evaluate(role => {
  const I = Game.input;
  const ids = I.pointers ? I.pointers().filter(p => p.role === role).map(p => p.id) : (role === 'slider' ? (I._barPtr ? [I._barPtr.id] : []) : [...I._btnPointers.keys()]);
  const el = document.getElementById(role === 'slider' ? 'balGauge' : 'boostBtn');
  ids.forEach(id => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: false, composed: true })));
  return ids.length;
}, role);

/** 입력 드라이버: Chromium = CDP 터치, WebKit = 합성 PointerEvent(pointerId별) */
async function driver(page) {
  const pts = new Map();
  if (BROWSER === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const P = (id, x, y) => ({ id, x, y, radiusX: 6, radiusY: 6, force: 1 });
    const sendAll = type => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts].map(([id, [x, y]]) => P(id, x, y)) });
    return {
      down: async (id, x, y) => { pts.set(id, [x, y]); await sendAll('touchStart'); },
      move: async (id, x, y) => { pts.set(id, [x, y]); await sendAll('touchMove'); },
      up: async (...ids) => { const gone = ids.map(id => P(id, ...pts.get(id))); ids.forEach(i => pts.delete(i)); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: gone }); },
      cancel: async id => { await synthCancel(page, id === 0 ? 'slider' : 'boost'); }, // CDP touchCancel은 전 손가락을 취소 → 한 손가락만은 그 손가락의 pointerId로 pointercancel 직접 발생
      cancelAll: async () => { pts.clear(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); },
    };
  }
  // WebKit: 요소(elementFromPoint)에 PointerEvent 직접 디스패치 — 캡처는 요소 단위로 흉내(window까지 버블)
  const fire = (type, id, x, y) => page.evaluate(([type, id, x, y]) => {
    const el = window.__cap?.get(id) || document.elementFromPoint(x, y) || document.body;
    if (!window.__cap) window.__cap = new Map();
    if (type === 'pointerdown') window.__cap.set(id, el);
    el.dispatchEvent(new PointerEvent(type, { pointerId: id + 10, pointerType: 'touch', isPrimary: id === 0, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true }));
    if (type !== 'pointermove' && type !== 'pointerdown') window.__cap.delete(id);
  }, [type, id, x, y]);
  return {
    down: async (id, x, y) => { pts.set(id, [x, y]); await fire('pointerdown', id, x, y); },
    move: async (id, x, y) => { pts.set(id, [x, y]); await fire('pointermove', id, x, y); },
    up: async (...ids) => { for (const id of ids) { await fire('pointerup', id, ...pts.get(id)); pts.delete(id); } },
    cancel: async id => { await fire('pointercancel', id, ...pts.get(id)); },
  };
}

const geom = page => page.evaluate(() => {
  const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; };
  return { rail: r('#balRail'), boost: r('#boostBtn'), bar: r('#balGauge') };
});
const state = page => page.evaluate(() => ({ lean: Game.cart.leanInput, boosts: window.__boosts, mash: window.__mash, pressed: document.getElementById('boostBtn').classList.contains('pressed'), holding: document.getElementById('balGauge').classList.contains('holding'),
  knobX: document.getElementById('balKnob').getBoundingClientRect().x }));

async function scenarios(name, w, h) {
  const { page, errors, close } = await setup(w, h);
  const d = await driver(page);
  const g = await geom(page);
  const X = v => g.rail.x + (v + 1) / 2 * g.rail.w, Y = g.rail.cy, B = [g.boost.cx, g.boost.cy];
  const near = (v, t, tol = 0.08) => Math.abs(v - t) <= tol;
  const idle = async () => { await sleep(450); };
  const cleanNow = async () => { const s = await state(page); return Math.abs(s.lean) < 0.02 && !s.pressed && !s.holding; };
  const reset = async () => { await page.evaluate(() => { window.__boosts = 0; window.__mash = 0; }); };

  // (a) 슬라이더 누른 채 부스트 5회 탭 → 노브 ±1px, 부스트 5회
  await reset();
  await d.down(0, X(0), Y); await d.move(0, X(0.6), Y); await sleep(450);
  const k0 = (await state(page)).knobX;
  for (let i = 0; i < 5; i++) { await d.down(1, ...B); await sleep(40); await d.up(1); await sleep(70); }
  await sleep(250);
  let s = await state(page);
  check(`${name} (a) 바 잡은 채 BOOST 5탭 → 노브 ±1px, 부스트 5회`, Math.abs(s.knobX - k0) <= 1 && s.boosts === 5 && s.holding, JSON.stringify({ ...s, k0 }));
  await d.up(0); await idle();

  // (b) 바를 끄는 동안 부스트 탭
  await reset();
  await d.down(0, X(-0.8), Y);
  let boostsDuring = 0;
  for (let i = 0; i <= 12; i++) {
    await d.move(0, X(-0.8 + i * 0.1), Y); await sleep(20);
    if (i % 4 === 2) { await d.down(1, ...B); await sleep(30); await d.up(1); boostsDuring++; }
  }
  await sleep(350);
  s = await state(page);
  check(`${name} (b) 바를 끄는 동안 BOOST 탭 ${boostsDuring}회 → 모두 인식, 바는 끝(+0.4)까지 따라감`, s.boosts === boostsDuring && near(s.lean, 0.4) && s.holding, JSON.stringify(s));
  await d.up(0); await idle();

  // (c) 부스트 먼저 누르고 슬라이더 시작
  await reset();
  await d.down(1, ...B); await sleep(60);
  await d.down(0, X(0), Y); await d.move(0, X(-0.7), Y); await sleep(450);
  s = await state(page);
  check(`${name} (c) BOOST 먼저 누르고 바 시작 → 부스트 1회·눌림 유지, 바 −0.7`, s.boosts === 1 && s.pressed && s.holding && near(s.lean, -0.7), JSON.stringify(s));
  await d.up(0, 1); await idle();

  // (d) 두 손가락 떼는 모든 순서·간격
  for (const gap of [50, 150, 400]) for (const first of ['bar', 'boost']) {
    await reset();
    await d.down(0, X(0.5), Y); await d.down(1, ...B); await sleep(450);
    await d.up(first === 'bar' ? 0 : 1); await sleep(gap);
    const mid = await state(page);
    const midOk = first === 'bar' ? mid.pressed && !mid.holding : mid.holding && !mid.pressed && near(mid.lean, 0.5);
    await d.up(first === 'bar' ? 1 : 0); await idle();
    check(`${name} (d) ${first} 먼저 뗌, ${gap}ms 뒤 나머지 — 남은 입력 유지, 끝나면 깨끗`, midOk && mid.boosts === 1 && await cleanNow(), JSON.stringify(mid));
  }

  // (e) 한쪽만 cancel
  await reset();
  await d.down(0, X(0.5), Y); await d.down(1, ...B); await sleep(450);
  await d.cancel(1); await sleep(100); // 부스트 손가락은 물리적으로는 아직 닿아 있음(앱만 cancel을 받음)
  s = await state(page);
  const eA = s.holding && !s.pressed && near(s.lean, 0.5);
  await d.up(0, 1); await idle();
  await d.down(0, X(0.5), Y); await d.down(1, ...B); await sleep(300);
  await d.cancel(0); await sleep(100);
  const s2 = await state(page);
  const eB = s2.pressed && !s2.holding;
  await d.up(0, 1); await idle();
  check(`${name} (e) 한쪽만 cancel → 다른 쪽 입력 유지(부스트 cancel→바 유지 ${eA}, 바 cancel→부스트 유지 ${eB})`, eA && eB && await cleanNow(), JSON.stringify([s, s2]));

  if (BROWSER === 'chromium') { // 전체 touchcancel(시스템이 터치를 가져감) → 모두 깨끗이 해제
    await d.down(0, X(0.5), Y); await d.down(1, ...B); await sleep(300); await d.cancelAll(); await idle();
    check(`${name} (e2) 시스템 touchcancel(전 손가락) → 모두 해제, 아무것도 안 걸림`, await cleanNow(), JSON.stringify(await state(page)));
  }

  // (g) 연타 구간 중 슬라이더 유지
  await reset();
  await page.evaluate(() => { Game.cart.mashTimeout = Infinity; Game.cart.rollback = { phase: 'mash', time: 0, mode: 'mash', zone: Game.track.rollbackZone || { mode: 'mash', tValley: 0.001, tPeak: 0.02 }, gauge: 0, taps: 0, mashTime: 0 }; });
  await d.down(0, X(0.4), Y); await sleep(350);
  const mk0 = (await state(page)).knobX;
  for (let i = 0; i < 5; i++) { await d.down(1, ...B); await sleep(35); await d.up(1); await sleep(60); }
  await sleep(200);
  s = await state(page);
  check(`${name} (g) 연타 구간에서 바 잡은 채 BOOST 5연타 → 연타 5회 인식, 바 유지`, s.mash === 5 && s.holding && Math.abs(s.knobX - mk0) <= 1, JSON.stringify(s));
  await d.up(0); await page.evaluate(() => { Game.cart.rollback = null; }); await idle();

  // (h) 키보드 ← 누른 채 ↑ 탭 (Chromium/WebKit 공통 — 실제 키 이벤트)
  await reset();
  await page.keyboard.down('ArrowLeft'); await sleep(400); await page.keyboard.press('ArrowUp'); await sleep(80); await page.keyboard.press('Space'); await sleep(80);
  s = await state(page);
  await page.keyboard.up('ArrowLeft'); await idle();
  check(`${name} (h) 키보드 ← 누른 채 ↑·Space → 천천히 왼쪽(≈−0.5) + 부스트 2회`, s.lean < -0.35 && s.lean > -0.8 && s.boosts === 2, JSON.stringify(s));
  await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowRight'); await sleep(300); await page.keyboard.up('ArrowUp'); await sleep(300);
  s = await state(page);
  await page.keyboard.up('ArrowRight'); await idle();
  check(`${name} (h2) ↑를 먼저 떼도 → 키가 서로 덮어쓰지 않음(→ 계속 이동)`, s.lean > 0.5, JSON.stringify(s));
  check(`${name} page error 0`, errors.length === 0, errors.join('|'));
  await close();
}

async function audit(name, w, h) {
  const { page, close } = await setup(w, h);
  const a = await page.evaluate(() => {
    const R = s => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const bar = R('#balGauge'), boost = R('#boostBtn'), wrap = R('#boostWrap');
    const gapX = boost.l - bar.r, gapY = boost.t - bar.b;
    const gap = Math.max(gapX, gapY, bar.l - boost.r, bar.t - boost.b);
    const topAt = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className || e.tagName) : null; };
    const cB = [(boost.l + boost.r) / 2, (boost.t + boost.b) / 2], cR = (() => { const r = document.getElementById('balRail').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })();
    const chain = el => { const out = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); out.push(`${e.id || e.tagName}:${cs.touchAction}/${cs.pointerEvents}`); } return out; };
    const ta = s => getComputedStyle(document.querySelector(s)).touchAction;
    return { gap: Math.round(gap), wrapOverlapsBar: !(wrap.r <= bar.l || wrap.l >= bar.r || wrap.b <= bar.t || wrap.t >= bar.b), topBoost: topAt(...cB), topRail: topAt(...cR),
      touchAction: { html: ta('html'), body: ta('body'), canvas: ta('canvas'), controls: ta('#driveControls'), bar: ta('#balGauge'), boost: ta('#boostBtn') }, chainBoost: chain(document.getElementById('boostBtn')).slice(0, 5), chainBar: chain(document.getElementById('balGauge')).slice(0, 5) };
  });
  console.log(`[audit ${name}] ${JSON.stringify(a)}`);
  check(`${name} 영역: 바↔BOOST 간격 ≥16px(${a.gap}px), 위 레이어가 가로채지 않음`, a.gap >= 16 && a.topBoost === 'boostBtn' && /bal/.test(String(a.topRail)) && !a.wrapOverlapsBar, JSON.stringify(a));
  check(`${name} touch-action none: html·body·canvas·조작 영역`, ['html', 'body', 'canvas', 'controls', 'bar', 'boost'].every(k => a.touchAction[k] === 'none'), JSON.stringify(a.touchAction));
  await close();
}

// 메뉴 스크롤 + ?touch-debug 진단 화면
async function menuAndDebug() {
  const { page, errors, close } = await start({ browser: BROWSER, w: 375, h: 667, init: { rc_quality: 'low' }, url: '/index.html?touch-debug' });
  await page.waitForSelector('#touchDebug', { state: 'attached', timeout: 5000 }).catch(() => {});
  check('?touch-debug 진단 화면이 뜸(일반 주소엔 없음)', await page.locator('#touchDebug').count() === 1);
  if (BROWSER === 'chromium') {
    await page.evaluate(() => UI.showStageSelect(STAGES, () => {})); await sleep(400);
    const info = await page.evaluate(() => { const els = [...document.querySelectorAll('#uiRoot *')].filter(e => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)); const e = els[0]; if (!e) return null; const b = e.getBoundingClientRect(); window.__sc = e; return { x: b.x + b.width / 2, y: b.y + b.height * 0.8 }; });
    const cdp = await page.context().newCDPSession(page);
    const P = (x, y) => [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }];
    if (info) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: P(info.x, info.y) }); for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: P(info.x, info.y - i * 25) }); await sleep(16); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300); }
    const top = info ? await page.evaluate(() => window.__sc.scrollTop) : -1;
    check(`메뉴(스테이지 선택) 터치 스크롤이 여전히 동작(touch-action none 영향 없음) scrollTop=${Math.round(top)}`, info && top > 20, JSON.stringify(info));
  }
  check('menu/debug page error 0', errors.length === 0, errors.join('|'));
  await close();
}

const sizes = [['세로', 375, 667], ['가로', 667, 375], ['소형', 320, 568]];
for (const [n, w, h] of sizes) { await audit(n, w, h); await scenarios(n, w, h); }
await menuAndDebug();
const failed = results.filter(r => !r.ok).length;
console.log(`[touch-multi:${TAG}] ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
