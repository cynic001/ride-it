/**
 * title.js — 타이틀 화면 (2차 UI 개선 2번). 스펙: docs/title-디자인-스펙.md
 *  - 로고는 Jua 글리프 외곽선(js/title-logo-data.js, tools/make-logo.py)으로 그린 SVG — 폰트 로딩과 무관, 어떤 배율에서도 선명
 *  - 배경은 2D 레이어(하늘 · 햇살 · 구름 시차 · 먼/가까운 언덕 · 트랙과 달리는 카트 · 속도선). 애니메이션은 transform/opacity만
 *  - 시안 a(풍경) · b(속도) · c(배지) — `?title=b`로 선택(개발용), 기본은 DEFAULT_VARIANT
 */
const Title = {
  DEFAULT_VARIANT: 'b', // 선택 시안: 속도형(개발기록 68번) — a·c는 ?title=a|c 로 비교용

  /** 로고 한 줄 배치: 글자별 크기·기울기·위아래를 달리해 통통 튀는 느낌, 바닥선 정렬 */
  _logoLayout() {
    const G = TITLE_LOGO_DATA.logo; // 떨 어 진 다 !
    const items = [
      { g: 0, s: 1, rot: -3, dy: 14 }, { g: 1, s: 1, rot: 2, dy: -12 }, { g: 2, s: 1, rot: -2, dy: 10 }, { g: 3, s: 1, rot: 3, dy: -8 },
      { g: 4, s: 1, rot: -6, dy: 0, bang: true }, { g: 4, s: 1.2, rot: 3, dy: 0, bang: true }, { g: 4, s: 1.45, rot: -3, dy: 0, bang: true },
    ];
    const BASE = 840, PAD = 130; let x = PAD, minY = Infinity, maxY = -Infinity;
    items.forEach((it, i) => {
      const g = G[it.g]; it.w = g.w * it.s; it.h = g.h * it.s;
      it.x = x; it.y = BASE - it.h + it.dy;
      x += it.w + (it.bang ? 62 : -6);
      minY = Math.min(minY, it.y); maxY = Math.max(maxY, it.y + it.h);
    });
    const shift = PAD - minY; items.forEach(it => { it.y += shift; });
    return { items, W: x + PAD - 40, H: maxY - minY + PAD * 2 + 40, base: BASE + shift + 60 };
  },

  logoSVG() {
    const G = TITLE_LOGO_DATA.logo, L = this._logoLayout();
    const defs = G.map((g, i) => `<path id="lg${i}" d="${g.d}"/>`).join('');
    const glyphs = L.items.map((it, i) => {
      const cx = it.w / 2 / it.s, cy = it.h / it.s;
      const dust = [0.2, 0.5, 0.8].map((f, k) => `<circle class="dust d${k}" cx="${(G[it.g].w * f).toFixed(0)}" cy="${(G[it.g].h - 10).toFixed(0)}" r="${42 + k * 6}"/>`).join('');
      return `<g class="glyph${it.bang ? ' bang' : ''}" style="--i:${i}" transform="translate(${it.x.toFixed(0)} ${it.y.toFixed(0)}) scale(${it.s})">
        <g class="g-anim"><g transform="rotate(${it.rot} ${cx.toFixed(0)} ${cy.toFixed(0)})">
          <use href="#lg${it.g}" class="ext0" transform="translate(26 34)"/><use href="#lg${it.g}" class="ext1" transform="translate(15 20)"/>
          <use href="#lg${it.g}" class="face"/><use href="#lg${it.g}" class="hi"/>
        </g><g class="dusts">${dust}</g></g></g>`;
    }).join('');
    const cxm = L.W / 2;
    return `<svg class="t-logo" viewBox="0 0 ${L.W.toFixed(0)} ${L.H.toFixed(0)}" role="img" aria-label="${t('brand.name')} RIDE IT" style="--drop:${(L.H * 1.5).toFixed(0)}px">
      <defs>${defs}
        <linearGradient id="lgFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE56A"/><stop offset=".55" stop-color="#FFB22E"/><stop offset="1" stop-color="#FF7A1A"/></linearGradient>
        <linearGradient id="lgBang" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF9A8A"/><stop offset=".55" stop-color="#F0483B"/><stop offset="1" stop-color="#D02C24"/></linearGradient>
        <linearGradient id="lgHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <g class="logo-shadow"><ellipse cx="${(cxm + 120).toFixed(0)}" cy="${(L.base + 40).toFixed(0)}" rx="${(L.W * 0.46).toFixed(0)}" ry="${(L.H * 0.075).toFixed(0)}" class="amb"/><ellipse cx="${(cxm + 70).toFixed(0)}" cy="${(L.base + 14).toFixed(0)}" rx="${(L.W * 0.4).toFixed(0)}" ry="${(L.H * 0.032).toFixed(0)}" class="con"/></g>
      ${glyphs}</svg>`;
  },

  /** "RIDE IT" 리본 — 네이비 배지 + 흰 글자(글리프 외곽선) */
  ribbonSVG() {
    const R = TITLE_LOGO_DATA.ride; let x = 0; const sp = [0, 0, 0, 150, 0, 0]; // RIDE | IT 사이 띄어쓰기
    const parts = R.map((g, i) => { const gx = x; x += g.w + 36 + sp[i]; return { g, gx }; });
    const W = x - 36, H = 760, s = 0.9; // 글자 높이 약 700
    const body = parts.map(p => `<path transform="translate(${p.gx} 0)" d="${p.g.d}"/>`).join('');
    const bw = W + 520;
    return `<svg class="t-ribbon" viewBox="0 0 ${bw} ${H + 200}" aria-hidden="true">
      <path class="rb-shadow" d="M120 150 H${bw - 20} L${bw - 120} ${(H + 200) / 2 + 60} L${bw - 20} ${H + 190} H120 L220 ${(H + 200) / 2 + 60} Z"/>
      <path class="rb-body" d="M100 120 H${bw - 40} L${bw - 140} ${(H + 200) / 2 + 30} L${bw - 40} ${H + 160} H100 L200 ${(H + 200) / 2 + 30} Z"/>
      <g class="rb-text" transform="translate(${((bw - W * s) / 2).toFixed(0)} ${(180).toFixed(0)}) scale(${s})">${body}</g></svg>`;
  },

  _cloud(cls, top, w, delay, dur) {
    return `<svg class="t-cloud ${cls}" viewBox="0 0 120 56" style="top:${top}%;width:${w}px;animation-duration:${dur}s;animation-delay:${delay}s" aria-hidden="true">
      <g fill="#cfe4fa"><circle cx="38" cy="38" r="20"/><circle cx="62" cy="30" r="25"/><circle cx="88" cy="38" r="19"/><rect x="26" y="38" width="76" height="22" rx="11"/></g>
      <g fill="#fff"><circle cx="35" cy="33" r="20"/><circle cx="59" cy="25" r="25"/><circle cx="85" cy="33" r="19"/><rect x="23" y="33" width="76" height="22" rx="11"/></g></svg>`;
  },

  /** 카트(오른쪽을 보고 달림): 노랑 차체 + 주황 줄 + 좌석 2개 + 바퀴, 네이비 외곽선, 빛은 왼쪽 위 */
  _cartSVG() {
    return `<g class="t-cart"><g class="cart-in">
      <ellipse cx="3" cy="13" rx="26" ry="4" fill="#141a33" opacity=".28"/>
      <rect x="-24" y="-12" width="48" height="22" rx="8" fill="#B4570F" transform="translate(2 2)"/>
      <rect x="-24" y="-12" width="48" height="22" rx="8" fill="#FFC93A" stroke="#141a33" stroke-width="3"/>
      <rect x="-22" y="0" width="44" height="7" rx="3" fill="#FF7A1A"/>
      <rect x="-16" y="-21" width="13" height="13" rx="5" fill="#E5362B" stroke="#141a33" stroke-width="3"/><rect x="2" y="-21" width="13" height="13" rx="5" fill="#E5362B" stroke="#141a33" stroke-width="3"/>
      <rect x="-13" y="-19" width="5" height="5" rx="2" fill="#fff" opacity=".6"/>
      <circle cx="-14" cy="11" r="5.5" fill="#141a33"/><circle cx="14" cy="11" r="5.5" fill="#141a33"/><circle cx="-14" cy="11" r="2" fill="#cfd6ea"/><circle cx="14" cy="11" r="2" fill="#cfd6ea"/>
    </g></g>`;
  },

  /** 시안별 풍경(viewBox 400×260, 아래 맞춤): 언덕 + 트랙 곡선 + 지지대 + 카트 */
  sceneSVG(v) {
    const track = v === 'b' ? 'M-30 222 C 55 218 108 186 172 126 S 290 38 432 8' : v === 'c' ? 'M-20 215 C 40 215 70 150 120 150 S 190 228 240 228 S 300 170 350 170 S 400 205 420 205'
      : 'M-20 175 C 30 175 58 78 112 78 S 168 196 220 196 S 270 100 326 100 S 384 156 424 156';
    const hills = v === 'b' ? `<path fill="#8fd67a" d="M0 215 C70 195 150 210 230 225 S350 205 400 215 V260 H0Z"/><path fill="#5fc25a" d="M0 238 C80 224 160 236 250 244 S350 232 400 238 V260 H0Z"/>`
      : `<path fill="#8fd67a" d="M0 200 C60 160 120 175 190 195 S330 150 400 185 V260 H0Z"/><path fill="#a6e28f" d="M0 200 C60 160 120 175 190 195 S330 150 400 185" fill-opacity="0" stroke="#b9ec9f" stroke-width="2"/><path fill="#5fc25a" d="M0 228 C70 208 150 218 220 231 S340 210 400 226 V260 H0Z"/>`;
    return `<svg class="t-scene" viewBox="0 0 400 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      ${hills}
      <g class="t-supports" stroke="#141a33" stroke-width="3" stroke-linecap="round"></g>
      <path class="t-track-shadow" d="${track}" fill="none" stroke="#141a33" stroke-opacity=".25" stroke-width="9" transform="translate(4 6)"/>
      <path id="tTrack" d="${track}" fill="none" stroke="#141a33" stroke-width="7" stroke-linecap="round"/>
      <path d="${track}" fill="none" stroke="#FFC93A" stroke-width="2.4" stroke-dasharray="7 7"/>
      ${this._cartSVG()}
      <g class="t-bushes"><circle cx="22" cy="248" r="16" fill="#4aa84a"/><circle cx="40" cy="252" r="12" fill="#58bb55"/><circle cx="372" cy="250" r="17" fill="#4aa84a"/><circle cx="352" cy="254" r="12" fill="#58bb55"/></g>
    </svg>`;
  },

  html(v) {
    const clouds = v === 'c'
      ? this._cloud('far', 9, 90, -18, 80) + this._cloud('near', 62, 150, -40, 46)
      : this._cloud('far', 10, 96, -20, 80) + this._cloud('far', 27, 70, -55, 90) + this._cloud('near', 43, 150, -10, 48) + this._cloud('near', 60, 120, -34, 38);
    const streaks = v === 'b' ? Array.from({ length: 8 }, (_, i) => `<i class="t-streak" style="top:${12 + i * 10}%;animation-delay:${-i * 0.37}s;width:${90 + (i % 3) * 50}px"></i>`).join('') : '';
    const sparkles = v === 'c' ? Array.from({ length: 7 }, (_, i) => `<i class="t-star" style="left:${8 + i * 13}%;top:${6 + (i * 37) % 30}%;animation-delay:${-i * 0.4}s"></i>`).join('') : '';
    const badge = v === 'c' ? `<div class="t-badge"><svg viewBox="0 0 200 200" aria-hidden="true"><g class="t-burst">${Array.from({ length: 16 }, (_, i) => `<path d="M100 100 L${(100 + 118 * Math.cos((i * 22.5 - 5) * Math.PI / 180)).toFixed(1)} ${(100 + 118 * Math.sin((i * 22.5 - 5) * Math.PI / 180)).toFixed(1)} L${(100 + 118 * Math.cos((i * 22.5 + 5) * Math.PI / 180)).toFixed(1)} ${(100 + 118 * Math.sin((i * 22.5 + 5) * Math.PI / 180)).toFixed(1)}Z" fill="${i % 2 ? '#FFD84D' : '#FFB22E'}"/>`).join('')}</g><circle cx="100" cy="100" r="86" fill="#F1EBDD" stroke="#141a33" stroke-width="5"/><circle cx="100" cy="100" r="74" fill="none" stroke="#FFB80D" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/></svg></div>` : '';
    const icon = (id, ico, key) => `<button class="icon-btn t-ico" id="${id}" type="button" aria-label="${t(key)}">${ico}</button><span class="t-ico-label">${t(key)}</span>`;
    return `<div class="screen title-screen v-${v}" id="titleScreen">
      <div class="t-sky"></div><div class="t-rays"></div>${clouds}${streaks}${sparkles}${this.sceneSVG(v)}
      <div class="t-ui">
        <div class="t-logo-wrap">${badge}<div class="logo-float">${this.logoSVG()}</div><div class="t-ribbon-wrap">${this.ribbonSVG()}</div></div>
        <div class="t-actions">
          <button id="titleStart" class="btn primary title-start" type="button">${ICONS.play}<span>${t('title.start')}</span></button>
          <div class="t-dock">
            <div class="t-dock-item">${icon('titleSettings', ICONS.gear, 'title.dock.settings')}</div>
            <div class="t-dock-item">${icon('titleHowto', ICONS.help, 'title.dock.howto')}</div>
            <div class="t-dock-item">${icon('titleTutorial', ICONS.flag, 'title.dock.tutorial')}</div>
            <div class="t-dock-item">${icon('titleCredits', ICONS.info, 'title.dock.credits')}</div>
          </div>
        </div>
      </div>
      <div class="t-studio chip">chaechae studio</div>
    </div>`;
  },

  /** 화면에 넣은 뒤: 지지대·카트 움직임(트랙 곡선을 따라 샘플링한 transform 키프레임) */
  _animate(root) {
    const path = root.querySelector('#tTrack'); if (!path) return;
    const len = path.getTotalLength(), sup = root.querySelector('.t-supports'), cart = root.querySelector('.t-cart');
    let supports = '';
    for (let d = 14; d < len; d += len / 12) { const p = path.getPointAtLength(d); if (p.x > 4 && p.x < 396 && p.y < 240) supports += `<line x1="${p.x.toFixed(1)}" y1="${(p.y + 3).toFixed(1)}" x2="${p.x.toFixed(1)}" y2="248"/>`; }
    sup.innerHTML = supports;
    const N = 64, kf = [];
    for (let i = 0; i <= N; i++) {
      const d = len * i / N, p = path.getPointAtLength(d), q = path.getPointAtLength(Math.min(len, d + 1)), a = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      kf.push({ transform: `translate(${p.x.toFixed(1)}px, ${(p.y - 11).toFixed(1)}px) rotate(${a.toFixed(1)}deg)` });
    }
    const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mid = kf[Math.round(N * (root.classList.contains('v-b') ? 0.42 : root.classList.contains('v-c') ? 0.22 : 0.3))]; cart.style.transform = mid.transform; // 정적일 때 보이는 자리
    if (!still && cart.animate) this._cartAnim = cart.animate(kf, { duration: 9000, iterations: Infinity, easing: 'linear' });
  },

  render(onStart) {
    const v = new URLSearchParams(location.search).get('title') || this.DEFAULT_VARIANT;
    this.variant = ['a', 'b', 'c'].includes(v) ? v : this.DEFAULT_VARIANT;
    UI._setScreen(this.html(this.variant));
    const root = document.getElementById('titleScreen');
    this._animate(root);
    const go = () => { Title._off(); onStart(); };
    root.querySelector('#titleStart').addEventListener('click', go);
    root.querySelector('#titleSettings').addEventListener('click', () => UI.showSettings());
    root.querySelector('#titleHowto').addEventListener('click', () => UI.showHowTo());
    root.querySelector('#titleTutorial').addEventListener('click', () => { Title._off(); Game.loadTutorial(); });
    root.querySelector('#titleCredits').addEventListener('click', () => UI.showCredits());
    this._key = e => { if ((e.key === 'Enter' || e.key === ' ') && document.getElementById('titleScreen') && !document.querySelector('.popup') && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); go(); } };
    document.addEventListener('keydown', this._key);
    return root;
  },
  _off() { if (this._key) { document.removeEventListener('keydown', this._key); this._key = null; } if (this._cartAnim) { this._cartAnim.cancel(); this._cartAnim = null; } },
};
window.Title = Title;
