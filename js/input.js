/**
 * input.js
 * Pointer Events API로 마우스/터치 통합 처리
 *
 * 입력 레이어 분리 (SE2 등 작은 화면에서 겹치지 않도록 영역 분리):
 *  - 스타트 전: 화면 하단 중앙 "스타트 바" DOM 안에서만 — 아래로 당겨(pull, 힘 게이지) 위로 빠르게 밀어 올리면 발사.
 *    힘 = 당긴 거리 × 밀어 올린 속도(flick). 위로 밀지 않고 손을 떼면 발사 취소(바가 제자리로). 키보드: ↓ 누르고 있기 = 충전, ↑ = 발사
 *  - 주행 중(양손 조작): 왼쪽 아래 균형 바 = 노브를 좌우로 끌어 leanInput(−1~1) 조절(손가락 위치에 노브가 거의 즉시 따라감, 놓으면 0.3초에 가운데로 복귀),
 *    오른쪽 아래 BOOST = 부스트(누르는 순간 시간 기준 판정, 뒤로 떨어지기 연타 구간에선 연타).
 *    설정에서 "기울기"를 켜면 폰 좌우 기울기가 같은 바의 노브를 움직임(출발 순간 각도 기준, 데드존 3°, 손으로는 못 끎) — 센서 없음/권한 거부 시 바 끌기로 자동 전환.
 *    키보드(항상): ← → 누르는 동안 노브가 천천히 이동(초당 1.2), ↑ 또는 Space 부스트, 키보드가 눌려 있는 동안엔 바를 손으로 못 끎
 *  - 멀티터치: 손가락마다 pointerId로 따로 추적하고, 터치가 시작된 바/버튼에만 묶음(setPointerCapture — 바 밖으로 미끄러져도 드래그 유지,
 *    캡처가 실패해도 window pointermove/up이 그 pointerId만 따라감). 한 손가락을 떼도 다른 손가락 입력은 그대로
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
const BAR_FOLLOW = 22;       // 바 드래그: 손가락 위치로 노브가 따라가는 속도(1/초) — 거의 즉시지만 급격한 튐은 완화
const KEY_LEAN_RATE = 1.2;   // 키보드 ← →: 누르는 동안 노브가 움직이는 속도(초당, 0→1.0에 약 0.83초)
const LEAN_RETURN_SEC = 0.3; // 손/키를 떼면 이 시간에 걸쳐 가운데(0)로 부드럽게 복귀

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
    this._btnPointers = new Map(); // pointerId → 'boost' — 손가락마다 그 손가락이 누른 버튼만 기억
    this._barPtr = null;           // 균형 바를 끌고 있는 손가락 { id, x }
    this._rel = null;              // 놓은 뒤 가운데로 복귀 중인 상태 { from, t }
    this._keys = new Set();
    this.lastInputKind = null;     // 'touch' | 'mouse' | 'keyboard' — 튜토리얼 안내 문구 기준
    this.blocked = false;          // 튜토리얼 설명 카드가 떠 있는 동안 주행 입력 무시

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
        if (this.state !== 'launched' || this.blocked) return;
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
    bindBtn('boostBtn', 'boost');
    // 균형 바: 바(패널) 어디를 눌러도 그 손가락의 x 위치로 노브가 이동 — 한 손가락만, 놓으면 0.3초에 가운데로
    const bar = document.getElementById('balGauge');
    if (bar) {
      this._bar = bar;
      this._rail = document.getElementById('balRail');
      bar.addEventListener('pointerdown', e => {
        if (this.state !== 'launched' || this.blocked || this.mode !== 'twohand' || this._keyLean() || this._barPtr) return;
        e.preventDefault();
        this.lastInputKind = e.pointerType === 'mouse' ? 'mouse' : 'touch';
        try { bar.setPointerCapture(e.pointerId); } catch (err) { /* iOS Safari 대응 */ }
        this._barPtr = { id: e.pointerId, x: e.clientX };
        this._syncPressed();
      }, opt);
      const up = e => { if (this._barPtr && e.pointerId === this._barPtr.id) { this._barPtr = null; this._syncPressed(); } };
      bar.addEventListener('pointerup', up, opt);
      bar.addEventListener('pointercancel', up, opt);
      bar.addEventListener('lostpointercapture', up, opt);
      bar.addEventListener('contextmenu', e => e.preventDefault(), opt);
      // 캡처가 안 되는 환경(바 밖으로 나간 손가락의 move/up)도 그 pointerId만 따라감
      window.addEventListener('pointermove', e => { if (this._barPtr && e.pointerId === this._barPtr.id) this._barPtr.x = e.clientX; }, opt);
      window.addEventListener('pointerup', up, opt);
      window.addEventListener('pointercancel', up, opt);
    }
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
    this.lastInputKind = e.pointerType === 'mouse' ? 'mouse' : 'touch';
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
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') this.lastInputKind = 'keyboard';
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
    this._syncPressed();
  }

  /** 버튼 뗌 — 그 손가락(pointerId)만. name을 주면 그 버튼에 묶인 손가락일 때만 */
  _release(pointerId, name) {
    const cur = this._btnPointers.get(pointerId);
    if (!cur || (name && cur !== name)) return;
    this._btnPointers.delete(pointerId);
    this._syncPressed();
  }

  /** 모든 입력 해제(회전/백그라운드/포커스 잃음) */
  releaseAll() {
    if (this.state === 'pulling') this._onPullUp(); // 스타트 바를 당기던 중 회전 → 발사 취소(바 복귀)
    this._keyCharging = false;
    this._btnPointers.clear();
    this._barPtr = null;
    this._keys.clear();
    this._syncPressed();
  }

  /** 눌린 부스트 버튼·바 드래그 표시 */
  _syncPressed() {
    const boost = document.getElementById('boostBtn');
    if (boost) boost.classList.toggle('pressed', [...this._btnPointers.values()].includes('boost'));
    if (this._bar) this._bar.classList.toggle('holding', !!this._barPtr);
  }

  /** 키보드 ← → 방향(−1/0/1) */
  _keyLean() { return (this._keys.has('ArrowRight') ? 1 : 0) - (this._keys.has('ArrowLeft') ? 1 : 0); }

  /** 손가락 x → 바 값(−1~1): 노브 중심이 다니는 레일(#balRail) 기준 */
  _valueAt(x) {
    const r = (this._rail || this._bar).getBoundingClientRect();
    return Math.max(-1, Math.min(1, ((x - r.left) / Math.max(1, r.width)) * 2 - 1));
  }

  _onDriveKey(e, down) {
    if (this.state !== 'launched' || (this.blocked && down)) return;
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'c', 'C'].includes(k)) return;
    e.preventDefault();
    this.lastInputKind = 'keyboard';
    if (k === 'c' || k === 'C') { if (down && !e.repeat) UI.toggleView(); return; } // 시점 바꾸기
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

  /** main.js 고정 스텝마다(cart.update 전) — 바 드래그/키보드/기울기를 leanInput으로 합성.
   * 우선순위: 손가락 드래그 > 키보드(천천히 이동) > 기울기 > 아무것도 없으면 0.3초에 걸쳐 가운데 복귀 */
  update(dt) {
    if (this.state !== 'launched') return;
    const c = this.cart;
    const keyLean = this._keyLean();
    if (this._barPtr && this.mode === 'twohand' && !keyLean) {
      const target = this._valueAt(this._barPtr.x);
      c.leanInput += (target - c.leanInput) * (1 - Math.exp(-dt * BAR_FOLLOW));
      this._rel = null;
      return;
    }
    if (keyLean) {
      c.leanInput = Math.max(-1, Math.min(1, c.leanInput + keyLean * KEY_LEAN_RATE * dt));
      this._rel = null;
      return;
    }
    if (this.mode === 'tilt') {
      this._updateTilt();
      if (this.mode === 'tilt') { // 기울기: 지수 추종(거의 즉시)
        c.leanInput += (this._leanTarget - c.leanInput) * (1 - Math.exp(-dt * this._leanRate));
        this._rel = null;
        return;
      }
    }
    // 손을 뗐다: 놓은 순간의 값에서 0까지 0.3초 ease-out
    if (Math.abs(c.leanInput) < 1e-4) { c.leanInput = 0; this._rel = null; return; }
    if (!this._rel) this._rel = { from: c.leanInput, t: 0 };
    this._rel.t += dt;
    const u = Math.min(1, this._rel.t / LEAN_RETURN_SEC);
    c.leanInput = this._rel.from * (1 - u * (2 - u));
  }

  _updateTilt() {
    const now = performance.now();
    if (!this._tiltInit) { this._tiltInit = true; this._tiltBase = InputController._gamma; this._tiltStart = now; } // 출발 순간 각도 = 정면
    const stale = !InputController._tiltSeenAt || now - InputController._tiltSeenAt > TILT.fallbackSec * 1000;
    if (InputController._tiltPermission === 'denied' || (stale && now - this._tiltStart > TILT.fallbackSec * 1000)) {
      this.mode = 'twohand'; // 센서를 쓸 수 없음 → 바 끌기로 자동 전환
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
