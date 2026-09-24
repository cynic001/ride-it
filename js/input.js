/**
 * input.js
 * Pointer Events API로 마우스/터치 통합 처리
 *
 * 입력 레이어 분리 (SE2 등 작은 화면에서 겹치지 않도록 영역 분리):
 *  - 스타트 전: 화면 전체 드래그 = 당기기, 릴리스 = 발사
 *  - 주행 중 화면 하단: 좌우 스와이프/드래그 = 밸런스 (leanInput)
 *  - 주행 중 화면 상단/중앙: 탭 = 게이트 판정 (부스트/브레이크/피니쉬)
 *  - 길게 누르기(주행 중, 위치 무관): 손들기 = 에어타임 홀드
 *  - 별도 UI 버튼: 카메라 토글 (락 해제 후)
 */

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
      this.cart.launch(strength);
      this.state = 'launched';
      this._dragStart = null;
      this._dragCurrent = null;
      return;
    }

    if (this.state === 'launched') {
      this._dragStart = null;
      // 밸런스 입력은 손을 떼면 서서히 중립으로 복귀 (main.js 루프에서 decay 처리 가능)
    }
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
    const result = this.cart.resolveGate(this._localTWithinSegment());
    window.dispatchEvent(new CustomEvent('gate-result', { detail: result }));
  }

  /** 현재 세그먼트 내에서의 상대 진행률 (0~1) — 게이트 판정 타이밍 계산용 */
  _localTWithinSegment() {
    const seg = this.cart.track.getSegmentAt(this.cart.t);
    return (this.cart.t - seg.tStart) / (seg.tEnd - seg.tStart);
  }
}

window.InputController = InputController;
