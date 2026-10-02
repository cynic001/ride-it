/**
 * popup.js — 공통 모달 팝업 컴포넌트 (뉴모픽 raised-lg 크림 패널)
 *  - 높이는 화면 높이의 최대 1/2, 화면 정중앙. 폭은 세로 min(88vw, 420px) / 가로 min(70vw, 560px) (css/ui.css)
 *  - 내용(blocks)은 문단·컨트롤 행·그림 단위로 쪼개 넣고, 화면에 안 들어가면 자동으로 페이지를 나눈다
 *    (측정 → 그리디 패킹, 회전·리사이즈 때 다시 계산). 스크롤로 해결하지 않음.
 *  - 페이지가 둘 이상이면 머리 줄 오른쪽에 점(●○○, 현재 = 노란 채움), 아래 줄에 이전/다음, 마지막 페이지에 확인(actions).
 *  - 키보드: ←/→ 페이지, Enter = 다음(마지막이면 첫 번째 주요 버튼), Esc = 닫기(cancelable일 때), Tab은 팝업 안에서만 순환.
 *  사용: Popup.open({ id, title, meta, blocks: [Popup.p('문장'), Popup.fig(svg), ...], actions: [{ id, label, primary, onClick }], cancelable, onClose })
 */
const Popup = {
  _stack: [],
  GAP: 8, // 블록 사이 간격(css .popup-body gap과 같은 값, 8px 단위)

  /* ── 블록 만들기 도우미 (문구는 호출하는 쪽이 strings.js에서 가져옴) ── */
  p(html, cls = '') { return { html: `<p${cls ? ` class="${cls}"` : ''}>${html}</p>` }; },
  fig(svg) { return { html: svg, cls: 'popup-fig' }; },
  item(icon, title, desc) { return { html: `<div class="popup-item"><span class="ico">${icon}</span><span class="txt"><b>${title}</b>${desc}</span></div>` }; },
  /** 라벨 + 컨트롤 한 줄. 좁은 가로 화면에서는 두 개씩 나란히(half) 놓이고 설명 줄은 숨겨짐 */
  row(label, control, desc = '') { return { html: `<div class="field-row"><span class="field-label">${label}${desc ? `<span class="row-desc">${desc}</span>` : ''}</span>${control}</div>`, cls: 'half' }; },
  raw(html, cls = '') { return { html, cls }; },
  half(html) { return { html, cls: 'half' }; },

  /**
   * @returns {{ el: HTMLElement, close: Function, goto: Function, pages: number }}
   */
  open({ id, title, meta = '', blocks, actions = [], cancelable = true, onClose, center = false }) {
    actions = actions.map((a, i) => ({ ...a, id: a.id || `${id || 'popup'}Act${i}` })); // 모든 버튼에 id(이벤트 연결용)
    const prevFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'screen modal-overlay';
    if (id) overlay.id = id;
    const titleId = `${id || 'popup'}Title`;
    overlay.innerHTML = `
      <div class="popup" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1"${actions.length > 1 ? ' data-multi' : ''}>
        <div class="popup-head">
          ${meta ? `<span class="popup-meta chip">${meta}</span>` : ''}
          <span class="popup-title" id="${titleId}">${title}</span>
          <span class="popup-dots" aria-hidden="true"></span>
        </div>
        <div class="popup-body measuring"></div>
        <div class="popup-foot"></div>
      </div>`;
    const panel = overlay.querySelector('.popup'), body = overlay.querySelector('.popup-body'), foot = overlay.querySelector('.popup-foot'), dots = overlay.querySelector('.popup-dots');
    const els = blocks.map(b => { const d = document.createElement('div'); d.className = `popup-block ${b.cls || ''}${center ? ' center' : ''}`; d.innerHTML = b.html; body.appendChild(d); return d; });
    (UI.root || document.body).appendChild(overlay);

    const ctl = { el: overlay, pages: 1, page: 0, close, goto, layout };
    let pageOf = []; // 블록 인덱스 → 페이지

    /** 페이지 나누기: 팝업을 최대 높이로 두고 본문 가용 높이를 잰 뒤 블록을 차례로 담음 */
    function layout() {
      const keepFirst = ctl.page > 0 ? pageOf.findIndex(p => p === ctl.page) : 0;
      const maxH = Math.floor(window.innerHeight * 0.5);
      panel.classList.add('paged'); panel.style.height = `${maxH}px`;
      body.classList.add('measuring'); els.forEach(e => { e.hidden = false; });
      const H = body.clientHeight;
      panel.style.setProperty('--page-h', `${H}px`);
      // 행 단위로 묶기: 같은 높이 위치(offsetTop)에 놓인 블록(가로 2열)은 한 행
      const rows = [];
      els.forEach((e, i) => { const top = e.offsetTop, last = rows[rows.length - 1]; if (last && Math.abs(last.top - top) <= 1) { last.idx.push(i); last.h = Math.max(last.h, e.offsetHeight); } else rows.push({ top, idx: [i], h: e.offsetHeight }); });
      const pages = []; let cur = [], used = 0;
      rows.forEach(r => {
        const add = cur.length ? this.GAP + r.h : r.h;
        if (cur.length && used + add > H) { pages.push(cur); cur = []; used = 0; }
        used += cur.length ? this.GAP + r.h : r.h; cur.push(...r.idx);
      });
      if (cur.length) pages.push(cur);
      ctl.pages = pages.length || 1;
      pageOf = []; pages.forEach((list, p) => list.forEach(i => { pageOf[i] = p; }));
      if (ctl.pages === 1) { panel.classList.remove('paged'); panel.style.height = ''; }
      body.classList.remove('measuring');
      goto(Math.max(0, Math.min(ctl.pages - 1, keepFirst >= 0 ? pageOf[keepFirst] : 0)));
    }
    layout.call(Popup);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (document.contains(overlay)) layout.call(Popup); }); // 글꼴이 늦게 로드돼도 페이지 나누기를 다시 계산

    function btn(a, cls = '') { return `<button class="btn ${a.primary ? 'primary' : ''} ${cls}" ${a.id ? `id="${a.id}"` : ''} type="button">${a.icon || ''}${a.label}</button>`; }
    function goto(p) {
      ctl.page = p;
      els.forEach((e, i) => { e.hidden = pageOf[i] !== p; });
      dots.innerHTML = ctl.pages > 1 ? Array.from({ length: ctl.pages }, (_, i) => `<i class="${i === p ? 'on' : ''}"></i>`).join('') : '';
      dots.setAttribute('aria-label', ctl.pages > 1 ? `${p + 1} / ${ctl.pages}` : '');
      const last = p === ctl.pages - 1;
      const prev = p > 0 ? '<button class="btn small popup-prev" type="button">이전</button>' : '<span class="spacer"></span>';
      if (ctl.pages === 1) foot.innerHTML = `<span class="actions-wrap">${actions.map(a => btn(a)).join('')}</span>`;
      else if (!last) foot.innerHTML = `${prev}<span class="count popup-count">${p + 1}/${ctl.pages}</span><button class="btn small primary popup-next" type="button">다음</button>`;
      else foot.innerHTML = `${prev}<span class="actions-wrap">${actions.map(a => btn(a)).join('')}</span>`;
      const pv = foot.querySelector('.popup-prev'), nx = foot.querySelector('.popup-next');
      if (pv) pv.addEventListener('click', () => goto(ctl.page - 1));
      if (nx) nx.addEventListener('click', () => goto(ctl.page + 1));
      actions.forEach(a => { const b = a.id ? foot.querySelector(`#${a.id}`) : null; if (b && a.onClick) b.addEventListener('click', e => a.onClick(e, ctl)); });
    }
    function close() {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      overlay.remove();
      Popup._stack = Popup._stack.filter(c => c !== ctl);
      if (!Popup._stack.length) document.body.classList.remove('popup-open');
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
      if (onClose) onClose();
    }
    const onResize = () => layout.call(Popup);
    const onKey = e => {
      if (Popup._stack[Popup._stack.length - 1] !== ctl) return; // 맨 위 팝업만 키를 받음
      if (e.key === 'Escape' && cancelable) { e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight' && ctl.page < ctl.pages - 1) { e.preventDefault(); goto(ctl.page + 1); }
      else if (e.key === 'ArrowLeft' && ctl.page > 0) { e.preventDefault(); goto(ctl.page - 1); }
      else if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button, a, [role=switch]'))) {
        e.preventDefault();
        if (ctl.page < ctl.pages - 1) goto(ctl.page + 1);
        else { const pb = foot.querySelector('.btn.primary'); if (pb) pb.click(); }
      } else if (e.key === 'Tab') { // 포커스 가두기
        const f = [...panel.querySelectorAll('button:not([disabled]), a[href], [role=switch]')].filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], lastEl = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    Popup._stack.push(ctl);
    document.body.classList.add('popup-open'); // 튜토리얼 강조 테두리·손가락이 팝업 위로 비치지 않게(css/hud.css)
    try { panel.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
    return ctl;
  },

  /** 열려 있는 팝업을 모두 닫음(화면 전환 시) */
  closeAll() { [...this._stack].forEach(c => c.close()); },
};
window.Popup = Popup;
