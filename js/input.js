/**
 * input.js
 * Pointer Events API로 마우스/터치 통합 처리
 *
 * 입력 레이어 분리 (SE2 등 작은 화면에서 겹치지 않도록 영역 분리):
 *  - 스타트 전: 화면 하단 중앙 "스타트 바" DOM 안에서만 — 아래로 당겨(pull, 힘 게이지) 위로 빠르게 밀어 올리면 발사.
 *    힘 = 당긴 거리 × 밀어 올린 속도(flick). 위로 밀지 않고 손을 떼면 발사 취소(바가 제자리로). 키보드: ↓ 누르고 있기 = 충전, ↑ = 발사
 *  - 주행 중(설정의 조작 방식, ui.js ControlSettings):
 *    onehand(기본): 하단 가로 전체 "엄지 패드" — 좌우로 밀기 = 밸런스(민 거리 비례, 떼면 중립 복귀),
 *                   톡(0.12초 미만) = 부스트, 꾹(0.12초 이상) = 손 들기(에어타임). 밀면서 누르고 있어도 손 들기 유지
 *    tilt:          폰 좌우 기울기 = 밸런스(출발 순간 각도 기준, 데드존 3°), 패드는 톡/꾹만. 센서 없음/권한 거부 시 onehand로 자동 전환
 *    twohand:       왼쪽 ◀ ▶(누르는 동안 기울임), 오른쪽 BOOST(누르는 순간 판정)·손 들기(누르고 있기)
 *    키보드(항상):  ← → 밸런스, ↑ 부스트, Space 손 들기(누르고 있기)
 *  - 캔버스 자체는 입력을 받지 않음(예전 "캔버스 탭=게이트 / 길게 누르기=에어타임" 방식은 대체됨)
 */

const FLICK_WINDOW_MS = 100;       // 발사 판정 직전 이 구간의 이동만으로 속도 계산
const REFERENCE_FLICK_VELOCITY = 1.5; // px/ms — 이 이상 빠르게 밀어 올리면 최대 flick 배율
const MIN_FLICK_MULTIPLIER = 0.6;  // 천천히 밀어 올렸을 때 배율
const MAX_FLICK_MULTIPLIER = 1.6;  // 확 튕겨 올렸을 때 배율
const LAUNCH_UP_DISTANCE = 28;     // 최저점에서 이만큼(px) 위로 올라오면서
const LAUNCH_UP_VELOCITY = 0.35;   // 이 속도(px/ms) 이상이면 즉시 발사(손을 뗄 필요 없음)
const KEY_CHARGE_SECONDS = 0.8;    // 키보드 ↓를 이만큼 누르면 최대 충전
const KEY_FLICK_MULTIPLIER = 1.25; // 키보드 발사 flick(속도 정보가 없어 고정)
const TAP_MAX_SECONDS = 0.12;      // 이보다 짧게 누르고 떼면 "톡"(부스트), 길면 "꾹"(손 들기)
const TAP_MAX_MOVE = 14;           // px — 이보다 많이 움직이면 탭이 아니라 밀기(밸런스)
const PAD_FULL_LEAN_PX = 90;       // 패드에서 이만큼 밀면 최대 기울기
const TILT = { deadzone: 3, full: 22, fallbackSec: 1.2 }; // 도(°) — 데드존 이하 무시, full°에서 최대 기울기
const LEAN_FOLLOW = { direct: 18, ramp: 7 }; // leanInput 추종 속도(1/초): 패드/기울기는 즉각, 버튼/키는 누르는 동안 서서히

