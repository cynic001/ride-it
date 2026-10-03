// 줄바꿈 자동 점검(AGENTS.md UI 규칙): ① 한 단어(공백 기준)가 서로 다른 줄에 걸치면 실패 ② 버튼·칩·탭·세그먼트·배지 라벨이 두 줄 이상이거나 넘치면 실패
export const SCAN = () => {
  const issues = [];
  const nameOf = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''}`;
  const hiddenUp = el => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return true; if (e.hidden || e.classList.contains('ui-ghost') || e.id === 'touchDebug') return true; } return false; };
  // 줄 수: 사각형들의 세로 중심이 글자 높이의 60% 넘게 떨어지면 다른 줄(다른 글꼴로 대체된 글자는 사각형 높이·top이 달라 top 비교는 오탐)
  const lineTops = rects => { const rs = rects.filter(r => r.width > 0.5 && r.height > 0.5); const cs = rs.map(r => ({ c: (r.top + r.bottom) / 2, h: r.height })).sort((a, b) => a.c - b.c); const lines = new Set(); let n = 0, prev = null;
    for (const x of cs) { if (prev === null || x.c - prev.c > 0.6 * Math.min(x.h, prev.h)) n++; lines.add(n); prev = x; } return lines; };
  // 1) 단어 중간 줄바꿈
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement; if (!el || el.closest('script, style, svg, textarea') || hiddenUp(el)) continue;
    const re = /\S+/g; let m;
    while ((m = re.exec(n.nodeValue))) {
      const range = document.createRange(); range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
      const tops = lineTops([...range.getClientRects()]);
      if (tops.size > 1) issues.push({ kind: '단어 중간 줄바꿈', el: nameOf(el), text: m[0] });
    }
  }
  // 2) 라벨 요소: 두 줄 이상 / 넘침
  const SEL = '.btn, .chip, .hud-chip, .seg-btn, .badge, .derail-tag, .gfx-opt, .nav-home, .popup-meta, .hud-btn, .stage-num, .tab, .switch';
  document.querySelectorAll(SEL).forEach(el => {
    if (hiddenUp(el)) return; const r = el.getBoundingClientRect(); if (r.width < 1) return;
    const txt = (el.textContent || '').trim(); if (!txt) return;
    const er = el.getBoundingClientRect(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t;
    while ((t = w.nextNode())) {
      if (!t.nodeValue.trim()) continue;
      let abs = false; for (let e = t.parentElement; e && e !== el; e = e.parentElement) if (getComputedStyle(e).position === 'absolute') abs = true; // MAX 태그처럼 일부러 걸쳐 놓은 요소는 제외
      if (abs) continue;
      const rg = document.createRange(); rg.selectNodeContents(t); const rects = [...rg.getClientRects()].filter(r => r.width > 0.5);
      if (lineTops(rects).size > 1) issues.push({ kind: '라벨 두 줄 이상', el: nameOf(el), text: t.nodeValue.trim().slice(0, 20) }); // 한 덩어리 글자가 두 줄로 쪼개짐(칩 안에서 줄이 다른 요소로 나뉜 건 허용)
      if (rects.some(r => r.right > er.right + 1 || r.left < er.left - 1)) issues.push({ kind: '라벨 넘침', el: nameOf(el), text: t.nodeValue.trim().slice(0, 20) });
    }
  });
  return issues;
};
export const table = rows => rows.length ? ['| 상태 | 크기 | 요소 | 종류 | 문구 |', '|---|---|---|---|---|', ...rows.map(r => `| ${r.state} | ${r.size} | ${r.el} | ${r.kind} | ${r.text} |`)].join('\n') : '(문제 없음)';
