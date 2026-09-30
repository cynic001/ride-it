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
    if (this.input) this.input.dispose(); // 이전 스테이지 입력 리스너가 남아 탭이 중복 판정되던 문제 방지
    if (this.camera) this.camera.dispose(); // 이전 스테이지 카메라가 activeCamera로 남아 빈 하늘만 보이던 문제 방지
    this.camera = new CoasterCamera(this.scene, this.canvas);
    this._setupPipeline();
    StyleManager.apply(this);

    // 레일/지지대/스테이션 + 카트 glb 로딩 동안 스피너 표시 — 끝나야 스타트 바 화면으로 전환
    UI.showLoadingOverlay();
    AudioManager.preloadSamples(); // 녹음 효과음 미리 받기(작은 파일, 서비스 워커가 캐싱)
    AudioManager.setBgmMode('menu'); // 재도전 시 드럼 빠진 잔잔한 버전으로 — 발사(cart-launched) 때 ride로 전환
    Promise.all([this.track.loadTrackMeshes(), this._loadCartMesh()])
      .then(() => {
        this._setupShadows();
        this._setupSplash();
        StyleManager.apply(this); // 새로 로드된 glb 재질에 단계형 음영 적용
        // showStartPrompt가 스타트 바 DOM을 먼저 만들어야 InputController가 그 엘리먼트에 바인딩 가능
        UI.showStartPrompt(stageData.name, stageData.motif);
        this.input = new InputController(this.canvas, this.cart, this.camera, UI.startBarEl, ControlSettings.mode);

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
    AudioManager.setBgmMode('pause');
    SpeedLines.draw(0, 0);
    if (this._vignette) this._vignette.style.opacity = '0';
    UI.showPauseOverlay();
  },

  resumeGame() {
    if (!this.paused) return;
    this.paused = false;
    UI.hidePauseOverlay();
    AudioManager.setBgmMode('ride');
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
    AudioManager.setBgmMode('menu');
    SpeedLines.draw(0, 0);
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
    this._skybox = sky;
    sky.infiniteDistance = true;
    sky.applyFog = false; // 안개는 지형/소품에만 — 하늘까지 덮으면 뿌옇게 바랜 느낌

    // 태양: HDRI 이름대로 고도 약 43도 — 방향만 맞추고 세기는 IBL과 합쳐 과노출 안 되게
    this.sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.55, -0.68, 0.48).normalize(), scene);
    this.sun.intensity = 2.2;
    this.sun.shadowMinZ = 1;

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 5000, height: 5000 }, scene); // 4·5단계 70m 높이에서도 지면 끝이 안개 안에 묻히도록
    ground.position.y = -0.02; // 지지대 밑면(y=0)과 z-fighting 방지
    const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
    groundMat.albedoTexture = this._makeGrassTexture();
    groundMat.albedoTexture.uScale = groundMat.albedoTexture.vScale = 500;
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
    // 잔디 깎은 줄무늬(밝고 어두운 띠 반복) — 지면 흐름이 잘 보여 속도감이 커짐
    ctx.fillStyle = '#5a9a3c';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#4c8a31';
    ctx.fillRect(0, 0, 128, 256);
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
    StyleManager.apply(this); // 파이프라인이 새로 만들어졌으니 스타일 색보정/외곽선 다시 적용
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

    if (this._motionBlur) {
      this._motionBlur.dispose(); // 이전 스테이지 카메라는 이미 dispose됐을 수 있어 카메라 인자 없이 전체 해제
      this._motionBlur = null;
    }
    if (this._radial) {
      this._radial.dispose();
      this._radial = null;
    }
    const rs = QualityManager.settings.radialBlur;
    if (rs) {
      // 부스트 가속 중에만 붙였다 뗌(_render) — 평소엔 풀스크린 패스 비용 0
      const defines = `#define SAMPLES ${rs}\n${QualityManager.settings.chromaticAberration ? '#define CA\n' : ''}`;
      const rp = new BABYLON.PostProcess('radialBoost', 'radialBoost', ['center', 'strength'], null, 1.0, null,
        BABYLON.Texture.BILINEAR_SAMPLINGMODE, this.engine, false, defines);
      rp.onApply = eff => {
        eff.setFloat2('center', this._radialCenter ? this._radialCenter.x : 0.5, this._radialCenter ? this._radialCenter.y : 0.55);
        eff.setFloat('strength', this._radialStrength || 0);
      };
      this._radial = rp;
      this._radialAttached = false;
    }
    if (QualityManager.settings.motionBlur) {
      // 화면(깊이) 기반 — 카메라 이동에 따른 번짐. 세기는 _render에서 속도 비례로 갱신
      const mb = new BABYLON.MotionBlurPostProcess('motionBlur', this.scene, 1.0, this.camera.camera);
      mb.isObjectBased = false;
      mb.motionBlurSamples = 12;
      mb.motionStrength = 0;
      this._motionBlur = mb;
    }
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

    if (this.input) this.input.update(dt);
    this.cart.update(dt);
    this.camera.update(this.track, this.cart, dt);
    this._updateCartMesh();
    UI.updateHUD(this.cart, this.track);

    const diveNow = Math.max(0, -this.track.getTangentAt(this.cart.t).y - 0.2);
    AudioManager.updateWind(this.cart.speed / this.cart.maxSpeedMs, Math.min(1, diveNow * 1.6));
    const currentSeg = this.track.getSegmentAt(this.cart.t);
    AudioManager.setAirtimeHold(currentSeg.airtimeZone && this.cart.airtimeHolding);

    this._updateRideSounds();
    const ty = this.track.getTangentAt(this.cart.t).y;
    if (!this.cart.rollback && ty < -0.45 && (this._prevTy ?? 0) >= -0.45 && this.cart.speed / this.cart.maxSpeedMs > 0.3
      && performance.now() - (this._lastWhoa || 0) > 4000) {
      this._lastWhoa = performance.now();
      AudioManager.playSample('whoa', { volume: 0.85, rate: 0.95 + Math.random() * 0.15 });
    }
    this._prevTy = ty;
    if (this.cart.isFinished) {
      SpeedLines.draw(0, 0);
      if (this._vignette) this._vignette.style.opacity = '0';
      AudioManager.updateWind(0);
      AudioManager.setAirtimeHold(false);
      this.camera.unlockToggle(); // 이미 풀려있겠지만 안전장치
      AudioManager.setBgmMode('menu');
      UI.showResult(this.cart, this.currentStageIndex);
      this.engine.stopRenderLoop();
    }

    // 스타트 완료(카트 발사) 시 카메라 토글 잠금 해제
    if (this.cart.launched) {
      this.camera.unlockToggle();
    }
  },

  /** 레일 이음새 "덜컹"(6m마다, 속도 비례 음량) + 터널/게이트 링 통과 "휙" */
  _updateRideSounds() {
    const c = this.cart;
    if (c.currentLap !== this._lastLapSeen) { // 뒤로 떨어지기 경고는 매 플레이 두 번째 랩부터
      this._lastLapSeen = c.currentLap;
      this.track.setRollbackMarkersVisible(c.currentLap >= 2);
    }
    // 체인 리프트: 초당 약 12회 딸깍(멈칫하는 동안은 느리게) — 리프트를 벗어나면 멈춤
    if (c.onChainLift || c._crestHold > 0) {
      this._chainAcc = (this._chainAcc || 0) + (c._crestHold > 0 ? 1 / 60 * 0.4 : 1 / 60);
      if (this._chainAcc >= 1 / 12) { this._chainAcc = 0; AudioManager.playChainClick(); }
    }
    this._jointAcc = (this._jointAcc || 0) + (c._stepDistance || 0);
    if (this._jointAcc >= 6) {
      this._jointAcc %= 6;
      AudioManager.playRailJoint(c.speed / c.maxSpeedMs);
    }
    // 피니쉬 아치 통과 = 랩 기준점: LAP n/N · FINAL LAP · FINISH! 표시 + 배너 흔들림 + 효과음
    const ft = this.track.finishT;
    if (ft !== undefined && !c.rollback && (this._prevT ?? c.t) < ft && c.t >= ft) {
      const next = c.currentLap + 1;
      const label = c.currentLap >= c.totalLaps ? 'FINISH!' : next === c.totalLaps ? 'FINAL LAP' : `LAP ${next}/${c.totalLaps}`;
      UI.showLapBanner(label, label === 'FINISH!' || label === 'FINAL LAP');
      this._bannerSwing = 1;
      AudioManager.playLapChime(label === 'FINISH!');
      window.dispatchEvent(new CustomEvent('lap-pass', { detail: label }));
    }
    const sp = this.track.splash;
    if (sp && !c.rollback && (this._prevT ?? c.t) < sp.t && c.t >= sp.t) this._triggerSplash();
    const markers = this.track.passMarkers || [];
    const prev = this._prevT ?? c.t;
    const lookAhead = 0.35 * c.speed * Cart.speedScale / this.track.lengthM; // 소리는 통과 0.35초 전부터 차오름
    markers.forEach(m => {
      if (prev < m.t - lookAhead && c.t >= m.t - lookAhead) AudioManager.playPassBy(m.kind === 'tunnel' ? 1 : 0.6);
    });
    this._prevT = c.t;
  },

  _render(alpha) {
    // 속도감 연출(렌더 프레임 단위): 스피드 라인은 상한 대비 50% 이상부터 차오르고, 부스트/보조 추진 순간 버스트
    const dt = this.engine.getDeltaTime() / 1000;
    let ratio = 0;
    if (this.cart && this.cart.launched && !this.paused) ratio = this.cart.speed / this.cart.maxSpeedMs;
    this._lineBurst = (this._lineBurst || 0) * Math.exp(-dt * 3);
    const intensity = Math.min(1, Math.max(0, (ratio - 0.5) / 0.5) * 0.85 + this._lineBurst);
    SpeedLines.draw(ratio > 0 ? intensity : 0, Math.min(dt, 0.05));
    if (this._motionBlur) this._motionBlur.motionStrength = Math.max(0, ratio - 0.4) * 0.9;
    this._updateBoostFx(dt, ratio);
    if (this.track && this.cart) this.track.updateEventMarkers(this.cart.t, dt, QualityManager.current !== 'low');
    if (this._bannerSwing > 0.01 && this.track && this.track.finishBanner) { // 통과 순간 배너가 펄럭이다 잦아듦
      this._bannerSwing *= Math.exp(-dt * 1.5);
      this._bannerClock = (this._bannerClock || 0) + dt;
      this.track.finishBanner.rotation.x = this.track._bannerBaseRotX + Math.sin(this._bannerClock * 14) * 0.6 * this._bannerSwing;
    }
    if (this.track && this.track.pondTexture && QualityManager.current !== 'low') this.track.pondTexture.vOffset -= dt * 0.05; // 물결 흐름
    if (this._mistBoost > 0.01) { // 5단계 착수 물안개: 안개를 잠깐 짙게 했다가 원래 값으로
      this._mistBoost *= Math.exp(-dt * 1.2);
      if (!this._baseFog) this._baseFog = this.scene.fogDensity;
      this.scene.fogDensity = this._baseFog * (1 + this._mistBoost * 6);
    } else if (this._baseFog) { this.scene.fogDensity = this._baseFog; this._baseFog = null; }
    this.scene.render();
  },

  /** 물 착수 파티클 준비(스테이지 로드 시). 단계(level 1~3)가 오를수록 양·높이·종류 증가, low는 약 1/3로 축소 */
  _setupSplash() {
    (this._splashSystems || []).forEach(ps => ps.dispose());
    this._splashSystems = [];
    const sp = this.track && this.track.splash;
    if (!sp) return;
    const q = { low: 0.35, medium: 0.7, high: 1 }[QualityManager.current] || 0.7;
    const lv = sp.level;
    const tex = new BABYLON.DynamicTexture('dropTex', { width: 32, height: 32 }, this.scene, false);
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(220,240,255,.7)'); g.addColorStop(1, 'rgba(200,230,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32); tex.hasAlpha = true; tex.update();
    const tan = new BABYLON.Vector3(sp.tangent.x, 0, sp.tangent.z).normalize();
    const right = new BABYLON.Vector3(tan.z, 0, -tan.x);
    const origin = new BABYLON.Vector3(sp.pos.x, 0.4, sp.pos.z);
    const make = (name, count, cfg) => {
      const ps = new BABYLON.ParticleSystem(name, Math.max(10, Math.round(count * q)), this.scene);
      ps.particleTexture = tex;
      ps.emitter = origin.clone();
      ps.gravity = new BABYLON.Vector3(0, -9.8, 0);
      ps.minLifeTime = cfg.life[0]; ps.maxLifeTime = cfg.life[1];
      ps.minSize = cfg.size[0]; ps.maxSize = cfg.size[1];
      ps.minEmitPower = 1; ps.maxEmitPower = 1;
      ps.color1 = new BABYLON.Color4(1, 1, 1, 0.8); ps.color2 = new BABYLON.Color4(0.7, 0.88, 1, 0.65);
      ps.colorDead = new BABYLON.Color4(0.8, 0.9, 1, 0);
      ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
      ps.emitRate = 0; ps.manualEmitCount = 0;
      ps.startPositionFunction = (m, pos) => { pos.copyFrom(origin.add(tan.scale((Math.random() - 0.5) * 6))); };
      ps.startDirectionFunction = cfg.dir;
      if (cfg.rainbow) ['#ff5a5a', '#ffb13d', '#fff15a', '#5aff7a', '#5ab4ff', '#b45aff'].forEach((c, i, a) => {
        const col = BABYLON.Color3.FromHexString(c); ps.addColorGradient(i / (a.length - 1), new BABYLON.Color4(col.r, col.g, col.b, 0.9));
      });
      ps.start();
      this._splashSystems.push(ps);
      return { ps, count: Math.round(count * q) };
    };
    const side = (power, upk) => (m, dir) => {
      const sd = Math.random() < 0.5 ? -1 : 1; // 양옆으로 쏟아지는 물보라
      dir.copyFrom(right.scale(sd * (0.5 + Math.random()) * power).add(new BABYLON.Vector3(0, (0.6 + Math.random()) * power * upk, 0)).add(tan.scale(Math.random() * power * 0.6)));
    };
    this._splashFx = { level: lv, bursts: [make('spray', [0, 160, 300, 480][lv], { life: [0.7, 1.4 + 0.3 * lv], size: [0.2, 0.45 + 0.2 * lv], dir: side(5 + 2.5 * lv, 0.8 + 0.3 * lv) })] };
    if (lv >= 3) {
      this._splashFx.bursts.push(make('column', 260, { life: [1.4, 2.4], size: [0.6, 1.5], dir: (m, dir) => dir.set((Math.random() - 0.5) * 3, 16 + Math.random() * 10, (Math.random() - 0.5) * 3) }));
      this._splashFx.bursts.push(make('rainbow', 120, { life: [1.6, 2.8], size: [0.15, 0.35], rainbow: true, dir: (m, dir) => dir.set((Math.random() - 0.5) * 8, 6 + Math.random() * 8, (Math.random() - 0.5) * 8) }));
    }
    this._splashSystems.push({ dispose: () => tex.dispose() });
  },

  /** 착수 순간: 파티클 버스트 + 카메라 킥 + 소리, 4단계+ 화면 물방울, 5단계 물안개(안개 짙게 + 흰 막) */
  _triggerSplash() {
    const fx = this._splashFx;
    if (!fx) return;
    fx.bursts.forEach(b => { b.ps.manualEmitCount = b.count; });
    if (this.camera) this.camera.kick(0.7 + 0.2 * fx.level);
    AudioManager.playSplash(fx.level);
    if (fx.level >= 2) UI.splashDroplets(fx.level === 3 ? 18 : 10);
    if (fx.level >= 3) {
      UI.flashMist();
      this._mistBoost = 1;
    }
    window.dispatchEvent(new CustomEvent('splash', { detail: fx.level }));
  },

  /** 부스트 가속 중 방사형 블러(가속 세기 비례, 끝나면 부드럽게 해제) + 고속 비네트(전 프리셋, CSS) */
  _updateBoostFx(dt, ratio) {
    const c = this.cart;
    const boosting = c && c.launched && !this.paused && c.boostRemaining > 0;
    const target = boosting ? Math.min(1, c.boostAccel / (0.6 * c.baseSpeedMs)) * 0.14 : 0;
    this._radialStrength = BABYLON.Scalar.Lerp(this._radialStrength || 0, target, Math.min(1, dt * (target > (this._radialStrength || 0) ? 8 : 2.5)));
    if (this._radial && this.camera) {
      const cam = this.camera.camera;
      const want = this._radialStrength > 0.004;
      if (want !== this._radialAttached) {
        if (want) cam.attachPostProcess(this._radial); else cam.detachPostProcess(this._radial);
        this._radialAttached = want;
      }
      if (want && this.cartMesh) {
        const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
        const p = BABYLON.Vector3.Project(this.cartMesh.position, BABYLON.Matrix.Identity(), this.scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
        this._radialCenter = { x: Math.min(1, Math.max(0, p.x / w)), y: Math.min(1, Math.max(0, 1 - p.y / h)) };
      }
    }
    if (!this._vignette) this._vignette = document.getElementById('vignette');
    if (this._vignette) {
      const v = c && c.launched && !this.paused ? Math.min(0.7, Math.max(0, (ratio - 0.45) / 0.55) * 0.55 + this._radialStrength * 1.5) : 0;
      this._vignette.style.opacity = v.toFixed(3);
    }
  },

  /** 부스트 성공/보조 추진 순간 — 카메라 킥 + 스피드 라인 버스트 (효과음은 audio.js가 같은 이벤트로 재생) */
  _onBoostMoment(strength) {
    if (this.camera) this.camera.kick(strength);
    this._lineBurst = Math.max(this._lineBurst || 0, strength);
  },
};

