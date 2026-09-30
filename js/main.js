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
  sun: null,
  _ground: null,
  _pipeline: null,
  _shadowGen: null,

  currentStageIndex: 0,
  accumulator: 0,
  lastTime: 0,
  paused: false,

  init() {
    this.canvas = document.getElementById('renderCanvas');
    this.engine = new BABYLON.Engine(this.canvas, true, { stencil: true }, true);
    this.scene = new BABYLON.Scene(this.engine);
    QualityManager.detectInitialPreset(this.engine);
    this._createEnvironment();

    this._applyQualitySettings();

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

    // 스테이지 배속: 기본 +10%/스테이지를 참고선으로 두되, 모티브별 baseSpeedKmh가 우선
    const stageMultiplier = stageData.baseSpeedKmh / 45; // 1단계(45km/h) 대비 배율로 정규화

    this.cart = new Cart(this.track, stageMultiplier, LapsManager.current);
    if (this.camera) this.camera.dispose(); // 이전 스테이지 카메라가 activeCamera로 남아 빈 하늘만 보이던 문제 방지
    this.camera = new CoasterCamera(this.scene, this.canvas);
    this._setupPipeline();

    // 레일/지지대/스테이션 + 카트 glb 로딩 동안 스피너 표시 — 끝나야 스타트 바 화면으로 전환
    UI.showLoadingOverlay();
    Promise.all([this.track.loadTrackMeshes(), this._loadCartMesh()])
      .then(() => {
        this._setupShadows();
        // showStartPrompt가 스타트 바 DOM을 먼저 만들어야 InputController가 그 엘리먼트에 바인딩 가능
        UI.showStartPrompt(stageData.name, stageData.motif);
        this.input = new InputController(this.canvas, this.cart, this.camera, UI.startBarEl);

        this.accumulator = 0;
        this.lastTime = performance.now();
        this.engine.runRenderLoop(() => this._loop());
      })
      .catch(err => {
        console.error('[Assets] 스테이지 에셋 로드 실패:', err);
        UI.showLoadError(() => this.loadStage(stageIndex));
      });
  },

  /** HUD의 일시정지 버튼 — 물리 루프를 완전히 멈추고 오버레이로 전환 */
  pauseGame() {
    if (!this.cart || !this.cart.launched || this.paused) return;
    this.paused = true;
    this.engine.stopRenderLoop();
    AudioManager.updateWind(0);
    AudioManager.setAirtimeHold(false);
    UI.showPauseOverlay();
  },

  resumeGame() {
    if (!this.paused) return;
    this.paused = false;
    UI.hidePauseOverlay();
    this.accumulator = 0;
    this.lastTime = performance.now(); // 정지해 있던 시간만큼 frameTime이 튀지 않도록 리셋
    this.engine.runRenderLoop(() => this._loop());
  },

  /** 일시정지 메뉴 → 스테이지 선택으로 복귀 (재시도 로직과 동일한 dispose 패턴) */
  exitToStageSelect() {
    this.paused = false;
    this.engine.stopRenderLoop();
    AudioManager.updateWind(0);
    AudioManager.setAirtimeHold(false);
    if (this.cartMesh) {
      this.cartMesh.dispose();
      this.cartMesh = null;
    }
    if (this.track) {
      this.track.dispose();
      this.track = null;
    }
    UI.hidePauseOverlay();
    UI.showStageSelect(STAGES, i => Game.loadStage(i));
  },

  /** 카트 glTF 로드 — 트랙 진행률(t)에 따라 매 고정 스텝마다 위치/방향 갱신 */
  async _loadCartMesh() {
    if (this.cartMesh) {
      this.cartMesh.dispose();
      this.cartMesh = null;
    }
    // 트랙 패밀리(railType)에 맞는 Kenney 카트 — 레일과 같은 KIT_SCALE로 맞춰야 레일 폭과 바퀴가 일치
    const result = await BABYLON.SceneLoader.ImportMeshAsync('', KIT_DIR, this.track.family.cart, this.scene);
    // meshes[0]("__root__")는 glTF 좌표계 변환용 미러링(scaling.z=-1)+180도 회전이 baked-in 되어 있어
    // lookAt()과 결합하면 급커브에서 시각적으로 틀어짐 — track.js의 레일/지지대/스테이션과 동일하게
    // 실제 지오메트리 메시(meshes[1])를 부모에서 분리해 깨끗한 트랜스폼으로 사용
    this.cartMesh = result.meshes[1];
    this.cartMesh.parent = null;
    // 인버티드 카트(coaster-train-hanging)는 원점이 차체 중심에서 옆으로 약 0.3 치우쳐 있어 레일 옆에 매달려
    // 보였음 — 바운딩박스 수평 중심을 원점으로 옮겨 레일 바로 아래에 오도록(대칭 모델은 사실상 변화 없음)
    const cbb = this.cartMesh.getBoundingInfo().boundingBox;
    const cx = (cbb.minimum.x + cbb.maximum.x) / 2, cz = (cbb.minimum.z + cbb.maximum.z) / 2;
    if (Math.abs(cx) > 0.01 || Math.abs(cz) > 0.01) {
      this.cartMesh.bakeTransformIntoVertices(BABYLON.Matrix.Translation(-cx, 0, -cz));
    }
    this.cartMesh.scaling.setAll(KIT_SCALE);
    // 카트 도장면 광택 — Kenney 기본값(거친 무광)보다 반사를 살려 IBL 하늘이 비치게
    const cartMat = this.cartMesh.material;
    if (cartMat && 'roughness' in cartMat) {
      cartMat.metallic = 0.15;
      cartMat.roughness = 0.22;
      cartMat.clearCoat.isEnabled = QualityManager.current === 'high';
    }
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

  /** Poly Haven 맑은 하늘 HDRI(프리필터드 .env) → IBL + 스카이박스, 태양광, 잔디 바닥, 옅은 안개.
   * 품질과 무관한 공통 씬 요소 — 프리셋별로 달라지는 그림자/포스트프로세싱은 _applyQualitySettings */
  _createEnvironment() {
    const scene = this.scene;
    scene.clearColor = new BABYLON.Color4(0.72, 0.84, 0.95, 1); // HDRI 로드 전/틈 노출 시 폴백 = 지평선 색

    const env = BABYLON.CubeTexture.CreateFromPrefilteredData('assets/vendor/polyhaven/sky_256.env', scene);
    scene.environmentTexture = env;
    scene.environmentIntensity = 0.9;
    const sky = scene.createDefaultSkybox(env, true, 1000, 0, false);
    sky.infiniteDistance = true;
    sky.applyFog = false; // 안개는 지형/소품에만 — 하늘까지 덮으면 뿌옇게 바랜 느낌

    // 태양: HDRI 이름대로 고도 약 43도 — 방향만 맞추고 세기는 IBL과 합쳐 과노출 안 되게
    this.sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.55, -0.68, 0.48).normalize(), scene);
    this.sun.intensity = 2.2;
    this.sun.shadowMinZ = 1;

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 1600, height: 1600 }, scene);
    ground.position.y = -0.02; // 지지대 밑면(y=0)과 z-fighting 방지
    const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
    groundMat.albedoTexture = this._makeGrassTexture();
    groundMat.albedoTexture.uScale = groundMat.albedoTexture.vScale = 160;
    groundMat.metallic = 0;
    groundMat.roughness = 1;
    groundMat.environmentIntensity = 0.6; // 넓은 면이 하늘빛 반사로 떠 보이지 않게
    ground.material = groundMat;
    ground.receiveShadows = true;
    ground.isPickable = false;
    this._ground = ground;

    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0017;
    scene.fogColor = new BABYLON.Color3(0.74, 0.85, 0.96);
  },

  /** 잔디 바닥용 256px 절차적 텍스처(명도 얼룩) — 이미지 파일 없이 타일링 반복감만 깨줌 */
  _makeGrassTexture() {
    const tex = new BABYLON.DynamicTexture('grassTex', { width: 256, height: 256 }, this.scene, true);
    const ctx = tex.getContext();
    ctx.fillStyle = '#5a9a3c';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const l = 30 + Math.random() * 18;
      ctx.fillStyle = `hsla(${95 + Math.random() * 20}, 45%, ${l}%, 0.35)`;
      const x = Math.random() * 256, y = Math.random() * 256, r = 2 + Math.random() * 7;
      // 경계에서 이어지도록 가장자리 근처 얼룩은 반대편에도 복제(타일 이음매 방지)
      for (const [ox, oy] of [[0, 0], [-256, 0], [256, 0], [0, -256], [0, 256]]) {
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    tex.update();
    tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;
    return tex;
  },

  _applyQualitySettings() {
    const settings = QualityManager.settings;
    this.engine.setHardwareScalingLevel(settings.textureResolution < 1024 ? 1.5 : 1);
    this._setupPipeline();
    this._setupShadows();
  },

  /** DefaultRenderingPipeline — low는 FXAA만(LDR), medium/high는 HDR + ACES 톤매핑 + 약한 bloom.
   * 카메라가 스테이지마다 새로 만들어지므로 loadStage에서도 다시 호출해 새 카메라에 붙인다. */
  _setupPipeline() {
    if (this._pipeline) {
      this._pipeline.dispose();
      this._pipeline = null;
    }
    if (!this.camera) return;
    const pp = QualityManager.settings.postProcessing;
    const hdr = pp.includes('bloom') || pp.includes('aces');
    const pipeline = new BABYLON.DefaultRenderingPipeline('pp', hdr, this.scene, [this.camera.camera]);
    pipeline.fxaaEnabled = pp.includes('fxaa');
    pipeline.imageProcessingEnabled = pp.includes('aces');
    if (pp.includes('aces')) {
      pipeline.imageProcessing.toneMappingEnabled = true;
      pipeline.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
      pipeline.imageProcessing.exposure = 1.15;
      pipeline.imageProcessing.contrast = 1.1;
    }
    pipeline.bloomEnabled = pp.includes('bloom');
    if (pipeline.bloomEnabled) {
      pipeline.bloomThreshold = 0.85;
      pipeline.bloomWeight = 0.25;
      pipeline.bloomKernel = 48;
      pipeline.bloomScale = 0.5;
    }
    this._pipeline = pipeline;
  },

  /** 실시간 그림자는 high 프리셋에서만 — 카트/레일/지지대/소품이 캐스터, 바닥이 리시버 */
  _setupShadows() {
    if (this._shadowGen) {
      this._shadowGen.dispose();
      this._shadowGen = null;
    }
    if (QualityManager.settings.shadows !== 'realtime' || !this.track) return;
    const gen = new BABYLON.ShadowGenerator(2048, this.sun);
    gen.usePercentageCloserFiltering = true;
    gen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
    gen.bias = 0.002;
    this.track.shadowCasters().forEach(m => gen.addShadowCaster(m, false));
    if (this.cartMesh) gen.addShadowCaster(this.cartMesh, false);
    this.sun.autoUpdateExtends = true;
    this._shadowGen = gen;
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
    if (!this.cart) return;
    if (!this.cart.launched) {
      // 발사 전에도 카메라는 스타트 지점 3인칭 위치로 따라가야 함 — 안 하면 초기 좌표(0,10,-20)에서 엉뚱한 곳을 봄
      this.camera.update(this.track, this.cart, dt);
      return;
    }

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
