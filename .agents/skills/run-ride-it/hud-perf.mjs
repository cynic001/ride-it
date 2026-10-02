#!/usr/bin/env node
/**
 * hud-perf.mjs — 주행 중 HUD(#uiRoot)가 켜졌을 때/꺼졌을 때 렌더 시간 비교 (low 프리셋, 헤드리스 소프트웨어 렌더라 절대값보다 차이가 의미)
 * 각 조건 4초 동안 requestAnimationFrame 간격 평균(ms)을 번갈아 3회 측정해 중앙값을 낸다.
 * 사용: node hud-perf.mjs [--stage=0] [--q=low]
 */
import { start, loadStage } from './polish-lib.mjs';
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const stages = String(args.stage ?? '0,4').split(',').map(Number);
const q = args.q || 'low';
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
for (const stage of stages) {
  const { page, errors, close } = await start({ init: { rc_quality: q, rc_derail: 'off' } });
  await loadStage(page, stage);
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('cart-launched', { detail: { strength: 1, flickMultiplier: 1 } })); Game.cart.launch(1, 1); });
  await page.waitForTimeout(1000);
  const measure = async on => {
    await page.evaluate(on => { document.getElementById('uiRoot').style.visibility = on ? '' : 'hidden'; document.getElementById('uiRoot').style.display = on ? '' : 'none'; }, on);
    await page.waitForTimeout(300);
    return page.evaluate(() => new Promise(res => { let n = 0, t0 = performance.now(), last = t0; const iv = []; const f = t => { iv.push(t - last); last = t; if (t - t0 < 4000) requestAnimationFrame(f); else res(iv.reduce((a, x) => a + x, 0) / iv.length); }; requestAnimationFrame(f); }));
  };
  const on = [], off = [];
  for (let i = 0; i < 3; i++) { on.push(await measure(true)); off.push(await measure(false)); }
  console.log(`stage${stage + 1} ${q}: HUD 켜짐 ${median(on).toFixed(1)}ms/프레임, 꺼짐 ${median(off).toFixed(1)}ms/프레임, 차이 ${(median(on) - median(off)).toFixed(2)}ms (page error ${errors.length})`);
  await close();
}
