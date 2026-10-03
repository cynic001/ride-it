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
const CONTROL_MODES = { twohand: {}, tilt: {} }; // 라벨·설명은 strings.js의 control.* 키
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
  `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${body}</svg>`;
const ICONS = {
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>', true),
  soundOn: svg('<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M16 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12"/>'),
  soundOff: svg('<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><line x1="16" y1="9" x2="21" y2="14"/><line x1="21" y1="9" x2="16" y2="14"/>'),
  camera: svg('<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  // 시점 버튼 아이콘 — 지금 보이는 시점을 알려줌: 3인칭 = 레일 위 카트를 뒤에서 본 모양, 1인칭 = 눈
  viewThird: svg('<path d="M3 21L9 4M21 21L15 4"/><rect x="8" y="11" width="8" height="6" rx="2"/><circle cx="9.5" cy="19" r="1.2"/><circle cx="14.5" cy="19" r="1.2"/>'),
  viewFirst: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
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
  flag: svg('<path d="M5 21V4"/><path d="M5 4h11l-2.5 4L16 12H5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  back: svg('<polyline points="15 5 8 12 15 19"/>'),
  list: svg('<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
};

// 메뉴 배경 — 하늘 그라데이션/햇살/구름 + 코스터 트랙 실루엣(SVG). 타이틀·스테이지 선택 공용
// 부스트 타이밍 링(UI 개선 2차 4번): BOOST 버튼 바깥의 링. 링 반지름 = BR_T + (BR_OUT − BR_T) × (−err / POP_RANGE) — err(지금 누르면 판정될 오차, 초)가
// 0인 순간 링이 목표 반지름(BR_T, 버튼 가장자리 바로 바깥)에 닿음. Good/Perfect 띠 두께도 같은 식(±good/±perfect초)이라 판정(cart.gateTiming)과 어긋날 수 없음.
// 좌표는 viewBox 144 기준(버튼 반지름 BR_BTN = 50, 링 바깥 끝 BR_OUT = 72).
const BR_BTN = 50, BR_T = 57, BR_OUT = 72, POP_RANGE = 0.8; // 링이 나타나는 시점 = 중심 도달 0.8초 전
const BAL_RING_C = 2 * Math.PI * 20; // 균형 바 노브 둘레 링(r=20) 길이 — 진행도 = stroke-dashoffset
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
    // UI 버튼 "톡" 효과음 — 주행 조작부(균형 바·BOOST)는 제외(자체 입력), 연타 쓰로틀은 AudioManager
    document.addEventListener('pointerdown', e => {
      const t = e.target.closest && e.target.closest('#uiRoot .btn, #uiRoot .icon-btn, #uiRoot .seg-btn, #uiRoot .switch, #uiRoot .stage-btn, #uiRoot .hud-btn, #uiRoot .gfx-opt, #uiRoot .derail-tag');
      if (t && !t.disabled) AudioManager.playUiClick();
    }, true);
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


  showTitle(onStart) {
    Title.render(onStart);
  },

  /** 스테이지 선택 — 카드를 누르면 바로 시작하지 않고 상세 화면으로. onStart(i)는 상세의 START에서 호출 */
  showStageSelect(stages, onStart) {
    this._onStart = onStart;
    this._setScreen(`
      <div class="screen stage-select">
        <div class="top-nav">
          <button class="icon-btn" id="howtoBtn" aria-label="${t('aria.howto')}">${ICONS.help}</button>
          <div class="logo-mini">${t('brand.name')}<small>RIDE IT</small></div>
          <button class="icon-btn" id="settingsBtn" aria-label="${t('aria.settings')}">${ICONS.gear}</button>
        </div>
        <div class="progress-summary">${t('select.cleared', { n: ProgressManager.clearedCount, total: stages.length })}</div>
        <div class="stage-list">
          <button class="stage-btn tutorial-btn" id="tutorialStageBtn">
            <span class="stage-num">${t('select.practice')}</span>
            <span class="stage-info">
              <span class="stage-name">${t('select.practiceName', { name: stageName(TUTORIAL_STAGE) })}</span>
              <span class="stage-motif">${stageMotif(TUTORIAL_STAGE)}</span>
            </span>
            <span class="stage-side">${localStorage.getItem('rc_tutorial_done') ? `<span class="badge clear">${t('select.done')}</span>` : `<span class="badge">${t('select.recommend')}</span>`}</span>
          </button>
          ${stages.map((s, i) => `
            <button class="stage-btn" data-index="${i}">
              <span class="stage-num">${i + 1}</span>
              <span class="stage-info">
                <span class="stage-name">${stageName(s)}</span>
                <span class="stage-motif">${stageMotif(s)}</span>
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
        <div class="top-nav">
          <button class="icon-btn" id="detailBackBtn" aria-label="${t('aria.back')}">${ICONS.back}</button>
          <span class="top-title">${t('detail.title', { n: i + 1 })}</span>
          <button class="icon-btn" id="settingsBtn" aria-label="${t('aria.settings')}">${ICONS.gear}</button>
        </div>
        <div class="card detail-card">
          <span class="stage-num big">${i + 1}</span>
          <h2>${stageName(s)}</h2>
          <p class="detail-motif">${stageMotif(s)}</p>
          ${s.rollback ? `<p class="detail-warn">⚠ ${t(s.rollback.mode === 'mash' ? 'detail.rollbackMash' : 'detail.rollbackAuto')}</p>` : ''}
          <div class="detail-meta"><span class="stars">${'★'.repeat(i + 1)}${'☆'.repeat(4 - i)}</span><span>${t('detail.topSpeed', { kmh: Math.round(s.baseSpeedKmh * 1.5) })}</span><button class="derail-tag${DerailSettings.on ? ' on' : ''}" id="derailTag" aria-label="${t('settings.derail')}">${t(DerailSettings.on ? 'detail.derailOn' : 'detail.derailOff')}</button></div>
          <div class="stats" id="detailStats"></div>
          <div class="field">
            <span class="field-label">${t('detail.laps')}</span>
            <div class="seg" id="lapSeg">
              ${[1, 2, 3].map(n => `<button class="seg-btn${LapsManager.current === n ? ' on' : ''}" data-laps="${n}">${t('detail.lapOption', { n })}</button>`).join('')}
            </div>
          </div>
          <div class="actions"><button id="stageStartBtn" class="btn primary wide big">${ICONS.play}START</button></div>
        </div>
      </div>
    `);
    // 최고 기록 칸 — 랩 수·이탈 설정을 바꾸면 그 조건의 기록으로 즉시 갱신
    const renderStats = () => {
      const q = ProgressManager.get(s.id);
      const cond = t(DerailSettings.on ? 'detail.cond' : 'detail.condOff', { laps: LapsManager.current });
      document.getElementById('detailStats').innerHTML = `
        <div class="stat"><small>${t('detail.bestRank')}</small><b>${q ? q.rank : '-'}</b></div>
        <div class="stat"><small>${t('detail.bestScore')}</small><b>${q ? q.best.toLocaleString() : '-'}</b></div>
        <div class="stat full"><small>${t('detail.record', { cond, plays: q ? q.plays : 0 })}</small></div>`;
      const tag = document.getElementById('derailTag');
      tag.textContent = t(DerailSettings.on ? 'detail.derailOn' : 'detail.derailOff');
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

  /** 설정 팝업 — 행(라벨 + 컨트롤) 단위로 자동 페이지 */
  showSettings() {
    const seg = (key, options, current) => `<div class="seg" role="radiogroup" data-setting="${key}">${options.map(([v, l]) =>
      `<button class="seg-btn${v === current ? ' on' : ''}" role="radio" aria-checked="${v === current}" data-value="${v}" type="button">${l}</button>`).join('')}</div>`;
    const sw = (key, on) => `<button class="switch" role="switch" aria-checked="${on}" data-setting="${key}" type="button"><span class="sw-text on">${t('common.on')}</span><span class="sw-text off">${t('common.off')}</span><span class="sw-knob"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"/></svg></span></button>`;
    const ctl = Popup.open({
      id: 'settingsOverlay', title: t('settings.title'),
      blocks: [
        Popup.row(t('settings.graphics'), `<button class="btn small" id="graphicsBtn" type="button">${ICONS.sparkle}<span id="graphicsSummary">${this._graphicsSummary()}</span></button>`),
        Popup.row(t('settings.view'), seg('view', [['third', t('settings.view.third')], ['first', t('settings.view.first')]], ViewSettings.mode), `<span id="viewDesc">${this._viewDesc(ViewSettings.mode)}</span>`),
        Popup.row(t('settings.sound'), sw('audio', AudioManager.enabled), t('settings.soundDesc')),
        Popup.row(t('settings.control'), seg('control', Object.keys(CONTROL_MODES).map(k => [k, t(`control.${k}`)]), ControlSettings.mode), `<span id="controlDesc">${t(`control.${ControlSettings.mode}Desc`)}</span>`),
        Popup.row(t('settings.derail'), sw('derail', DerailSettings.on), t('settings.derailDesc')),
        Popup.half(`<button id="settingsHowtoBtn" class="btn wide" type="button">${ICONS.help}${t('settings.howto')}</button>`),
        Popup.half(`<button id="creditsBtn" class="btn wide" type="button">${ICONS.info}${t('settings.credits')}</button>`),
        Popup.half(`<button id="settingsTutorialBtn" class="btn wide" type="button">${ICONS.play}${t('settings.tutorial')}</button>`),
      ],
      actions: [{ id: 'settingsCloseBtn', label: t('common.close'), primary: true, onClick: (e, c) => c.close() }],
    });
    const el = ctl.el, $ = id => el.querySelector(`#${id}`);
    el.querySelectorAll('.seg').forEach(group => group.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.value;
      group.querySelectorAll('.seg-btn').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      const key = group.dataset.setting;
      if (key === 'view') { ViewSettings.set(v); $('viewDesc').textContent = this._viewDesc(v); }
      else if (key === 'control') {
        ControlSettings.set(v);
        $('controlDesc').textContent = t(`control.${v}Desc`);
        if (v === 'tilt' && window.InputController && InputController.requestTiltPermission) InputController.requestTiltPermission(); // 이 탭이 권한 요청 제스처
      }
    })));
    el.querySelectorAll('.switch').forEach(b => b.addEventListener('click', () => {
      const on = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', on);
      if (b.dataset.setting === 'audio') AudioManager.setEnabled(on);
      else if (b.dataset.setting === 'derail') DerailSettings.set(on);
    }));
    $('graphicsBtn').addEventListener('click', () => this.showGraphics(() => { const sm = $('graphicsSummary'); if (sm) sm.textContent = this._graphicsSummary(); }));
    $('settingsHowtoBtn').addEventListener('click', () => this.showHowTo());
    $('creditsBtn').addEventListener('click', () => this.showCredits());
    $('settingsTutorialBtn').addEventListener('click', () => { Popup.closeAll(); Game.loadTutorial(); });
  },

  /** 스테이지 카드 오른쪽 배지 — 클리어 시 최고 랭크 + 최고 점수, 미클리어는 NEW */
  _stageBadges(i) {
    const p = ProgressManager.get(STAGES[i].id);
    if (!p) return `<span class="badge">${t('select.new')}</span>`;
    return `<span class="badge rank-badge">${p.rank}</span><span class="badge clear">${t('select.best', { n: p.best.toLocaleString() })}</span>`;
  },

  /** 조작법 팝업 — 항목마다 한두 문장(가로 폰에서도 4페이지 이하) */
  showHowTo(onClose) {
    const holds = STAGES.map(s => s.balance && s.balance.holdSec).filter(Boolean);
    const hold = Math.min(...holds) === Math.max(...holds) ? `${holds[0]}` : `${Math.min(...holds)}~${Math.max(...holds)}`; // 스테이지마다 다름(코드 값)
    const dot = c => `<i style="background:${c}"></i>`;
    const ctl = Popup.open({
      id: 'howtoOverlay', title: t('howto.title'),
      blocks: [
        Popup.item(ICONS.arrowUp, t('howto.launch'), t('howto.launchText')),
        Popup.item(ICONS.swipe, t('howto.balance'), t('howto.balanceText', { hold })),
        Popup.item(ICONS.tap, t('howto.boost'), t('howto.boostText')),
        Popup.item(ICONS.sparkle, t('howto.judge'), t('howto.judgeText')),
        Popup.item(ICONS.info, t('howto.derail'), t('howto.derailText', { hearts: DERAIL_HITS })),
        Popup.item(ICONS.retry, t('howto.rollback'), t('howto.rollbackText')),
        Popup.item(ICONS.viewFirst, t('howto.view'), t('howto.viewText', { sec: MANUAL_VIEW_SEC })), // 시점 버튼이 바꿔 주는 시간(camera.js 상수)
        Popup.raw(`<div class="popup-item"><span class="ico">${ICONS.list}</span><span class="txt"><b>${t('howto.floor')}</b><span class="legend-row">${dot('#ffc61a')}${t('howto.floorBoost')} ${dot('#59ff8c')}${t('howto.floorCurve')} ${dot('#ff801a')}${t('howto.floorDrop')} ${dot('#ff4099')}${t('howto.floorBack')}</span></span></div>`),
      ],
      actions: [{ id: 'howtoCloseBtn', label: t('common.ok'), primary: true, onClick: (e, c) => c.close() }],
      onClose: () => { localStorage.setItem('rc_howto_seen', '1'); if (onClose) onClose(); },
    });
    return ctl;
  },

  /** 처음 실행 권유 — 답하면(해 볼래요/건너뛰기) 다시 묻지 않음 */
  showTutorialAsk() {
    const answer = c => { try { localStorage.setItem('rc_tutorial_asked', '1'); } catch (e) { /* 무시 */ } c.close(); };
    Popup.open({
      id: 'tutorialAsk', title: t('tutAsk.title'), cancelable: false,
      blocks: [Popup.p(t('tutAsk.heading'), 'lead'), Popup.p(t('tutAsk.text'))],
      actions: [
        { id: 'tutAskNo', label: t('tutAsk.no'), onClick: (e, c) => answer(c) },
        { id: 'tutAskYes', label: t('tutAsk.yes'), icon: ICONS.play, primary: true, onClick: (e, c) => { answer(c); Game.loadTutorial(); } },
      ],
    });
  },

  /** 튜토리얼 완료 — 기록 저장 없이, 1단계로 바로 */
  showTutorialDone() {
    this._setScreen('');
    Popup.open({
      id: 'tutorialDone', title: t('tutDone.title'), cancelable: false,
      blocks: [Popup.p(t('tutDone.text'), 'lead')],
      actions: [
        { id: 'tutToSelect', label: t('common.stageSelect'), icon: ICONS.list, onClick: (e, c) => { c.close(); this.showStageSelect(STAGES, i => Game.loadStage(i)); } },
        { id: 'tutGoStage1', label: t('tutDone.go'), icon: ICONS.play, primary: true, onClick: (e, c) => { c.close(); Game.loadStage(0); } },
      ],
    });
    AudioManager.playSample('cheer', { volume: 0.7 });
  },

  /** 균형 바 읽는 법 그림(튜토리얼 카드·조작법 공용) — 오른쪽 커브 예시: 목표 ▼, 초록 띠(사선), 진한 Perfect 띠, 노브(노란 링 + 아래 화살표) */
  gaugeDiagram() {
    return `<svg class="diagram" viewBox="0 0 300 120" role="img" aria-label="${t('hud.balanceBar')}">
      <defs><pattern id="gdStripe" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#168A4C"/><rect width="5" height="10" fill="#2BAA68"/></pattern></defs>
      <rect x="10" y="44" width="280" height="48" rx="24" fill="#E6DDC8" stroke="#141a33" stroke-width="2"/>
      <rect x="150" y="56" width="112" height="24" rx="4" fill="url(#gdStripe)" stroke="#141a33" stroke-width="2"/>
      <rect x="196" y="52" width="40" height="32" rx="4" fill="#0A3D22" stroke="#fff" stroke-width="2"/><rect x="196" y="52" width="40" height="32" rx="4" fill="none" stroke="#141a33" stroke-width="1"/>
      <polygon points="216,12 228,12 222,26" fill="#141a33"/><rect x="220.5" y="8" width="3" height="26" fill="#141a33"/>
      <circle cx="110" cy="68" r="22" fill="#F1EBDD" stroke="#141a33" stroke-width="2"/><circle cx="110" cy="68" r="26" fill="none" stroke="#FFB80D" stroke-width="4"/>
      <polygon points="103,102 117,102 110,92" fill="#141a33"/>
      <text x="110" y="75" font-size="20" text-anchor="middle" fill="#141a33" font-weight="700">●</text>
      <text x="222" y="104" font-size="14" text-anchor="middle" fill="#141a33" font-weight="700">${t('diagram.target')}</text>
      <text x="110" y="118" font-size="14" text-anchor="middle" fill="#141a33" font-weight="700">${t('diagram.knob')}</text>
    </svg>`;
  },

  /** 부스트 타이밍 링 그림(연습 코스 카드·조작법 공용) — BOOST 버튼 바깥의 링이 점선에 닿는 순간 */
  popupDiagram() {
    return `<svg class="diagram" viewBox="0 0 300 140" role="img" aria-label="${t('tut.card.boost')}">
      <g transform="translate(70 70)">
        <circle r="52" fill="none" stroke="#FFD84D" stroke-width="10" opacity=".85"/><circle r="52" fill="none" stroke="#168A4C" stroke-width="4"/>
        <circle r="52" fill="none" stroke="#141a33" stroke-width="1.5" stroke-dasharray="3 3"/>
        <circle r="62" fill="none" stroke="#141a33" stroke-width="8"/><circle r="62" fill="none" stroke="#fff" stroke-width="4"/>
        <circle r="44" fill="#FFB80D" stroke="#141a33" stroke-width="2"/><text y="6" font-size="16" text-anchor="middle" font-weight="700" fill="#141a33">BOOST</text>
      </g>
      <text x="150" y="44" font-size="15" fill="#141a33" font-weight="700">${t('diagram.ring1')}</text>
      <text x="150" y="74" font-size="15" fill="#141a33" font-weight="700">${t('diagram.ring2')}</text>
      <text x="150" y="98" font-size="17" fill="#141a33" font-weight="700">${t('diagram.ring3')}</text>
      <text x="150" y="124" font-size="14" fill="#454a66" font-weight="500">${t('diagram.ring4')}</text>
    </svg>`;
  },

  _viewDesc(m) {
    return t(m === 'first' ? 'settings.view.firstDesc' : 'settings.view.thirdDesc');
  },

  _graphicsSummary() {
    return `${t(`graphics.quality.${QualityManager.current}`)} · ${t(`graphics.style.${StyleManager.current}`)}`;
  },

  /** 그래픽 팝업 — 화질·화면 스타일을 세그먼트로, 고른 항목의 설명을 아래에 */
  showGraphics(onChange) {
    const seg = (key, options, current) => `<div class="seg" role="radiogroup" data-setting="${key}">${options.map(([v, l]) =>
      `<button class="seg-btn${v === current ? ' on' : ''}" role="radio" aria-checked="${v === current}" data-value="${v}" type="button">${l}</button>`).join('')}</div>`;
    const sw = (key, on) => `<button class="switch" role="switch" aria-checked="${on}" data-setting="${key}" type="button"><span class="sw-text on">${t('common.on')}</span><span class="sw-text off">${t('common.off')}</span><span class="sw-knob"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"/></svg></span></button>`;
    const styles = ['day', 'toon', 'pastel', 'standard'];
    const desc = () => `${t(`graphics.quality.${QualityManager.current}Desc`)}<br>${t(`graphics.style.${StyleManager.current}Desc`)}`;
    const ctl = Popup.open({
      id: 'graphicsOverlay', title: t('graphics.title'),
      blocks: [
        Popup.row(t('graphics.quality'), seg('quality', ['low', 'medium', 'high'].map(k => [k, t(`graphics.quality.${k}`)]), QualityManager.current)),
        { ...Popup.row(t('graphics.style'), seg('style', styles.map(k => [k, t(`graphics.style.${k}`)]), StyleManager.current)), cls: '' },
        Popup.p(`<span id="gfxDesc">${desc()}</span>`),
      ],
      actions: [{ id: 'graphicsCloseBtn', label: t('common.ok'), primary: true, onClick: (e, c) => c.close() }],
    });
    ctl.el.querySelectorAll('.seg').forEach(group => group.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      group.querySelectorAll('.seg-btn').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      if (group.dataset.setting === 'quality') { QualityManager.setPreset(b.dataset.value); if (Game.scene) Game._applyQualitySettings(); }
      else StyleManager.set(b.dataset.value);
      ctl.el.querySelector('#gfxDesc').innerHTML = desc();
      if (onChange) onChange();
    })));
  },

  /** 서드파티 에셋 표기 — Kenney/Poly Haven 모두 CC0라 의무는 없지만 감사 표기. 글꼴은 OFL */
  showCredits() {
    const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    Popup.open({
      id: 'creditsOverlay', title: t('credits.title'),
      blocks: [
        Popup.raw(`<p><b>${t('credits.game')}</b><br>${t('credits.tester')}</p>`, 'popup-credit'),
        Popup.raw(`<p><b>${t('credits.model')}</b> Coaster Kit · Nature Kit — ${link('https://kenney.nl', 'Kenney.nl')} (CC0)</p>`, 'popup-credit'),
        Popup.raw(`<p><b>${t('credits.sky')}</b> Kloofendal 43d Clear — Greg Zaal, ${link('https://polyhaven.com', 'Poly Haven')} (CC0)</p>`, 'popup-credit'),
        Popup.raw(`<p><b>${t('credits.sfx')}</b> ${t('credits.sfxText')}</p>`, 'popup-credit'),
        Popup.raw(`<p><b>${t('credits.font')}</b> ${t('credits.fontText')}</p>`, 'popup-credit'),
      ],
      actions: [{ id: 'creditsCloseBtn', label: t('common.close'), primary: true, onClick: (e, c) => c.close() }],
    });
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
    el.textContent = t('update.toast');
    el.addEventListener('click', () => location.reload());
    document.body.appendChild(el);
  },

  showLoadingOverlay() {
    this._setScreen(`
      <div class="screen loading-screen" id="loadingOverlay">
        <div class="spinner"></div>
        <p>${t('loading.text')}</p>
      </div>
    `);
  },

  showLoadError(retryFn) {
    this._setScreen('');
    Popup.open({
      id: 'loadErrorOverlay', title: t('loadError.title'), cancelable: false,
      blocks: [Popup.p(t('loadError.text'), 'lead')],
      actions: [{ id: 'retryLoadBtn', label: t('loadError.retry'), icon: ICONS.retry, primary: true, onClick: () => retryFn() }],
    });
  },

  showPauseOverlay() {
    const sd = Game.track && Game.track.stageData, name = sd ? stageName(sd) : '';
    this._pause = Popup.open({
      id: 'pauseOverlay', title: t('pause.title'), cancelable: false,
      blocks: [Popup.p(t('pause.stage', { name }), 'lead')],
      actions: [
        { id: 'pauseExitBtn', label: t('common.stageSelect'), icon: ICONS.list, onClick: () => Game.exitToStageSelect() },
        { id: 'resumeBtn', label: t('pause.resume'), icon: ICONS.play, primary: true, onClick: () => Game.resumeGame() },
      ],
    });
  },

  hidePauseOverlay() {
    if (this._pause) { this._pause.close(); this._pause = null; }
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
            <span class="hud-chip lap-chip" id="lapChip"><b id="lapLabel">${t('hud.lap', { n: 1, total: 1 })}</b><small id="turnLabel">${t('hud.curve', { n: 1, total: 1 })}</small></span>
            <span class="hud-chip speed-chip" id="speedo"><i class="max-tag">MAX</i><span class="num" id="speedLabel">0</span><small>km/h</small></span>
            <span class="hud-chip accent combo-chip" id="comboChip"${tutorial ? ' hidden' : ''}><small>${t('hud.combo')}</small><b id="comboLabel">0</b><small class="mult" id="comboMult">×1.0</small></span>
            ${tutorial ? `<button class="hud-chip tut-skip" id="tutSkipBtn">${t('hud.skip')}</button>` : ''}
          </div>
          ${derail ? `<div class="hud-chip hud-hearts" id="hearts" aria-label="${t('hud.lives')}">${'<svg class="heart-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.6A5.2 5.2 0 0 1 12 7.7a5.2 5.2 0 0 1 9.5 3.7C19.5 16.4 12 21 12 21z" stroke-linejoin="round"/></svg>'.repeat(DERAIL_HITS)}</div>` : ''}
        </div>
        ${tutorial ? '<div class="tut-banner" id="tutBanner"></div>' : ''}
        <div class="judge" id="judgeToast"></div>
        <div class="rb-overlay" id="rbOverlay"><div class="rb-title" id="rbTitle"></div>
          <div class="rb-gauge" id="rbGauge"><div class="rb-gauge-fill" id="rbGaugeFill"></div></div><div class="rb-sub" id="rbSub"></div></div>
        <div class="timing-pop" id="gatePop">
          <span class="hud-chip tp-label" id="gatePopLabel"></span>
          <div class="tp-result" id="gatePopResult"></div>
        </div>
        <div class="start-bar" id="startBar">
          <div class="start-bar-label" id="startBarLabel">${t('start.label')}</div>
          <div class="start-bar-track">
            <div class="start-bar-fill" id="startBarFill"></div>
            <div class="start-bar-handle" id="startBarHandle">${ICONS.arrowUp}</div>
          </div>
          <div class="start-power"><div class="start-power-fill" id="startPowerFill"></div></div>
          <div class="key-hint">${t('start.keys')}</div>
        </div>
        ${this._driveControlsHTML()}
        <div class="hud-controls">
          <button class="hud-btn" id="soundToggleBtn" aria-label="${t('hud.sound')}">${AudioManager.enabled ? ICONS.soundOn : ICONS.soundOff}</button>
          <button class="hud-btn" id="pauseBtn" disabled aria-label="${t('hud.pause')}">${ICONS.pause}</button>
        </div>
        <button class="hud-btn view-btn" id="cameraToggleBtn" disabled aria-label="${t('hud.view')}">${ICONS.viewThird}</button>
        <span class="hud-chip view-flash" id="viewFlash" aria-live="polite"></span>
      </div>
    `);
    const $ = id => document.getElementById(id);
    this._hud = {
      speed: $('speedLabel'), speedo: $('speedo'), comboMult: $('comboMult'), combo: $('comboLabel'), comboChip: $('comboChip'), turn: $('turnLabel'), lap: $('lapLabel'),
      progress: $('progressFill'), cameraBtn: $('cameraToggleBtn'), pauseBtn: $('pauseBtn'), viewFlash: $('viewFlash'), viewMode: 'third',
      bal: $('balGauge'), balDir: $('balDir'), balBand: $('balBand'), balPerfect: $('balPerfect'), balKnob: $('balKnob'), balTarget: $('balTarget'), balRing: $('balRing'), balResult: $('balResult'), balLast: null,
      pop: $('gatePop'), popLabel: $('gatePopLabel'), popResult: $('gatePopResult'), ringWrap: $('boostWrap'), ring: $('brRing'), ringOut: $('brOut'), ringGood: $('brGood'), ringPerfect: $('brPerfect'), ringFlash: $('brFlash'), popKey: null, popResultUntil: 0, popPrevErr: null, popTick: 0,
      judge: $('judgeToast'), hearts: $('hearts'), lastDerails: 0,
      rb: $('rbOverlay'), rbTitle: $('rbTitle'), rbGauge: $('rbGauge'), rbFill: $('rbGaugeFill'), rbSub: $('rbSub'), lastCombo: 0,
    };

    $('cameraToggleBtn').addEventListener('click', () => this.toggleView());
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
    this._fallbackHandler = () => { // 기울기 센서 불가 → 바 끌기로 전환 + 짧은 신호
      const dc = $('driveControls');
      if (dc) dc.classList.remove('tilt');
      this.flashSignal(t('hud.fallbackBar'));
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

  /** 주행 조작 DOM — 왼쪽 아래 균형 바(손으로 끌기 / 기울기·키보드는 노브가 따라 움직임), 오른쪽 아래 BOOST. 발사 전에는 숨겨 두고(스타트 바가 하단 중앙 사용)
   * cart-launched에서 표시. 두 영역은 화면 양 끝(엄지 위치)에 붙이고 가운데를 비워 손가락이 겹치지 않게 */
  _driveControlsHTML() {
    const tilt = ControlSettings.mode === 'tilt';
    return `<div class="drive-controls twohand${tilt ? ' tilt' : ''}" id="driveControls">
      <div class="ctl-left" id="ctlLeft">
        <div class="bal-bar${tilt ? ' locked' : ''}" id="balGauge" role="slider" aria-label="${t('hud.balanceBar')}" aria-valuemin="-1" aria-valuemax="1" aria-valuenow="0">
          <div class="bal-top"><span class="bal-dir" id="balDir"></span><span class="bal-result" id="balResult"></span></div>
          <div class="bal-track" id="balTrack"><div class="bal-rail" id="balRail">
            <div class="bal-band" id="balBand"></div><div class="bal-perfect" id="balPerfect"></div><i class="bal-zero"></i>
            <i class="bal-target" id="balTarget"></i>
            <div class="bal-knob" id="balKnob"><svg class="bal-ring" viewBox="0 0 50 50" aria-hidden="true"><circle class="base" cx="25" cy="25" r="20"/><circle class="prog" id="balRing" cx="25" cy="25" r="20"/></svg><b class="bal-state" aria-hidden="true"></b></div>
          </div></div>
        </div>
      </div>
      <div class="ctl-right" id="ctlRight">
        <div class="boost-wrap" id="boostWrap">
          <svg class="boost-ring" viewBox="0 0 144 144" aria-hidden="true">
            <defs><linearGradient id="brRainbow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD84D"/><stop offset=".33" stop-color="#4DE0FF"/><stop offset=".66" stop-color="#7DFFB0"/><stop offset="1" stop-color="#B38CFF"/></linearGradient></defs>
            <circle class="br-good" id="brGood" cx="72" cy="72" r="${BR_T}"/>
            <circle class="br-perfect" id="brPerfect" cx="72" cy="72" r="${BR_T}"/>
            <circle class="br-target" cx="72" cy="72" r="${BR_T}"/>
            <circle class="br-out" id="brOut" cx="72" cy="72" r="${BR_OUT}"/>
            <circle class="br-ring" id="brRing" cx="72" cy="72" r="${BR_OUT}"/>
            <circle class="br-flash" id="brFlash" cx="72" cy="72" r="${BR_T}"/>
            <g class="br-stars"><path class="star" transform="translate(114 30)" d="M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2Z"/><path class="star" transform="translate(30 30)" d="M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2Z"/><path class="star" transform="translate(30 114)" d="M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2Z"/><path class="star" transform="translate(114 114)" d="M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2Z"/></g>
          </svg>
          <button class="ctl-btn boost" id="boostBtn" type="button">BOOST</button>
        </div>
      </div>
    </div>`;
  },

  /** 시점 바꾸기(버튼 · 키보드 C) — 지금 보이는 시점의 반대로 잠깐(6초). 바뀐 시점 이름을 버튼 아래에 짧게 보여 줌 */
  toggleView() {
    const cam = window.Game && Game.camera, h = this._hud;
    if (!cam || cam.locked || !h) return false;
    cam.toggleMode();
    const f = h.viewFlash;
    if (f) {
      f.textContent = t(cam._manualTarget ? 'view.first' : 'view.third');
      f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
    }
    const b = h.cameraBtn;
    b.classList.add('pressed'); setTimeout(() => b.classList.remove('pressed'), 160);
    return true;
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
      h.lap.textContent = t('hud.lap', { n: cart.currentLap, total: cart.totalLaps });
      h.turn.textContent = t('hud.curve', { n: turnNum, total: ranges.length });
      const overall = ((cart.currentLap - 1) + Math.min(1, cart.t)) / cart.totalLaps;
      h.progress.style.width = `${(overall * 100).toFixed(1)}%`;

      // 균형 바: 노브 = 지금 내 입력값(−1~1, 손/키보드/기울기 모두 같은 바에 표시). 커브 구간이면 목표 ▼ · 성공 띠(초록 + 사선 무늬 + 테두리) ·
      // 그 안의 Perfect 띠(더 진한 색 + 흰 테두리) · 방향 글자가 나타나고, 노브 둘레 링 = holdSec초 연속 유지 진행도(벗어나면 즉시 0)
      const pct = v => (Math.max(-1, Math.min(1, v)) + 1) * 50;
      const inp = window.Game && Game.input;
      h.bal.classList.toggle('locked', !!inp && (inp.mode === 'tilt' || inp._keyLean() !== 0));
      h.balKnob.style.left = `${pct(cart.leanInput).toFixed(1)}%`;
      h.bal.setAttribute('aria-valuenow', cart.leanInput.toFixed(2));
      const bs = cart.launched && !cart.rollback ? cart.balanceState : null;
      if (bs) {
        const a = pct(bs.dir * bs.minLean), b = pct(bs.dir);
        h.balBand.style.left = `${Math.min(a, b).toFixed(1)}%`;
        h.balBand.style.right = `${(100 - Math.max(a, b)).toFixed(1)}%`;
        const p0 = pct(bs.dir * Math.max(bs.minLean, bs.target - bs.perfectRange)), p1 = pct(bs.dir * Math.min(1, bs.target + bs.perfectRange));
        h.balPerfect.style.left = `${Math.min(p0, p1).toFixed(1)}%`;
        h.balPerfect.style.right = `${(100 - Math.max(p0, p1)).toFixed(1)}%`;
        h.balTarget.style.left = `${pct(bs.dir * bs.target).toFixed(1)}%`;
        h.balRing.style.strokeDashoffset = (BAL_RING_C * (1 - Math.max(0, Math.min(1, bs.progress)))).toFixed(1);
        if (h.balLast !== bs.dir) { h.balDir.textContent = t(bs.dir < 0 ? 'hud.curveLeft' : 'hud.curveRight'); h.balDir.classList.toggle('right', bs.dir > 0); h.balLast = bs.dir; }
        h.bal.classList.toggle('in', bs.inBand);
        h.bal.classList.toggle('perfect', bs.inBand && bs.perfectNow);
        h.bal.classList.toggle('done', !!bs.done);
        h.bal.classList.add('active');
      } else {
        h.bal.classList.remove('active', 'in', 'perfect', 'done');
        h.balLast = null;
      }

      // 부스트 타이밍 링: 다가오는 게이트(중심까지 POP_RANGE초 이내)에서 BOOST 버튼 바깥에 나타나 줄어들고, 링이 목표 반지름에 닿는 순간 = 정타.
      // err는 판정 함수(cart.gateTiming, 터치 지연 보정 포함)와 같은 값. 늦으면 링이 버튼 아래로 줄어들며 사라짐
      const g = cart.launched && !cart.rollback ? cart.gateTiming() : null;
      const now = performance.now(), wrap = h.ringWrap;
      if (g && -g.err <= POP_RANGE + INPUT_LATENCY_OFFSET && g.err <= GATE_ATTEMPT_RANGE) {
        const k = (BR_OUT - BR_T) / POP_RANGE; // 초 → 반지름(viewBox)
        const r = Math.max(BR_BTN, BR_T + k * -g.err).toFixed(2);
        h.ring.setAttribute('r', r); h.ringOut.setAttribute('r', r);
        h.ringGood.setAttribute('stroke-width', (2 * k * g.good).toFixed(2));
        h.ringPerfect.setAttribute('stroke-width', (2 * k * g.perfect).toFixed(2));
        wrap.dataset.err = g.err.toFixed(4);
        wrap.classList.add('on');
        wrap.classList.toggle('ready', Math.abs(g.err) <= g.good);
        wrap.classList.toggle('perfect-now', Math.abs(g.err) <= g.perfect);
        wrap.classList.toggle('finish', g.type === 'finish');
        wrap.classList.toggle('lowfx', QualityManager.current === 'low');
        h.popLabel.textContent = g.type === 'finish' ? t('hud.finish') : '';
        // 박자 틱: 정타 0.5초 전·0.25초 전 "틱-틱", 정타 직전 "지금!"(출력 지연만큼 살짝 일찍) — 게이트마다 한 번씩
        if (h.popKey !== g.key) { h.popTick = 0; h.popPrevErr = null; }
        if (h.popTick < 1 && g.err >= -0.5) { h.popTick = 1; AudioManager.playTick(false); }
        if (h.popTick < 2 && g.err >= -0.25) { h.popTick = 2; AudioManager.playTick(false); }
        if (h.popTick < 3 && g.err >= -0.03) { h.popTick = 3; AudioManager.playTick(true); }
        if (h.popPrevErr !== null && h.popPrevErr < 0 && g.err >= 0) { // 정타 순간 반짝(링 안쪽에서 퍼지는 흰 원, 0.18초)
          h.ringFlash.classList.remove('go'); void h.ringFlash.getBoundingClientRect(); h.ringFlash.classList.add('go');
        }
        h.popPrevErr = g.err;
        if (h.popKey && h.popKey !== g.key && !cart._resolvedGates.has(h.popKey)) this._showPopResult('miss'); // 앞 게이트를 놓치고 바로 다음 게이트
        if (now >= h.popResultUntil) { h.pop.classList.toggle('on', g.type === 'finish'); h.pop.classList.remove('result'); }
        h.popKey = g.key;
      } else {
        // 링이 떠 있던 게이트를 누르지 않고 지나침 → MISS
        if (h.popKey && !cart._resolvedGates.has(h.popKey) && cart.launched && !cart.rollback) this._showPopResult('miss');
        h.popKey = null;
        wrap.classList.remove('on', 'ready', 'perfect-now', 'finish');
        if (now >= h.popResultUntil) h.pop.classList.remove('on', 'result');
      }
    }
    // 뒤로 떨어지기 신호: 멈칫/뒤로 = 경고, 연타 = "연타!" + 힘 게이지 + 남은 초, 자동 발사 = 부스터
    const rb = cart.rollback;
    h.rb.classList.toggle('on', !!rb);
    if (rb) {
      const mash = rb.phase === 'mash';
      h.rbTitle.textContent = t(mash ? 'rb.mash' : rb.phase === 'launch' ? 'rb.launch' : 'rb.slip');
      h.rb.classList.toggle('mash', mash);
      h.rbGauge.style.display = mash ? 'block' : 'none';
      if (mash) {
        h.rbFill.style.width = `${Math.round(rb.gauge * 100)}%`;
        const left = Math.max(0, 6 - rb.mashTime);
        h.rbSub.textContent = left.toFixed(1); // 일반 스테이지는 짧은 신호만(13번) — 연타 방법 설명은 튜토리얼에서
      } else h.rbSub.textContent = rb.phase === 'launch' ? '' : t('rb.hold');
    }
    if (h.hearts && cart.derails !== h.lastDerails) { // 남은 기회(하트) — 잃는 순간 하나가 튀며 회색으로
      h.lastDerails = cart.derails;
      [...h.hearts.children].forEach((el, i) => {
        const lost = i >= DERAIL_HITS - cart.derails;
        if (lost && !el.classList.contains('off')) { el.classList.remove('lose'); void el.offsetWidth; el.classList.add('lose'); }
        el.classList.toggle('off', lost);
      });
    }
    const vm = window.Game && Game.camera ? Game.camera.mode : 'third'; // 지금 화면에 보이는 시점 — 아이콘이 따라 바뀜
    if (vm !== h.viewMode) { h.viewMode = vm; h.cameraBtn.innerHTML = vm === 'first' ? ICONS.viewFirst : ICONS.viewThird; }
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

  /** 탈선을 다 써서 스테이지 실패 — 기록 저장 없음 */
  showFail(stageIndex) {
    const stageData = STAGES[stageIndex];
    const heart = '<svg class="heart-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.6A5.2 5.2 0 0 1 12 7.7a5.2 5.2 0 0 1 9.5 3.7C19.5 16.4 12 21 12 21z" stroke-linejoin="round"/></svg>';
    this._setScreen('');
    Popup.open({
      id: 'failScreen', title: t('fail.title'), cancelable: false,
      blocks: [
        Popup.raw(`<div class="result-stage">${stageName(stageData)}</div><div class="hearts-row">${heart.repeat(DERAIL_HITS)}</div>`, 'center'),
        Popup.p(t('fail.text', { hearts: DERAIL_HITS }), 'lead'),
      ],
      actions: [
        { id: 'stageSelectBtn', label: t('common.stageSelect'), icon: ICONS.list, onClick: () => this.showStageSelect(STAGES, i => Game.loadStage(i)) },
        { id: 'retryBtn', label: t('common.retry'), icon: ICONS.retry, primary: true, onClick: () => Game.loadStage(stageIndex) },
      ],
    });
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
      <div class="screen result-screen" id="resultScreen">
        <div class="card result-card">
          <div class="ribbon">${t('result.complete')}</div>
          <div class="result-stage">${stageName(stageData)}</div>
          <div class="rank ${sum.rank}">${sum.rank}</div>
          <div class="result-score"><small>SCORE</small>${score.toLocaleString()}</div>
          ${rec.firstClear ? `<div class="new-best">${t('result.firstClear')}</div>` : rec.newBest ? `<div class="new-best">${t('result.newBest')}</div>` : `<div class="result-stage">${t('result.best', { n: ProgressManager.get(stageData.id, cart.totalLaps, cart.derailEnabled).best.toLocaleString() })}</div>`}
          <div class="result-cond">${t('result.cond', { laps: cart.totalLaps })}${cart.derailEnabled ? '' : ` · <span class="off-tag">${t('result.condOff')}</span>`}</div>
          <div class="breakdown">
            ${[
              [t('result.gate'), bd.gate],
              [t('result.balance', { a: sum.curvesCleared, b: sum.curveCount }), bd.balance],
              [t('result.balancePerfect', { n: cart.balancePerfects }), bd.balancePerfect],
              [t('result.combo'), bd.comboBonus],
              ...(bd.finishBonus > 0 ? [[t('result.finish'), bd.finishBonus]] : []),
              ...(bd.mashBonus > 0 ? [[t('result.mash'), bd.mashBonus]] : []),
            ].map(([k, v]) => `<div class="bd-row"><span>${k}</span><b>+${Math.round(v).toLocaleString()}</b></div>`).join('')}
            ${cart.derailEnabled ? `<div class="bd-row bd-derail"><span>${t('result.derail', { n: cart.derails })}</span><b>−${Math.round(bd.derailPenalty).toLocaleString()}</b></div>` : ''}
          </div>
          <div class="stats">
            <div class="stat"><small>${t('result.maxCombo')}</small><b>${cart.maxCombo.toLocaleString()}</b></div>
            <div class="stat"><small>${t('result.balanceAcc')}</small><b>${Math.round(sum.balanceAcc * 100)}%</b></div>
            <div class="stat full"><small>${t('result.assist')}</small><b>${cart.rideTime ? Math.round(cart.assistTime / cart.rideTime * 100) : 0}%</b><small>${t('result.assistDesc')}</small></div>
            <div class="stat full"><small>${t('result.gateJudge')}${sum.gateMissed ? ` · ${t('result.missed', { n: sum.gateMissed })}` : ''}</small>
              <div class="judge-row"><span class="p">PERFECT ${sum.gates.perfect}</span><span class="g">GOOD ${sum.gates.good}</span><span class="m">MISS ${sum.gates.miss}</span></div>
            </div>
          </div>
          <div class="actions">
            <button id="retryBtn" class="btn primary wide">${ICONS.retry}${t('common.retry')}</button>
            <button id="stageSelectBtn" class="btn wide">${ICONS.list}${t('common.stageSelect')}</button>
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
