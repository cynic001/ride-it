/**
 * ui.js
 * DOM 오버레이 기반 UI: 스테이지 선택, HUD, 시작 안내, 결과 화면, 품질 설정
 * (Canvas 내부가 아닌 별도 DOM 레이어 — 터치 타겟 확보가 쉽고 CSS로 다루기 편함)
 */

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
      </div>
    `;

    this.root.querySelectorAll('.stage-btn').forEach(btn => {
      btn.addEventListener('click', () => onSelect(Number(btn.dataset.index)));
    });

    document.getElementById('qualityBtn').addEventListener('click', () => this._cycleQuality());
  },

  _cycleQuality() {
    const order = ['low', 'medium', 'high'];
    const next = order[(order.indexOf(QualityManager.current) + 1) % order.length];
    QualityManager.setPreset(next);
    const btn = document.getElementById('qualityBtn');
    if (btn) btn.textContent = `그래픽: ${next}`;
  },

  showStartPrompt(name, motif) {
    this.root.innerHTML = `
      <div class="screen hud">
        <div class="top-bar">
          <span class="stage-label">${name}</span>
          <span class="speed-label" id="speedLabel">0 km/h</span>
          <span class="combo-label" id="comboLabel">Combo 0</span>
        </div>
        <div class="start-hint" id="startHint">화면을 당겼다 놓으면 출발!</div>
        <button class="camera-toggle" id="cameraToggleBtn" disabled>시점 전환</button>
      </div>
    `;

    document.getElementById('cameraToggleBtn').addEventListener('click', () => {
      if (Game.camera && !Game.camera.locked) Game.camera.toggleMode();
    });
  },

  updateHUD(cart) {
    const speedLabel = document.getElementById('speedLabel');
    const comboLabel = document.getElementById('comboLabel');
    const startHint = document.getElementById('startHint');
    const cameraBtn = document.getElementById('cameraToggleBtn');

    if (speedLabel) speedLabel.textContent = `${Math.round(cart.speed * 3.6)} km/h`; // m/s → km/h
    if (comboLabel) comboLabel.textContent = `Combo ${cart.combo}`;
    if (startHint) startHint.style.display = cart.launched ? 'none' : 'block';
    if (cameraBtn) cameraBtn.disabled = !cart.launched;
  },

  showResult(score, stageIndex) {
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
