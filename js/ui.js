/**
 * ui.js
 * DOM 오버레이 기반 UI: 타이틀, 스테이지 선택, HUD, 시작 안내, 결과 화면, 품질 설정
 * (Canvas 내부가 아닌 별도 DOM 레이어 — 터치 타겟 확보가 쉽고 CSS로 다루기 편함)
 */

// 랩(턴 반복 횟수) 설정 — QualityManager와 같은 방식으로 localStorage에 저장, main.js가 읽어 Cart에 전달
const LapsManager = {
  current: Number(localStorage.getItem('rc_laps')) || 1, // 기본값 1랩 = 기존과 동일 동작(하위 호환)
  setLaps(n) {
    this.current = n;
    localStorage.setItem('rc_laps', String(n));
  },
};
window.LapsManager = LapsManager;

// 조작 방식(13번: 양손 조작으로 통일) — 'twohand'(기본: 왼쪽 아래 ◀ ▶ + 오른쪽 아래 BOOST) / 'tilt'(◀ ▶ 대신 폰 기울기로 밸런스).
// 예전 저장값 'onehand'(엄지 패드, legacy/onehand-pad.js로 이동)는 'twohand'로 읽음
const CONTROL_MODES = {
  twohand: { label: '버튼 ◀ ▶', desc: '왼쪽 ◀ ▶ 밸런스, 오른쪽 BOOST' },
  tilt: { label: '기울기', desc: '폰을 기울여 밸런스, 부스트는 BOOST 버튼' },
};
const ControlSettings = {
  mode: localStorage.getItem('rc_control') === 'tilt' ? 'tilt' : 'twohand',
  set(mode) {
    if (!CONTROL_MODES[mode]) return;
    this.mode = mode;
    try { localStorage.setItem('rc_control', mode); } catch (e) { /* 무시 */ }
  },
};
window.CONTROL_MODES = CONTROL_MODES;
window.ControlSettings = ControlSettings;

// 레일 이탈(밸런스 Miss 시 커브 밖으로 튕겨 나가 재출발, 3번 이탈하면 실패) — 기본 켜짐. 튜토리얼은 설정과 무관하게 이탈 없음
const DerailSettings = {
  on: localStorage.getItem('rc_derail') !== 'off',
  set(on) {
    this.on = on;
    try { localStorage.setItem('rc_derail', on ? 'on' : 'off'); } catch (e) { /* 무시 */ }
  },
};
window.DerailSettings = DerailSettings;

// 스테이지별 진행 저장 — rc_progress_v2: { [stage.id]: { "L{랩 수}-{on|off}": { cleared, best, rank, plays } } }
// (랩이 많을수록 총점이 높고 이탈 OFF는 더 쉬워서 조건별로 따로 저장·비교. 인덱스가 아닌 id 기준이라 순서가 바뀌어도 유지.
//  나중에 리더보드(Firebase)도 같은 축으로: leaderboards/{stageId}/{L{laps}-{on|off}})
const RANK_ORDER = 'CBAS';
const progressKey = (laps, derail) => `L${laps}-${derail ? 'on' : 'off'}`;
const ProgressManager = {
  _data: (() => {
    try {
      const v2 = JSON.parse(localStorage.getItem('rc_progress_v2'));
      if (v2) return v2;
      // 예전 기록(rc_progress, 1랩·이탈 개념 없음) → 1랩·이탈 ON 기록으로 옮김. 원본 키는 지우지 않음
      const old = JSON.parse(localStorage.getItem('rc_progress')) || {};
      const moved = {};
      for (const id of Object.keys(old)) moved[id] = { [progressKey(1, true)]: old[id] };
      return moved;
    } catch (e) { return {}; }
  })(),
  /** 조건(랩 수, 이탈 설정)별 기록 — 기본은 지금 설정 */
  get(stageId, laps = LapsManager.current, derail = DerailSettings.on) {
    const st = this._data[stageId];
    return (st && st[progressKey(laps, derail)]) || null;
  },
  /** 완주 기록 반영 — 반환값 { firstClear, newBest }(같은 조건 기준)로 결과 화면 배지 결정 */
  record(stageId, score, rank, laps, derail) {
    const key = progressKey(laps, derail);
    const st = this._data[stageId] || (this._data[stageId] = {});
    const prev = st[key];
    const firstClear = !prev;
    const newBest = !!prev && score > prev.best;
    st[key] = {
      cleared: true,
      best: Math.max(score, prev ? prev.best : 0),
      rank: prev && RANK_ORDER.indexOf(prev.rank) > RANK_ORDER.indexOf(rank) ? prev.rank : rank,
      plays: (prev ? prev.plays : 0) + 1,
    };
    try { localStorage.setItem('rc_progress_v2', JSON.stringify(this._data)); } catch (e) { /* 저장 불가(사파리 개인정보 보호 모드 등) — 이번 세션 메모리에만 유지 */ }
    return { firstClear, newBest };
  },
  /** 어떤 조건으로든 클리어한 스테이지 수 */
  get clearedCount() {
    return Object.values(this._data).filter(st => Object.values(st).some(p => p.cleared)).length;
  },
};
window.ProgressManager = ProgressManager;

// 아이콘 — 이모지 대신 인라인 SVG(currentColor로 버튼 색 상속)
const svg = (body, fill = false) =>
  `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${body}</svg>`;
