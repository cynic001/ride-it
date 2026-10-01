/**
 * input.js
 * Pointer Events API로 마우스/터치 통합 처리
 *
 * 입력 레이어 분리 (SE2 등 작은 화면에서 겹치지 않도록 영역 분리):
 *  - 스타트 전: 화면 하단 중앙 "스타트 바" DOM 안에서만 — 아래로 당겨(pull, 힘 게이지) 위로 빠르게 밀어 올리면 발사.
 *    힘 = 당긴 거리 × 밀어 올린 속도(flick). 위로 밀지 않고 손을 떼면 발사 취소(바가 제자리로). 키보드: ↓ 누르고 있기 = 충전, ↑ = 발사
 *  - 주행 중(양손 조작으로 통일, 13번): 왼쪽 아래 ◀ ▶ = 밸런스(누르는 동안 0.3초 램프로 ±1.0, 떼면 0.3초에 0 — 톡톡 눌러 중간 값),
 *    오른쪽 아래 BOOST = 부스트(누르는 순간 시간 기준 판정, 뒤로 떨어지기 연타 구간에선 연타).
 *    설정에서 "기울기"를 켜면 ◀ ▶ 대신 폰 좌우 기울기 = 밸런스(출발 순간 각도 기준, 데드존 3°) — 센서 없음/권한 거부 시 ◀ ▶로 자동 전환.
 *    키보드(항상): ← → 밸런스, ↑ 또는 Space 부스트
 *  - 멀티터치: 손가락마다 pointerId로 따로 추적하고, 터치가 시작된 버튼에만 묶음(버튼 단위 setPointerCapture — 살짝 밖으로
 *    미끄러져도 유지). 한 손가락을 떼도 다른 손가락 입력은 그대로. 캡처가 실패해도 window의 pointerup/cancel이 그 pointerId만 해제
 *  - 손 들기(에어타임)와 한손 엄지 패드는 13번에서 제거 — 패드 코드는 legacy/onehand-pad.js에 보관
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
const TILT = { deadzone: 3, full: 22, fallbackSec: 1.2 }; // 도(°) — 데드존 이하 무시, full°에서 최대 기울기
const LEAN_FOLLOW = { direct: 18 }; // 기울기 leanInput 추종 속도(1/초) — 거의 즉시
const LEAN_RAMP_SEC = 0.3; // 버튼(◀▶)/키보드(← →): 누르고 있으면 이 시간에 걸쳐 0→1.0, 떼면 같은 속도로 0 — 톡톡 눌러 중간 값 가능

class InputController {
  /** @param {HTMLElement} startBarElement - 스타트 전 드래그를 받는 전용 DOM(ui.js가 렌더) */
  constructor(canvas, cart, camera, startBarElement, mode = 'twohand') {
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

    this.mode = mode === 'tilt' ? 'tilt' : 'twohand';
    this._leanTarget = 0;
    this._leanRate = LEAN_FOLLOW.direct;
    this._btnPointers = new Map(); // pointerId → 'left'|'right'|'boost' — 손가락마다 그 손가락이 누른 버튼만 기억
    this._leanOrder = [];          // 눌려 있는 ◀/▶ 손가락(pointerId) 순서 — 둘 다 누르면 나중에 누른 쪽
    this._keys = new Set();
    this.lastInputKind = null;     // 'touch' | 'mouse' | 'keyboard' — 튜토리얼 안내 문구 기준

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

    // 주행 버튼: ◀ ▶(누르고 있기) · BOOST(누르는 순간) — 손가락(pointerId)마다 따로
    const bindBtn = (id, name) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (this.state !== 'launched') return;
        this.lastInputKind = e.pointerType === 'mouse' ? 'mouse' : 'touch';
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* iOS Safari 대응 */ }
        this._press(e.pointerId, name);
      }, opt);
      const up = e => this._release(e.pointerId, name);
      el.addEventListener('pointerup', up, opt);
      el.addEventListener('pointercancel', up, opt);
      el.addEventListener('lostpointercapture', up, opt);
      el.addEventListener('contextmenu', e => e.preventDefault(), opt);
    };
    bindBtn('leanLeftBtn', 'left');
    bindBtn('leanRightBtn', 'right');
    bindBtn('boostBtn', 'boost');
    // 캡처가 실패해 다른 곳에서 손가락을 뗀 경우의 안전장치 — 그 pointerId만 해제(다른 손가락은 그대로)
    const anyUp = e => { if (this._btnPointers.has(e.pointerId)) this._release(e.pointerId); };
    window.addEventListener('pointerup', anyUp, opt);
    window.addEventListener('pointercancel', anyUp, opt);
    // 회전·앱 전환·창 포커스 잃음: 눌려 있던 입력을 모두 안전하게 해제(손가락이 화면에서 떨어진 걸 못 받는 경우)
    window.addEventListener('blur', () => this.releaseAll(), opt);
    window.addEventListener('orientationchange', () => this.releaseAll(), opt);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); }, opt);
    this._orient = window.innerWidth > window.innerHeight;
    window.addEventListener('resize', () => {
      const o = window.innerWidth > window.innerHeight;
      if (o !== this._orient) { this._orient = o; this.releaseAll(); }
    }, opt);
    // 두 손가락 핀치 확대(iOS gesture 이벤트)·길게 누르기 메뉴 차단
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false, signal: this._abort.signal }));
    const dc = document.getElementById('driveControls');
    if (dc) {
      dc.addEventListener('contextmenu', e => e.preventDefault(), opt);
      dc.addEventListener('touchstart', e => { if (e.cancelable) e.preventDefault(); }, { passive: false, signal: this._abort.signal }); // 텍스트 선택·돋보기·스크롤
    }

    // 주행 키보드: ← → 밸런스, ↑ 또는 Space 부스트
    window.addEventListener('keydown', e => this._onDriveKey(e, true), opt);
    window.addEventListener('keyup', e => this._onDriveKey(e, false), opt);

    // 기울기 센서
    window.addEventListener('deviceorientation', e => {
      if (e.gamma === null || e.gamma === undefined) return;
      InputController._gamma = e.gamma;
      InputController._tiltSeenAt = performance.now();
    }, opt);

    // iOS Safari 더블탭 줌 방지 (JS 레벨) — 조작 영역 전체(두 손가락을 거의 동시에 떼는 경우도 포함)
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

  /** 버튼 누름 — pointerId별로 기억. BOOST는 누르는 순간 판정 */
  _press(pointerId, name) {
    this._btnPointers.set(pointerId, name);
    if (name === 'boost') this._boost();
    else { this._leanOrder = this._leanOrder.filter(id => id !== pointerId); this._leanOrder.push(pointerId); }
    this._syncPressed();
  }

  /** 버튼 뗌 — 그 손가락(pointerId)만. name을 주면 그 버튼에 묶인 손가락일 때만 */
  _release(pointerId, name) {
    const cur = this._btnPointers.get(pointerId);
    if (!cur || (name && cur !== name)) return;
    this._btnPointers.delete(pointerId);
    this._leanOrder = this._leanOrder.filter(id => id !== pointerId);
    this._syncPressed();
  }

  /** 모든 입력 해제(회전/백그라운드/포커스 잃음) */
  releaseAll() {
    if (this.state === 'pulling') this._onPullUp(); // 스타트 바를 당기던 중 회전 → 발사 취소(바 복귀)
    this._keyCharging = false;
    this._btnPointers.clear();
    this._leanOrder = [];
    this._keys.clear();
    this._syncPressed();
  }

  /** 눌린 버튼 표시 + 현재 ◀▶ 방향 */
  _syncPressed() {
    const held = new Set(this._btnPointers.values());
    for (const [id, name] of [['leanLeftBtn', 'left'], ['leanRightBtn', 'right'], ['boostBtn', 'boost']]) {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('pressed', held.has(name));
    }
  }

  get _btnLean() {
    const last = this._leanOrder[this._leanOrder.length - 1];
    const name = last === undefined ? null : this._btnPointers.get(last);
    return name === 'left' ? -1 : name === 'right' ? 1 : 0;
  }

  _onDriveKey(e, down) {
    if (this.state !== 'launched') return;
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', ' '].includes(k)) return;
    e.preventDefault();
    this.lastInputKind = 'keyboard';
    if (down) {
      if ((k === 'ArrowUp' || k === ' ') && !e.repeat) this._boost();
      this._keys.add(k);
    } else {
      this._keys.delete(k);
    }
  }

  /** 부스트 입력(BOOST 버튼/↑/Space) — 실제 시간 기준 게이트 판정 */
  _boost() {
    // 뒤로 떨어지기: 연타 구간에선 부스트 입력 = 연타, 그 밖의 뒤로 가는 동안은 무시
    if (this.cart.rollback) {
      if (this.cart.mashTap()) window.dispatchEvent(new CustomEvent('mash-tap'));
      return;
    }
    const result = this.cart.resolveGate();
    window.dispatchEvent(new CustomEvent('gate-result', { detail: { type: this.cart.lastGateType, result } }));
  }

  /** main.js 고정 스텝마다(cart.update 전) — 버튼/키보드/기울기를 leanInput으로 합성 */
  update(dt) {
    if (this.state !== 'launched') return;
    const keyLean = (this._keys.has('ArrowRight') ? 1 : 0) - (this._keys.has('ArrowLeft') ? 1 : 0);
    const held = keyLean || this._btnLean;
    if (this.mode === 'tilt' && !held) {
      this._updateTilt();
      if (this.mode === 'tilt') { // 기울기: 지수 추종(거의 즉시)
        this.cart.leanInput += (this._leanTarget - this.cart.leanInput) * (1 - Math.exp(-dt * this._leanRate));
        return;
      }
    }
    // 버튼/키: 일정 속도(1/LEAN_RAMP_SEC)로 선형 램프 — 누르면 0.3초에 1.0, 떼면 0.3초에 0
    const goal = held || 0;
    const stepAmt = dt / LEAN_RAMP_SEC;
    const cur = this.cart.leanInput;
    this.cart.leanInput = goal > cur ? Math.min(goal, cur + stepAmt) : Math.max(goal, cur - stepAmt);
  }

  _updateTilt() {
    const now = performance.now();
    if (!this._tiltInit) { this._tiltInit = true; this._tiltBase = InputController._gamma; this._tiltStart = now; } // 출발 순간 각도 = 정면
    const stale = !InputController._tiltSeenAt || now - InputController._tiltSeenAt > TILT.fallbackSec * 1000;
    if (InputController._tiltPermission === 'denied' || (stale && now - this._tiltStart > TILT.fallbackSec * 1000)) {
      this.mode = 'twohand'; // 센서를 쓸 수 없음 → ◀ ▶ 버튼으로 자동 전환
      window.dispatchEvent(new CustomEvent('control-fallback', { detail: 'twohand' }));
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