window.Game = Game;

window.addEventListener('gate-result', e => {
  if (e.detail.type === 'boost' && (e.detail.result === 'perfect' || e.detail.result === 'good')) {
    Game._onBoostMoment(e.detail.result === 'perfect' ? 1 : 0.7);
  }
});
window.addEventListener('booster-assist', () => Game._onBoostMoment(0.45));
// 뒤로 떨어지기 연출: 뒤로 미끄러지기 시작 = 흔들림 킥, 부스터 발사/연타 성공 = 부스트 킥
window.addEventListener('rollback', e => {
  const ph = e.detail.phase;
  if (ph === 'back') { if (Game.camera) Game.camera.kick(0.6); AudioManager.playPassBy(1.2); AudioManager.playSample('whoa', { volume: 0.9, rate: 1.15 }); }
  else if (ph === 'launch' || ph === 'success') { Game._onBoostMoment(1); AudioManager.playBoostHit(1); }
  if (ph === 'success') AudioManager.playSample('cheer', { volume: 0.8 });
});
window.addEventListener('mash-tap', () => AudioManager.playChainClick());
// 발사 순간 연출: 카메라 밀림+FOV 킥, 스피드 라인 버스트 (발사음은 input.js가 AudioManager.playLaunch)
window.addEventListener('cart-launched', e => {
  const k = e.detail ? e.detail.strength : 1;
  AudioManager.playSample('voice_go', { volume: 0.55 });
  if (Game.camera) Game.camera.launchPush(k);
  Game._lineBurst = Math.max(Game._lineBurst || 0, 0.6 + 0.4 * k);
});

