#!/usr/bin/env node
/**
 * contrast-check.mjs — UI 키트(`?ui-kit`)의 대비·상태 구분 자동 점검
 *  - 글자 ≥ 4.5:1 (비활성 상태 글자는 ≥ 3:1 — 점선 테두리·회색 병행)
 *  - 아이콘(svg stroke/fill)과 상태 색 ≥ 3:1
 *  - 그림자만으로 구분되는 컨트롤이 없는지: 같은 그룹의 상태끼리 (색·배경·글자·굵기·테두리/윤곽·아이콘 수·글자 내용)가 모두 같으면 실패
 * 사용: node contrast-check.mjs [--browser=webkit] [--q=low]
 */
import { start } from './polish-lib.mjs';
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const BROWSER = args.browser || 'chromium';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} [${BROWSER}${args.q ? '/' + args.q : ''}] ${n}${ok ? '' : ' — ' + d}`); };
const { page, errors, close } = await start({ browser: BROWSER, w: 800, h: 900, init: args.q ? { rc_quality: args.q } : {}, url: '/index.html?ui-kit' });
await page.waitForSelector('#uiKit');
const res = await page.evaluate(() => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = el => { // 실제 보이는 배경: 조상으로 올라가며 투명도 합성
    const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base); return base;
  };
  const out = { text: [], icon: [], states: {} };
  const cells = [...document.querySelectorAll('.kit-cell')];
  for (const cell of cells) {
    const group = cell.dataset.kit, state = cell.dataset.state;
    const target = cell.firstElementChild;
    const disabled = state === 'disabled' || target.disabled || !!target.querySelector('[disabled]');
    // 글자: 직접 텍스트 노드가 있는 요소
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT); const seen = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue; const el = n.parentElement; if (seen.has(el)) continue; seen.add(el);
      const cs = getComputedStyle(el); const fg = parse(cs.color); const bg = bgOf(el); if (!fg) continue;
      const opacity = parseFloat(cs.opacity); if (opacity === 0) continue; // 켜짐/꺼짐 글자 중 숨겨진 쪽
      let p = el, hidden = false; for (; p && p !== cell; p = p.parentElement) if (parseFloat(getComputedStyle(p).opacity) === 0) hidden = true; if (hidden) continue;
      out.text.push({ group, state, text: n.textContent.trim().slice(0, 14), ratio: +ratio(over(fg, bg), bg).toFixed(2), disabled: disabled || !!el.closest('[disabled]') || !!el.closest('.disabled'), size: parseFloat(cs.fontSize) });
    }
    // 아이콘: data-kit-icon 또는 svg
    for (const s of target.querySelectorAll('svg')) {
      const cs = getComputedStyle(s); if (parseFloat(cs.opacity) === 0) continue; let hidden = false; for (let p = s; p && p !== cell; p = p.parentElement) if (parseFloat(getComputedStyle(p).opacity) === 0) hidden = true; if (hidden) continue;
      const stroke = cs.stroke !== 'none' ? parse(cs.stroke) : null; const fill = (cs.fill !== 'none') ? parse(cs.fill) : null; const bgc = bgOf(s.parentElement);
      // 윤곽선(stroke)이나 채움(fill) 중 하나라도 배경과 3:1이면 모양이 보임(노란 채움 + 남색 윤곽선 조합 허용)
      const rs = [stroke, fill].filter(c => c && c.a > 0).map(c => ratio(c, bgc)); if (!rs.length) continue;
      out.icon.push({ group, state, ratio: +Math.max(...rs).toFixed(2), disabled });
    }
    // 상태 서명(그림자 제외)
    const sigEl = target.matches('button, .stage-btn, .chip, .hud-chip, .badge') ? target : (target.querySelector('button.switch, .seg, .meter, .card, .stat') || target);
    const parts = [sigEl, ...sigEl.querySelectorAll('*')].slice(0, 40).map(e => { const cs = getComputedStyle(e); const op = cs.opacity === '0' ? 'H' : ''; return [getComputedStyle(e, '::before').content, cs.backgroundImage === 'none' ? '' : cs.backgroundImage, cs.strokeDashoffset, cs.display === 'none' ? 'D' : '', cs.color, cs.backgroundColor, cs.fontWeight, cs.borderStyle + cs.borderTopColor, cs.outlineStyle, cs.textDecorationLine, e.children.length ? '' : e.textContent.trim().slice(0, 12), op, cs.fill, cs.stroke, cs.width, cs.transform === 'none' ? '' : 'T'].join('|'); }).join('//');
    (out.states[group] ||= []).push({ state, sig: parts });
  }
  return out;
});
const bad = res.text.filter(t => t.ratio < (t.disabled ? 3 : 4.5));
check(`글자 대비 (${res.text.length}개 중 4.5:1 미만 ${bad.length}개, 비활성은 3:1)`, bad.length === 0, JSON.stringify(bad.slice(0, 6)));
const badI = res.icon.filter(i => i.ratio < 3);
check(`아이콘·상태 색 대비 3:1 (${res.icon.length}개)`, badI.length === 0, JSON.stringify(badI.slice(0, 6)));
// 상태 구분: 눌림/포커스는 모양 신호(그림자·링)가 정의된 별도 상태라 제외
const dup = [];
for (const [g, list] of Object.entries(res.states)) {
  if (g.startsWith('value-')) continue; // 값(진행도) 표시는 상태가 아님
  const cmp = list.filter(x => !['pressed', 'focus', 'pressed-kit'].includes(x.state));
  for (let i = 0; i < cmp.length; i++) for (let j = i + 1; j < cmp.length; j++) if (cmp[i].sig === cmp[j].sig && cmp[i].state !== cmp[j].state) dup.push(`${g}:${cmp[i].state}=${cmp[j].state}`);
}
check('그림자에만 의존하는 상태 구분 없음(색/글자/굵기/윤곽/아이콘 중 하나 이상 다름)', dup.length === 0, dup.join(', '));
const focus = await page.evaluate(() => [...document.querySelectorAll('[data-state="focus"]')].map(c => { const t = c.querySelector('.force-focus') || c.firstElementChild; return { g: c.dataset.kit, sh: getComputedStyle(t).boxShadow }; }));
const badF = focus.filter(f => !(f.sh.includes('rgb(255, 184, 13) 0px 0px 0px 2px') && f.sh.includes('rgb(20, 26, 51) 0px 0px 0px 4px')));
check(`키보드 포커스 링: 노랑 2px + 남색 2px (${focus.length}개)`, focus.length > 0 && badF.length === 0, JSON.stringify(badF));
check('키트 page error 0', errors.length === 0, errors.join('|'));
await close();
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
