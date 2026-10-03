#!/usr/bin/env node
// UI 폴리시 세션(2026-10-03) 항목별 검증 — node verify-polish.mjs [--browser=chromium|webkit] [--only=lap,derail,...]
// 각 항목 검증은 section('이름', async ctx => {...}) 으로 추가. 실패가 하나라도 있으면 exit 1.
import { start, loadStage } from './polish-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const BROWSER = args.browser || 'chromium';
const ONLY = args.only ? String(args.only).split(',') : null;
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} [${BROWSER}] ${name}${ok ? '' : ' — ' + detail}`); };
const sections = [];
const section = (name, fn) => sections.push([name, fn]);

// ── 1-4 랩 문구: 1·2·3랩 × 배너 문구 순서 (게임 루프 대신 cart.update + _updateRideSounds를 직접 돌림)
section('lap', async () => {
  const expect = { 1: ['완주!'], 2: ['마지막 바퀴!', '완주!'], 3: ['2/3바퀴', '마지막 바퀴!', '완주!'] };
  for (const laps of [1, 2, 3]) {
    const { page, errors, close } = await start({ browser: BROWSER, init: { rc_laps: String(laps), rc_derail: 'off' } });
    await loadStage(page, 0);
    const out = await page.evaluate(() => {
      const labels = []; UI.showLapBanner = (t) => labels.push({ t, lap: Game.cart.currentLap, tt: +Game.cart.t.toFixed(3) });
      const c = Game.cart; c.launch(1, 1); let n = 0;
      while (!c.isFinished && n++ < 200000) { c.update(1 / 60); Game._updateRideSounds(); }
      return labels;
    });
    const got = out.map(x => x.t);
    check(`lap ${laps}랩 배너 순서 ${expect[laps].join(' → ')}`, JSON.stringify(got) === JSON.stringify(expect[laps]), JSON.stringify(out));
    // FINAL LAP은 실제 마지막 랩 안에서만
    check(`lap ${laps}랩 마지막 바퀴!/완주!는 마지막 랩에서만`, out.filter(x => x.t === '마지막 바퀴!' || x.t === '완주!').every(x => x.lap === laps), JSON.stringify(out));
    check(`lap ${laps}랩 page error 0`, errors.length === 0, errors.join('|'));
    await close();
  }
});

// ── 2 레일 이탈: ON이면 Miss → 1.5초 연출 → 커브 앞에서 기본 속도로 재출발, 3번째 이탈은 스테이지 실패. OFF·튜토리얼은 이탈 없음
section('derail', async () => {
  const { page, errors, close } = await start({ browser: BROWSER, init: { rc_derail: 'on' } });
  await loadStage(page, 0);
  const on = await page.evaluate(() => {
    const ev = []; ['derail', 'derail-respawn', 'stage-failed'].forEach(n => window.addEventListener(n, () => ev.push(n)));
    const c = Game.cart; c.launch(1, 1);
    const log = []; let n = 0, lastD = 0, scoreBefore = 0;
    while (!c.failed && !c.isFinished && n++ < 100000) {
      c.leanInput = 0; // 커브에서 계속 못 맞춤
      if (!c.derailState) scoreBefore = c.score;
      c.update(1 / 60);
      if (c.derails !== lastD) { lastD = c.derails; log.push({ kind: 'derail', n: c.derails, combo: c.combo, state: !!c.derailState, scoreDrop: +(scoreBefore - c.score).toFixed(0), t: +c.t.toFixed(3) }); }
      if (log.length && log[log.length - 1].kind === 'derail' && !c.derailState && !log[log.length - 1].re && !c.failed) { const l = log[log.length - 1]; l.re = { t: +c.t.toFixed(3), speed: +c.speed.toFixed(2), base: +c.baseSpeedMs.toFixed(2), curve: c._curve }; }
    }
    UI.updateHUD(c, Game.track);
    return { log, ev, failed: c.failed, finished: c.isFinished, derails: c.derails, hearts: document.querySelectorAll('#hearts .heart:not(.off)').length, score: c.score, pen: c.scoreBreakdown.derailPenalty };
  });
  check('derail ON: 이탈 3번 → 실패(완주 아님)', on.failed && !on.finished && on.derails === 3, JSON.stringify(on).slice(0, 400));
  check('derail ON: 이벤트 순서(이탈, 재출발, 이탈, 재출발, 이탈, 실패)', on.ev.join() === 'derail,derail-respawn,derail,derail-respawn,derail,stage-failed', on.ev.join());
  check('derail ON: 이탈 시 콤보 0·감점(점수 0 미만 없음)', on.log.every(l => l.combo === 0) && on.score >= 0, JSON.stringify(on.log.map(l => [l.combo, l.scoreDrop])));
  const re = on.log.map(l => l.re).filter(Boolean);
  check('derail ON: 재출발 속도 = 기본 속도, 커브 진행 초기화', re.length === 2 && re.every(r => Math.abs(r.speed - r.base) < 0.6 && r.curve === null), JSON.stringify(re));
  check('derail ON: HUD 하트 0개 남음', on.hearts === 0, String(on.hearts));
  // 이탈 연출 중 물리 정지 + 1.5초 후 재개 (고정 스텝)
  const timing = await page.evaluate(() => {
    Game.loadStage(0); return true;
  });
  await page.waitForSelector('#startBar'); await page.waitForTimeout(300);
  const tm = await page.evaluate(() => {
    const c = Game.cart; c.launch(1, 1); let n = 0;
    while (!c.derailState && n++ < 100000) { c.leanInput = 0; c.update(1 / 60); }
    const t0 = c.t; let ticks = 0;
    while (c.derailState && ticks < 1000) { c.update(1 / 60); ticks++; }
    return { frozen: c.t === t0 || ticks > 0, ticks, sec: ticks / 60 };
  });
  check('derail ON: 연출 1.5초(고정 스텝 90틱) 후 재개', Math.abs(tm.ticks - 90) <= 1, JSON.stringify(tm));
  await close();

  const off = await start({ browser: BROWSER, init: { rc_derail: 'off' } });
  await loadStage(off.page, 0);
  const o = await off.page.evaluate(() => {
    const c = Game.cart; c.launch(1, 1); let n = 0;
    while (!c.isFinished && !c.failed && n++ < 100000) { c.leanInput = 0; c.update(1 / 60); }
    return { derails: c.derails, finished: c.isFinished, failed: c.failed, enabled: c.derailEnabled, hearts: document.querySelectorAll('#hearts').length, miss: c.balanceResults.miss };
  });
  check('derail OFF: 이탈·하트 없음, 기존 방식으로 완주', o.derails === 0 && o.finished && !o.failed && !o.enabled && o.hearts === 0 && o.miss > 0, JSON.stringify(o));
  await off.close();

  const tu = await start({ browser: BROWSER, init: { rc_derail: 'on' } });
  await tu.page.evaluate(() => Game.loadTutorial()); await tu.page.waitForSelector('#startBar');
  check('튜토리얼은 설정과 관계없이 이탈 없음', await tu.page.evaluate(() => Game.cart.derailEnabled === false && !document.getElementById('hearts')));
  check('derail page error 0', errors.length === 0 && off.errors.length === 0 && tu.errors.length === 0, [...errors, ...off.errors, ...tu.errors].join('|'));
  await tu.close();
});

// ── 3 튜토리얼 화면: 안내줄·설명 카드가 조작 버튼/게이지/팝업/스타트 바와 겹치지 않음 (세로·가로 × 모든 단계)
section('tutlayout', async () => {
  for (const [name, w, h] of [['세로', 375, 667], ['가로', 667, 375]]) {
    const { page, errors, close } = await start({ browser: BROWSER, w, h });
    await page.evaluate(() => Game.loadTutorial()); await page.waitForSelector('#startBar'); await page.waitForTimeout(400);
    const res = await page.evaluate(() => {
      const R = sel => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
      const hit = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const out = [];
      const T = Tutorial;
      const steps = ['start', 'balance', 'boost', 'combo', 'rollback', 'finish'];
      for (const step of steps) {
        if (step !== 'start') window.dispatchEvent(new CustomEvent('cart-launched', { detail: { strength: 0.5, flickMultiplier: 1 } }));
        T.active = true; T._setStep(step);
        // 이 단계에서 실제로 같이 보이는 요소만 강제로 켜서 비교(스타트 바는 발사 전 = start 단계에서만 보임)
        const show = { start: ['startBar'], balance: ['gauge', 'lean'], boost: ['pop', 'boostBtn'], combo: ['gauge', 'lean', 'pop', 'boostBtn'], rollback: ['rb', 'boostBtn'], finish: ['pop', 'boostBtn'] }[step];
        document.getElementById('balGauge')?.classList.toggle('on', show.includes('gauge')); document.getElementById('gatePop')?.classList.toggle('on', show.includes('pop')); document.getElementById('rbOverlay')?.classList.toggle('on', show.includes('rb'));
        T.banner(T._text(step === 'start' ? 'start' : step + 'Banner'), false);
        const B = R('#tutBanner');
        const sel = { gauge: '#balGauge', lean: '.lean-btns', boostBtn: '#boostBtn', pop: '#gatePop', startBar: '#startBar', rb: '#rbOverlay > .rb-title' };
        const bad = [...show.map(k => [k, sel[k]]), ['controls', '.hud-controls'], ['top', '.hud-row']].filter(([, q]) => hit(B, R(q))).map(([k]) => k);
        if (step !== 'start' && !document.querySelector('#startBar:not(.hidden)')) { /* 발사 후 */ }
        out.push({ step, B, bad, inView: !!B && B.l >= 0 && B.r <= innerWidth && B.t >= 0 && B.b <= innerHeight });
      }
      return out;
    });
    for (const r of res) check(`tutorial ${name} 안내줄 ${r.step}: 겹침 없음·화면 안`, r.inView && !r.bad.length, JSON.stringify(r));
    // 설명 카드: 화면 안에 들어오고 안 잘림
    const cards = await page.evaluate(() => {
      const out = [];
      for (const key of ['balanceCard', 'boostCard', 'comboCard', 'rollbackCard', 'finishCard']) {
        Tutorial._stepLabel = key; Tutorial.card('제목', Tutorial._text(key), key === 'balanceCard' ? UI.gaugeDiagram() : null, () => {});
        const c = document.querySelector('#tutCard .popup'), b = c.getBoundingClientRect(), body = c.querySelector('.popup-body');
        out.push({ key, top: Math.round(b.top), bottom: Math.round(b.bottom), H: innerHeight, scroll: body.scrollHeight > body.clientHeight + 1, fs: parseFloat(getComputedStyle(c.querySelector('.popup-block p')).fontSize) });
        Popup.closeAll(); Tutorial.hold = false;
      }
      return out;
    });
    for (const c of cards) check(`tutorial ${name} 카드 ${c.key}: 화면 안, 글 16px 이상`, c.top >= 0 && c.bottom <= c.H && !c.scroll && c.fs >= 16, JSON.stringify(c));
    const note = await page.evaluate(() => Tutorial._text('balanceCard').includes('놓치면 탈선할 수 있어요. (설정에서 끌 수 있어요)'));
    check(`tutorial ${name} 밸런스 카드에 이탈 안내 한 줄`, note);
    check(`tutorial ${name} page error 0`, errors.length === 0, errors.join('|'));
    await close();
  }
});

// ── 4 랩 수 × 이탈 설정별 기록: 예전 기록은 1랩·이탈 ON으로 이전, 조건별 따로 저장·NEW BEST, 상세 화면 즉시 갱신, 결과 화면 OFF 표시
section('progress', async () => {
  const id = await (async () => { const t = await start({ browser: BROWSER, port: 8201 }); const v = await t.page.evaluate(() => STAGES[0].id); await t.close(); return v; })();
  const old = JSON.stringify({ [id]: { cleared: true, best: 1234, rank: 'A', plays: 3 } });
  const { page, errors, close } = await start({ browser: BROWSER, init: { rc_progress: old, rc_laps: '1', rc_derail: 'on' } });
  const mig = await page.evaluate(id => ({ a: ProgressManager.get(id, 1, true), b: ProgressManager.get(id, 1, false), c: ProgressManager.get(id, 3, true), kept: !!localStorage.getItem('rc_progress'), n: ProgressManager.clearedCount }), id);
  check('기록 이전: 예전 기록 = 1랩·이탈 ON, 다른 조건은 비어 있음, 원본 키 유지', mig.a && mig.a.best === 1234 && mig.a.rank === 'A' && !mig.b && !mig.c && mig.kept && mig.n === 1, JSON.stringify(mig));
  const rec = await page.evaluate(id => {
    const r1 = ProgressManager.record(id, 2000, 'B', 3, true); const r2 = ProgressManager.record(id, 900, 'C', 3, false); const r3 = ProgressManager.record(id, 800, 'C', 3, false); const r4 = ProgressManager.record(id, 3000, 'S', 3, false);
    return { r1, r2, r3, r4, on3: ProgressManager.get(id, 3, true), off3: ProgressManager.get(id, 3, false), one: ProgressManager.get(id, 1, true), saved: !!localStorage.getItem('rc_progress_v2') };
  }, id);
  check('조건별 따로 저장: 3랩 ON/OFF 분리, 1랩 기록 그대로', rec.on3.best === 2000 && rec.off3.best === 3000 && rec.one.best === 1234 && rec.saved, JSON.stringify(rec));
  check('NEW BEST는 같은 조건 안에서만 (첫 클리어 / 낮은 점수 아님 / 높은 점수)', rec.r1.firstClear && rec.r2.firstClear && !rec.r3.newBest && rec.r4.newBest, JSON.stringify([rec.r1, rec.r2, rec.r3, rec.r4]));
  // 상세 화면: 랩·이탈 바꾸면 그 조건 기록으로
  await page.evaluate(() => UI.showStageDetail(0)); await page.waitForTimeout(300);
  const txt = () => page.evaluate(() => document.getElementById('detailStats').innerText.replace(/\s+/g, ' '));
  const t1 = await txt();
  await page.click('#lapSeg [data-laps="3"]'); const t3 = await txt();
  await page.click('#derailTag'); const t3off = await txt();
  const tag = await page.evaluate(() => document.getElementById('derailTag').textContent);
  await page.click('#derailTag'); await page.click('#lapSeg [data-laps="1"]'); const t1b = await txt();
  check('상세 화면: 1랩 ON → 1234', t1.includes('1,234') && t1.includes('1바퀴'), t1);
  check('상세 화면: 3랩 ON → 2000, 3랩 이탈 OFF → 3000 + OFF 표시', t3.includes('2,000') && t3off.includes('3,000') && t3off.includes('탈선 꺼짐') && tag === '탈선 꺼짐', `${t3} | ${t3off} | ${tag}`);
  check('상세 화면: 다시 1랩 ON → 1234 (설정 저장 유지)', t1b.includes('1,234') && await page.evaluate(() => localStorage.getItem('rc_derail')) === 'on', t1b);
  // 결과 화면: 이탈 OFF 3랩 완주 → 같은 조건(3랩·OFF) 기록과 비교, OFF 표시
  await page.evaluate(() => { DerailSettings.set(false); LapsManager.setLaps(2); Game.loadStage(0); }); await page.waitForSelector('#startBar');
  const resTxt = await page.evaluate(() => {
    const c = Game.cart; c.launch(1, 1); let n = 0;
    while (!c.isFinished && n++ < 200000) { c.leanInput = 0; c.update(1 / 60); }
    UI.showResult(c, 0); return { t: document.getElementById('resultScreen').innerText.replace(/\s+/g, ' '), laps: c.totalLaps, rec: ProgressManager.get(STAGES[0].id, 2, false) };
  });
  check('결과 화면: 2바퀴 · 탈선 꺼짐 표시 + 그 조건 기록 저장(처음 완주)', resTxt.t.includes('2바퀴') && resTxt.t.includes('탈선 꺼짐') && resTxt.t.includes('처음 완주!') && resTxt.rec && resTxt.rec.plays === 1, JSON.stringify(resTxt).slice(0, 300));
  check('progress page error 0', errors.length === 0, errors.join('|'));
  await close();
});

// ── 4 부스트 타이밍 링(BOOST 버튼 바깥): 판정과 같은 식, 틱-틱-지금 1회씩, 정타 순간 반짝, Good은 은은하게(점멸 없음), Miss는 점멸 없음,
//    Perfect는 알록달록 점멸 — 초당 3회 이하·빨강 제외·모양 변화(두꺼워짐·맥동·별)·reduced-motion이면 고정 무지개 테두리·low는 맥동 없음
section('boost', async () => {
  const parseColor = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (m) return m[1].split(',').slice(0, 3).map(Number); const h = String(c).match(/^#([0-9a-f]{6})$/i); return h ? [0, 2, 4].map(i => parseInt(h[1].slice(i, i + 2), 16)) : null; };
  for (const [name, w, h] of [['세로', 375, 667], ['가로', 667, 375], ['소형 세로', 320, 568]]) {
    const { page, errors, close } = await start({ browser: BROWSER, w, h, init: { rc_derail: 'off', rc_quality: 'medium' } });
    await loadStage(page, 0);
    await page.evaluate(() => { Game.engine.stopRenderLoop(); Game.input._launch(1, 1); });
    await page.waitForTimeout(450); // 조작부가 올라오는 전환(0.25초)이 끝난 뒤
    const geo = await page.evaluate(() => { const b = document.getElementById('boostBtn').getBoundingClientRect(), wr = document.getElementById('boostWrap').getBoundingClientRect(), bar = document.getElementById('balGauge').getBoundingClientRect();
      return { btn: b.width, wrap: wr.width, dx: (wr.left + wr.right) / 2 - (b.left + b.right) / 2, dy: (wr.top + wr.bottom) / 2 - (b.top + b.bottom) / 2, barRight: bar.right, wrapLeft: wr.left, wrapRight: wr.right, wrapBottom: wr.bottom, W: innerWidth, H: innerHeight, wrapTop: wr.top }; });
    check(`부스트 ${name}: BOOST 버튼 지름 ${Math.round(geo.btn)}px(큰 원형), 링 영역은 버튼의 1.44배·같은 중심·화면 안·균형 바와 안 겹침`,
      geo.btn >= 76 && Math.abs(geo.wrap / geo.btn - 1.44) < 0.02 && Math.abs(geo.dx) < 1 && Math.abs(geo.dy) < 1 && geo.wrapRight <= geo.W + 0.5 && geo.wrapBottom <= geo.H + 0.5 && geo.barRight <= geo.wrapLeft + 0.5, JSON.stringify(geo));
    // 다가오는 게이트까지 진행하며 상태 샘플링
    const r = await page.evaluate(() => {
      const c = Game.cart, wrap = document.getElementById('boostWrap'), ticks = []; let key = null, n = 0, perfectSeen = false, perfectOutside = false, goodOutside = false, flashSeen = false, ringOk = true, maxErr = 0;
      AudioManager.playTick = f => ticks.push([f, +(c.gateTiming() ? c.gateTiming().err : 9).toFixed(3)]);
      while (n++ < 60 * 120) {
        c.leanInput = 0; Game._fixedUpdate(1 / 60);
        const g = c.gateTiming(); if (!g) continue;
        if (key === null && g.err > -0.78 && g.err < 0) key = g.key;
        if (key === null || g.key !== key) { if (key !== null) break; continue; }
        const inP = Math.abs(g.err) <= g.perfect, inG = Math.abs(g.err) <= g.good;
        if (wrap.classList.contains('perfect-now') && inP) perfectSeen = true;
        if (wrap.classList.contains('perfect-now') && !inP) perfectOutside = true;
        if (wrap.classList.contains('ready') && !inG) goodOutside = true;
        if (document.getElementById('brFlash').classList.contains('go')) flashSeen = true;
        const rr = parseFloat(document.getElementById('brRing').getAttribute('r')), exp = Math.max(50, 57 + (15 / 0.8) * -g.err); maxErr = Math.max(maxErr, Math.abs(rr - exp)); if (Math.abs(rr - exp) > 0.05) ringOk = false;
      }
      return { ticks, perfectSeen, perfectOutside, goodOutside, flashSeen, ringOk, maxErr };
    });
    check(`부스트 ${name}: 링 반지름·Good/Perfect 띠가 cart.gateTiming과 같은 식(오차 ${r.maxErr.toFixed(3)})`, r.ringOk, JSON.stringify(r));
    check(`부스트 ${name}: Perfect 범위에서만 perfect-now, Good 범위에서만 ready`, r.perfectSeen && !r.perfectOutside && !r.goodOutside, JSON.stringify(r));
    check(`부스트 ${name}: 정타 순간 flash`, r.flashSeen);
    const t = r.ticks;
    check(`부스트 ${name}: 틱-틱-지금 1회씩`, t.length === 3 && !t[0][0] && !t[1][0] && t[2][0] && t[0][1] >= -0.52 && t[0][1] < -0.4 && t[1][1] >= -0.27 && t[1][1] < -0.15 && t[2][1] >= -0.05 && t[2][1] < 0.03, JSON.stringify(t));
    if (name !== '소형 세로') {
      // 상태별 점멸: 강제로 err를 맞춘 상태를 만들어 애니메이션을 검사
      // 같은 게이트로 err를 맞춘 상태를 만든다(게이트가 몇 개 없어 매번 새로 찾지 않음): 접근 중인 게이트를 잡고 cart.t를 옮겨 판정 오차를 지정
      await page.evaluate(() => {
        const c = Game.cart; let n = 0;
        while (n++ < 60 * 120) { c.leanInput = 0; Game._fixedUpdate(1 / 60); const g = c.gateTiming(); if (g && g.err > -0.78 && g.err < -0.6) break; }
        window.__setErr = err => { const g = c.gateTiming(); const tPerSec = Math.max(0.1, c.speed * Cart.speedScale * c.tScale) / Game.track.lengthM; c.t += g.dT - (-(err + 0.05) * tPerSec); UI.updateHUD(c, Game.track); return c.gateTiming(); };
      });
      const gt = await page.evaluate(() => { const g = Game.cart.gateTiming(); return { perfect: g.perfect, good: g.good }; });
      const state = async errSec => {
        await page.evaluate(e => window.__setErr(e), errSec);
        await page.waitForTimeout(80);
        return page.evaluate(() => {
          const wrap = document.getElementById('boostWrap'); const anims = wrap.getAnimations({ subtree: true }).filter(a => a.playState === 'running' && !(a.animationName || '').match(/brFlash/));
          const info = anims.map(a => { const t = a.effect.getTiming(), kf = a.effect.getKeyframes(); const stepped = kf.some(k => /steps/.test(String(k.easing)));
            const colors = kf.filter(k => k.offset < 1).map(k => k.stroke).filter(Boolean); const changes = stepped ? colors.filter((c, i) => i === 0 || c !== colors[i - 1]).length : 0; // steps 애니메이션: 색이 바뀌는 횟수(마지막 100% 키프레임 중복 제외)
            return { name: a.animationName, dur: t.duration, stepped, colors, perSec: stepped ? changes / (t.duration / 1000) : 1000 / t.duration }; });
          const ring = getComputedStyle(document.getElementById('brRing')), out = getComputedStyle(document.getElementById('brOut'));
          return { cls: [...wrap.classList].join(' '), info, ringW: parseFloat(ring.strokeWidth), outW: parseFloat(out.strokeWidth), ringStroke: ring.stroke, stars: getComputedStyle(wrap.querySelector('.br-stars')).opacity };
        });
      };
      const miss = await state(-0.7), good = await state(-(gt.perfect + gt.good) / 2), perfect = await state(-0.02);
      check(`부스트 ${name}: Miss 구간(링 멀리)에는 점멸·애니메이션 없음, 별 없음`, !/ready|perfect-now/.test(miss.cls) && miss.info.length === 0 && parseFloat(miss.stars) === 0, JSON.stringify(miss));
      check(`부스트 ${name}: Good 구간은 은은하게 구분(노란 링, 점멸 없음)`, /ready/.test(good.cls) && !/perfect-now/.test(good.cls) && good.info.length === 0, JSON.stringify(good));
      const maxHz = Math.max(...perfect.info.map(i => i.perSec));
      const red = perfect.info.flatMap(i => i.colors).map(parseColor).filter(Boolean).filter(([r, g, b]) => r > 200 && g < 90 && b < 90);
      check(`부스트 ${name}: Perfect 점멸은 초당 3회 이하(최대 ${maxHz.toFixed(2)}회/초, 애니메이션 ${perfect.info.length}개), 강한 빨강 없음`, /perfect-now/.test(perfect.cls) && perfect.info.length >= 3 && maxHz <= 3.01 && red.length === 0, JSON.stringify(perfect));
      check(`부스트 ${name}: Perfect는 색 외에 모양도 바뀜(링 두꺼워짐 ${good.ringW}→${perfect.ringW}, 맥동 애니메이션, 별 반짝임)`, perfect.ringW > good.ringW + 3 && perfect.info.some(i => /Pulse/i.test(i.name)) && parseFloat(perfect.stars) === 1 && perfect.info.some(i => /Twinkle/i.test(i.name)), JSON.stringify([good.ringW, perfect.ringW, perfect.info.map(i => i.name)]));
      // reduced-motion: 점멸 없이 고정된 무지개빛 테두리
      await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(100);
      const rm = await state(-0.02);
      check(`부스트 ${name}: reduced-motion이면 점멸 없이 고정 무지개빛 테두리`, /perfect-now/.test(rm.cls) && rm.info.length === 0 && /brRainbow/.test(rm.ringStroke) && rm.ringW > good.ringW + 3, JSON.stringify(rm));
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
    const res = await page.evaluate(() => { UI._showPopResult('perfect'); return parseFloat(getComputedStyle(document.getElementById('gatePopResult')).fontSize); });
    check(`부스트 ${name}: 판정 글자 48px 이상`, res >= 48, String(res));
    check(`boost ${name} page error 0`, errors.length === 0, errors.join('|'));
    await close();
  }
});

// ── 1-1 안내 요소 겹침: 팝업(+판정)·랩 배너·판정 토스트·밸런스 게이지·조작 버튼·HUD가 서로 겹치지 않음 (세로·가로, 피니쉬 순간처럼 동시에 뜰 때)
section('overlap', async () => {
  for (const [name, w, h] of [['세로', 375, 667], ['가로', 667, 375]]) {
    const { page, errors, close } = await start({ browser: BROWSER, w, h, init: { rc_derail: 'on' } });
    await loadStage(page, 0);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('cart-launched', { detail: { strength: 1, flickMultiplier: 1 } })));
    await page.evaluate(() => {
      document.getElementById('gatePop').classList.add('on'); document.getElementById('balGauge').classList.add('on');
      UI.showLapBanner('FINAL LAP', true); UI.flashSignal('GOOD', 'good'); UI._showPopResult('perfect');
    });
    await page.waitForTimeout(100);
    const r = await page.evaluate(() => {
      document.querySelectorAll('.lap-banner, #judgeToast, #gatePopResult').forEach(e => { e.style.animation = 'none'; e.style.opacity = '1'; e.style.transform = e.id === 'gatePopResult' ? 'translate(-50%, -50%)' : 'none'; }); // 팝 애니메이션(확대·회전)을 멈춰 자리 잡은 모습으로 측정
      const R = (sel, pad = 0) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width }; };
      const popLabel = R('#gatePop'), lbl = R('#gatePopLabel');
      const pop = { l: popLabel.l, r: popLabel.r, t: popLabel.t, b: Math.max(popLabel.b, lbl ? lbl.b : 0) };
      // 글자 영역은 줄 박스가 화면 폭 전체라 실제 글자 폭(range)으로 계산
      const textBox = sel => { const e = document.querySelector(sel); const rg = document.createRange(); rg.selectNodeContents(e); const b = rg.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      const boxes = { banner: textBox('.lap-banner'), judge: textBox('#judgeToast'), popResult: textBox('#gatePopResult') };
      const others = { 팝업: pop, 게이지: R('#balGauge'), 버튼: R('.lean-btns'), 부스트: R('#boostBtn'), 상단: R('.hud-row'), 컨트롤: R('.hud-controls') };
      const hit = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const bad = [];
      for (const k of ['banner', 'judge']) {
        for (const [on, o] of Object.entries(others)) if (hit(boxes[k], o)) bad.push(`${k}×${on}`);
      }
      if (hit(boxes.banner, boxes.judge)) bad.push('banner×judge');
      return { bad, boxes, W: innerWidth, H: innerHeight };
    });
    check(`overlap ${name}: 랩 배너·판정 토스트가 팝업·게이지·버튼·HUD와 겹치지 않음`, r.bad.length === 0 && r.boxes.banner.r - r.boxes.banner.l > 50 && r.boxes.judge.r - r.boxes.judge.l > 30, JSON.stringify(r)); // 빈 박스로 통과하지 않게 폭도 확인
    check(`overlap ${name} page error 0`, errors.length === 0, errors.join('|'));
    await close();
  }
});

// ── 6 실제 입력 시나리오(합성 PointerEvent — Chromium/WebKit 공통): 출발(당겼다 밀어 올리기) → 밸런스 버튼 램프 → 부스트 판정 → 양손 동시 입력 → 회전 시 해제
section('input', async () => {
  const { page, errors, close } = await start({ browser: BROWSER, init: { rc_derail: 'off' } });
  await loadStage(page, 0);
  const ev = (sel, type, id, x, y) => page.evaluate(([sel, type, id, x, y]) => {
    const el = document.querySelector(sel); const b = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, bubbles: true, cancelable: true, clientX: x ?? b.left + b.width / 2, clientY: y ?? b.top + b.height / 2 }));
  }, [sel, type, id, x, y]);
  // 출발: 스타트 바에서 아래로 당겼다가 위로 빠르게
  const bar = await page.evaluate(() => { const b = document.getElementById('startBar').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 40 }; });
  await ev('#startBar', 'pointerdown', 1, bar.x, bar.y);
  for (let i = 1; i <= 8; i++) { await ev('#startBar', 'pointermove', 1, bar.x, bar.y + i * 14); await page.waitForTimeout(16); }
  for (let i = 1; i <= 4; i++) { await ev('#startBar', 'pointermove', 1, bar.x, bar.y + 112 - i * 30); await page.waitForTimeout(12); }
  await page.waitForTimeout(200);
  const launched = await page.evaluate(() => ({ l: Game.cart.launched, sp: Game.cart.speed }));
  check('입력: 스타트 바 당겼다 밀어 올리기 → 발사', launched.l && launched.sp > 3, JSON.stringify(launched));
  await page.waitForSelector('#boostBtn');
  // 균형 바: 손가락 위치로 노브가 따라가고(+0.7), 다른 손가락 BOOST를 눌렀다 떼도 유지, 두 번째 손가락이 바를 눌러도 무시, 첫 손가락을 떼면 0.3초에 0
  const rail = await page.evaluate(() => { const b = document.getElementById('balRail').getBoundingClientRect(); return { l: b.left, w: b.width, y: b.top + b.height / 2 }; });
  const X = v => rail.l + (v + 1) / 2 * rail.w;
  await ev('#balGauge', 'pointerdown', 1, X(0), rail.y); await ev('#balGauge', 'pointermove', 1, X(0.7), rail.y); await page.waitForTimeout(350);
  const lean1 = await page.evaluate(() => Game.cart.leanInput);
  await ev('#boostBtn', 'pointerdown', 2); await page.waitForTimeout(80); await ev('#boostBtn', 'pointerup', 2); await page.waitForTimeout(150);
  const lean2 = await page.evaluate(() => Game.cart.leanInput);
  await ev('#balGauge', 'pointerdown', 3, X(-0.9), rail.y); await page.waitForTimeout(250);
  const lean3 = await page.evaluate(() => Game.cart.leanInput);
  await ev('#balGauge', 'pointerup', 3, X(-0.9), rail.y);
  await ev('#balGauge', 'pointerup', 1, X(0.7), rail.y); await page.waitForTimeout(450);
  const lean4 = await page.evaluate(() => Game.cart.leanInput);
  check('입력: 바 끌기 → +0.7, 다른 손가락 BOOST·바 터치는 영향 없음, 놓으면 0', Math.abs(lean1 - 0.7) < 0.06 && Math.abs(lean2 - 0.7) < 0.06 && Math.abs(lean3 - 0.7) < 0.06 && Math.abs(lean4) < 0.02, `${lean1.toFixed(2)} ${lean2.toFixed(2)} ${lean3.toFixed(2)} ${lean4.toFixed(2)}`);
  // 부스트 판정: 게이트가 정타일 때 BOOST 누름 → Perfect
  const near = await page.evaluate(() => {
    Game.engine.stopRenderLoop(); const c = Game.cart; let key = null, n = 0;
    while (n++ < 60 * 120) { c.leanInput = 0; Game._fixedUpdate(1 / 60); const g = c.gateTiming(); if (g && g.err > -0.4 && g.err < 0) key = g.key; if (g && g.key === key && g.err >= -0.012) break; if (c.isFinished) return null; }
    return c.gateTiming().err;
  });
  await ev('#boostBtn', 'pointerdown', 3); await ev('#boostBtn', 'pointerup', 3);
  const gate = await page.evaluate(() => { const r = Game.cart._gateResults; return r.length ? r[r.length - 1].result : 'none'; });
  check('입력: BOOST 탭 정타 → perfect', near !== null && gate === 'perfect', `err=${near} → ${gate}`);
  // 회전: 가로로 바뀌면 눌려 있던 입력 해제
  await ev('#balGauge', 'pointerdown', 4, X(0.7), rail.y); await page.waitForTimeout(150);
  await page.setViewportSize({ width: 667, height: 375 }); await page.waitForTimeout(500);
  const rel = await page.evaluate(() => ({ lean: Game.cart.leanInput, held: Game.input.pointers().length }));
  check('입력: 회전하면 눌려 있던 버튼 해제', rel.held === 0 && Math.abs(rel.lean) < 0.7, JSON.stringify(rel));
  check('input page error 0', errors.length === 0, errors.join('|'));
  await close();
});

// ── 1-A 모달 팝업 전수: 세로·가로·데스크톱에서 높이 ≤ 화면 1/2, 정중앙, 폭 규칙, 본문 16px 이상, 넘침 없음, 터치 44px — 페이지별 스크린샷은 /tmp/ride-it-popups
section('popups', async () => {
  const fs = await import('node:fs'); const OUTP = '/tmp/ride-it-popups'; fs.mkdirSync(OUTP, { recursive: true });
  const POPUPS = {
    settings: () => UI.showSettings(), graphics: () => UI.showGraphics(), howto: () => UI.showHowTo(), credits: () => UI.showCredits(),
    pause: () => UI.showPauseOverlay(), tutorialAsk: () => UI.showTutorialAsk(), tutorialDone: () => UI.showTutorialDone(), loadError: () => UI.showLoadError(() => {}), fail: () => UI.showFail(0),
    tutCard: () => Popup.open({ id: 'tutCard', title: '균형 바 읽는 법', meta: '2/6', cancelable: false, blocks: [Popup.fig(UI.gaugeDiagram()), Popup.p(Tutorial._text('balanceCard'))], actions: [{ id: 'tutOkBtn', label: t('tutorial.ok'), primary: true }] }),
  };
  const table = {};
  for (const [orient, w, h] of [['세로', 375, 667], ['가로', 667, 375], ['데스크톱', 1280, 720]]) {
    const { page, errors, close } = await start({ browser: BROWSER, w, h, init: { rc_derail: 'on' } });
    await page.evaluate(() => Game.loadTutorial()); await page.waitForSelector('#startBar'); await page.waitForTimeout(300);
    for (const name of Object.keys(POPUPS)) {
      await page.evaluate(([n]) => { Popup.closeAll(); window.__open = null; }, [name]);
      await page.evaluate(([n, src]) => { new Function('UI', 'Popup', 'Tutorial', 'Game', 't', `(${src})()`)(UI, Popup, Tutorial, Game, t); }, [name, POPUPS[name].toString()]);
      await page.waitForSelector('.popup', { timeout: 5000 });
      await page.waitForTimeout(260);
      let pageNo = 0, total = 1;
      for (;;) {
        const m = await page.evaluate(([W, H, orient]) => {
          const panel = document.querySelector('.popup:last-of-type') || document.querySelector('.popup');
          const pops = [...document.querySelectorAll('.popup')]; const pn = pops[pops.length - 1];
          const r = pn.getBoundingClientRect(), body = pn.querySelector('.popup-body');
          const expectW = orient === '가로' || W > H ? Math.min(0.7 * W, 560) : Math.min(0.88 * W, 420);
          const blocks = [...pn.querySelectorAll('.popup-block:not([hidden])')];
          const bb = body.getBoundingClientRect();
          const small = [];
          for (const b of blocks) for (const el of [b, ...b.querySelectorAll('*')]) {
            if (el.children.length && !el.matches('p, b, span, small, a')) continue;
            const txt = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (!txt) continue;
            if (el.closest('svg') || el.closest('.popup-meta')) continue;
            const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 16) small.push(`${el.tagName}.${el.className}:${fs}`);
          }
          const overflow = blocks.some(b => b.getBoundingClientRect().bottom > bb.bottom + 1) || body.scrollHeight > body.clientHeight + 1;
          const tiny = [...pn.querySelectorAll('button, [role=switch]')].filter(b => b.offsetParent !== null).map(b => b.getBoundingClientRect()).filter(q => q.height < 43.5 || q.width < 43.5).length;
          const dots = pn.querySelectorAll('.popup-dots i').length;
          const wb = getComputedStyle(blocks[0] || body).wordBreak;
          return { h: r.height, maxH: H / 2, cx: (r.left + r.right) / 2 - W / 2, cy: (r.top + r.bottom) / 2 - H / 2, w: r.width, expectW, inView: r.left >= 0 && r.top >= 0 && r.right <= W && r.bottom <= H, small, overflow, tiny, pages: dots || 1, wb, title: pn.querySelector('.popup-title').textContent };
        }, [w, h, orient]);
        total = m.pages;
        const tag = `${orient} ${name} ${pageNo + 1}/${total}`;
        await page.screenshot({ path: `${OUTP}/${BROWSER}_${orient}_${name}_${pageNo + 1}.png` });
        check(`popup ${tag}: 높이 ≤ 화면 1/2 (${Math.round(m.h)}/${Math.round(m.maxH)}px), 정중앙(오차 ${m.cx.toFixed(1)}, ${m.cy.toFixed(1)}), 폭 ${Math.round(m.w)}≈${Math.round(m.expectW)}, 화면 안`,
          m.h <= m.maxH + 0.5 && Math.abs(m.cx) <= 1.5 && Math.abs(m.cy) <= 1.5 && Math.abs(m.w - m.expectW) <= 2 && m.inView, JSON.stringify(m));
        check(`popup ${tag}: 본문 16px 이상·넘침 없음·터치 44px·keep-all`, !m.small.length && !m.overflow && m.tiny === 0 && m.wb === 'keep-all', JSON.stringify({ small: m.small, overflow: m.overflow, tiny: m.tiny, wb: m.wb }));
        if (pageNo >= total - 1) break;
        await page.click('.popup .popup-next'); pageNo++; await page.waitForTimeout(80);
      }
      (table[name] ||= {})[orient] = total;
    }
    check(`popups ${orient} page error 0`, errors.length === 0, errors.join('|'));
    await close();
  }
  console.log('PAGES ' + JSON.stringify(table));
  fs.writeFileSync(`${OUTP}/pages_${BROWSER}.json`, JSON.stringify(table, null, 1));
});

// ── 1-A 글꼴: 자체 호스팅 서브셋(Noto Sans KR·Jua)이 실제로 적용되고, 외부 글꼴 요청이 없고, 쓰는 글자가 서브셋에 다 있음
section('fonts', async () => {
  const { execSync } = await import('node:child_process'); const fsx = await import('node:fs'); const pth = await import('node:path');
  const { ROOT } = await import('./polish-lib.mjs');
  const { page, errors, close } = await start({ browser: BROWSER });
  const reqs = []; page.on('request', r => reqs.push(r.url()));
  await page.reload(); await page.waitForFunction(() => window.UI && window.STAGES);
  await page.evaluate(() => UI.showSettings()); await page.waitForTimeout(600);
  const f = await page.evaluate(async () => {
    await document.fonts.ready;
    await document.fonts.load('16px "Jua"'); const loaded = [...document.fonts].filter(x => x.status === 'loaded').map(x => `${x.family}`);
    const el = document.querySelector('.popup-title'); const cs = getComputedStyle(el);
    return { loaded, family: cs.fontFamily, weight: cs.fontWeight, w700: document.fonts.check('700 16px "Noto Sans KR"'), w400: document.fonts.check('400 16px "Noto Sans KR"'), jua: document.fonts.check('16px "Jua"') };
  });
  check('글꼴: Noto Sans KR·Jua 서브셋이 로드됨(font-face loaded)', f.loaded.includes('Noto Sans KR') && f.loaded.includes('Jua'), JSON.stringify(f));
  check('글꼴: 팝업 제목 font-family가 Noto Sans KR 우선, 폴백 체인 포함', /^"?Noto Sans KR"?,.*(-apple-system).*("?Apple SD Gothic Neo"?).*sans-serif/.test(f.family), f.family);
  const ext = reqs.filter(u => /fonts\.(googleapis|gstatic)\.com/.test(u));
  check('글꼴: Google Fonts 외부 요청 없음', ext.length === 0, ext.join(','));
  const woff = reqs.filter(u => /\.woff2$/.test(u));
  check('글꼴: woff2는 같은 출처에서 받음(2개)', woff.length >= 2 && woff.every(u => u.includes('localhost')), woff.join(','));
  const sizes = ['NotoSansKR-subset.woff2', 'Jua-subset.woff2'].map(n => fsx.statSync(pth.join(ROOT, 'assets/fonts', n)).size);
  check(`글꼴: 서브셋 용량 합계 ${Math.round(sizes.reduce((a, b) => a + b, 0) / 1024)}KB (300KB 이하)`, sizes.reduce((a, b) => a + b, 0) < 300 * 1024, String(sizes));
  check('글꼴: OFL 라이선스 파일 포함', ['OFL-NotoSansKR.txt', 'OFL-Jua.txt'].every(n => fsx.existsSync(pth.join(ROOT, 'assets/fonts', n))));
  let cov = ''; try { cov = execSync('python3 tools/make-fonts.py --check', { cwd: ROOT }).toString(); check('글꼴: 소스에서 쓰는 글자가 서브셋에 모두 있음', true); } catch (e) { check('글꼴: 소스에서 쓰는 글자가 서브셋에 모두 있음', false, String(e.stdout || e.message).slice(0, 200)); }
  check('fonts page error 0', errors.length === 0, errors.join('|'));
  await close();
});

// ── 5 시점 버튼 + HUD 겹침: 오른쪽 가장자리 약 36% 높이·터치 48~52px·반투명→누르면 불투명·아이콘이 지금 시점을 알려줌·키보드 C,
//    그리고 모든 HUD 요소(칩·버튼·균형 바·부스트·타이밍 표시)가 서로 겹치지 않고 화면 안에 있음 (세로·가로·작은 폰·데스크톱)
section('hud', async () => {
  for (const [name, w, h] of [['세로', 375, 667], ['가로', 667, 375], ['소형 세로', 320, 568], ['데스크톱', 1280, 720]]) {
    const { page, errors, close } = await start({ browser: BROWSER, w, h, init: { rc_derail: 'on', rc_quality: 'medium' } });
    await loadStage(page, 0);
    const pre = await page.evaluate(() => ({ dis: document.getElementById('cameraToggleBtn').disabled }));
    await page.evaluate(() => { Game.engine.stopRenderLoop(); Game.input._launch(1, 1); Game.camera.unlockToggle(); }); // 실제 입력 경로로 발사(키보드 C가 발사 뒤에만 동작)
    // 커브 안으로 옮겨 균형 바(목표·띠)를 켜고, 모든 HUD 표시를 한꺼번에 보이게
    await page.evaluate(() => {
      const c = Game.cart, seg = Game.track.segmentRanges.find(x => x.requiredLean > 0); c._finalizeCurve(); c.t = seg.tStart + (seg.tEnd - seg.tStart) * 0.3; Cart.speedScale = 0.02;
      for (let i = 0; i < 30; i++) { c.leanInput = (seg.curveDirection === 'left' ? -1 : 1) * 0.5; Game._fixedUpdate(1 / 60); }
      window.dispatchEvent(new CustomEvent('derail', { detail: { count: 1, left: 2 } })); c.derails = 1; c.combo = 12;
      UI.updateHUD(c, Game.track); document.getElementById('gatePop').classList.add('on'); UI._showPopResult('perfect');
      const bar = document.getElementById('balResult'); bar.textContent = 'GOOD'; bar.className = 'bal-result show good';
    });
    await page.waitForTimeout(200); // 활성화 전환(opacity) 끝난 뒤
    const view0 = await page.evaluate(() => ({ dis: document.getElementById('cameraToggleBtn').disabled, op: getComputedStyle(document.getElementById('cameraToggleBtn')).opacity, icon: document.getElementById('cameraToggleBtn').innerHTML.length, mode: Game.camera.mode }));
    await page.click('#cameraToggleBtn'); await page.waitForTimeout(110);
    const view1 = await page.evaluate(() => ({ target: Game.camera._manualTarget, flash: document.getElementById('viewFlash').textContent, flashOp: getComputedStyle(document.getElementById('viewFlash')).opacity, pressedOp: getComputedStyle(document.getElementById('cameraToggleBtn')).opacity }));
    await page.evaluate(() => { for (let i = 0; i < 60; i++) Game._fixedUpdate(1 / 60); UI.updateHUD(Game.cart, Game.track); }); // 전환(0.65초) 진행 후 아이콘 갱신
    const view2 = await page.evaluate(() => ({ mode: Game.camera.mode, icon: document.getElementById('cameraToggleBtn').innerHTML }));
    await page.evaluate(() => { document.getElementById('cameraToggleBtn').classList.remove('pressed'); }); await page.keyboard.press('c'); await page.waitForTimeout(100);
    const view3 = await page.evaluate(() => ({ target: Game.camera._manualTarget, flash: document.getElementById('viewFlash').textContent }));
    const box = await page.evaluate(() => { const b = document.getElementById('cameraToggleBtn').getBoundingClientRect(); return { w: b.width, h: b.height, rightGap: innerWidth - b.right, topRatio: b.top / innerHeight, cy: (b.top + b.bottom) / 2 / innerHeight }; });
    check(`시점 버튼 ${name}: 발사 전 비활성, 발사 후 활성`, pre.dis && !view0.dis, JSON.stringify([pre, view0]));
    check(`시점 버튼 ${name}: 터치 영역 48~52px, 오른쪽 가장자리, 화면 높이 30~40% 지점`, box.w >= 48 && box.w <= 52 && box.h >= 48 && box.h <= 52 && box.rightGap >= 8 && box.rightGap <= 24 && box.cy >= 0.28 && box.cy <= 0.45, JSON.stringify(box));
    check(`시점 버튼 ${name}: 평소 반투명, 누르면 불투명`, parseFloat(view0.op) < 0.9 && parseFloat(view1.pressedOp) > 0.95, JSON.stringify([view0.op, view1.pressedOp]));
    check(`시점 버튼 ${name}: 누르면 반대 시점으로 + 이름 표시, 아이콘이 지금 시점으로 바뀜`, view1.target === 1 && view1.flash === '1인칭' && parseFloat(view1.flashOp) > 0.5 && view2.mode === 'first' && view0.mode === 'third' && view2.icon.includes('circle'), JSON.stringify([view1, view2.mode]));
    check(`시점 버튼 ${name}: 키보드 C로도 바뀜(3인칭 이름 표시)`, view3.target === 0 && view3.flash === '3인칭', JSON.stringify(view3));
    await page.evaluate(() => { const f = document.getElementById('viewFlash'); f.classList.remove('show'); f.style.opacity = '1'; f.style.animation = 'none'; f.textContent = '1인칭'; }); // 겹침 검사: 이름 표시도 보이게
    const lay = await page.evaluate(() => {
      const R = sel => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
      const els = { 바퀴칩: '#lapChip', 속도칩: '#speedo', 콤보칩: '#comboChip', 하트: '#hearts', 소리: '#soundToggleBtn', 일시정지: '#pauseBtn', 시점: '#cameraToggleBtn', 시점이름: '#viewFlash', 균형바: '#balGauge', 균형결과: '#balResult', 부스트: '#boostBtn', 타이밍표시: '#gatePop' };
      const rects = Object.fromEntries(Object.entries(els).map(([k, q]) => [k, R(q)]));
      const hit = (a, b) => a && b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
      const names = Object.keys(rects).filter(k => rects[k]); const bad = [];
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (hit(rects[names[i]], rects[names[j]])) bad.push(`${names[i]}×${names[j]}`);
      const W = innerWidth, H = innerHeight; const out = names.filter(k => rects[k].l < -0.5 || rects[k].t < -0.5 || rects[k].r > W + 0.5 || rects[k].b > H + 0.5);
      const small = ['소리', '일시정지', '시점', '부스트'].filter(k => rects[k] && (rects[k].r - rects[k].l < 43.5 || rects[k].b - rects[k].t < 43.5));
      return { bad, out, small, n: names.length, missing: Object.keys(rects).filter(k => !rects[k]) };
    });
    await page.screenshot({ path: `/tmp/ride-it-popups/hud_${BROWSER}_${name}.png` }).catch(() => {});
    check(`HUD 겹침 ${name}: ${lay.n}개 요소가 서로 안 겹치고 화면 안(소리·일시정지·시점·부스트 44px 이상)`, !lay.bad.length && !lay.out.length && !lay.small.length && lay.n >= 11, JSON.stringify(lay));
    check(`hud ${name} page error 0`, errors.length === 0, errors.join('|'));
    await close();
  }
});

// ── 1-B 문구: 금지어·strings.js 밖의 한글·설정값 숫자 직접 표기·긴 문장이 없음 (check-wording.mjs), 모든 모달 가로 4페이지 이하
section('wording', async () => {
  const { execSync } = await import('node:child_process'); const { ROOT } = await import('./polish-lib.mjs'); const pth = await import('node:path');
  let out = '', ok = true;
  try { out = execSync('node check-wording.mjs', { cwd: pth.join(ROOT, '.claude/skills/run-ride-it') }).toString(); } catch (e) { ok = false; out = String(e.stdout || e.message); }
  check('문구: 금지어·strings.js 밖의 한글·설정값 숫자 직접 표기·긴 문장 없음(check-wording.mjs)', ok, out.split('\n').filter(l => /^FAIL/.test(l)).slice(0, 4).join(' | '));
  const fsx = await import('node:fs'); const file = '/tmp/ride-it-popups/pages_' + BROWSER + '.json';
  if (fsx.existsSync(file)) { const t = JSON.parse(fsx.readFileSync(file, 'utf8')); const over = Object.entries(t).filter(([, v]) => v['가로'] > 4).map(([k, v]) => `${k}:${v['가로']}`); check('문구: 모든 모달이 가로 폰에서 4페이지 이하', over.length === 0, over.join(',')); }
});

// ── 2 타이틀: START가 0.8초 안에 눌림, 로고·버튼·패널 정렬과 안전 영역(세로·가로·데스크톱), 애니메이션은 transform/opacity만, reduced-motion 정지, low 장식 제거, 용량 ≤ 300KB
section('title', async () => {
  const fsx = await import('node:fs'); const pth = await import('node:path'); const { ROOT } = await import('./polish-lib.mjs');
  const bytes = ['js/title.js', 'js/title-logo-data.js', 'css/title.css'].map(f => fsx.statSync(pth.join(ROOT, f)).size);
  check(`타이틀 전용 에셋(js·로고 데이터·css) ${Math.round(bytes.reduce((a, b) => a + b, 0) / 1024)}KB (300KB 이하, 글꼴 제외)`, bytes.reduce((a, b) => a + b, 0) < 300 * 1024, String(bytes));
  const ALLOWED = new Set(['transform', 'translate', 'rotate', 'scale', 'opacity', 'offset', 'easing', 'composite']);
  for (const [name, w, h] of [['세로', 375, 667], ['가로', 667, 375], ['데스크톱', 1280, 720]]) {
    const { page, errors, close } = await start({ browser: BROWSER, w, h, init: { rc_quality: 'medium' } });
    await page.waitForSelector('#titleScreen');
    const t0 = await page.evaluate(() => { const b = document.getElementById('titleStart').getBoundingClientRect(); return { now: performance.now(), w: b.width, h: b.height, fcp: (performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint') || {}).startTime }; });
    await page.waitForTimeout(2800);
    const lay = await page.evaluate(() => {
      const R = q => { const e = document.querySelector(q); const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const logo = R('.t-logo'), start = R('#titleStart'), dock = R('.t-dock'), rib = R('.t-ribbon'), W = innerWidth, H = innerHeight;
      const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const btns = [...document.querySelectorAll('.t-ico, #titleStart')].map(e => e.getBoundingClientRect());
      return { logo, start, dock, W, H, startCx: (start.l + start.r) / 2, dockCx: (dock.l + dock.r) / 2, startDock: hit(start, dock), logoStart: hit(logo, start), logoDock: hit(logo, dock),
        inView: [start, dock].every(b => b.l >= 0 && b.r <= W && b.t >= 0 && b.b <= H), logoX: logo.l >= -2 && logo.r <= W + 2, small: btns.filter(b => b.width < 43.5 || b.height < 43.5).length, h1: logo.h };
    });
    check(`타이틀 ${name}: START가 로드 직후 0.8초 안에 눌림(첫 그림 ${Math.round(t0.fcp || 0)}ms, START ${Math.round(t0.w)}×${Math.round(t0.h)})`, t0.w >= 200 && t0.h >= 60 && t0.now < 4000, JSON.stringify(t0));
    check(`타이틀 ${name}: 로고·START·패널이 화면 안, 서로 안 겹침, 버튼 44px 이상`, lay.inView && lay.logoX && !lay.startDock && !lay.logoStart && !lay.logoDock && lay.small === 0, JSON.stringify(lay));
    if (name === '세로') check('타이틀 세로: START와 패널이 가운데 정렬(오차 2px 이하)', Math.abs(lay.startCx - lay.W / 2) <= 2 && Math.abs(lay.dockCx - lay.W / 2) <= 2, JSON.stringify([lay.startCx, lay.dockCx, lay.W]));
    const anims = await page.evaluate(() => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#titleScreen')).map(a => ({ n: a.animationName || 'waapi', keys: [...new Set(a.effect.getKeyframes().flatMap(k => Object.keys(k)))] })));
    const bad = anims.filter(a => a.keys.some(k => !['transform', 'translate', 'rotate', 'scale', 'opacity', 'offset', 'computedOffset', 'easing', 'composite'].includes(k)));
    check(`타이틀 ${name}: 실행 중 애니메이션 ${anims.length}개가 transform/opacity(translate·rotate 포함)만 사용`, anims.length >= 3 && bad.length === 0, JSON.stringify(bad));
    // START 바로 눌러도 단계 선택으로
    await page.click('#titleStart'); await page.waitForSelector('.stage-btn', { timeout: 5000 });
    check(`타이틀 ${name}: START → 단계 선택`, (await page.locator('.stage-btn[data-index]').count()) === 5);
    check(`title ${name} page error 0`, errors.length === 0, errors.join('|'));
    await close();
  }
  // 아이콘 4개 동작 + reduced-motion + low
  const { page, errors, close } = await start({ browser: BROWSER, w: 375, h: 667, init: { rc_quality: 'low' } });
  await page.waitForSelector('#titleScreen'); await page.waitForTimeout(300);
  const lowHidden = await page.evaluate(() => ['.t-rays', '.t-streak'].every(q => { const e = document.querySelector(q); return !e || getComputedStyle(e).display === 'none'; }));
  check('타이틀 low 프리셋: 햇살·속도선·반짝임 제거', lowHidden);
  for (const [id, sel] of [['titleSettings', '#settingsOverlay'], ['titleHowto', '#howtoOverlay'], ['titleCredits', '#creditsOverlay']]) {
    await page.click('#' + id); await page.waitForSelector(sel, { timeout: 3000 }); await page.evaluate(() => Popup.closeAll());
  }
  check('타이틀: 설정·조작법·크레딧 아이콘이 각 팝업을 엶', true);
  await page.click('#titleTutorial'); await page.waitForSelector('#startBar', { timeout: 30000 });
  check('타이틀: 연습 코스 아이콘이 연습 코스를 시작', await page.evaluate(() => !!window.Tutorial && Tutorial.active));
  await close();
  const rm = await start({ browser: BROWSER, w: 375, h: 667 });
  await rm.page.emulateMedia({ reducedMotion: 'reduce' }); await rm.page.reload(); await rm.page.waitForSelector('#titleScreen'); await rm.page.waitForTimeout(500);
  const rmAnims = await rm.page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#titleScreen')).length);
  const rmPos = await rm.page.evaluate(() => { const g = document.querySelector('.glyph .g-anim'); return getComputedStyle(g).opacity; });
  check('타이틀 reduced-motion: 애니메이션 정지, 로고는 완성된 모습', rmAnims === 0 && parseFloat(rmPos) === 1, `${rmAnims} ${rmPos}`);
  check('타이틀 reduced-motion page error 0', rm.errors.length === 0, rm.errors.join('|'));
  await rm.close();
});

// ── 동시 구간(부스트 가속 지점이 균형 구간 안에 겹침): 위쪽 한 자리 표시 — 배치·크기·겹침·판정 위치 분리·균형 진행 유지·끝나면 원복
section('simul', async () => {
  for (const [name, w, h] of [['세로', 375, 667], ['가로', 667, 375], ['소형', 320, 568]]) {
    const { page, errors, close } = await start({ browser: BROWSER, w, h, init: { rc_derail: 'off', rc_quality: 'medium' } });
    await loadStage(page, 0);
    await page.evaluate(() => { Game.engine.stopRenderLoop(); window.dispatchEvent(new CustomEvent('cart-launched', { detail: { strength: 1, flickMultiplier: 1 } })); Game.cart.launch(1, 1); });
    const step = (n, until) => page.evaluate(([n, until]) => {
      const c = Game.cart; let i = 0;
      while (i++ < n) { const b = c.balanceState; c.leanInput = b ? b.dir * b.target : 0; Game._fixedUpdate(1 / 60); if (until) { const g = c.gateTiming(), bs = c.balanceState; if (bs && g && g.type === 'boost' && g.timeTo <= until) break; } }
      UI.updateHUD(c, Game.track); Game.scene.render();
      const bs = c.balanceState; return { sim: UI._hud.simulOn, prog: bs ? bs.progress : null, timeTo: c.gateTiming() ? c.gateTiming().timeTo : null };
    }, [n, until]);
    const off0 = await step(5);
    check(`동시 ${name}: 평소엔 표시 없음`, off0.sim === false);
    const s0 = await step(20000, 0.75);
    await page.waitForTimeout(700);
    check(`동시 ${name}: 균형 구간 안 가속 지점 0.75초 전에 표시가 켜짐`, s0.sim === true, JSON.stringify(s0));
    const geo = await page.evaluate(() => {
      const R = q => { const e = document.querySelector(q); const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const box = { ring: R('#simRing'), bal: R('#simBal'), ctrl: R('.hud-controls'), view: R('#cameraToggleBtn'), row: R('.hud-row'), realBar: R('#balGauge'), boost: R('#boostBtn'), real: R('#boostWrap') };
      const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const W = innerWidth, H = innerHeight;
      const names = ['ctrl', 'view', 'row', 'realBar', 'boost'];
      const over = names.filter(n => hit(box.ring, box[n]) || hit(box.bal, box[n]));
      const inV = [box.ring, box.bal].every(b => b.l >= 0 && b.r <= W && b.t >= 0 && b.b <= H);
      const mainRingHidden = getComputedStyle(document.querySelector('#boostWrap .boost-ring')).opacity === '0';
      const barW = box.realBar.w, ringFull = parseFloat(getComputedStyle(document.querySelector('#boostWrap')).width);
      const stack = box.ring.b <= box.bal.t + 1 ? 'ring-above' : box.ring.l >= box.bal.r - 1 ? 'bal-left' : 'other';
      return { over, inV, mainRingHidden, ringRatio: box.ring.w / ringFull, balRatio: box.bal.w / barW, stack, ringW: box.ring.w, balW: box.bal.w };
    });
    check(`동시 ${name}: 화면 안·다른 HUD/조작과 안 겹침, BOOST 둘레 링은 위쪽으로 이동`, geo.inV && geo.over.length === 0 && geo.mainRingHidden, JSON.stringify(geo));
    check(`동시 ${name}: 링 = 기존의 80%(${geo.ringRatio.toFixed(2)}), 균형 = 기존 바의 60%(${geo.balRatio.toFixed(2)})`, Math.abs(geo.ringRatio - 0.8) < 0.03 && Math.abs(geo.balRatio - 0.6) < 0.08, JSON.stringify(geo));
    check(`동시 ${name}: 배치 ${name === '세로' || name === '소형' ? '링 위·균형 아래' : '균형 왼쪽·링 오른쪽'}`, name === '가로' ? geo.stack === 'bal-left' : geo.stack === 'ring-above', geo.stack);
    // 판정: 부스트 결과는 링 자리, 균형 결과는 칩 — 겹치지 않음. 부스트 입력이 균형 진행도를 초기화하지 않음
    const pBefore = (await step(1)).prog;
    await page.evaluate(() => { const c = Game.cart; for (let i = 0; i < 600; i++) { const g = c.gateTiming(); if (g && g.err >= -0.01) break; const b = c.balanceState; c.leanInput = b ? b.dir * b.target : 0; Game._fixedUpdate(1 / 60); } UI.updateHUD(c, Game.track); });
    const res = await page.evaluate(() => { const c = Game.cart; const r = c.resolveGate(); window.dispatchEvent(new CustomEvent('gate-result', { detail: { type: 'boost', result: r } })); window.dispatchEvent(new CustomEvent('balance-judge', { detail: 'perfect' })); Game.scene.render(); return r; });
    await page.waitForTimeout(250);
    const pAfter = (await step(1)).prog;
    check(`동시 ${name}: 부스트 입력 뒤에도 균형 진행도 유지(${pBefore?.toFixed(2)} → ${pAfter?.toFixed(2)})`, pBefore !== null && pAfter !== null && pAfter >= pBefore - 0.001, `${pBefore} ${pAfter}`);
    const rr = await page.evaluate(() => { const R = q => { const b = document.querySelector(q).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; }; const a = R('#simRes'), c = R('#sbChip');
      return { res: document.getElementById('simRes').textContent, chip: document.getElementById('sbChip').textContent, gatePopOn: document.getElementById('gatePop').classList.contains('on'), sep: a.r <= c.l || c.r <= a.l || a.b <= c.t || c.b <= a.t }; });
    check(`동시 ${name}: 부스트 결과(${rr.res})는 링 자리, 균형 결과(${rr.chip})는 칩 — 서로 안 가리고 가운데 팝업은 안 뜸`, !!rr.res && !!rr.chip && rr.sep && !rr.gatePopOn, JSON.stringify(rr));
    // 끝나면 원복: 유지 시간 지나고 커브 끝까지
    await page.waitForTimeout(1100); await page.evaluate(() => { const c = Game.cart; let i = 0; while (c.balanceState && i++ < 2000) { c.leanInput = 0; Game._fixedUpdate(1 / 60); } for (let k = 0; k < 90; k++) Game._fixedUpdate(1 / 60); UI.updateHUD(c, Game.track); }); await page.waitForTimeout(500);
    const end = await page.evaluate(() => ({ sim: UI._hud.simulOn, op: getComputedStyle(document.getElementById('simul')).opacity, ring: document.getElementById('boostWrap').classList.contains('simul-moved') }));
    check(`동시 ${name}: 구간이 끝나면 표시가 사라지고 BOOST 둘레 링이 돌아옴`, end.sim === false && end.ring === false && parseFloat(end.op) < 0.05, JSON.stringify(end));
    check(`simul ${name} page error 0`, errors.length === 0, errors.join('|'));
    await close();
  }
});

for (const [name, fn] of sections) {
  if (ONLY && !ONLY.includes(name)) continue;
  try { await fn(); } catch (e) { check(`${name} 실행`, false, String(e.message).split('\n')[0]); }
}
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