// PWA 오프라인 캐싱 — file://이나 미지원 브라우저는 조용히 건너뜀(게임 동작과 무관)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    // updateViaCache:'none' — sw.js 자체는 HTTP 캐시(max-age 600)를 거치지 않고 매번 확인해 새 배포를 바로 감지
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => reg.update())
      .catch(err => console.warn('[SW] 등록 실패:', err));
  });
  // 새 버전 감지 → 안내 토스트: (1) 정적 에셋 내용이 바뀜(SW가 알림) (2) 새 SW가 활성화되어 제어권이 넘어옴(이전 제어자가 있던 경우만)
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'asset-updated') UI.showUpdateToast(); });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) UI.showUpdateToast(); });
}

window.addEventListener('DOMContentLoaded', () => {
  Game.init();
  UI.showTitle(() => UI.showStageSelect(STAGES, stageIndex => Game.loadStage(stageIndex)));
});

// iOS Safari 등 자동재생 제한 대응 — 사용자 제스처에서 AudioContext 생성/resume.
// 한 번만 시도하면 iOS에서 첫 제스처가 오디오 허용으로 인정되지 않았거나(pointerdown) 백그라운드 복귀 후 멈춘 경우
// 영영 소리가 안 남 — 컨텍스트가 돌고 있지 않은 동안은 모든 제스처에서 다시 시도(돌고 있으면 즉시 반환)
['pointerdown', 'touchend', 'click', 'keydown'].forEach(type => window.addEventListener(type, () => {
  if (!AudioManager.ctx || AudioManager.ctx.state !== 'running') AudioManager.unlock();
}, { capture: true }));
