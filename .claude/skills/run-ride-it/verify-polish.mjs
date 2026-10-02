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
    const { page, errors, close } = await start({ browser: BROWSER, init: { rc_laps: String(laps) } });
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

for (const [name, fn] of sections) {
  if (ONLY && !ONLY.includes(name)) continue;
  try { await fn(); } catch (e) { check(`${name} 실행`, false, String(e.message).split('\n')[0]); }
}
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
