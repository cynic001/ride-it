/**
 * input.js
 * Pointer Events API로 마우스/터치 통합 처리
 *
 * 입력 레이어 분리 (SE2 등 작은 화면에서 겹치지 않도록 영역 분리):
 *  - 스타트 전: 화면 하단 중앙 "스타트 바" DOM 안에서만 — 아래로 당겨(pull, 힘 게이지) 위로 빠르게 밀어 올리면 발사.
 *    힘 = 당긴 거리 × 밀어 올린 속도(flick). 위로 밀지 않고 손을 떼면 발사 취소(바가 제자리로). 키보드: ↓ 누르고 있기 = 충전, ↑ = 발사
 *  - 주행 중 화면 하단: 좌우 스와이프/드래그 = 밸런스 (leanInput)
 *  - 주행 중 화면 상단/중앙: 탭 = 게이트 판정 (부스트/브레이크/피니쉬)
 *  - 길게 누르기(주행 중, 위치 무관): 손들기 = 에어타임 홀드
 *  - 별도 UI 버튼: 카메라 토글 (락 해제 후)
 */

const FLICK_WINDOW_MS = 100;       // 발사 판정 직전 이 구간의 이동만으로 속도 계산
const REFERENCE_FLICK_VELOCITY = 1.5; // px/ms — 이 이상 빠르게 밀어 올리면 최대 flick 배율
const MIN_FLICK_MULTIPLIER = 0.6;  // 천천히 밀어 올렸을 때 배율
const MAX_FLICK_MULTIPLIER = 1.6;  // 확 튕겨 올렸을 때 배율
const LAUNCH_UP_DISTANCE = 28;     // 최저점에서 이만큼(px) 위로 올라오면서
const LAUNCH_UP_VELOCITY = 0.35;   // 이 속도(px/ms) 이상이면 즉시 발사(손을 뗄 필요 없음)
const KEY_CHARGE_SECONDS = 0.8;    // 키보드 ↓를 이만큼 누르면 최대 충전
const KEY_FLICK_MULTIPLIER = 1.25; // 키보드 발사 flick(속도 정보가 없어 고정)

class InputController {
  /** @param {HTMLElement} startBarElement - 스타트 전 드래그를 받는 전용 DOM(ui.js가 렌더) */
  constructor(canvas, cart, camera, startBarElement) {
    this.canvas = canvas;
    this.cart = cart;
    this.camera = camera;
    this.startBar = startBarElement;

    this.state = 'idle'; // 'idle' | 'pulling' | 'launched'
    this._dragStart = null;
    this._dragCurrent = null;
    this._holdTimer = null;

    this._balanceZoneRatio = 0.5; // 화면 하단 50% = 밸런스 입력 영역
    this.maxPullDistance = 140;   // px, 이 이상 아래로 당기면 최대 파워
    this._pull = 0;               // 현재 당긴 강도 0~1(터치/키보드 공용)
    this._lowestY = 0;
    this._moveSamples = [];       // pull 중 {x,y,t} 샘플 — release 시 flick 속도 계산용

    this._bindEvents();
  }

  /** 스테이지 재로드 시 이전 컨트롤러의 리스너 제거 — 안 하면 이전 카트용 컨트롤러가 캔버스 탭을 계속 받아
   * 게이트 판정/효과음이 스테이지를 다시 할 때마다 중복으로 발생 */
  dispose() {
    this._abort.abort();
    clearTimeout(this._holdTimer);
  }

