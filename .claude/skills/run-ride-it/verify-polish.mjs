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
  const expect = { 1: ['FINISH!'], 2: ['FINAL LAP', 'FINISH!'], 3: ['LAP 2/3', 'FINAL LAP', 'FINISH!'] };
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
    check(`lap ${laps}랩 FINAL LAP/FINISH는 마지막 랩에서만`, out.filter(x => x.t === 'FINAL LAP' || x.t === 'FINISH!').every(x => x.lap === laps), JSON.stringify(out));
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
        const c = document.querySelector('#tutCard .card'), b = c.getBoundingClientRect();
        out.push({ key, top: Math.round(b.top), bottom: Math.round(b.bottom), H: innerHeight, scroll: c.scrollHeight > c.clientHeight, fs: parseFloat(getComputedStyle(c.querySelector('p')).fontSize) });
        document.getElementById('tutCard').remove(); Tutorial.hold = false;
      }
      return out;
    });
    for (const c of cards) check(`tutorial ${name} 카드 ${c.key}: 화면 안, 글 16px 이상`, c.top >= 0 && c.bottom <= c.H && !c.scroll && c.fs >= 16, JSON.stringify(c));
    const note = await page.evaluate(() => Tutorial._text('balanceCard').includes('레일에서 이탈할 수 있어요 (설정에서 끌 수 있어요)'));
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
  check('상세 화면: 1랩 ON → 1234', t1.includes('1,234') && t1.includes('1랩'), t1);
  check('상세 화면: 3랩 ON → 2000, 3랩 이탈 OFF → 3000 + OFF 표시', t3.includes('2,000') && t3off.includes('3,000') && t3off.includes('이탈 OFF') && tag === '이탈 OFF', `${t3} | ${t3off} | ${tag}`);
  check('상세 화면: 다시 1랩 ON → 1234 (설정 저장 유지)', t1b.includes('1,234') && await page.evaluate(() => localStorage.getItem('rc_derail')) === 'on', t1b);
  // 결과 화면: 이탈 OFF 3랩 완주 → 같은 조건(3랩·OFF) 기록과 비교, OFF 표시
  await page.evaluate(() => { DerailSettings.set(false); LapsManager.setLaps(2); Game.loadStage(0); }); await page.waitForSelector('#startBar');
  const resTxt = await page.evaluate(() => {
    const c = Game.cart; c.launch(1, 1); let n = 0;
    while (!c.isFinished && n++ < 200000) { c.leanInput = 0; c.update(1 / 60); }
    UI.showResult(c, 0); return { t: document.getElementById('resultScreen').innerText.replace(/\s+/g, ' '), laps: c.totalLaps, rec: ProgressManager.get(STAGES[0].id, 2, false) };
  });
  check('결과 화면: 2랩 · 이탈 OFF 표시 + 그 조건 기록 저장(첫 클리어)', resTxt.t.includes('2랩') && resTxt.t.includes('이탈 OFF') && resTxt.t.includes('첫 클리어') && resTxt.rec && resTxt.rec.plays === 1, JSON.stringify(resTxt).slice(0, 300));
  check('progress page error 0', errors.length === 0, errors.join('|'));
  await close();
});

// ── 1-2 부스트 타이밍 팝업: 화면 폭 40%(세로)/높이 40%(가로), Perfect 범위에서 perfect-now(글로우), 정타 순간 flash, 틱-틱-지금 소리 1회씩, 판정 글자 크게
section('popup', async () => {
  for (const [name, w, h] of [['세로', 375, 667], ['가로', 667, 375]]) {
    const { page, errors, close } = await start({ browser: BROWSER, w, h, init: { rc_derail: 'off' } });
    await loadStage(page, 0);
    const r = await page.evaluate(() => {
      Game.engine.stopRenderLoop();
      const ticks = []; let nowErr = null; const c = Game.cart;
      AudioManager.playTick = f => ticks.push([f, +(c.gateTiming() ? c.gateTiming().err : 9).toFixed(3)]);
      window.dispatchEvent(new CustomEvent('cart-launched', { detail: { strength: 1, flickMultiplier: 1 } }));
      c.launch(1, 1);
      const pop = document.getElementById('gatePop'), flash = document.getElementById('gatePopFlash');
      let key = null, perfectSeen = false, perfectOutside = false, flashSeen = false, size = null, n = 0;
      while (n++ < 60 * 100) {
        c.leanInput = 0; Game._fixedUpdate(1 / 60);
        const g = c.gateTiming();
        if (!g) continue;
        if (key === null && g.err > -0.78 && g.err < 0) key = g.key; // 다가오는 첫 게이트
        if (key === null || g.key !== key) { if (key !== null) break; continue; }
        const inP = Math.abs(g.err) <= g.perfect;
        if (pop.classList.contains('perfect-now') && inP) perfectSeen = true;
        if (pop.classList.contains('perfect-now') && !inP) perfectOutside = true;
        if (flash.classList.contains('go')) flashSeen = true;
        if (!size && pop.classList.contains('on')) { size = { w: pop.offsetWidth, h: pop.offsetHeight, vw: innerWidth, vh: innerHeight }; }
      }
      const res = document.getElementById('gatePopResult'); UI._showPopResult('perfect');
      const fs = parseFloat(getComputedStyle(res).fontSize);
      return { ticks, perfectSeen, perfectOutside, flashSeen, size, fs, quality: QualityManager.current };
    });
    const want = name === '세로' ? 0.4 * 375 : 0.4 * 375; // 세로 40vw = 150, 가로 40vh = 150
    check(`popup ${name}: 크기 = 화면 짧은 변의 약 40%`, r.size && Math.abs(r.size.w - want) < 6 && Math.abs(r.size.h - want) < 6, JSON.stringify(r.size));
    check(`popup ${name}: Perfect 범위 안에서만 perfect-now(글로우)`, r.perfectSeen && !r.perfectOutside, `seen=${r.perfectSeen} outside=${r.perfectOutside}`);
    check(`popup ${name}: 정타 순간 flash`, r.flashSeen);
    const t = r.ticks;
    check(`popup ${name}: 틱-틱-지금 1회씩(−0.5s·−0.25s·−0.03s 부근)`, t.length === 3 && !t[0][0] && !t[1][0] && t[2][0] && t[0][1] >= -0.52 && t[0][1] < -0.4 && t[1][1] >= -0.27 && t[1][1] < -0.15 && t[2][1] >= -0.05 && t[2][1] < 0.03, JSON.stringify(t));
    check(`popup ${name}: 판정 글자 48px 이상`, r.fs >= 48, String(r.fs));
    check(`popup ${name} page error 0`, errors.length === 0, errors.join('|'));
    await close();
  }
});

for (const [name, fn] of sections) {
  if (ONLY && !ONLY.includes(name)) continue;
  try { await fn(); } catch (e) { check(`${name} 실행`, false, String(e.message).split('\n')[0]); }
}
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
