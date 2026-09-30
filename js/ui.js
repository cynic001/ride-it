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

// 스테이지별 진행 저장 — { [stage.id]: { cleared, best, rank, plays } } (인덱스가 아닌 id 기준이라 순서가 바뀌어도 유지)
const RANK_ORDER = 'CBAS';
const ProgressManager = {
  _data: (() => {
    try { return JSON.parse(localStorage.getItem('rc_progress')) || {}; } catch (e) { return {}; }
  })(),
  get(stageId) {
    return this._data[stageId] || null;
  },
  /** 완주 기록 반영 — 반환값 { firstClear, newBest }로 결과 화면 배지 결정 */
  record(stageId, score, rank) {
    const prev = this._data[stageId];
    const firstClear = !prev;
    const newBest = !!prev && score > prev.best;
    this._data[stageId] = {
      cleared: true,
      best: Math.max(score, prev ? prev.best : 0),
      rank: prev && RANK_ORDER.indexOf(prev.rank) > RANK_ORDER.indexOf(rank) ? prev.rank : rank,
      plays: (prev ? prev.plays : 0) + 1,
    };
    try { localStorage.setItem('rc_progress', JSON.stringify(this._data)); } catch (e) { /* 저장 불가(사파리 개인정보 보호 모드 등) — 이번 세션 메모리에만 유지 */ }
    return { firstClear, newBest };
  },
  get clearedCount() {
    return Object.values(this._data).filter(p => p.cleared).length;
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

const JUDGE_LABEL = { perfect: 'PERFECT!', good: 'GOOD', miss: 'MISS' };
const GATE_LABEL = { boost: '부스트 게이트', brake: '브레이크 게이트', finish: '피니쉬!' };

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

  showStageSelect(stages, onSelect) {
    this._setScreen(`
      <div class="screen stage-select">
        ${MENU_BG}
        ${LOGO(true)}
        <div class="progress-summary">클리어 ${ProgressManager.clearedCount} / ${stages.length}</div>
        <div class="stage-list">
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
        <div class="settings-row">
          <button class="pill" id="qualityBtn">${ICONS.sparkle}<span>그래픽 ${this._qualityLabel()}</span></button>
          <button class="pill" id="lapsBtn">${ICONS.repeat}<span>${LapsManager.current}랩</span></button>
          <button class="pill" id="audioBtn">${AudioManager.enabled ? ICONS.soundOn : ICONS.soundOff}<span>사운드 ${AudioManager.enabled ? 'ON' : 'OFF'}</span></button>
          <button class="pill" id="howtoBtn">${ICONS.help}<span>조작법</span></button>
          <button class="pill" id="creditsBtn">${ICONS.info}<span>크레딧</span></button>
        </div>
      </div>
    `);

    this.root.querySelectorAll('.stage-btn').forEach(btn => {
      btn.addEventListener('click', () => onSelect(Number(btn.dataset.index)));
    });

    document.getElementById('qualityBtn').addEventListener('click', () => this._cycleQuality());
    document.getElementById('lapsBtn').addEventListener('click', () => this._cycleLaps());
    document.getElementById('audioBtn').addEventListener('click', () => this._cycleAudio());
    document.getElementById('howtoBtn').addEventListener('click', () => this.showHowTo());
    document.getElementById('creditsBtn').addEventListener('click', () => this.showCredits());

    // 최초 1회만 자동으로 조작법 안내 — 이후엔 위 버튼으로만 접근
    if (!localStorage.getItem('rc_howto_seen')) this.showHowTo();
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
    const el = this._modal('howtoOverlay', `
      <h2>조작법</h2>
      <div class="howto-list">
        ${item(ICONS.arrowRight, '스타트 바', '바 안의 손잡이를 끌었다가 휙 놓으면 출발! 빠르게 놓을수록 세게')}
        ${item(ICONS.swipe, '좌우 밸런스', '커브에서 화면 아래쪽을 좌우로 밀어 노란 구간에 맞추기')}
        ${item(ICONS.tap, '게이트 탭', '게이트가 초록색일 때 화면 위쪽을 탭 (부스트/브레이크/피니쉬)')}
        ${item(ICONS.hand, '에어타임 홀드', '무중력 구간에서 화면을 길게 눌러 손 들기 — 보너스 점수')}
      </div>
      <div class="actions"><button id="howtoCloseBtn" class="btn primary wide">알겠어요!</button></div>
    `, { solid: true });
    document.getElementById('howtoCloseBtn').addEventListener('click', () => {
      el.remove();
      localStorage.setItem('rc_howto_seen', '1');
      if (onClose) onClose();
    });
  },

  /** 서드파티 에셋 표기 — Kenney/Poly Haven 모두 CC0라 의무는 없지만 감사 표기 */
  showCredits() {
    const el = this._modal('creditsOverlay', `
      <h2>크레딧</h2>
      <div class="credits-list">
        <p><strong>떨어진다!!! RIDE IT</strong><br>chaechae studio</p>
        <p><strong>3D 모델</strong><br>Coaster Kit · Nature Kit — <a href="https://kenney.nl" target="_blank" rel="noopener">Kenney.nl</a> (CC0)</p>
        <p><strong>하늘 HDRI</strong><br>Kloofendal 43d Clear (Pure Sky) — Greg Zaal, <a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a> (CC0)</p>
        <p><strong>엔진</strong><br>Babylon.js</p>
      </div>
      <div class="actions"><button id="creditsCloseBtn" class="btn primary wide">닫기</button></div>
    `, { solid: true });
    document.getElementById('creditsCloseBtn').addEventListener('click', () => el.remove());
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

  _cycleQuality() {
    const order = ['low', 'medium', 'high'];
    const next = order[(order.indexOf(QualityManager.current) + 1) % order.length];
    QualityManager.setPreset(next);
    const btn = document.getElementById('qualityBtn');
    if (btn) btn.lastElementChild.textContent = `그래픽 ${this._qualityLabel()}`;
  },

  _cycleLaps() {
    const order = [1, 2, 3];
    const next = order[(order.indexOf(LapsManager.current) + 1) % order.length];
    LapsManager.setLaps(next);
    const btn = document.getElementById('lapsBtn');
    if (btn) btn.lastElementChild.textContent = `${next}랩`;
  },

  _cycleAudio() {
    const next = !AudioManager.enabled;
    AudioManager.setEnabled(next);
    const btn = document.getElementById('audioBtn');
    if (btn) btn.innerHTML = `${next ? ICONS.soundOn : ICONS.soundOff}<span>사운드 ${next ? 'ON' : 'OFF'}</span>`;
  },

  showStartPrompt(name, motif) {
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
            <span class="combo-chip" id="comboChip"><small>COMBO</small><b id="comboLabel">0</b><small class="mult" id="comboMult">×1.0</small></span>
          </div>
        </div>
        <div class="judge" id="judgeToast"></div>
        <div class="guide gate" id="gateGuide">
          <div class="guide-label" id="gateGuideLabel"></div>
          <div class="guide-bar"><div class="guide-zone" id="gateZone"></div><div class="guide-marker" id="gateMarker"></div></div>
        </div>
        <div class="guide balance" id="balanceGuide">
          <div class="guide-label">밸런스!</div>
          <div class="guide-bar"><div class="guide-zone" id="balanceZone"></div><div class="guide-marker" id="balanceMarker"></div></div>
        </div>
        <div class="start-bar" id="startBar">
          <div class="start-bar-label">당겨서 출발!</div>
          <div class="start-bar-track">
            <div class="start-bar-fill" id="startBarFill"></div>
            <div class="start-bar-handle" id="startBarHandle">${ICONS.arrowRight}</div>
          </div>
        </div>
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
      balance: $('balanceGuide'), balanceZone: $('balanceZone'), balanceMarker: $('balanceMarker'),
      gate: $('gateGuide'), gateLabel: $('gateGuideLabel'), gateZone: $('gateZone'), gateMarker: $('gateMarker'),
      judge: $('judgeToast'), lastCombo: 0,
    };

    $('cameraToggleBtn').addEventListener('click', () => {
      if (Game.camera && !Game.camera.locked) Game.camera.toggleMode();
    });
    $('pauseBtn').addEventListener('click', () => Game.pauseGame());
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

    this._pullProgressHandler = e => {
      const strength = Math.max(0, Math.min(1, e.detail));
      const travel = Math.max(0, track.clientWidth - handle.clientWidth - 8); // 8 = track 내부 좌우 패딩(4px*2)
      const offset = travel * strength;
      handle.style.transform = `translateX(${offset}px)`;
      fill.style.width = `${4 + offset + handle.clientWidth / 2}px`;
    };
    // 발사 성공 시: 힌트 텍스트만 사라지는 게 아니라 스타트 바 UI 자체를 화면에서 치우고 HUD로 전환
    this._launchedHandler = () => {
      this.startBarEl.classList.add('launched');
    };
    // 게이트 탭 판정 토스트(게이트 없는 곳의 탭 = 'none'은 표시하지 않음)
    this._gateHandler = e => {
      const { result } = e.detail;
      if (!JUDGE_LABEL[result] || !this._hud) return;
      const j = this._hud.judge;
      j.textContent = JUDGE_LABEL[result];
      j.className = 'judge';
      void j.offsetWidth; // 애니메이션 재시작
      j.className = `judge show ${result}`;
    };
    window.addEventListener('pull-progress', this._pullProgressHandler);
    window.addEventListener('cart-launched', this._launchedHandler);
    window.addEventListener('gate-result', this._gateHandler);
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

      // 밸런스 가이드: 목표 기울기 ±leanWindow를 노란 구간으로, 현재 입력을 흰 마커로 (−1~1 → 0~100%)
      const seg = track.getSegmentAt(cart.t);
      const pct = v => (Math.max(-1, Math.min(1, v)) + 1) * 50;
      if (cart.launched && seg.requiredLean > 0) {
        const target = seg.curveDirection === 'left' ? -seg.requiredLean : seg.requiredLean;
        h.balanceZone.style.left = `${pct(target - seg.leanWindow).toFixed(1)}%`;
        h.balanceZone.style.right = `${(100 - pct(target + seg.leanWindow)).toFixed(1)}%`;
        h.balanceMarker.style.left = `${pct(cart.leanInput).toFixed(1)}%`;
        h.balance.classList.add('on');
      } else {
        h.balance.classList.remove('on');
      }

      // 게이트 가이드: 세그먼트 진행률 위 판정 창(초록 = 지금 탭)
      if (cart.launched && seg.gate) {
        const local = (cart.t - seg.tStart) / (seg.tEnd - seg.tStart);
        const { start, end } = seg.gate.timingWindow;
        h.gateLabel.textContent = GATE_LABEL[seg.gate.type] || '';
        h.gateZone.style.left = `${start * 100}%`;
        h.gateZone.style.right = `${(1 - end) * 100}%`;
        h.gateMarker.style.left = `${Math.min(100, local * 100).toFixed(1)}%`;
        h.gate.classList.toggle('ready', local >= start && local <= end);
        h.gate.classList.add('on');
      } else {
        h.gate.classList.remove('on');
      }
    }
    h.cameraBtn.disabled = !cart.launched;
    h.pauseBtn.disabled = !cart.launched;
  },

  /** 결과 판정 요약 — 랭크는 "판정 점수"(게이트+커브 밸런스 기본 점수) ÷ 그 스테이지 만점 비율.
   * 에어타임은 초당 점수라 느리게 갈수록 쌓여(완벽 플레이보다 평균 플레이가 높아지는 역전) 랭크에서 제외하고,
   * 콤보/피니쉬 배율도 제외해 순수 판정 실력만 반영. 기준은 score-sim.mjs 시뮬레이션으로 정함(개발기록 27번) */
  _summarize(cart, stageData) {
    const bt = cart.balanceTicks;
    const bTotal = bt.perfect + bt.good + bt.miss;
    const balanceAcc = bTotal ? (bt.perfect + bt.good) / bTotal : 1;
    const gates = { perfect: 0, good: 0, miss: 0 };
    cart._gateResults.forEach(g => { gates[g.result] += 1; });
    const gateCount = stageData.segments.filter(s => s.gate).length * cart.totalLaps; // 못 누른 게이트도 실패로 취급
    const curveCount = stageData.segments.filter(s => s.requiredLean > 0).length * cart.totalLaps;
    const judgeMax = gateCount * SCORE.gate.perfect + curveCount * SCORE.balancePerCurve;
    const judgeRatio = judgeMax ? (cart.scoreBreakdown.gate + cart.scoreBreakdown.balance) / judgeMax : 1;
    const rank = judgeRatio >= 0.9 ? 'S' : judgeRatio >= 0.7 ? 'A' : judgeRatio >= 0.45 ? 'B' : 'C';
    return {
      rank, balanceAcc, gates, judgeRatio, curveCount, curvesCleared: cart.curvesCleared || 0,
      gateMissed: Math.max(0, gateCount - gates.perfect - gates.good - gates.miss),
    };
  },

  showResult(cart, stageIndex) {
    AudioManager.playResultFanfare();
    const stageData = STAGES[stageIndex];
    const sum = this._summarize(cart, stageData);
    const score = Math.round(cart.score);
    const bd = cart.scoreBreakdown;
    const rec = ProgressManager.record(stageData.id, score, sum.rank);
    this._setScreen(`
      <div class="screen modal-overlay" id="resultScreen">
        <div class="card result-card">
          <div class="ribbon">완주!</div>
          <div class="result-stage">${stageData.name}</div>
          <div class="rank ${sum.rank}">${sum.rank}</div>
          <div class="result-score"><small>SCORE</small>${score.toLocaleString()}</div>
          ${rec.firstClear ? '<div class="new-best">첫 클리어!</div>' : rec.newBest ? '<div class="new-best">NEW BEST!</div>' : `<div class="result-stage">최고 ${ProgressManager.get(stageData.id).best.toLocaleString()}</div>`}
          <div class="breakdown">
            ${[
              ['게이트', bd.gate],
              [`밸런스 (커브 ${sum.curvesCleared}/${sum.curveCount})`, bd.balance],
              ['에어타임', bd.airtime],
              ['콤보 보너스', bd.comboBonus],
              ...(bd.finishBonus > 0 ? [['피니쉬 보너스', bd.finishBonus]] : []),
            ].map(([k, v]) => `<div class="bd-row"><span>${k}</span><b>+${Math.round(v).toLocaleString()}</b></div>`).join('')}
          </div>
          <div class="stats">
            <div class="stat"><small>최고 콤보</small><b>${cart.maxCombo.toLocaleString()}</b></div>
            <div class="stat"><small>밸런스 정확도</small><b>${Math.round(sum.balanceAcc * 100)}%</b></div>
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
