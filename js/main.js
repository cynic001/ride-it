/**
 * main.js
 * 씬 초기화 + 고정 타임스텝(60Hz) 게임 루프
 * 물리(카트 이동, 판정)는 항상 60Hz로 고정, 렌더링만 보간으로 부드럽게 처리
 * (SE2 등 저사양 기기의 프레임 드랍 상황에서도 판정 타이밍이 흔들리지 않도록)
 */

const FIXED_DT = 1 / 60;

const Game = {
  engine: null,
  scene: null,
  canvas: null,
  track: null,
  cart: null,
  camera: null,
  input: null,

  currentStageIndex: 0,
  accumulator: 0,
  lastTime: 0,

  init() {
    this.canvas = document.getElementById('renderCanvas');
    this.engine = new BABYLON.Engine(this.canvas, true, { stencil: true }, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color3(0.53, 0.8, 0.92);

    QualityManager.detectInitialPreset(this.engine);
    this._applyQualitySettings();

    new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), this.scene);

    window.addEventListener('resize', () => this.engine.resize());
    window.addEventListener('quality-downgraded', e => {
      console.log('[Quality] 자동 다운그레이드:', e.detail);
      this._applyQualitySettings();
    });
  },

  /** 스테이지 로드 (UI에서 스테이지 선택 시 호출) */
  loadStage(stageIndex) {
    this.currentStageIndex = stageIndex;
    const stageData = STAGES[stageIndex];

    if (this.track) {
      // 이전 스테이지 리소스 정리 (실제 구현 시 mesh dispose 등 추가 필요)
    }

    this.track = new Track(stageData, this.scene);

    // 스테이지 배속: 기본 +10%/스테이지를 참고선으로 두되, 모티브별 baseSpeedKmh가 우선
    const stageMultiplier = stageData.baseSpeedKmh / 45; // 1단계(45km/h) 대비 배율로 정규화

    this.cart = new Cart(this.track, stageMultiplier);
    this.camera = new CoasterCamera(this.scene, this.canvas);
    this.input = new InputController(this.canvas, this.cart, this.camera);

    // TODO: 트랙 메시 렌더링 (glTF 트랙 지지대/레일 배치는 별도 구현 예정)
    this._drawDebugTrackLine();

    UI.showStartPrompt(stageData.name, stageData.motif);
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.engine.runRenderLoop(() => this._loop());
  },

  /** 실제 3D 트랙 메시 완성 전까지 진행률 확인용 디버그 라인 */
  _drawDebugTrackLine() {
    BABYLON.MeshBuilder.CreateLines('trackDebug', { points: this.track.points }, this.scene);
  },

  _applyQualitySettings() {
    const settings = QualityManager.settings;
    this.engine.setHardwareScalingLevel(settings.textureResolution < 1024 ? 1.5 : 1);
    // TODO: 파티클 수, 그림자, 포스트프로세싱은 실제 에셋/이펙트 구현 시 settings 참조해 적용
  },

  _loop() {
    const now = performance.now();
    const frameTime = Math.min((now - this.lastTime) / 1000, 0.25); // 스파이럴 오브 데스 방지 클램프
    this.lastTime = now;
    this.accumulator += frameTime;

    while (this.accumulator >= FIXED_DT) {
      this._fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    const alpha = this.accumulator / FIXED_DT;
    this._render(alpha);

    const fps = this.engine.getFps();
    QualityManager.reportFrame(fps, now);
  },

  _fixedUpdate(dt) {
    if (!this.cart || !this.cart.launched) return;

    this.cart.update(dt);
    this.camera.update(this.track, this.cart, dt);
    UI.updateHUD(this.cart);

    if (this.cart.isFinished) {
      this.camera.unlockToggle(); // 이미 풀려있겠지만 안전장치
      UI.showResult(this.cart.score, this.currentStageIndex);
      this.engine.stopRenderLoop();
    }

    // 스타트 완료(카트 발사) 시 카메라 토글 잠금 해제
    if (this.cart.launched) {
      this.camera.unlockToggle();
    }
  },

  _render(alpha) {
    this.scene.render();
  },
};

window.Game = Game;

window.addEventListener('DOMContentLoaded', () => {
  Game.init();
  UI.showStageSelect(STAGES, stageIndex => Game.loadStage(stageIndex));
});
