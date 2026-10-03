/**
 * touch-debug.js — 개발 전용 터치 진단 화면 (주소에 ?touch-debug). 기본은 로드되지 않음.
 * 활성 포인터마다 번호 원, 역할(slider/boost/기타), 역할별 down/up/cancel 횟수, gesture 이벤트 발생 여부, 최근 이벤트 10개.
 * 전부 pointer-events: none 오버레이 — 입력에 영향 없음. 이벤트는 window capture 단계에서 읽기만 함.
 */
(() => {
  const dev = document.createElement('div');
  dev.id = 'touchDebug';
  dev.setAttribute('aria-hidden', 'true');
  dev.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;font:12px/1.35 ui-monospace,Menlo,monospace;color:#fff';
  const panel = document.createElement('pre');
  panel.style.cssText = 'position:absolute;left:4px;top:calc(4px + env(safe-area-inset-top,0px));margin:0;padding:6px 8px;border-radius:8px;background:rgba(20,26,51,.82);max-width:70vw;white-space:pre-wrap';
  dev.appendChild(panel);
  document.body.appendChild(dev);

  const roleOf = el => { const r = el && el.closest && el.closest('[data-input-role]'); return r ? r.dataset.inputRole : 'other'; };
  const COL = { slider: '#34C27A', boost: '#FFB80D', other: '#4DA3FF' };
  const active = new Map();                       // pointerId → { n, role, x, y, el }
  const count = { slider: { down: 0, up: 0, cancel: 0, lost: 0 }, boost: { down: 0, up: 0, cancel: 0, lost: 0 }, other: { down: 0, up: 0, cancel: 0, lost: 0 } };
  const gesture = { gesturestart: 0, gesturechange: 0, gestureend: 0, 'contextmenu': 0 };
  const log = [];
  let seq = 0, raf = 0;
  const push = line => { log.unshift(`${(performance.now() / 1000).toFixed(2)} ${line}`); if (log.length > 10) log.pop(); };

  const draw = () => {
    raf = 0;
    dev.querySelectorAll('.td-dot').forEach(e => e.remove());
    for (const [id, p] of active) {
      const d = document.createElement('div');
      d.className = 'td-dot';
      d.style.cssText = `position:absolute;left:${p.x - 28}px;top:${p.y - 28}px;width:56px;height:56px;border-radius:50%;border:3px solid ${COL[p.role]};background:${COL[p.role]}55;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px`;
      d.textContent = p.n;
      dev.appendChild(d);
    }
    const rows = Object.entries(count).map(([r, c]) => `${r.padEnd(6)} down ${c.down}  up ${c.up}  cancel ${c.cancel}  lostcap ${c.lost}`);
    const act = [...active].map(([id, p]) => `#${p.n}(id ${id})=${p.role}`).join('  ') || '-';
    const gs = Object.entries(gesture).map(([k, v]) => `${k.replace('gesture', 'g.')}:${v}`).join(' ');
    const roles = window.Game && Game.input && Game.input.pointers ? Game.input.pointers().map(p => `${p.id}:${p.role}`).join(' ') || '-' : 'n/a';
    panel.textContent = `touch-debug  (원 = 손가락)\n활성: ${act}\n배정: ${roles}\n${rows.join('\n')}\n${gs}\n--\n${log.join('\n')}`;
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };

  const on = (type, fn) => window.addEventListener(type, fn, { capture: true, passive: true });
  on('pointerdown', e => {
    const role = roleOf(e.target);
    active.set(e.pointerId, { n: ++seq, role, x: e.clientX, y: e.clientY });
    count[role].down++; push(`down #${seq} id${e.pointerId} ${role}`); schedule();
  });
  on('pointermove', e => { const p = active.get(e.pointerId); if (p) { p.x = e.clientX; p.y = e.clientY; schedule(); } });
  const end = (kind, label) => e => {
    const p = active.get(e.pointerId);
    if (kind === 'lost') { const r = p ? p.role : roleOf(e.target); count[r].lost++; push(`lostcapture id${e.pointerId} ${r}`); schedule(); return; }
    if (!p) return;
    count[p.role][kind]++; push(`${label} #${p.n} id${e.pointerId} ${p.role}`);
    active.delete(e.pointerId); schedule();
  };
  on('pointerup', end('up', 'up'));
  on('pointercancel', end('cancel', 'CANCEL'));
  on('lostpointercapture', end('lost'));
  ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu'].forEach(t => on(t, () => { gesture[t]++; if (t !== 'gesturechange') push(t); schedule(); }));
  schedule();
})();
