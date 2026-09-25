/**
 * input.js
 * Pointer Events API로 마우스/터치 통합 처리
 *
 * 입력 레이어 분리 (SE2 등 작은 화면에서 겹치지 않도록 영역 분리):
 *  - 스타트 전: 화면 전체 드래그 = 당기기(pull), 릴리스 순간의 속도(flick) = 발사 세기
 *  - 주행 중 화면 하단: 좌우 스와이프/드래그 = 밸런스 (leanInput)
 *  - 주행 중 화면 상단/중앙: 탭 = 게이트 판정 (부스트/브레이크/피니쉬)
 *  - 길게 누르기(주행 중, 위치 무관): 손들기 = 에어타임 홀드
 *  - 별도 UI 버튼: 카메라 토글 (락 해제 후)
 */

const FLICK_WINDOW_MS = 100;       // release 직전 이 구간의 이동만으로 속도 계산
const REFERENCE_FLICK_VELOCITY = 1.2; // px/ms — 이 이상이면 최대 flick 배율로 취급
const MIN_FLICK_MULTIPLIER = 0.3;  // 느리게 놓았을 때(거의 정지 상태로 릴리스) 배율
const MAX_FLICK_MULTIPLIER = 1.6;  // 빠르게 확 채듯 놓았을 때 배율

class InputController {
  constructor(canvas, cart, camera) {
    this.canvas = canvas;
    this.cart = cart;
    this.camera = camera;

    this.state = 'idle'; // 'idle' | 'pulling' | 'launched'
    this._dragStart = null;
    this._dragCurrent = null;
    this._holdTimer = null;
    this._pressStartTime = 0;

    this._balanceZoneRatio = 0.5; // 화면 하단 50% = 밸런스 입력 영역
    this.maxPullDistance = 150;   // px, 이 이상 당기면 최대 파워
    this._moveSamples = [];       // pull 중 {x,y,t} 샘플 — release 시 flick 속도 계산용

    this._bindEvents();
  }

  _bindEvents() {
    this.canvas.style.touchAction = 'none'; // 브라우저 기본 제스처(스크롤/줌) 차단

    this.canvas.addEventListener('pointerdown', e => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', e => this._onPointerMove(e));
    this.canvas.addEventListener('pointerup', e => this._onPointerUp(e));
    this.canvas.addEventListener('pointercancel', e => this._onPointerUp(e));

    // iOS Safari 더블탭 줌 방지 (JS 레벨)
    let lastTouchEnd = 0;
    this.canvas.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });
  }

  _onPointerDown(e) {
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* iOS Safari 대응 */ }

    this._pressStartTime = performance.now();

    if (this.state === 'idle') {
      this.state = 'pulling';
      this._dragStart = { x: e.clientX, y: e.clientY };
      this._dragCurrent = { x: e.clientX, y: e.clientY };
      this._moveSamples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
      return;
    }

    if (this.state === 'launched') {
      const isBalanceZone = e.clientY > this.canvas.height * (1 - this._balanceZoneRatio);
      if (isBalanceZone) {
        this._dragStart = { x: e.clientX, y: e.clientY };
      } else {
        // 상단/중앙 탭 = 게이트 판정
        this._resolveGateTap();
      }

      // 길게 누르기 감지 시작 (손들기 = 에어타임)
      this._holdTimer = setTimeout(() => {
        this.cart.airtimeHolding = true;
      }, 120); // 120ms 이상 누르면 홀드로 간주 (짧은 탭과 구분)
    }
  }

  _onPointerMove(e) {
    if (this.state === 'pulling') {
      this._dragCurrent = { x: e.clientX, y: e.clientY };
      // main.js에서 pullStrength를 읽어 카트 당김 비주얼에 반영
      const now = performance.now();
      this._moveSamples.push({ x: e.clientX, y: e.clientY, t: now });
      const cutoff = now - FLICK_WINDOW_MS * 1.5; // 윈도우보다 넉넉히 여유를 둬서 정확한 보간 기준점 확보
      while (this._moveSamples.length > 1 && this._moveSamples[0].t < cutoff) this._moveSamples.shift();
      return;
    }

    if (this.state === 'launched' && this._dragStart) {
      const dx = e.clientX - this._dragStart.x;
      const normalized = Math.max(-1, Math.min(1, dx / 80)); // ±80px 이동으로 최대 밸런스 입력
      this.cart.leanInput = normalized;
    }
  }

  _onPointerUp(e) {
    clearTimeout(this._holdTimer);
    this.cart.airtimeHolding = false;

    if (this.state === 'pulling') {
      const strength = this.getPullStrength();
      const flickMultiplier = this._computeFlickMultiplier(e);
      this.cart.launch(strength, flickMultiplier);
      AudioManager.playLaunch(strength, flickMultiplier);
      this.state = 'launched';
      this._dragStart = null;
      this._dragCurrent = null;
      this._moveSamples = [];
      return;
    }

    if (this.state === 'launched') {
      this._dragStart = null;
      // 밸런스 입력은 손을 떼면 서서히 중립으로 복귀 (main.js 루프에서 decay 처리 가능)
    }
  }

  /** release 직전 FLICK_WINDOW_MS 구간의 이동 거리/시간으로 release 속도를 구해 0.3~1.6 배율로 정규화 */
  _computeFlickMultiplier(e) {
    const now = performance.now();
    const windowStart = now - FLICK_WINDOW_MS;
    let ref = this._moveSamples[0];
    for (const s of this._moveSamples) {
      if (s.t >= windowStart) { ref = s; break; }
    }
    const dx = e.clientX - ref.x;
    const dy = e.clientY - ref.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dtMs = Math.max(1, now - ref.t); // 0 나눗셈 방지
    const velocity = dist / dtMs; // px/ms
    const ratio = Math.min(1, velocity / REFERENCE_FLICK_VELOCITY);
    return MIN_FLICK_MULTIPLIER + (MAX_FLICK_MULTIPLIER - MIN_FLICK_MULTIPLIER) * ratio;
  }

  /** 0~1 정규화된 당김 강도 (main.js에서 발사 전 비주얼 피드백에도 사용) */
  getPullStrength() {
    if (!this._dragStart || !this._dragCurrent) return 0;
    const dx = this._dragCurrent.x - this._dragStart.x;
    const dy = this._dragCurrent.y - this._dragStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return Math.min(1, dist / this.maxPullDistance);
  }

  _resolveGateTap() {
    const gateType = this.cart.track.getSegmentAt(this.cart.t).gate?.type ?? null;
    const result = this.cart.resolveGate(this._localTWithinSegment());
    window.dispatchEvent(new CustomEvent('gate-result', { detail: { type: gateType, result } }));
  }

  /** 현재 세그먼트 내에서의 상대 진행률 (0~1) — 게이트 판정 타이밍 계산용 */
  _localTWithinSegment() {
    const seg = this.cart.track.getSegmentAt(this.cart.t);
    return (this.cart.t - seg.tStart) / (seg.tEnd - seg.tStart);
  }
}

window.InputController = InputController;