class InputController {
  /** @param {HTMLElement} startBarElement - 스타트 전 드래그를 받는 전용 DOM(ui.js가 렌더) */
  constructor(canvas, cart, camera, startBarElement, mode = 'onehand') {
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

    this.mode = mode;
    this._leanTarget = 0;
    this._leanRate = LEAN_FOLLOW.direct;
    this._pointers = new Map();   // 패드 위 손가락별 상태 {x0, t0, moved, hold, gate}
    this._keys = new Set();
    this._btnLean = 0;            // 양손 모드 ◀▶ 버튼
    this._handsBtn = false;

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

    // 주행 조작: 엄지 패드(한손/기울기) 또는 양손 버튼 — ui.js가 렌더한 DOM
    const pad = document.getElementById('thumbPad');
    if (pad) {
      pad.addEventListener('pointerdown', e => this._onPadDown(e), opt);
      pad.addEventListener('pointermove', e => this._onPadMove(e), opt);
      pad.addEventListener('pointerup', e => this._onPadUp(e), opt);
      pad.addEventListener('pointercancel', e => this._onPadUp(e, true), opt);
    }
    const hold = (id, on, off) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (err) { /* iOS */ } el.classList.add('pressed'); on(); }, opt);
      const up = () => { el.classList.remove('pressed'); off(); };
      el.addEventListener('pointerup', up, opt);
      el.addEventListener('pointercancel', up, opt);
    };
    hold('leanLeftBtn', () => { this._btnLean = -1; }, () => { if (this._btnLean < 0) this._btnLean = 0; });
    hold('leanRightBtn', () => { this._btnLean = 1; }, () => { if (this._btnLean > 0) this._btnLean = 0; });
    hold('boostBtn', () => this._boost(), () => {});
    hold('handsBtn', () => { this._handsBtn = true; }, () => { this._handsBtn = false; });

    // 주행 키보드: ← → 밸런스, ↑ 부스트, Space 손 들기
    window.addEventListener('keydown', e => this._onDriveKey(e, true), opt);
    window.addEventListener('keyup', e => this._onDriveKey(e, false), opt);

    // 기울기 센서
    window.addEventListener('deviceorientation', e => {
      if (e.gamma === null || e.gamma === undefined) return;
      InputController._gamma = e.gamma;
      InputController._tiltSeenAt = performance.now();
    }, opt);

    // iOS Safari 더블탭 줌 방지 (JS 레벨) — 조작 영역 전체
    let lastTouchEnd = 0;
    const controls = document.getElementById('driveControls') || this.canvas;
    controls.addEventListener('touchend', e => {
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

  // ── 주행 조작 ─────────────────────────────────────────────

  /** iOS 13+ 기울기 권한 — 반드시 사용자 탭 핸들러 안에서 호출(ui.js의 START/설정 탭). 결과는 정적 필드에 보관 */
  static requestTiltPermission() {
    const D = window.DeviceOrientationEvent;
    if (!D) { InputController._tiltPermission = 'denied'; return; }
    if (typeof D.requestPermission === 'function') {
      D.requestPermission().then(r => { InputController._tiltPermission = r; }).catch(() => { InputController._tiltPermission = 'denied'; });
    } else {
      InputController._tiltPermission = 'granted';
    }
  }

  _onPadDown(e) {
    if (this.state !== 'launched') return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* iOS Safari 대응 */ }
    // 탭 판정은 손가락이 닿은 순간 기준 — 떼는 순간(최대 0.12초 뒤)이 아니라 지금의 게이트 타이밍을 저장해 둠
    const p = { x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, hold: false, gate: this.cart.gateTiming() };
    p.timer = setTimeout(() => { p.hold = true; this._syncHold(); }, TAP_MAX_SECONDS * 1000);
    this._pointers.set(e.pointerId, p);
    this._leanPointer = e.pointerId;
    window.dispatchEvent(new CustomEvent('pad-touch', { detail: { x: e.clientX, y: e.clientY, down: true } }));
  }

  _onPadMove(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x0;
    if (Math.abs(dx) > TAP_MAX_MOVE || Math.abs(e.clientY - p.y0) > TAP_MAX_MOVE) p.moved = true;
    if (this.mode === 'onehand' && e.pointerId === this._leanPointer) {
      this._leanTarget = Math.max(-1, Math.min(1, dx / PAD_FULL_LEAN_PX));
      this._leanRate = LEAN_FOLLOW.direct;
    }
    window.dispatchEvent(new CustomEvent('pad-touch', { detail: { x: e.clientX, y: e.clientY, down: true } }));
  }

  _onPadUp(e, cancelled = false) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    clearTimeout(p.timer);
    this._pointers.delete(e.pointerId);
    const dur = (performance.now() - p.t0) / 1000;
    if (!cancelled && !p.moved && dur < TAP_MAX_SECONDS) this._boost(p.gate);
    if (e.pointerId === this._leanPointer) {
      this._leanPointer = null;
      if (this.mode === 'onehand') this._leanTarget = 0; // 떼면 중립 복귀
    }
    this._syncHold();
    if (!this._pointers.size) window.dispatchEvent(new CustomEvent('pad-touch', { detail: { down: false } }));
  }

  _syncHold() {
    const padHold = [...this._pointers.values()].some(p => p.hold);
    this.cart.airtimeHolding = padHold || this._handsBtn || this._keys.has(' ');
  }

  _onDriveKey(e, down) {
    if (this.state !== 'launched') return;
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', ' '].includes(k)) return;
    e.preventDefault();
    if (down) {
      if (k === 'ArrowUp' && !e.repeat) this._boost();
      this._keys.add(k);
    } else {
      this._keys.delete(k);
    }
    this._syncHold();
  }

  /** 부스트 입력(톡/BOOST 버튼/↑) — 실제 시간 기준 게이트 판정. gate: 손가락이 닿은 순간 저장해 둔 타이밍(패드 탭) */
  _boost(gate) {
    const result = this.cart.resolveGate(gate);
    window.dispatchEvent(new CustomEvent('gate-result', { detail: { type: this.cart.lastGateType, result } }));
  }

  /** main.js 고정 스텝마다(cart.update 전) — 기울기/버튼/키보드를 leanInput으로 합성하고 부드럽게 추종 */
  update(dt) {
    if (this.state !== 'launched') return;
    if (this.mode === 'tilt') this._updateTilt();
    const keyLean = (this._keys.has('ArrowRight') ? 1 : 0) - (this._keys.has('ArrowLeft') ? 1 : 0);
    let target = this._leanTarget, rate = this._leanRate;
    if (keyLean || this._btnLean) { target = keyLean || this._btnLean; rate = LEAN_FOLLOW.ramp; }
    else if (this.mode === 'twohand') { target = 0; rate = LEAN_FOLLOW.ramp; }
    this.cart.leanInput += (target - this.cart.leanInput) * (1 - Math.exp(-dt * rate));
    this._syncHold();
  }

  _updateTilt() {
    const now = performance.now();
    if (!this._tiltInit) { this._tiltInit = true; this._tiltBase = InputController._gamma; this._tiltStart = now; } // 출발 순간 각도 = 정면
    const stale = !InputController._tiltSeenAt || now - InputController._tiltSeenAt > TILT.fallbackSec * 1000;
    if (InputController._tiltPermission === 'denied' || (stale && now - this._tiltStart > TILT.fallbackSec * 1000)) {
      this.mode = 'onehand'; // 센서를 쓸 수 없음 → 한손 모드로 자동 전환(패드 밀기로 밸런스)
      window.dispatchEvent(new CustomEvent('control-fallback', { detail: 'onehand' }));
      return;
    }
    if (this._tiltBase === undefined || this._tiltBase === null) this._tiltBase = InputController._gamma; // 첫 센서 값이 출발 후 도착한 경우
    const v = (InputController._gamma || 0) - (this._tiltBase || 0);
    const a = Math.abs(v);
    this._leanTarget = a < TILT.deadzone ? 0 : Math.sign(v) * Math.min(1, (a - TILT.deadzone) / (TILT.full - TILT.deadzone));
    this._leanRate = LEAN_FOLLOW.direct;
  }
}

window.InputController = InputController;
