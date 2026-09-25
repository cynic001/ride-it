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
  cartMesh: null,
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
      this.track.dispose(); // 이전 스테이지의 레일/지지대/스테이션 인스턴스 정리
    }

    this.track = new Track(stageData, this.scene);
    this.track.loadTrackMeshes();

    // 스테이지 배속: 기본 +10%/스테이지를 참고선으로 두되, 모티브별 baseSpeedKmh가 우선
    const stageMultiplier = stageData.baseSpeedKmh / 45; // 1단계(45km/h) 대비 배율로 정규화

    this.cart = new Cart(this.track, stageMultiplier, LapsManager.current);
    this.camera = new CoasterCamera(this.scene, this.canvas);

    // showStartPrompt가 스타트 바 DOM을 먼저 만들어야 InputController가 그 엘리먼트에 바인딩 가능
    UI.showStartPrompt(stageData.name, stageData.motif);
    this.input = new InputController(this.canvas, this.cart, this.camera, UI.startBarEl);

    this._loadCartMesh();

    this.accumulator = 0;
    this.lastTime = performance.now();
    this.engine.runRenderLoop(() => this._loop());
  },

  /** 카트 glTF 로드 — 트랙 진행률(t)에 따라 매 고정 스텝마다 위치/방향 갱신 */
  async _loadCartMesh() {
    if (this.cartMesh) {
      this.cartMesh.dispose();
      this.cartMesh = null;
    }
    const result = await BABYLON.SceneLoader.ImportMeshAsync('', 'assets/models/', 'cart.glb', this.scene);
    // meshes[0]("__root__")는 glTF 좌표계 변환용 미러링(scaling.z=-1)+180도 회전이 baked-in 되어 있어
    // lookAt()과 결합하면 급커브에서 시각적으로 틀어짐 — track.js의 레일/지지대/스테이션과 동일하게
    // 실제 지오메트리 메시(meshes[1])를 부모에서 분리해 깨끗한 트랜스폼으로 사용
    this.cartMesh = result.meshes[1];
    this.cartMesh.parent = null;
    this.cartMesh.setEnabled(true);
    result.meshes[0].dispose(); // 빈 __root__는 더 이상 필요 없음
    this._updateCartMesh();
  },

  /** cart.t가 가리키는 트랙 위치/접선/뱅킹으로 카트 메시 위치·방향 동기화
   * (roll을 track.js의 레일 뱅킹과 동일한 getBankRollAt()으로 맞추지 않으면 커브 구간에서
   * 카트만 안 기울어져 레일과 따로 노는 것처럼 보임) */
  _updateCartMesh() {
    if (!this.cartMesh || !this.track || !this.cart) return;
    const pos = this.track.getPositionAt(this.cart.t);
    const tangent = this.track.getTangentAt(this.cart.t);
    const roll = this.track.getBankRollAt(this.cart.t);
    this.cartMesh.position.copyFrom(pos);
    this.cartMesh.lookAt(pos.add(tangent), 0, 0, roll);
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
    this._updateCartMesh();
    UI.updateHUD(this.cart, this.track);

    AudioManager.updateWind(this.cart.speed);
    const currentSeg = this.track.getSegmentAt(this.cart.t);
    AudioManager.setAirtimeHold(currentSeg.airtimeZone && this.cart.airtimeHolding);

    if (this.cart.isFinished) {
      AudioManager.updateWind(0);
      AudioManager.setAirtimeHold(false);
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

// iOS Safari 등 자동재생 제한 대응 — 페이지 전체에서 가장 먼저 발생하는 pointerdown(스테이지
// 선택 탭 포함)에서 AudioContext를 생성/resume. capture+once로 특정 요소에 종속되지 않게 처리.
window.addEventListener('pointerdown', () => AudioManager.unlock(), { capture: true, once: true });
