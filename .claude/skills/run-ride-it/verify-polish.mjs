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

for (const [name, fn] of sections) {
  if (ONLY && !ONLY.includes(name)) continue;
  try { await fn(); } catch (e) { check(`${name} 실행`, false, String(e.message).split('\n')[0]); }
}
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
