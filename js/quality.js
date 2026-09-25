/**
 * quality.js
 * 그래픽 품질 프리셋, 기기 자동 감지, 런타임 적응형 다운그레이드
 */

const QUALITY_PRESETS = {
  low: {
    particleCount: 10,
    shadows: 'none',
    cameraShake: false,
    textureResolution: 512,
    postProcessing: [],
  },
  medium: {
    particleCount: 30,
    shadows: 'baked',
    cameraShake: true,
    textureResolution: 1024,
    postProcessing: ['fxaa'],
  },
  high: {
    particleCount: 60,
    shadows: 'realtime',
    cameraShake: true,
    textureResolution: 2048,
    postProcessing: ['fxaa', 'bloom'],
  },
};

const QualityManager = {
  current: 'medium',
  autoAdaptEnabled: true,
  _fpsHistory: [],
  _lastDowngradeTime: 0,

  /** 최초 진입 시 기기 스펙 기반 프리셋 추천 */
  detectInitialPreset(engine) {
    const saved = localStorage.getItem('rc_quality');
    if (saved && QUALITY_PRESETS[saved]) {
      this.current = saved;
      return this.current;
    }

    const isMobile = this._isMobileDevice();

    if (!isMobile) {
      // 데스크톱(레티나 Mac 포함)은 화면 해상도/DPR이 높을수록 오히려 고사양 신호이자
      // 모바일처럼 발열/배터리 제약도 없음 — 모바일과 완전히 별개 기준으로 판정해
      // "고해상도=저사양" 휴리스틱이 전혀 개입하지 않도록 분리(레티나 디스플레이 오탐 방지)
      const mem = navigator.deviceMemory || 8; // Safari는 deviceMemory 미지원 — 데스크톱 기본값은 관대하게
      this.current = mem >= 6 ? 'high' : mem >= 4 ? 'medium' : 'low';
      console.log('[Quality] 초기 프리셋 판정(데스크톱):', this.current, { deviceMemory: navigator.deviceMemory });
      return this.current;
    }

    // ── 모바일: 기존 로직 그대로(화면 해상도/GPU 문자열이 저사양 신호로 유효한 영역) ──
    let score = 0;

    // 메모리 (Safari는 deviceMemory 미지원 — 폴백 필요)
    const mem = navigator.deviceMemory || 4;
    score += mem >= 6 ? 2 : mem >= 4 ? 1 : 0;

    // 픽셀 밀도 * 화면크기 (고해상도 저사양 기기 페널티) — 모바일 한정
    const pixelCount = window.screen.width * window.screen.height * (window.devicePixelRatio || 1);
    score += pixelCount > 2_000_000 ? -1 : 0;

    // GPU 벤더 문자열 체크 (가능한 경우) — 모바일 한정(Safari가 Apple GPU를 뭉뚱그려 보고하는
    // 경우가 있어 데스크톱까지 포함하면 Apple Silicon Mac까지 구형 아이폰으로 오탐할 수 있음)
    try {
      const gl = engine.getGlInfo ? engine.getGlInfo() : null;
      const renderer = gl && gl.renderer ? gl.renderer.toLowerCase() : '';
      if (renderer.includes('apple gpu') || renderer.includes('a13') || renderer.includes('a12')) {
        score -= 1; // 구형 iOS 기기 계열 — SE2(A13) 등 보수적으로 낮춤
      }
    } catch (e) {
      // GPU 정보 조회 실패 시 무시하고 기본값 유지
    }

    if (score <= 0) this.current = 'low';
    else if (score === 1) this.current = 'medium';
    else this.current = 'high';

    console.log('[Quality] 초기 프리셋 판정(모바일):', this.current, { score, deviceMemory: navigator.deviceMemory });
    return this.current;
  },

  /** UA/터치포인트 기반 모바일 판정 — iPadOS는 iOS13+부터 UA가 macOS로 위장하므로 별도 처리 */
  _isMobileDevice() {
    const ua = navigator.userAgent;
    if (/Mobi|Android|iPhone|iPod/i.test(ua)) return true;
    if (/iPad/i.test(ua)) return true;
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true; // 데스크톱 UA로 위장한 iPad
    return false;
  },

  setPreset(name) {
    if (!QUALITY_PRESETS[name]) return;
    this.current = name;
    localStorage.setItem('rc_quality', name);
  },

  get settings() {
    return QUALITY_PRESETS[this.current];
  },

  /** 매 프레임 fps를 기록하고, 지속적으로 낮으면 한 단계 다운그레이드 */
  reportFrame(fps, now) {
    if (!this.autoAdaptEnabled) return;

    this._fpsHistory.push(fps);
    if (this._fpsHistory.length > 90) this._fpsHistory.shift(); // 최근 약 1.5초(60fps 기준)

    if (this._fpsHistory.length < 60) return;
    if (now - this._lastDowngradeTime < 5000) return; // 5초 쿨다운

    const avg = this._fpsHistory.reduce((a, b) => a + b, 0) / this._fpsHistory.length;
    if (avg < 24 && this.current !== 'low') {
      this.current = this.current === 'high' ? 'medium' : 'low';
      this._lastDowngradeTime = now;
      this._fpsHistory = [];
      window.dispatchEvent(new CustomEvent('quality-downgraded', { detail: this.current }));
    }
  },
};

window.QUALITY_PRESETS = QUALITY_PRESETS;
window.QualityManager = QualityManager;