const ICONS = {
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>', true),
  soundOn: svg('<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M16 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12"/>'),
  soundOff: svg('<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><line x1="16" y1="9" x2="21" y2="14"/><line x1="21" y1="9" x2="16" y2="14"/>'),
  camera: svg('<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  arrowUp: svg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/>'),
  arrowRight: svg('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>'),
  swipe: svg('<polyline points="7 8 3 12 7 16"/><polyline points="17 8 21 12 17 16"/><line x1="3" y1="12" x2="21" y2="12"/>'),
  tap: svg('<circle cx="12" cy="9" r="3"/><path d="M12 12v8"/><path d="M6.5 5.5a8 8 0 0 1 11 0"/>'),
  hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5"/><path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L3.3 14a1.5 1.5 0 0 1 2.4-1.8L8 15"/>'),
  sparkle: svg('<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>'),
  repeat: svg('<polyline points="17 2 21 6 17 10"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><polyline points="7 22 3 18 7 14"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><line x1="12" y1="17" x2="12" y2="17.01"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8.01"/>'),
  play: svg('<polygon points="7 4 20 12 7 20"/>', true),
  retry: svg('<polyline points="3 4 3 10 9 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L3 10"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  back: svg('<polyline points="15 5 8 12 15 19"/>'),
  list: svg('<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
};

// 메뉴 배경 — 하늘 그라데이션/햇살/구름 + 코스터 트랙 실루엣(SVG). 타이틀·스테이지 선택 공용
const PILLAR_TOPS = [88, 50, 22, 28, 76, 108, 84, 56, 70, 90]; // 실루엣 곡선의 x=20,60,…,380 지점 높이
const MENU_BG = `
  <div class="menu-bg" aria-hidden="true">
    <div class="rays"></div>
    <div class="cloud" style="top:12%;width:70px;height:26px;animation-duration:46s;animation-delay:-8s"></div>
    <div class="cloud" style="top:24%;width:54px;height:20px;animation-duration:58s;animation-delay:-30s"></div>
    <div class="cloud" style="top:6%;width:44px;height:16px;animation-duration:70s;animation-delay:-50s"></div>
    <svg class="coaster" viewBox="0 0 400 140" preserveAspectRatio="none">
      <path d="M0 140 V96 C40 96 60 20 110 20 C160 20 170 110 220 110 C262 110 270 54 310 54 C350 54 360 92 400 92 V140 Z" fill="#141a33" opacity=".18"/>
      <g stroke="#141a33" stroke-width="3" opacity=".5">
        ${PILLAR_TOPS.map((y, i) => `<line x1="${20 + i * 40}" y1="140" x2="${20 + i * 40}" y2="${y}"/>`).join('')}
      </g>
      <path d="M0 92 C40 92 60 16 110 16 C160 16 170 106 220 106 C262 106 270 50 310 50 C350 50 360 88 400 88" fill="none" stroke="#141a33" stroke-width="7" stroke-linecap="round"/>
      <path d="M0 92 C40 92 60 16 110 16 C160 16 170 106 220 106 C262 106 270 50 310 50 C350 50 360 88 400 88" fill="none" stroke="#ffb80d" stroke-width="2.5" stroke-dasharray="6 6"/>
    </svg>
  </div>`;

const LOGO = (small = false) => `
  <div class="logo${small ? ' small' : ''}">
    <div class="logo-ko">떨어진다<span class="bang">!</span><span class="bang">!</span><span class="bang">!</span></div>
    <div class="logo-en">RIDE IT</div>
  </div>`;

// 부스트 타이밍 팝업(13번): 바깥 원 반지름 = POP_R0 × (1 − err / POP_RANGE) — err(지금 누르면 판정될 오차, 초)가 0인 순간 안쪽 원(POP_R0)과 겹침.
// Good/Perfect 띠는 안쪽 원 둘레에 ±good/±perfect초에 해당하는 두께로 그림 → 판정값과 그림이 같은 식이라 어긋날 수 없음
const POP_R0 = 30, POP_RANGE = 0.8; // viewBox 120 기준 반지름, 팝업이 뜨는 시점 = 중심 도달 0.8초 전
const DERAIL_HITS = 3; // cart.js DERAIL.maxHits와 같은 값(HUD 하트 개수)
const JUDGE_LABEL = { perfect: 'PERFECT!', good: 'GOOD', miss: 'MISS' };
const GATE_LABEL = { boost: 'BOOST', finish: 'FINISH' };

/** 스피드 라인 — 화면 중앙은 비우고 가장자리에서 바깥으로 흐르는 선(만화식 집중선). 2D 캔버스 1장, CSS 픽셀 해상도라
 * DPR 3 기기에서도 부담 없음. 개수는 그래픽 프리셋(speedLineCount)으로 차등 */
const SpeedLines = {
  canvas: null, ctx: null, parts: [], w: 0, h: 0, _clear: true,

  _resize() {
    this.w = this.canvas.width = window.innerWidth;
    this.h = this.canvas.height = window.innerHeight;
  },

  _spawn(p, fresh) {
    p.a = Math.random() * Math.PI * 2;
    p.r = fresh ? 0.35 + Math.random() * 0.7 : 0.35 + Math.random() * 0.1; // 반지름(화면 반대각선 대비)
    p.len = 0.08 + Math.random() * 0.14;
    p.v = 1.2 + Math.random() * 1.6;
    p.wid = 1 + Math.random() * 2;
    return p;
  },

  /** intensity 0~1 — 0이면 한 번 지우고 이후엔 아무것도 안 그림 */
  draw(intensity, dt) {
    if (!this.canvas) {
      this.canvas = document.getElementById('speedLines');
      this.ctx = this.canvas.getContext('2d');
      this._resize();
      window.addEventListener('resize', () => this._resize());
    }
    const n = QualityManager.settings.speedLineCount || 0;
    while (this.parts.length < n) this.parts.push(this._spawn({}, true));
    this.parts.length = n;
    const ctx = this.ctx;
    if (intensity <= 0.02 || !n) {
      if (!this._clear) { ctx.clearRect(0, 0, this.w, this.h); this._clear = true; }
      return;
    }
    this._clear = false;
    ctx.clearRect(0, 0, this.w, this.h);
    const cx = this.w / 2, cy = this.h * 0.45, R = Math.hypot(this.w, this.h) / 2;
    ctx.lineCap = 'round';
    for (const p of this.parts) {
      p.r += p.v * (0.4 + intensity) * dt;
      if (p.r > 1.1) this._spawn(p, false);
      const r0 = p.r * R, r1 = (p.r + p.len * (0.5 + intensity)) * R;
      const c = Math.cos(p.a), s = Math.sin(p.a);
      ctx.strokeStyle = `rgba(255,255,255,${(intensity * 0.55 * Math.min(1, (p.r - 0.35) * 4)).toFixed(3)})`;
      ctx.lineWidth = p.wid;
      ctx.beginPath();
      ctx.moveTo(cx + c * r0, cy + s * r0);
      ctx.lineTo(cx + c * r1, cy + s * r1);
      ctx.stroke();
    }
  },
};
window.SpeedLines = SpeedLines;

const UI = {
  root: null,

  init() {
    this.root = document.getElementById('uiRoot');
  },

  /** 화면 교체 — 직전 화면을 id 없는 복제본(ghost)으로 남겨 페이드 아웃시키고 새 화면은 즉시 렌더
   * (호출부가 innerHTML 직후 getElementById로 바로 이벤트를 붙이므로 교체 자체는 동기로 유지) */
  _setScreen(html) {
    if (this.root.children.length) {
      const ghost = document.createElement('div');
      ghost.className = 'ui-ghost';
      while (this.root.firstChild) ghost.appendChild(this.root.firstChild);
      ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      document.body.appendChild(ghost);
      setTimeout(() => ghost.remove(), 220);
    }
    this.root.innerHTML = html;
  },

  _modal(id, inner, { solid = false } = {}) {
    const el = document.createElement('div');
    el.className = `screen modal-overlay${solid ? ' solid' : ''}`;
    el.id = id;
    el.innerHTML = `<div class="card">${inner}</div>`;
    this.root.appendChild(el);
    return el;
  },

  showTitle(onStart) {
    this._setScreen(`
      <div class="screen title-screen" id="titleScreen">
        ${MENU_BG}
        ${LOGO()}
        <div class="tap-hint">화면을 터치해서 시작</div>
        <div class="studio">chaechae studio</div>
      </div>
    `);
    document.getElementById('titleScreen').addEventListener('click', onStart, { once: true });
  },

  /** 스테이지 선택 — 카드를 누르면 바로 시작하지 않고 상세 화면으로. onStart(i)는 상세의 START에서 호출 */
  showStageSelect(stages, onStart) {
    this._onStart = onStart;
    this._setScreen(`
      <div class="screen stage-select">
        ${MENU_BG}
        <div class="top-nav">
          <button class="icon-btn" id="howtoBtn" aria-label="조작법">${ICONS.help}</button>
          ${LOGO(true)}
          <button class="icon-btn" id="settingsBtn" aria-label="설정">${ICONS.gear}</button>
        </div>
        <div class="progress-summary">클리어 ${ProgressManager.clearedCount} / ${stages.length}</div>
        <div class="stage-list">
          <button class="stage-btn tutorial-btn" id="tutorialStageBtn">
            <span class="stage-num">연습</span>
            <span class="stage-info">
              <span class="stage-name">튜토리얼 · ${TUTORIAL_STAGE.name}</span>
              <span class="stage-motif">${TUTORIAL_STAGE.motif}</span>
            </span>
            <span class="stage-side">${localStorage.getItem('rc_tutorial_done') ? '<span class="badge clear">완료</span>' : '<span class="badge">추천</span>'}</span>
          </button>
          ${stages.map((s, i) => `
            <button class="stage-btn" data-index="${i}">
              <span class="stage-num">${i + 1}</span>
              <span class="stage-info">
                <span class="stage-name">${s.name}</span>
                <span class="stage-motif">${s.motif}</span>
                <span class="stage-meta"><span class="stars">${'★'.repeat(i + 1)}${'☆'.repeat(4 - i)}</span>${s.baseSpeedKmh}km/h</span>
              </span>
              <span class="stage-side">${this._stageBadges(i)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `);

    this.root.querySelectorAll('.stage-btn[data-index]').forEach(btn => {
      btn.addEventListener('click', () => this.showStageDetail(Number(btn.dataset.index)));
    });
    document.getElementById('howtoBtn').addEventListener('click', () => this.showHowTo());
    document.getElementById('settingsBtn').addEventListener('click', () => this.showSettings());
    document.getElementById('tutorialStageBtn').addEventListener('click', () => Game.loadTutorial());

    // 처음 실행: "튜토리얼부터 해볼까요?" (예 / 건너뛰기) — 예전 "최초 1회 자동 조작법 안내"를 대체(조작법 화면은 ? 버튼으로 그대로)
    if (!localStorage.getItem('rc_tutorial_asked') && !localStorage.getItem('rc_tutorial_done')) this.showTutorialAsk();
  },

  /** 스테이지 상세 — 모티브 설명, 최고 기록, 랩 수 선택, START */
  showStageDetail(i) {
    const s = STAGES[i];
    this._setScreen(`
      <div class="screen stage-detail">
        ${MENU_BG}
        <div class="top-nav">
          <button class="icon-btn" id="detailBackBtn" aria-label="뒤로">${ICONS.back}</button>
          <span class="top-title">STAGE ${i + 1}</span>
          <button class="icon-btn" id="settingsBtn" aria-label="설정">${ICONS.gear}</button>
        </div>
        <div class="card detail-card">
          <span class="stage-num big">${i + 1}</span>
          <h2>${s.name}</h2>
          <p class="detail-motif">${s.motif}</p>
          ${s.rollback ? `<p class="detail-warn">⚠ 뒤로 떨어지는 구간이 있어요${s.rollback.mode === 'mash' ? ' — 부스트 연타로 다시 올라가요!' : ' — 부스터가 다시 쏘아 올려줘요'}</p>` : ''}
          <div class="detail-meta"><span class="stars">${'★'.repeat(i + 1)}${'☆'.repeat(4 - i)}</span><span>최고 ${Math.round(s.baseSpeedKmh * 1.5)}km/h</span><button class="derail-tag${DerailSettings.on ? ' on' : ''}" id="derailTag" aria-label="레일 이탈 켜기/끄기">이탈 ${DerailSettings.on ? 'ON' : 'OFF'}</button></div>
          <div class="stats" id="detailStats"></div>
          <div class="field">
            <span class="field-label">랩 수</span>
            <div class="seg" id="lapSeg">
              ${[1, 2, 3].map(n => `<button class="seg-btn${LapsManager.current === n ? ' on' : ''}" data-laps="${n}">${n}랩</button>`).join('')}
            </div>
          </div>
          <div class="actions"><button id="stageStartBtn" class="btn primary wide big">${ICONS.play}START</button></div>
        </div>
      </div>
    `);
    // 최고 기록 칸 — 랩 수·이탈 설정을 바꾸면 그 조건의 기록으로 즉시 갱신
    const renderStats = () => {
      const q = ProgressManager.get(s.id);
      const cond = `${LapsManager.current}랩${DerailSettings.on ? '' : ' · 이탈 OFF'}`;
      document.getElementById('detailStats').innerHTML = `
        <div class="stat"><small>최고 랭크</small><b>${q ? q.rank : '-'}</b></div>
        <div class="stat"><small>최고 점수</small><b>${q ? q.best.toLocaleString() : '-'}</b></div>
        <div class="stat full"><small>${cond} · 플레이 ${q ? q.plays : 0}회</small></div>`;
      const tag = document.getElementById('derailTag');
      tag.textContent = `이탈 ${DerailSettings.on ? 'ON' : 'OFF'}`;
      tag.classList.toggle('on', DerailSettings.on);
    };
    renderStats();
    document.getElementById('derailTag').addEventListener('click', () => { DerailSettings.set(!DerailSettings.on); renderStats(); });
    document.getElementById('detailBackBtn').addEventListener('click', () => this.showStageSelect(STAGES, this._onStart));
    document.getElementById('settingsBtn').addEventListener('click', () => this.showSettings());
    this.root.querySelectorAll('#lapSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
      LapsManager.setLaps(Number(b.dataset.laps));
      this.root.querySelectorAll('#lapSeg .seg-btn').forEach(x => x.classList.toggle('on', x === b));
      renderStats();
    }));
    document.getElementById('stageStartBtn').addEventListener('click', () => {
      // 기울기 모드는 iOS 권한 요청이 사용자 탭 안에서만 가능 — START 탭을 그 제스처로 사용
      if (ControlSettings.mode === 'tilt' && window.InputController && InputController.requestTiltPermission) InputController.requestTiltPermission();
      (this._onStart || (n => Game.loadStage(n)))(i);
    });
  },

  /** 설정 — 그래픽 품질/스타일, 사운드, 조작 방식 + 조작법/크레딧 링크 */
  showSettings() {
    const seg = (key, options, current) => `<div class="seg" data-setting="${key}">${options.map(([v, l]) =>
      `<button class="seg-btn${v === current ? ' on' : ''}" data-value="${v}">${l}</button>`).join('')}</div>`;
    const el = this._modal('settingsOverlay', `
      <h2>설정</h2>
      <div class="field"><span class="field-label">그래픽</span>
        <button class="btn wide graphics-open" id="graphicsBtn">${ICONS.sparkle}<span id="graphicsSummary">${this._graphicsSummary()}</span></button></div>
      <div class="field"><span class="field-label">시점</span>
        ${seg('view', [['third', '3인칭'], ['first', '1인칭']], ViewSettings.mode)}
        <p class="field-desc" id="viewDesc">${this._viewDesc(ViewSettings.mode)}</p></div>
      <div class="field"><span class="field-label">사운드</span>
        ${seg('audio', [['on', '켜기'], ['off', '끄기']], AudioManager.enabled ? 'on' : 'off')}
        <p class="field-desc">소리가 안 나면 무음 모드를 꺼주세요</p></div>
      <div class="field"><span class="field-label">밸런스 조작</span>
        ${seg('control', Object.entries(CONTROL_MODES).map(([k, v]) => [k, v.label]), ControlSettings.mode)}
        <p class="field-desc" id="controlDesc">${CONTROL_MODES[ControlSettings.mode].desc}</p></div>
      <div class="field"><span class="field-label">레일 이탈</span>
        ${seg('derail', [['on', '켜기'], ['off', '끄기']], DerailSettings.on ? 'on' : 'off')}
        <p class="field-desc">커브에 실패하면 이탈! 3번이면 실패</p></div>
      <div class="actions row">
        <button id="settingsHowtoBtn" class="btn">${ICONS.help}조작법</button>
        <button id="creditsBtn" class="btn">${ICONS.info}크레딧</button>
      </div>
      <button id="settingsTutorialBtn" class="btn wide">${ICONS.play}튜토리얼 다시 하기</button>
      <div class="actions"><button id="settingsCloseBtn" class="btn primary wide">닫기</button></div>
    `, { solid: true });
    el.querySelectorAll('.seg').forEach(group => group.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.value;
      group.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('on', x === b));
      const key = group.dataset.setting;
      if (key === 'view') { ViewSettings.set(v); document.getElementById('viewDesc').textContent = this._viewDesc(v); }
      else if (key === 'audio') AudioManager.setEnabled(v === 'on');
      else if (key === 'derail') DerailSettings.set(v === 'on');
      else if (key === 'control') {
        ControlSettings.set(v);
        document.getElementById('controlDesc').textContent = CONTROL_MODES[v].desc;
        if (v === 'tilt' && window.InputController && InputController.requestTiltPermission) InputController.requestTiltPermission(); // 이 탭이 권한 요청 제스처
      }
    })));
    document.getElementById('graphicsBtn').addEventListener('click', () => this.showGraphics());
    document.getElementById('settingsHowtoBtn').addEventListener('click', () => this.showHowTo());
    document.getElementById('creditsBtn').addEventListener('click', () => this.showCredits());
    document.getElementById('settingsTutorialBtn').addEventListener('click', () => { el.remove(); Game.loadTutorial(); });
    document.getElementById('settingsCloseBtn').addEventListener('click', () => el.remove());
  },

  /** 스테이지 카드 오른쪽 배지 — 클리어 시 최고 랭크 + 최고 점수, 미클리어는 NEW */
  _stageBadges(i) {
    const p = ProgressManager.get(STAGES[i].id);
    if (!p) return '<span class="badge">NEW</span>';
    return `<span class="badge rank-badge">${p.rank}</span><span class="badge clear">최고 ${p.best.toLocaleString()}</span>`;
  },

  _qualityLabel() {
    return { low: '낮음', medium: '보통', high: '높음' }[QualityManager.current] || QualityManager.current;
  },

  showHowTo(onClose) {
    const item = (ico, title, desc) => `<div class="howto-item"><span class="ico">${ico}</span><span><b>${title}</b><span>${desc}</span></span></div>`;
    const tilt = ControlSettings.mode === 'tilt';
    const el = this._modal('howtoOverlay', `
      <h2>조작법</h2>
      <div class="howto-list">
        ${item(ICONS.arrowUp, '출발', '스타트 바를 아래로 당겼다가 위로 휙! 많이 당기고 빨리 올릴수록 세게 (키보드 ↓ 충전, ↑ 발사)')}
        ${item(ICONS.swipe, tilt ? '밸런스 — 기울기(현재)' : '밸런스 — 왼쪽 아래 ◀ ▶', tilt
          ? '폰을 커브 방향으로 기울여요'
          : '커브 방향 버튼을 누르고 있으면 기울고, 떼면 돌아와요 (키보드 ← →)')}
        <div class="howto-item legend"><span><b>밸런스 게이지 읽는 법</b>
          <span>▼ 커서를 초록 띠에 넣고 <b class="em">1.5초 연속</b> 버티면 성공! 파란 띠 안이면 Perfect</span>
          <div class="tut-pic">${this.gaugeDiagram()}</div></span></div>
        ${item(ICONS.tap, '부스트 — 오른쪽 아래 BOOST', '바깥 원이 안쪽 원과 겹치는 순간 누르면 PERFECT (키보드 ↑ / Space)')}
        ${item(ICONS.retry, '뒤로 떨어지기', '언덕에서 뒤로 미끄러져요! 부스터가 쏴 주거나 BOOST 연타로 올라가요')}
        ${item(ICONS.camera, '시점', '카메라 버튼으로 잠깐 시점 전환 (고정은 설정에서)')}
        <div class="howto-item legend"><span><b>바닥 표시</b><span class="legend-row">
          <i style="background:#ffc61a"></i>부스트 <i style="background:#59ff8c"></i>커브 방향
          <i style="background:#ff801a"></i>급하강·물 <i style="background:#ff4099"></i>뒤로 떨어짐(2랩부터)</span></span></div>
      </div>
      <p class="field-desc">처음이라면 맨 위 <b>튜토리얼</b>부터!</p>
      <div class="actions"><button id="howtoCloseBtn" class="btn primary wide">알겠어요!</button></div>
    `, { solid: true });
    document.getElementById('howtoCloseBtn').addEventListener('click', () => {
      el.remove();
      localStorage.setItem('rc_howto_seen', '1');
      if (onClose) onClose();
    });
  },

  /** 처음 실행 권유 — 답하면(예/건너뛰기) 다시 묻지 않음 */
  showTutorialAsk() {
    const el = this._modal('tutorialAsk', `
      <div class="ribbon">환영해요!</div>
      <h2>튜토리얼부터 해볼까요?</h2>
      <p>꼬마 열차 연습장에서 출발·밸런스·부스트를 하나씩 직접 해봐요. 1분이면 끝나요.</p>
      <div class="actions">
        <button id="tutAskYes" class="btn primary wide big">${ICONS.play}해볼래요</button>
        <button id="tutAskNo" class="btn wide">건너뛰기</button>
      </div>`);
    const answer = () => { try { localStorage.setItem('rc_tutorial_asked', '1'); } catch (e) { /* 무시 */ } el.remove(); };
    document.getElementById('tutAskYes').addEventListener('click', () => { answer(); Game.loadTutorial(); });
    document.getElementById('tutAskNo').addEventListener('click', answer);
  },

  /** 튜토리얼 완료 — 기록 저장 없이, 1단계로 바로 */
  showTutorialDone() {
    this._setScreen(`
      <div class="screen modal-overlay" id="tutorialDone">
        <div class="card">
          <div class="ribbon">준비 완료!</div>
          <h2>이제 진짜 코스터로!</h2>
          <p>출발 · 밸런스 · 부스트 · 연타 · 피니쉬 모두 해냈어요.</p>
          <div class="actions">
            <button id="tutGoStage1" class="btn primary wide big">${ICONS.play}1단계 출발</button>
            <button id="tutToSelect" class="btn wide">${ICONS.list}스테이지 선택</button>
          </div>
        </div>
      </div>`);
    AudioManager.playSample('cheer', { volume: 0.7 });
    document.getElementById('tutGoStage1').addEventListener('click', () => Game.loadStage(0));
    document.getElementById('tutToSelect').addEventListener('click', () => this.showStageSelect(STAGES, i => Game.loadStage(i)));
  },

  /** 밸런스 게이지 읽는 법 그림(튜토리얼 카드·조작법 공용) — 오른쪽 커브 예시 */
  gaugeDiagram() {
    return `<svg class="diagram" viewBox="0 0 300 150" role="img" aria-label="밸런스 게이지 읽는 법">
      <text x="268" y="34" font-size="24" fill="#3ddc84" stroke="#141a33" stroke-width="4" paint-order="stroke">▶</text>
      <text x="206" y="18" font-size="12" fill="#141a33" text-anchor="end">커브 방향</text>
      <rect x="20" y="50" width="260" height="20" rx="6" fill="#6b7390" stroke="#141a33" stroke-width="2"/>
      <rect x="167" y="52" width="111" height="16" fill="#5dff9a"/>
      <rect x="165.5" y="52" width="3" height="16" fill="#0b3d22"/><polygon points="163,77 171,77 167,71" fill="#2fbf6b"/>
      <rect x="186" y="53" width="52" height="14" rx="4" fill="#2563eb" stroke="#fff" stroke-width="2"/>
      <polygon points="200,34 216,34 208,46" fill="#ffb80d" stroke="#141a33" stroke-width="1.5"/>
      <rect x="206.5" y="44" width="3" height="28" fill="#ffb80d" stroke="#141a33" stroke-width="1"/>
      <rect x="20" y="78" width="260" height="8" rx="4" fill="#c9d0e4"/><rect x="20" y="78" width="170" height="8" rx="4" fill="#3ddc84"/>
      <line x1="150" y1="70" x2="150" y2="76" stroke="#141a33" stroke-width="2"/>
      <text x="150" y="44" font-size="12" fill="#141a33" text-anchor="end">내 기울기 ▼</text>
      <text x="20" y="104" font-size="12" fill="#141a33">아래 막대 = 1.5초 유지 진행도</text>
      <text x="280" y="122" font-size="12" fill="#1f8a4c" text-anchor="end">초록 = 성공(최소선부터 끝까지, 더 기울여도 OK)</text>
      <text x="280" y="140" font-size="12" fill="#2563eb" text-anchor="end">파란 띠 = Perfect(보너스)</text>
    </svg>`;
  },

  /** 부스트 타이밍 팝업 그림 */
  popupDiagram() {
    return `<svg class="diagram" viewBox="0 0 300 140" role="img" aria-label="부스트 타이밍 팝업">
      <g transform="translate(70 70)">
        <circle r="56" fill="rgba(20,26,51,.75)"/><circle r="30" fill="none" stroke="rgba(255,184,13,.8)" stroke-width="16"/>
        <circle r="30" fill="none" stroke="#3ddc84" stroke-width="8"/><circle r="30" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 3"/>
        <circle r="48" fill="none" stroke="#fff" stroke-width="4"/>
        <path d="M0 -48 L0 -36 M-5 -42 L0 -36 L5 -42" stroke="#ffb80d" stroke-width="2.5" fill="none"/>
      </g>
      <text x="140" y="44" font-size="13" fill="#141a33">① 바깥 흰 원이 줄어들어요</text>
      <text x="140" y="74" font-size="13" fill="#141a33">② 안쪽 원과 겹칠 때</text>
      <text x="140" y="96" font-size="15" fill="#d99700">BOOST! = PERFECT</text>
      <text x="140" y="122" font-size="11" fill="#5b6488">노란 띠 안 = GOOD</text>
    </svg>`;
  },

  _viewDesc(m) {
    return m === 'first' ? '계속 카트 좌석 시점' : '부스트·큰 낙하 때만 잠깐 1인칭';
  },

  _graphicsSummary() {
    return `${this._qualityLabel()} · ${STYLES[StyleManager.current].label}`;
  },

  /** 그래픽 팝업 — 품질(Low/Medium/High)과 스타일을 한곳에서. 각 선택지에 설명 한 줄, 스타일은 하늘/지면 색 미리보기 */
  showGraphics() {
    const Q = {
      low: ['낮음', 'SE2 등 저사양용 — 그림자·블러 끔, 프레임 우선'],
      medium: ['보통', '균형 — 가벼운 부스트 블러와 색보정'],
      high: ['높음', '최고 — 실시간 그림자, 모션·방사형 블러, 색수차'],
    };
    const S = {
      standard: '사실적인 조명 + 맑은 하늘(HDRI)',
      toon: '단계형 음영 + 외곽선 + 노을빛 — 고속에서 형태가 가장 또렷',
      pastel: '부드러운 단계형 음영 + 따뜻한 파스텔',
    };
    const preview = k => {
      const st = STYLES[k];
      const sky = st.sky ? `linear-gradient(180deg, ${st.sky.join(',')})` : 'linear-gradient(180deg, #4f8fe0, #cfe6ff)';
      const g = st.ground || [1, 1, 1]; // 잔디 기본색(#5a9a3c)에 스타일 지면 색조를 곱한 색
      const ground = `rgb(${[90, 154, 60].map((c, i) => Math.round(Math.min(255, c * g[i]))).join(',')})`;
      return `<span class="gfx-preview" style="background:${sky}"><span style="background:${ground}"></span>${st.outline ? '<i></i>' : ''}</span>`;
    };
    const opt = (group, k, title, desc, on, extra = '') =>
      `<button class="gfx-opt${on ? ' on' : ''}" data-group="${group}" data-value="${k}">${extra}<span><b>${title}</b><small>${desc}</small></span></button>`;
    const el = this._modal('graphicsOverlay', `
      <h2>그래픽</h2>
      <div class="field"><span class="field-label">품질</span>
        ${Object.entries(Q).map(([k, [t, d]]) => opt('quality', k, t, d, k === QualityManager.current)).join('')}</div>
      <div class="field"><span class="field-label">스타일</span>
        ${Object.keys(STYLES).map(k => opt('style', k, STYLES[k].label, S[k] || '', k === StyleManager.current, preview(k))).join('')}</div>
      <div class="actions"><button id="graphicsCloseBtn" class="btn primary wide">확인</button></div>
    `, { solid: true });
    el.querySelectorAll('.gfx-opt').forEach(b => b.addEventListener('click', () => {
      const { group, value } = b.dataset;
      el.querySelectorAll(`.gfx-opt[data-group="${group}"]`).forEach(x => x.classList.toggle('on', x === b));
      if (group === 'quality') { QualityManager.setPreset(value); if (Game.scene) Game._applyQualitySettings(); }
      else StyleManager.set(value);
      const sum = document.getElementById('graphicsSummary');
      if (sum) sum.textContent = this._graphicsSummary();
    }));
    document.getElementById('graphicsCloseBtn').addEventListener('click', () => el.remove());
  },

  /** 서드파티 에셋 표기 — Kenney/Poly Haven 모두 CC0라 의무는 없지만 감사 표기 */
  showCredits() {
    const el = this._modal('creditsOverlay', `
      <h2>크레딧</h2>
      <div class="credits-list">
        <p><strong>떨어진다!!! RIDE IT</strong><br>chaechae studio</p>
        <div class="tester-card"><small>TESTER</small><b>Chaewon</b></div>
        <p><strong>3D 모델</strong><br>Coaster Kit · Nature Kit — <a href="https://kenney.nl" target="_blank" rel="noopener">Kenney.nl</a> (CC0)</p>
        <p><strong>하늘 HDRI</strong><br>Kloofendal 43d Clear (Pure Sky) — Greg Zaal, <a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a> (CC0)</p>
        <p><strong>효과음</strong><br>환호 "Cheers", "OoOoOo" — Nocturnal_Vanguard<br>물소리 "40 CC0 water / splash / slime SFX" — rubberduck<br>(<a href="https://opengameart.org" target="_blank" rel="noopener">OpenGameArt.org</a>, CC0)<br>음성 Voiceover Pack — <a href="https://kenney.nl" target="_blank" rel="noopener">Kenney.nl</a> (CC0)<br>그 밖의 소리·배경음악은 Web Audio 합성</p>
        <p><strong>엔진</strong><br>Babylon.js</p>
      </div>
      <div class="actions"><button id="creditsCloseBtn" class="btn primary wide">닫기</button></div>
    `, { solid: true });
    document.getElementById('creditsCloseBtn').addEventListener('click', () => el.remove());
  },

  /** 피니쉬 아치 통과 큰 표시 — "LAP 2/3" / "FINAL LAP" / "FINISH!" */
  showLapBanner(text, big) {
    const el = document.createElement('div');
    el.className = `lap-banner${big ? ' big' : ''}`;
    el.textContent = text;
    (this.root || document.body).appendChild(el);
    setTimeout(() => el.remove(), 1800);
  },

  /** 화면 물방울(4·5단계 착수) — 가벼운 DOM 원 몇 개가 번졌다 사라짐 */
  splashDroplets(n) {
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'droplet';
      const sz = 30 + Math.random() * 70;
      d.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 80}%;width:${sz}px;height:${sz}px;animation-delay:${(Math.random() * 0.25).toFixed(2)}s`;
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 2200);
    }
  },

  /** 5단계 착수 물안개 — 흰 막이 확 덮였다 걷힘 + 무지개빛 */
  flashMist() {
    const m = document.createElement('div');
    m.className = 'mist-flash';
    document.body.appendChild(m);
    setTimeout(() => m.remove(), 2200);
  },

  /** 새 버전 안내 — 주행 중에도 방해되지 않게 화면 위 작은 토스트, 누르면 새로고침 */
  showUpdateToast() {
    if (document.getElementById('updateToast')) return;
    const c = window.Game && Game.cart;
    if (c && c.launched && !c.isFinished && !Game.paused && document.getElementById('speedLabel')) { setTimeout(() => this.showUpdateToast(), 2000); return; } // 주행 중엔 문장 안내를 띄우지 않음 — 끝나면 표시
    const el = document.createElement('button');
    el.id = 'updateToast';
    el.className = 'update-toast';
    el.textContent = '새 버전이 있어요 · 탭해서 새로고침';
    el.addEventListener('click', () => location.reload());
    document.body.appendChild(el);
  },

  showLoadingOverlay() {
    this._setScreen(`
      <div class="screen modal-overlay solid" id="loadingOverlay">
        <div class="card loading-card">
          ${LOGO(true)}
          <div class="spinner"></div>
          <p>코스터 준비 중...</p>
        </div>
      </div>
    `);
  },

  showLoadError(retryFn) {
    this._setScreen(`
      <div class="screen modal-overlay solid">
        <div class="card">
          <h2>불러오기 실패</h2>
          <p>에셋을 불러오지 못했어요.<br>네트워크를 확인해주세요.</p>
          <div class="actions"><button id="retryLoadBtn" class="btn primary wide">${ICONS.retry}다시 시도</button></div>
        </div>
      </div>
    `);
    document.getElementById('retryLoadBtn').addEventListener('click', retryFn);
  },

  showPauseOverlay() {
    this._modal('pauseOverlay', `
      <div class="ribbon">일시정지</div>
      <p>잠깐 쉬어가요</p>
      <div class="actions">
        <button id="resumeBtn" class="btn primary wide">${ICONS.play}계속하기</button>
        <button id="pauseExitBtn" class="btn wide">${ICONS.list}스테이지 선택</button>
      </div>
    `);
    document.getElementById('resumeBtn').addEventListener('click', () => Game.resumeGame());
    document.getElementById('pauseExitBtn').addEventListener('click', () => Game.exitToStageSelect());
  },

  hidePauseOverlay() {
    const el = document.getElementById('pauseOverlay');
    if (el) el.remove();
  },

  showStartPrompt(name, motif, { tutorial = false, derail = false } = {}) {
    // 스테이지를 재도전/재선택할 때마다 새로 호출되므로, 직전 호출에서 등록해둔 window 리스너를
    // 먼저 정리 — 그대로 두면 "발사 전에 스테이지 선택으로 돌아가기"를 반복할 때마다 리스너가
    // 계속 쌓이는 누수가 생김
    if (this._pullProgressHandler) window.removeEventListener('pull-progress', this._pullProgressHandler);
    if (this._launchedHandler) window.removeEventListener('cart-launched', this._launchedHandler);
    if (this._gateHandler) window.removeEventListener('gate-result', this._gateHandler);

    this._setScreen(`
      <div class="screen hud">
        <div class="hud-top">
          <div class="progress"><div class="progress-fill" id="progressFill"></div></div>
          <div class="hud-row">
            <span class="stage-chip stage-label">${name}</span>
            <span class="speedo" id="speedo"><span class="max-tag">MAX</span><span class="num" id="speedLabel">0</span><span class="unit">km/h</span><span class="sub turn-label" id="turnLabel"></span></span>
            <span class="combo-chip" id="comboChip"${tutorial ? ' hidden' : ''}><small>COMBO</small><b id="comboLabel">0</b><small class="mult" id="comboMult">×1.0</small></span>
            ${tutorial ? '<button class="tut-skip" id="tutSkipBtn">건너뛰기</button>' : ''}
          </div>
          ${derail ? `<div class="hearts" id="hearts" aria-label="남은 기회">${'<i class="heart">♥</i>'.repeat(DERAIL_HITS)}</div>` : ''}
        </div>
        ${tutorial ? '<div class="tut-banner" id="tutBanner"></div>' : ''}
        <div class="judge" id="judgeToast"></div>
        <div class="rb-overlay" id="rbOverlay"><div class="rb-title" id="rbTitle"></div>
          <div class="rb-gauge" id="rbGauge"><div class="rb-gauge-fill" id="rbGaugeFill"></div></div><div class="rb-sub" id="rbSub"></div></div>
        <div class="timing-pop" id="gatePop">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="tp-bg" cx="60" cy="60" r="56"/>
            <circle class="tp-good" id="gatePopGood" cx="60" cy="60" r="${POP_R0}"/>
            <circle class="tp-perfect" id="gatePopPerfect" cx="60" cy="60" r="${POP_R0}"/>
            <circle class="tp-target" cx="60" cy="60" r="${POP_R0}"/>
            <circle class="tp-ring" id="gatePopRing" cx="60" cy="60" r="${POP_R0 * 2}"/>
          </svg>
          <span class="tp-label" id="gatePopLabel">BOOST</span>
          <div class="tp-result" id="gatePopResult"></div>
        </div>
        <div class="start-bar" id="startBar">
          <div class="start-bar-label" id="startBarLabel">아래로 당겼다가<br>위로 밀어 올려!</div>
          <div class="start-bar-track">
            <div class="start-bar-fill" id="startBarFill"></div>
            <div class="start-bar-handle" id="startBarHandle">${ICONS.arrowUp}</div>
          </div>
          <div class="start-power"><div class="start-power-fill" id="startPowerFill"></div></div>
          <div class="key-hint">키보드: ↓ 누르고 있기 · ↑ 발사</div>
        </div>
        ${this._driveControlsHTML()}
        <div class="hud-controls">
          <button class="hud-icon-btn" id="soundToggleBtn" aria-label="사운드 켜기/끄기">${AudioManager.enabled ? ICONS.soundOn : ICONS.soundOff}</button>
          <button class="hud-icon-btn" id="pauseBtn" disabled aria-label="일시정지">${ICONS.pause}</button>
          <button class="hud-icon-btn camera-toggle" id="cameraToggleBtn" disabled aria-label="시점 전환">${ICONS.camera}</button>
        </div>
      </div>
    `);
    const $ = id => document.getElementById(id);
    this._hud = {
      speed: $('speedLabel'), speedo: $('speedo'), comboMult: $('comboMult'), combo: $('comboLabel'), comboChip: $('comboChip'), turn: $('turnLabel'),
      progress: $('progressFill'), cameraBtn: $('cameraToggleBtn'), pauseBtn: $('pauseBtn'),
      bal: $('balGauge'), balDir: $('balDir'), balBand: $('balBand'), balPerfect: $('balPerfect'), balCursor: $('balCursor'), balMin: $('balMin'), balMinTick: $('balMinTick'), balProg: $('balProg'), balResult: $('balResult'),
      pop: $('gatePop'), popLabel: $('gatePopLabel'), popGood: $('gatePopGood'), popPerfect: $('gatePopPerfect'), popRing: $('gatePopRing'), popResult: $('gatePopResult'), popKey: null, popResultUntil: 0,
      judge: $('judgeToast'), hearts: $('hearts'), lastDerails: 0,
      rb: $('rbOverlay'), rbTitle: $('rbTitle'), rbGauge: $('rbGauge'), rbFill: $('rbGaugeFill'), rbSub: $('rbSub'), lastCombo: 0,
    };

    $('cameraToggleBtn').addEventListener('click', () => {
      if (Game.camera && !Game.camera.locked) Game.camera.toggleMode();
    });
    $('pauseBtn').addEventListener('click', () => Game.pauseGame());
    if (tutorial) $('tutSkipBtn').addEventListener('click', () => Tutorial.skip());
    $('soundToggleBtn').addEventListener('click', () => {
      const next = !AudioManager.enabled;
      AudioManager.setEnabled(next);
      $('soundToggleBtn').innerHTML = next ? ICONS.soundOn : ICONS.soundOff;
    });

    // input.js가 실제 드래그를 받는 스타트 바 DOM — main.js가 InputController에 이 엘리먼트를 넘김
    this.startBarEl = $('startBar');
    const track = this.startBarEl.querySelector('.start-bar-track');
    const fill = $('startBarFill');
    const handle = $('startBarHandle');

    const power = $('startPowerFill');
    const label = $('startBarLabel');
    this._pullProgressHandler = e => {
      const { strength, handle: h, cancelled } = e.detail;
      const travel = Math.max(0, track.clientHeight - handle.clientHeight - 8); // 8 = track 내부 위아래 패딩(4px*2)
      const offset = travel * Math.max(0, Math.min(1, h));
      handle.style.transform = `translateY(${offset}px)`;
      fill.style.height = `${4 + offset + handle.clientHeight / 2}px`;
      power.style.width = `${Math.round(strength * 100)}%`;
      power.classList.toggle('max', strength >= 0.98);
      if (cancelled) { // 위로 밀지 않고 뗌 → 바 복귀 + 안내 흔들기
        label.classList.remove('nudge');
        void label.offsetWidth;
        label.classList.add('nudge');
      }
    };
    // 발사 성공 시: 힌트 텍스트만 사라지는 게 아니라 스타트 바 UI 자체를 화면에서 치우고 HUD로 전환
    this._launchedHandler = () => {
      this.startBarEl.classList.add('launched');
      const dc = $('driveControls');
      if (dc) dc.classList.add('on');
    };
    if (this._fallbackHandler) window.removeEventListener('control-fallback', this._fallbackHandler);
    this._fallbackHandler = () => { // 기울기 센서 불가 → ◀ ▶ 버튼 표시 + 짧은 신호
      const dc = $('driveControls');
      if (dc) dc.classList.remove('tilt');
      this.flashSignal('◀ ▶ 버튼으로');
    };
    window.addEventListener('control-fallback', this._fallbackHandler);
    // 게이트 판정 결과 = 타이밍 팝업 자리에 크게(게이트 없는 곳의 탭 = 'none'은 표시하지 않음)
    this._gateHandler = e => {
      const { result } = e.detail;
      if (!JUDGE_LABEL[result] || !this._hud) return;
      this._showPopResult(result);
    };
    window.addEventListener('pull-progress', this._pullProgressHandler);
    window.addEventListener('cart-launched', this._launchedHandler);
    window.addEventListener('gate-result', this._gateHandler);
    if (this._balJudgeHandler) window.removeEventListener('balance-judge', this._balJudgeHandler);
    this._balJudgeHandler = e => { // 밸런스 판정 확정/실패 — 게이지 위에 짧게
      const r = this._hud && this._hud.balResult;
      if (!r) return;
      r.textContent = JUDGE_LABEL[e.detail];
      r.className = 'bal-result';
      void r.offsetWidth;
      r.className = `bal-result show ${e.detail}`;
    };
    window.addEventListener('balance-judge', this._balJudgeHandler);
  },

  /** 주행 조작 DOM — 왼쪽 아래 ◀ ▶(기울기 모드면 숨김), 오른쪽 아래 BOOST. 발사 전에는 숨겨 두고(스타트 바가 하단 중앙 사용)
   * cart-launched에서 표시. 두 영역은 화면 양 끝(엄지 위치)에 붙이고 가운데를 비워 손가락이 겹치지 않게 */
  _driveControlsHTML() {
    const tilt = ControlSettings.mode === 'tilt';
    return `<div class="drive-controls twohand${tilt ? ' tilt' : ''}" id="driveControls">
      <div class="ctl-left" id="ctlLeft">
        <div class="bal-gauge" id="balGauge" aria-hidden="true">
          <div class="bal-dir" id="balDir"></div>
          <div class="bal-result" id="balResult"></div>
          <div class="bal-bar"><div class="bal-band" id="balBand"></div><div class="bal-min" id="balMin"></div><div class="bal-perfect" id="balPerfect"></div><i class="bal-zero"></i></div>
          <div class="bal-min-tick" id="balMinTick"></div>
          <div class="bal-cursor" id="balCursor"></div>
          <div class="bal-prog"><div class="bal-prog-fill" id="balProg"></div></div>
        </div>
        <div class="lean-btns"><button class="ctl-btn lean" id="leanLeftBtn" aria-label="왼쪽으로 기울이기">◀</button><button class="ctl-btn lean" id="leanRightBtn" aria-label="오른쪽으로 기울이기">▶</button></div>
      </div>
      <div class="ctl-right" id="ctlRight"><button class="ctl-btn boost" id="boostBtn">BOOST</button></div>
    </div>`;
  },

  /** 타이밍 팝업 자리에 판정 결과를 크게(0.7초) — PERFECT! / GOOD / MISS */
  _showPopResult(result) {
    const h = this._hud;
    if (!h || !h.pop) return;
    h.popKey = null;
    h.popResult.textContent = JUDGE_LABEL[result];
    h.popResult.className = `tp-result ${result}`;
    h.pop.classList.add('on', 'result');
    void h.popResult.offsetWidth;
    h.popResult.classList.add('show');
    h.popResultUntil = performance.now() + 700;
  },

  /** 게임을 멈추지 않는 짧은 신호(한두 단어) — 판정 토스트 자리 */
  flashSignal(text, cls = 'good small') {
    const j = this._hud && this._hud.judge;
    if (!j) return;
    j.textContent = text;
    j.className = 'judge';
    void j.offsetWidth;
    j.className = `judge show ${cls}`;
  },

  updateHUD(cart, track) {
    const h = this._hud;
    if (!h || !h.speed.isConnected) return;

    h.speed.textContent = Math.round(cart.speed * 3.6); // m/s → km/h
    h.speedo.classList.toggle('capped', cart.launched && cart.atSpeedCap); // 최고속도 상한 도달 강조
    if (cart.combo !== h.lastCombo) {
      h.combo.textContent = cart.combo;
      h.comboMult.textContent = `×${cart.comboMultiplier.toFixed(1)}`;
      // 콤보는 커브 구간에서 매 틱 오르므로 10단위를 넘을 때만 튀는 연출(매 프레임 애니메이션 재시작 방지)
      if (Math.floor(cart.combo / 10) > Math.floor(h.lastCombo / 10)) {
        h.comboChip.classList.remove('bump');
        void h.comboChip.offsetWidth;
        h.comboChip.classList.add('bump');
      }
      h.lastCombo = cart.combo;
    }
    if (track) {
      const ranges = track.segmentRanges;
      const idx = ranges.findIndex(s => cart.t >= s.tStart && cart.t < s.tEnd);
      const turnNum = idx === -1 ? ranges.length : idx + 1;
      const lapPrefix = cart.totalLaps > 1 ? `Lap ${cart.currentLap}/${cart.totalLaps} · ` : '';
      h.turn.textContent = `${lapPrefix}Turn ${turnNum}/${ranges.length}`;
      const overall = ((cart.currentLap - 1) + Math.min(1, cart.t)) / cart.totalLaps;
      h.progress.style.width = `${(overall * 100).toFixed(1)}%`;

      // 밸런스 게이지(13번): 회색 바 = −1(왼쪽 끝)~+1(오른쪽 끝). 초록 띠 = 성공 범위(최소선~커브 쪽 끝), 파란 띠(흰 테두리) = Perfect,
      // 삼각형 커서 + 세로선 = 지금 내 기울기, 아래 막대 = holdSec초 연속 유지 진행도(범위를 벗어나면 즉시 0)
      const pct = v => (Math.max(-1, Math.min(1, v)) + 1) * 50;
      const bs = cart.launched && !cart.rollback ? cart.balanceState : null;
      if (bs) {
        const a = pct(bs.dir * bs.minLean), b = pct(bs.dir);
        h.balBand.style.left = `${Math.min(a, b).toFixed(1)}%`;
        h.balBand.style.right = `${(100 - Math.max(a, b)).toFixed(1)}%`;
        const p0 = pct(bs.dir * Math.max(bs.minLean, bs.target - bs.perfectRange)), p1 = pct(bs.dir * Math.min(1, bs.target + bs.perfectRange));
        h.balPerfect.style.left = `${Math.min(p0, p1).toFixed(1)}%`;
        h.balPerfect.style.right = `${(100 - Math.max(p0, p1)).toFixed(1)}%`;
        h.balMin.style.left = h.balMinTick.style.left = `${a.toFixed(1)}%`;
        h.balCursor.style.left = `${pct(cart.leanInput).toFixed(1)}%`;
        h.balProg.style.width = `${(bs.progress * 100).toFixed(1)}%`;
        h.balDir.textContent = bs.dir < 0 ? '◀' : '▶';
        h.balDir.classList.toggle('right', bs.dir > 0);
        h.bal.classList.toggle('in', bs.inBand);
        h.bal.classList.toggle('perfect', bs.inBand && bs.perfectNow);
        h.bal.classList.toggle('done', !!bs.done);
        h.bal.classList.add('on');
      } else {
        h.bal.classList.remove('on', 'in', 'perfect', 'done');
      }

      // 부스트 타이밍 팝업: 다가오는 게이트(중심까지 POP_RANGE초 이내)에서 등장, 바깥 원이 줄어 안쪽 원과 겹치는 순간 = 정타.
      // err는 판정 함수(cart.gateTiming, 터치 지연 보정 포함)와 같은 값
      const g = cart.launched && !cart.rollback ? cart.gateTiming() : null;
      const now = performance.now();
      if (g && -g.err <= POP_RANGE + INPUT_LATENCY_OFFSET && g.err <= GATE_ATTEMPT_RANGE) {
        const k = 2 * POP_R0 / POP_RANGE; // 초 → 띠 두께
        h.popLabel.textContent = GATE_LABEL[g.type] || '';
        h.popGood.setAttribute('stroke-width', (k * g.good).toFixed(2));
        h.popPerfect.setAttribute('stroke-width', (k * g.perfect).toFixed(2));
        const r = Math.max(3, POP_R0 * (1 - g.err / POP_RANGE));
        h.popRing.setAttribute('r', r.toFixed(2));
        h.pop.dataset.err = g.err.toFixed(4);
        h.pop.classList.toggle('ready', Math.abs(g.err) <= g.good);
        h.pop.classList.toggle('finish', g.type === 'finish');
        if (h.popKey && h.popKey !== g.key && !cart._resolvedGates.has(h.popKey)) this._showPopResult('miss'); // 앞 게이트를 놓치고 바로 다음 게이트
        if (now >= h.popResultUntil) { h.pop.classList.add('on'); h.pop.classList.remove('result'); }
        h.popKey = g.key;
      } else {
        // 팝업에 떠 있던 게이트를 누르지 않고 지나침 → MISS
        if (h.popKey && !cart._resolvedGates.has(h.popKey) && cart.launched && !cart.rollback) this._showPopResult('miss');
        h.popKey = null;
        if (now >= h.popResultUntil) h.pop.classList.remove('on', 'result');
      }
    }
    // 뒤로 떨어지기 신호: 멈칫/뒤로 = 경고, 연타 = "연타!" + 힘 게이지 + 남은 초, 자동 발사 = 부스터
    const rb = cart.rollback;
    h.rb.classList.toggle('on', !!rb);
    if (rb) {
      const mash = rb.phase === 'mash';
      h.rbTitle.textContent = mash ? '연타!' : rb.phase === 'launch' ? '부스터 발사!' : '뒤로 떨어진다!!!';
      h.rb.classList.toggle('mash', mash);
      h.rbGauge.style.display = mash ? 'block' : 'none';
      if (mash) {
        h.rbFill.style.width = `${Math.round(rb.gauge * 100)}%`;
        const left = Math.max(0, 6 - rb.mashTime);
        h.rbSub.textContent = left.toFixed(1); // 일반 스테이지는 짧은 신호만(13번) — 연타 방법 설명은 튜토리얼에서
      } else h.rbSub.textContent = rb.phase === 'launch' ? '' : '꽉 잡아!';
    }
    if (h.hearts && cart.derails !== h.lastDerails) { // 남은 기회(하트) — 잃는 순간 하나가 튀며 회색으로
      h.lastDerails = cart.derails;
      [...h.hearts.children].forEach((el, i) => {
        const lost = i >= DERAIL_HITS - cart.derails;
        if (lost && !el.classList.contains('off')) { el.classList.remove('lose'); void el.offsetWidth; el.classList.add('lose'); }
        el.classList.toggle('off', lost);
      });
    }
    h.cameraBtn.disabled = !cart.launched;
    h.pauseBtn.disabled = !cart.launched;
  },

  /** 결과 판정 요약 — 랭크는 cart.judgeSummary()(판정 항목만 만점 대비 비율, score-sim과 같은 함수) */
  _summarize(cart, stageData) {
    const bt = cart.balanceTicks;
    const bTotal = bt.perfect + bt.good + bt.miss;
    const balanceAcc = bTotal ? (bt.perfect + bt.good) / bTotal : 1;
    const gates = { perfect: 0, good: 0, miss: 0 };
    cart._gateResults.forEach(g => { gates[g.result] += 1; });
    const j = cart.judgeSummary();
    return {
      rank: j.rank, balanceAcc, gates, judgeRatio: j.ratio, curveCount: j.curves, curvesCleared: cart.curvesCleared || 0,
      gateMissed: Math.max(0, j.gates - gates.perfect - gates.good - gates.miss),
    };
  },

  /** 레일 이탈 3번 — 스테이지 실패(기록 저장 없음) */
  showFail(stageIndex) {
    const stageData = STAGES[stageIndex];
    this._setScreen(`
      <div class="screen modal-overlay" id="failScreen">
        <div class="card result-card">
          <div class="ribbon fail">실패…</div>
          <div class="result-stage">${stageData.name}</div>
          <div class="hearts big" aria-hidden="true">${'<i class="heart off">♥</i>'.repeat(DERAIL_HITS)}</div>
          <p class="fail-text">레일에서 ${DERAIL_HITS}번 이탈했어요</p>
          <div class="actions">
            <button id="retryBtn" class="btn primary wide">${ICONS.retry}다시 도전</button>
            <button id="stageSelectBtn" class="btn wide">${ICONS.list}스테이지 선택</button>
          </div>
        </div>
      </div>
    `);
    document.getElementById('retryBtn').addEventListener('click', () => Game.loadStage(stageIndex));
    document.getElementById('stageSelectBtn').addEventListener('click', () => this.showStageSelect(STAGES, i => Game.loadStage(i)));
  },

  showResult(cart, stageIndex) {
    AudioManager.playResultFanfare();
    const stageData = STAGES[stageIndex];
    const sum = this._summarize(cart, stageData);
    const score = Math.round(cart.score);
    const bd = cart.scoreBreakdown;
    const rec = ProgressManager.record(stageData.id, score, sum.rank, cart.totalLaps, cart.derailEnabled);
    if (rec.newBest) AudioManager.playSample('voice_newbest', { volume: 0.6, delay: 0.9 });
    this._setScreen(`
      <div class="screen modal-overlay" id="resultScreen">
        <div class="card result-card">
          <div class="ribbon">완주!</div>
          <div class="result-stage">${stageData.name}</div>
          <div class="rank ${sum.rank}">${sum.rank}</div>
          <div class="result-score"><small>SCORE</small>${score.toLocaleString()}</div>
          ${rec.firstClear ? '<div class="new-best">첫 클리어!</div>' : rec.newBest ? '<div class="new-best">NEW BEST!</div>' : `<div class="result-stage">최고 ${ProgressManager.get(stageData.id, cart.totalLaps, cart.derailEnabled).best.toLocaleString()}</div>`}
          <div class="result-cond">${cart.totalLaps}랩${cart.derailEnabled ? '' : ' · <span class="off-tag">이탈 OFF</span>'}</div>
          <div class="breakdown">
            ${[
              ['게이트', bd.gate],
              [`밸런스 (커브 ${sum.curvesCleared}/${sum.curveCount})`, bd.balance],
              [`밸런스 Perfect ×${cart.balancePerfects}`, bd.balancePerfect],
              ['콤보 보너스', bd.comboBonus],
              ...(bd.finishBonus > 0 ? [['피니쉬 보너스', bd.finishBonus]] : []),
              ...(bd.mashBonus > 0 ? [['연타 보너스', bd.mashBonus]] : []),
            ].map(([k, v]) => `<div class="bd-row"><span>${k}</span><b>+${Math.round(v).toLocaleString()}</b></div>`).join('')}
            ${cart.derailEnabled ? `<div class="bd-row bd-derail"><span>레일 이탈 ×${cart.derails}</span><b>−${Math.round(bd.derailPenalty).toLocaleString()}</b></div>` : ''}
          </div>
          <div class="stats">
            <div class="stat"><small>최고 콤보</small><b>${cart.maxCombo.toLocaleString()}</b></div>
            <div class="stat"><small>밸런스 정확도</small><b>${Math.round(sum.balanceAcc * 100)}%</b></div>
            <div class="stat full"><small>부스터 보조 추진</small><b>${cart.rideTime ? Math.round(cart.assistTime / cart.rideTime * 100) : 0}%</b><small> 주행 시간 중 속도가 떨어져 부스터 타이어가 밀어준 비율</small></div>
            <div class="stat full"><small>게이트 판정${sum.gateMissed ? ` · 놓침 ${sum.gateMissed}` : ''}</small>
              <div class="judge-row"><span class="p">PERFECT ${sum.gates.perfect}</span><span class="g">GOOD ${sum.gates.good}</span><span class="m">MISS ${sum.gates.miss}</span></div>
            </div>
          </div>
          <div class="actions">
            <button id="retryBtn" class="btn primary wide">${ICONS.retry}다시 도전</button>
            <button id="stageSelectBtn" class="btn wide">${ICONS.list}스테이지 선택</button>
          </div>
        </div>
      </div>
    `);
    document.getElementById('retryBtn').addEventListener('click', () => Game.loadStage(stageIndex));
    document.getElementById('stageSelectBtn').addEventListener('click', () => this.showStageSelect(STAGES, i => Game.loadStage(i)));
  },

};

window.UI = UI;
window.addEventListener('DOMContentLoaded', () => UI.init());