  _bindEvents() {
    this._abort = new AbortController();
    const opt = { signal: this._abort.signal };
    this.canvas.style.touchAction = 'none'; // 브라우저 기본 제스처(스크롤/줌) 차단

    // 스타트 전: 스타트 바 안에서만 당기기(pull) 인식
    if (this.startBar) {
      this.startBar.style.touchAction = 'none';
      this.startBar.addEventListener('pointerdown', e => this._onPullDown(e), opt);
      this.startBar.addEventListener('pointermove', e => this._onPullMove(e), opt);
      this.startBar.addEventListener('pointerup', e => this._onPullUp(e), opt);
      this.startBar.addEventListener('pointercancel', e => this._onPullUp(e), opt);
    }

    // 키보드 스타트: ↓ 누르고 있기 = 충전, ↑ = 발사
    window.addEventListener('keydown', e => this._onStartKey(e, true), opt);
    window.addEventListener('keyup', e => this._onStartKey(e, false), opt);

    // 발사 후: 캔버스 전체에서 밸런스/게이트/손들기
    this.canvas.addEventListener('pointerdown', e => this._onDriveDown(e), opt);
    this.canvas.addEventListener('pointermove', e => this._onDriveMove(e), opt);
    this.canvas.addEventListener('pointerup', e => this._onDriveUp(e), opt);
    this.canvas.addEventListener('pointercancel', e => this._onDriveUp(e), opt);

    // iOS Safari 더블탭 줌 방지 (JS 레벨)
    let lastTouchEnd = 0;
    this.canvas.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false, signal: this._abort.signal });
  }

  _onPullDown(e) {
    if (this.state !== 'idle') return;
    e.preventDefault();
    try { this.startBar.setPointerCapture(e.pointerId); } catch (err) { /* iOS Safari 대응 */ }
    this.state = 'pulling';
    this._dragStart = { x: e.clientX, y: e.clientY };
    this._lowestY = e.clientY;
    this._pull = 0;
    this._moveSamples = [{ y: e.clientY, t: performance.now() }];
  }

  _onPullMove(e) {
    if (this.state !== 'pulling') return;
    e.preventDefault();
    const now = performance.now();
    this._moveSamples.push({ y: e.clientY, t: now });
    const cutoff = now - FLICK_WINDOW_MS * 1.5;
    while (this._moveSamples.length > 1 && this._moveSamples[0].t < cutoff) this._moveSamples.shift();

    if (e.clientY > this._lowestY) this._lowestY = e.clientY; // 아래로 당기는 중 — 가장 깊이 당긴 지점 기록
    this._pull = Math.max(0, Math.min(1, (this._lowestY - this._dragStart.y) / this.maxPullDistance));
    const rise = this._lowestY - e.clientY; // 최저점에서 다시 올라온 거리
    const upV = this._upVelocity();
    if (this._pull > 0.05 && rise >= LAUNCH_UP_DISTANCE && upV >= LAUNCH_UP_VELOCITY) {
      this._launch(this._pull, this._flickFromVelocity(upV));
      return;
    }
    // ui.js 게이지: 당긴 강도 + 올라오는 중인 핸들 위치(아래로 당긴 만큼 내려가 있음)
    const shown = Math.max(0, (e.clientY - this._dragStart.y) / this.maxPullDistance);
    window.dispatchEvent(new CustomEvent('pull-progress', { detail: { strength: this._pull, handle: Math.min(1, shown) } }));
  }

  _onPullUp() {
    if (this.state !== 'pulling') return;
    // 위로 밀어 올리지 않고 뗀 경우: 마지막 순간 위로 빠르게 움직이고 있었다면 발사, 아니면 취소(바 복귀 + 안내)
    const upV = this._upVelocity();
    if (this._pull > 0.05 && upV >= LAUNCH_UP_VELOCITY) {
      this._launch(this._pull, this._flickFromVelocity(upV));
      return;
    }
    this.state = 'idle';
    this._pull = 0;
    window.dispatchEvent(new CustomEvent('pull-progress', { detail: { strength: 0, handle: 0, cancelled: true } }));
  }

  /** 발사 직전 FLICK_WINDOW_MS 구간의 위쪽 이동 속도(px/ms, 위로 = 양수) */
  _upVelocity() {
    const s = this._moveSamples;
    if (s.length < 2) return 0;
    const last = s[s.length - 1];
    let ref = s[0];
    for (const p of s) { if (p.t >= last.t - FLICK_WINDOW_MS) { ref = p; break; } }
    return (ref.y - last.y) / Math.max(1, last.t - ref.t);
  }

  _flickFromVelocity(v) {
    const ratio = Math.min(1, v / REFERENCE_FLICK_VELOCITY);
    return MIN_FLICK_MULTIPLIER + (MAX_FLICK_MULTIPLIER - MIN_FLICK_MULTIPLIER) * ratio;
  }

  _onStartKey(e, down) {
    if (this.state === 'launched') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (down && !this._keyCharging) {
        this._keyCharging = true;
        const t0 = performance.now();
        const tick = () => {
          if (!this._keyCharging || this.state === 'launched') return;
          this._pull = Math.min(1, (performance.now() - t0) / 1000 / KEY_CHARGE_SECONDS);
          window.dispatchEvent(new CustomEvent('pull-progress', { detail: { strength: this._pull, handle: this._pull } }));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } else if (!down) {
        this._keyCharging = false;
      }
    } else if (e.key === 'ArrowUp' && down) {
      e.preventDefault();
      this._keyCharging = false;
      if (this._pull > 0.05) this._launch(this._pull, KEY_FLICK_MULTIPLIER);
    }
  }

  _launch(strength, flickMultiplier) {
    this.cart.launch(strength, flickMultiplier);
    AudioManager.playLaunch(strength, flickMultiplier);
    this.state = 'launched';
    this._keyCharging = false;
    this._dragStart = null;
    this._moveSamples = [];
    // ui.js(스타트 바 → HUD 전환)·main.js(발사 연출)가 받음
    window.dispatchEvent(new CustomEvent('cart-launched', { detail: { strength, flickMultiplier } }));
  }

  _onDriveDown(e) {
    if (this.state !== 'launched') return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* iOS Safari 대응 */ }

    // canvas.height는 렌더 해상도(하드웨어 스케일링 반영)라 CSS 픽셀 clientY와 단위가 다름 — low 프리셋(스케일 1.5)에서
    // 게이트 탭 영역이 화면 위 1/3로 줄어들던 문제. 화면상 크기(getBoundingClientRect) 기준으로 비교
    const rect = this.canvas.getBoundingClientRect();
    const isBalanceZone = e.clientY - rect.top > rect.height * (1 - this._balanceZoneRatio);
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

  _onDriveMove(e) {
    if (this.state === 'launched' && this._dragStart) {
      const dx = e.clientX - this._dragStart.x;
      const normalized = Math.max(-1, Math.min(1, dx / 80)); // ±80px 이동으로 최대 밸런스 입력
      this.cart.leanInput = normalized;
    }
  }

  _onDriveUp(e) {
    clearTimeout(this._holdTimer);
    this.cart.airtimeHolding = false;
    this._dragStart = null;
    // 밸런스 입력은 손을 떼면 서서히 중립으로 복귀 (main.js 루프에서 decay 처리 가능)
  }

  _resolveGateTap() {
    const result = this.cart.resolveGate(); // 실제 시간 기준 판정(cart.js) — 게이트 종류는 판정된 게이트 기준
    window.dispatchEvent(new CustomEvent('gate-result', { detail: { type: this.cart.lastGateType, result } }));
  }
}

window.InputController = InputController;
