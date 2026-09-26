/**
 * ui.js
 * DOM 오버레이 기반 UI: 스테이지 선택, HUD, 시작 안내, 결과 화면, 품질 설정
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

const UI = {
  root: null,

  init() {
    this.root = document.getElementById('uiRoot');
  },

  showStageSelect(stages, onSelect) {
    this.root.innerHTML = `
      <div class="screen stage-select">
        <h1>롤러코스터</h1>
        <div class="stage-list">
          ${stages.map((s, i) => `
            <button class="stage-btn" data-index="${i}">
              <span class="stage-name">${s.name}</span>
              <span class="stage-motif">${s.motif}</span>
            </button>
          `).join('')}
        </div>
        <button class="quality-toggle" id="qualityBtn">그래픽: ${QualityManager.current}</button>
        <button class="quality-toggle" id="lapsBtn">턴 반복: ${LapsManager.current}랩</button>
        <button class="quality-toggle" id="audioBtn">사운드: ${AudioManager.enabled ? 'ON' : 'OFF'}</button>
        <button class="quality-toggle" id="howtoBtn">조작법</button>
      </div>
    `;

    this.root.querySelectorAll('.stage-btn').forEach(btn => {
      btn.addEventListener('click', () => onSelect(Number(btn.dataset.index)));
    });

    document.getElementById('qualityBtn').addEventListener('click', () => this._cycleQuality());
    document.getElementById('lapsBtn').addEventListener('click', () => this._cycleLaps());
    document.getElementById('audioBtn').addEventListener('click', () => this._cycleAudio());
    document.getElementById('howtoBtn').addEventListener('click', () => this.showHowTo());

    // 최초 1회만 자동으로 조작법 안내 — 이후엔 위 버튼으로만 접근
    if (!localStorage.getItem('rc_howto_seen')) this.showHowTo();
  },

  showHowTo(onClose) {
    const el = document.createElement('div');
    el.className = 'screen modal-overlay';
    el.id = 'howtoOverlay';
    el.innerHTML = `
      <h2>조작법</h2>
      <div class="howto-list">
        <p>➜ <strong>스타트 바</strong> — 바 안에서 당겼다 놓으면 출발</p>
        <p>↔ <strong>좌우 밸런스</strong> — 주행 중 화면 하단을 좌우로 스와이프</p>
        <p>👆 <strong>게이트 탭</strong> — 화면 상단/중앙을 타이밍 맞춰 탭 (부스트/브레이크/피니쉬)</p>
        <p>✋ <strong>에어타임 홀드</strong> — 화면을 길게 눌러 손 들기</p>
      </div>
      <button id="howtoCloseBtn" class="primary">확인</button>
    `;
    this.root.appendChild(el);
    document.getElementById('howtoCloseBtn').addEventListener('click', () => {
      el.remove();
      localStorage.setItem('rc_howto_seen', '1');
      if (onClose) onClose();
    });
  },

  showLoadingOverlay() {
    this.root.innerHTML = `
      <div class="screen modal-overlay" id="loadingOverlay">
        <div class="spinner"></div>
        <p>불러오는 중...</p>
      </div>
    `;
  },

  showLoadError(retryFn) {
    this.root.innerHTML = `
      <div class="screen modal-overlay">
        <h2>불러오기 실패</h2>
        <p>에셋을 불러오지 못했습니다. 네트워크를 확인해주세요.</p>
        <button id="retryLoadBtn" class="primary">다시 시도</button>
      </div>
    `;
    document.getElementById('retryLoadBtn').addEventListener('click', retryFn);
  },

  showPauseOverlay() {
    const el = document.createElement('div');
    el.className = 'screen modal-overlay';
    el.id = 'pauseOverlay';
    el.innerHTML = `
      <h2>일시정지</h2>
      <button id="resumeBtn" class="primary">계속하기</button>
      <button id="pauseExitBtn">스테이지 선택으로</button>
    `;
    this.root.appendChild(el);
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
    if (btn) btn.textContent = `그래픽: ${next}`;
  },

  _cycleLaps() {
    const order = [1, 2, 3];
    const next = order[(order.indexOf(LapsManager.current) + 1) % order.length];
    LapsManager.setLaps(next);
    const btn = document.getElementById('lapsBtn');
    if (btn) btn.textContent = `턴 반복: ${next}랩`;
  },

  _cycleAudio() {
    const next = !AudioManager.enabled;
    AudioManager.setEnabled(next);
    const btn = document.getElementById('audioBtn');
    if (btn) btn.textContent = `사운드: ${next ? 'ON' : 'OFF'}`;
  },

  showStartPrompt(name, motif) {
    // 스테이지를 재도전/재선택할 때마다 새로 호출되므로, 직전 호출에서 등록해둔 window 리스너를
    // 먼저 정리 — 그대로 두면 "발사 전에 스테이지 선택으로 돌아가기"를 반복할 때마다 리스너가
    // 계속 쌓이는 누수가 생김
    if (this._pullProgressHandler) window.removeEventListener('pull-progress', this._pullProgressHandler);
    if (this._launchedHandler) window.removeEventListener('cart-launched', this._launchedHandler);

    this.root.innerHTML = `
      <div class="screen hud">
        <div class="top-bar">
          <span class="stage-label">${name}</span>
          <span class="speed-label" id="speedLabel">0 km/h</span>
          <span class="turn-label" id="turnLabel"></span>
          <span class="combo-label" id="comboLabel">Combo 0</span>
        </div>
        <div class="start-bar" id="startBar">
          <div class="start-bar-label">당겨서 출발!</div>
          <div class="start-bar-track">
            <div class="start-bar-fill" id="startBarFill"></div>
            <div class="start-bar-handle" id="startBarHandle">➜</div>
          </div>
        </div>
        <div class="hud-controls">
          <button class="hud-icon-btn" id="soundToggleBtn">${AudioManager.enabled ? '🔊' : '🔇'}</button>
          <button class="hud-icon-btn" id="pauseBtn" disabled>⏸</button>
          <button class="camera-toggle" id="cameraToggleBtn" disabled>시점 전환</button>
        </div>
      </div>
    `;

    document.getElementById('cameraToggleBtn').addEventListener('click', () => {
      if (Game.camera && !Game.camera.locked) Game.camera.toggleMode();
    });
    document.getElementById('pauseBtn').addEventListener('click', () => Game.pauseGame());
    document.getElementById('soundToggleBtn').addEventListener('click', () => {
      const next = !AudioManager.enabled;
      AudioManager.setEnabled(next);
      document.getElementById('soundToggleBtn').textContent = next ? '🔊' : '🔇';
    });

    // input.js가 실제 드래그를 받는 스타트 바 DOM — main.js가 InputController에 이 엘리먼트를 넘김
    this.startBarEl = document.getElementById('startBar');
    const track = this.startBarEl.querySelector('.start-bar-track');
    const fill = document.getElementById('startBarFill');
    const handle = document.getElementById('startBarHandle');

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
    window.addEventListener('pull-progress', this._pullProgressHandler);
    window.addEventListener('cart-launched', this._launchedHandler);
  },

  updateHUD(cart, track) {
    const speedLabel = document.getElementById('speedLabel');
    const comboLabel = document.getElementById('comboLabel');
    const turnLabel = document.getElementById('turnLabel');
    const cameraBtn = document.getElementById('cameraToggleBtn');
    const pauseBtn = document.getElementById('pauseBtn');

    if (speedLabel) speedLabel.textContent = `${Math.round(cart.speed * 3.6)} km/h`; // m/s → km/h
    if (comboLabel) comboLabel.textContent = `Combo ${cart.combo}`;
    if (turnLabel && track) {
      const ranges = track.segmentRanges;
      const idx = ranges.findIndex(s => cart.t >= s.tStart && cart.t < s.tEnd);
      const turnNum = idx === -1 ? ranges.length : idx + 1;
      const lapPrefix = cart.totalLaps > 1 ? `Lap ${cart.currentLap}/${cart.totalLaps} · ` : '';
      turnLabel.textContent = `${lapPrefix}Turn ${turnNum}/${ranges.length}`;
    }
    if (cameraBtn) cameraBtn.disabled = !cart.launched;
    if (pauseBtn) pauseBtn.disabled = !cart.launched;
  },

  showResult(score, stageIndex) {
    AudioManager.playResultFanfare();
    this.root.innerHTML = `
      <div class="screen result">
        <h2>완주!</h2>
        <p class="score">Score: ${Math.round(score)}</p>
        <button id="retryBtn">다시 도전</button>
        <button id="stageSelectBtn">스테이지 선택</button>
      </div>
    `;
    document.getElementById('retryBtn').addEventListener('click', () => Game.loadStage(stageIndex));
    document.getElementById('stageSelectBtn').addEventListener('click', () => this.showStageSelect(STAGES, i => Game.loadStage(i)));
  },
};

window.UI = UI;
window.addEventListener('DOMContentLoaded', () => UI.init());
