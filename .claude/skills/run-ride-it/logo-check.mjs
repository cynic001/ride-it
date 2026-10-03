// 타이틀 로고 글자 간격 검사: 글자별 "외곽선까지 포함한" 경계 상자를 정지 상태·입장 연출 마지막 프레임·대기 애니메이션 한 주기(20프레임)에서 측정
//   node logo-check.mjs [--shots]  (--shots: 폭 120/240/480px 비교 이미지 저장)
import { start } from './polish-lib.mjs';
import fs from 'node:fs';
const OUT = process.argv.find(a => a.startsWith('--out='))?.split('=')[1];
export const MEASURE = () => {
  // SVG 좌표(viewBox 단위)로 계산 — 로고 전체의 기울임(rotate)·화면 배율에 영향받지 않음. 글자 = .glyph 7개(떨 어 진 다 ! ! !).
  // 경계 상자 = 글리프 외곽(path bbox)을 글자 변환(이동·회전·크기)으로 옮긴 네 모서리의 AABB + 두께 실루엣(.ext0, 이동 26·34)의 바깥 외곽선(stroke 120 → 바깥 60 × 글자 크기)
  const svg = document.querySelector('.t-logo'); const root = svg.getScreenCTM().inverse();
  const boxes = [...document.querySelectorAll('.t-logo .glyph')].map(g => {
    const u = g.querySelector('.ext0'); const bb = document.querySelector(u.getAttribute('href')).getBBox();
    const m = root.multiply(u.getScreenCTM()); const sc = Math.hypot(m.a, m.b); const pad = 60 * sc;
    const pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { l: Math.min(...xs) - pad, r: Math.max(...xs) + pad, t: Math.min(...ys) - pad, b: Math.max(...ys) + pad, h: bb.height * sc, sc };
  });
  const T = 60; // 외곽선 두께(바깥쪽, 글자 크기 1배 기준 viewBox 단위)
  const gaps = boxes.slice(0, -1).map((a, i) => { const b = boxes[i + 1]; return { gx: b.l - a.r, gy: Math.max(b.t - a.b, a.t - b.b), i }; });
  return { T, boxes, gaps, hMax: Math.max(...boxes.map(b => b.h)) };
};
export async function measureLogo(page) {
  const out = {};
  await page.evaluate(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { /* 무한 애니메이션 */ } }); });
  await page.evaluate(() => { for (const a of document.getAnimations()) { if (a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.t-logo-wrap')) a.pause(); } });
  out.still = await page.evaluate(MEASURE);
  // 입장 연출 마지막 프레임: 마지막 글자 애니메이션의 끝(= 착지·찌그러짐이 끝난 순간)
  out.entry = await page.evaluate(() => { const gl = [...document.querySelectorAll('.t-logo .g-anim')]; gl.forEach(g => g.getAnimations().forEach(a => { a.pause(); a.currentTime = a.effect.getComputedTiming().endTime; })); return null; }) ?? await page.evaluate(MEASURE);
  // 대기 애니메이션(둥실) 한 주기를 20프레임으로
  out.idle = [];
  for (let f = 0; f < 20; f++) {
    await page.evaluate(f => { for (const a of document.getAnimations()) { if (a.animationName === 'tFloat') { a.pause(); a.currentTime = 1900 + (f / 20) * 6400; } } }, f);
    out.idle.push(await page.evaluate(MEASURE));
  }
  return out;
}
// 요구: 어떤 이웃 글자 쌍도 외곽선 포함 상자가 겹치지 않음(gx ≥ 0 또는 gy ≥ 0), 다↔! 사이는 외곽선 두께 2배 + 글자 높이 8% 이상
export const judge = m => {
  const bad = [];
  m.gaps.forEach(g => { if (g.gx < 0 && g.gy < 0) bad.push(`글자${g.i}↔${g.i + 1} 겹침(${g.gx.toFixed(1)})`); });
  const da = m.gaps[3]; const need = 2 * m.T + 0.08 * m.boxes[3].h; // 다(3) ↔ 첫 !(4): 외곽선 두께 2배 + 글자(다) 높이의 8%
  if (da.gx < need) bad.push(`다↔! 간격 ${da.gx.toFixed(1)} < ${need.toFixed(1)}`);
  return bad;
};
if (process.argv[1].endsWith('logo-check.mjs')) {
  const { page, close } = await start({ w: 375, h: 667, init: { rc_quality: 'low' }, url: '/index.html?title=b' });
  await page.waitForSelector('.t-logo'); await page.waitForTimeout(500);
  const r = await measureLogo(page);
  for (const [name, m] of [['정지', r.still], ['입장 끝', r.entry], ...r.idle.map((m, i) => [`대기#${i}`, m])]) { const bad = judge(m); if (bad.length || name === '정지') console.log(name, bad.length ? bad.join('; ') : 'OK', JSON.stringify(m.gaps.map(g => +g.gx.toFixed(1))), 'T', m.T.toFixed(1), 'hMax', m.hMax.toFixed(1)); }
  await close();
}
