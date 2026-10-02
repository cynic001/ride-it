/**
 * camera.js
 * - 스타트 구간: 항상 3인칭 고정(움직임 없음)
 * - 시점 설정(ViewSettings): 'third'(기본) — 부스트 성공 순간·큰 급하강(25m 이상) 진입 순간에만 짧게(1.2/1.5초) 1인칭 펄스 후 복귀,
 *                            복귀 뒤 3초는 다시 전환하지 않음(13번: 3·4·5단계가 부스트·에어타임 언덕 연속으로 1인칭 고정처럼 보이던 문제)
 *                            'first'       — 발사 직후 카트 좌석으로 부드럽게 이동해 1인칭 유지
 * - 전환: 3인칭/1인칭 목표(위치·시선·FOV·롤)를 매 프레임 둘 다 계산해 blend(0=3인칭, 1=1인칭)로 섞음 — 0.65초 smoothstep,
 *   위치만 옮기면 시선이 뚝 끊기므로 시선/FOV까지 함께 보간. 자동 전환은 최소 유지 시간으로 왔다 갔다 방지
 * - 카메라 버튼: 현재 시점을 잠깐(6초) 반대로 — 설정값은 그대로
 * - 속도감: 속도(상한 대비) 비례 FOV·흔들림, 커브 곡률 비례 흔들림, 급하강 진입/부스트 성공 시 짧고 강한 킥(kick)
 */

// 흔들림 진폭(m) — 1인칭은 멀미를 피하려고 더 약하게
const SHAKE = { speed: 0.12, curve: 0.08, dive: 0.18, firstPersonScale: 0.45 };
const VIEW_BLEND_SEC = 0.65;     // 3인칭↔1인칭 전환 시간
// 자동 1인칭 펄스(3인칭 설정): "조건이 이어지는 동안"이 아니라 순간 이벤트마다 짧게 — 연속 부스트·연속 언덕에서 계속 1인칭이던 문제(13번 진단)
const AUTO_FIRST = { boostSec: 1.2, dropSec: 1.5, cooldownSec: 3 };
const MANUAL_VIEW_SEC = 6;       // 카메라 버튼으로 바꾼 시점 유지 시간

const CAMERA_MODES = { THIRD_PERSON: 'third', FIRST_PERSON: 'first' };

// 시점 설정 — localStorage 저장, 기본 3인칭
const ViewSettings = {
  mode: localStorage.getItem('rc_view') === 'first' ? 'first' : 'third',
  set(m) {
    this.mode = m === 'first' ? 'first' : 'third';
    try { localStorage.setItem('rc_view', this.mode); } catch (e) { /* 무시 */ }
  },
};

class CoasterCamera {
  constructor(scene, canvas) {
    this.scene = scene;
    this.camera = new BABYLON.UniversalCamera('coasterCam', new BABYLON.Vector3(0, 10, -20), scene);
    this.camera.minZ = 0.1;
    this.camera.attachControl(canvas, false); // 카트가 주도, 사용자 자유시점 없음
    this.camera.maxZ = 3000;
    scene.activeCamera = this.camera; // 스테이지 재로드 시 새 카메라가 확실히 활성화되도록

    this.locked = true; // 스타트 구간에는 토글 잠금
    this.forceMode = null; // 테스트/스크린샷용 강제 시점('third'|'first') — 게임 흐름에서는 쓰지 않음

    this._blendLin = 0;  // 0=3인칭 ~ 1=1인칭 (선형 진행값, 화면에는 smoothstep 적용)
    this._autoUntil = 0;     // 자동 1인칭 펄스 끝나는 시각(_clock 기준)
    this._autoCooldown = 0;  // 이 시각 전엔 새 펄스 무시
    this.autoLog = [];       // { at, reason } — 진단/테스트용
    this._manualUntil = 0;
    this._manualTarget = 0;
    this._clock = 0;

    this._pos3 = this.camera.position.clone(); // 3인칭 스프링 상태(흔들림 제외) — 흔들림이 누적되지 않도록 분리
    this._fov = 0.8;
    this._roll = 0;
    this._impulse = 0;   // 순간 흔들림(m), 지수 감쇠
    this._fovKick = 0;   // 순간 FOV 확대(rad), 지수 감쇠
    this._prevTangentY = 0;
    this._push = 0;      // 발사/부스트 순간 카메라가 뒤로 밀리는 거리(m), 지수 감쇠
    this._dive = 0;
  }

  /** 현재 화면상 시점 */
  get mode() { return this._blendLin >= 0.5 ? CAMERA_MODES.FIRST_PERSON : CAMERA_MODES.THIRD_PERSON; }
  set mode(v) { this.forceMode = v; this._blendLin = v === CAMERA_MODES.FIRST_PERSON ? 1 : 0; }

  /** 발사 순간: 강한 FOV 킥 + 카메라가 뒤로 밀렸다가 따라붙음 */
  launchPush(strength = 1) {
    this.kick(1.1 * strength + 0.3);
    this._push = Math.max(this._push, 3 + 4 * strength);
  }

  /** 부스트 성공/급하강 진입 등 "쾅" 순간 — strength 0~1 */
  kick(strength = 1) {
    this._impulse = Math.max(this._impulse, 0.35 * strength);
    this._fovKick = Math.max(this._fovKick, 0.3 * strength);
    this._push = Math.max(this._push, 1.8 * strength);
  }

  /** 카트가 순간이동(이탈 재출발)했을 때 — 3인칭 스프링이 가로질러 날아오지 않게 즉시 맞추고 낙하/펄스 감지 기준 위치도 갱신 */
  resnap(cart) {
    this._snap = true;
    this._prevT = cart.t;
  }

  dispose() {
    this.camera.detachControl();
    this.camera.dispose();
  }

  unlockToggle() {
    this.locked = false;
  }

  /** 카메라 버튼 — 지금 보이는 시점의 반대로 잠깐 */
  toggleMode() {
    if (this.locked) return;
    this.forceMode = null;
    // 지금 화면에 보이는 시점의 반대로(사용자가 보고 누른 기준)
    this._manualTarget = this._blendLin >= 0.5 ? 0 : 1;
    this._manualUntil = this._clock + MANUAL_VIEW_SEC;
  }

  /** 이번 프레임에 원하는 시점(0/1) — 설정·자동 전환·수동 토글 규칙 */
  _desiredBlend(cart, tangent) {
    if (this.forceMode) return this.forceMode === CAMERA_MODES.FIRST_PERSON ? 1 : 0;
    if (!cart.launched) return 0; // 스타트 화면은 항상 3인칭
    if (this._clock < this._manualUntil) return this._manualTarget;
    if (ViewSettings.mode === 'first') return 1;
    return this._clock < this._autoUntil ? 1 : 0; // 3인칭 설정: 펄스 동안만 1인칭
  }

  /** 자동 1인칭 펄스 요청(3인칭 설정에서만 의미) — 쿨다운 중이거나 뒤로 떨어지는 중이면 무시 */
  autoFirst(sec, reason, cart) {
    if (!cart || !cart.launched || cart.rollback || cart.derailState || this._clock < this._autoCooldown) return;
    if (this._clock < this._autoUntil) { this._autoUntil = Math.max(this._autoUntil, this._clock + sec); }
    else this._autoUntil = this._clock + sec;
    this._autoCooldown = this._autoUntil + VIEW_BLEND_SEC + AUTO_FIRST.cooldownSec; // 복귀(블렌드) 후 3초
    this.autoLog.push({ at: +this._clock.toFixed(2), reason });
  }

  /**
   * @param {Track} track
   * @param {Cart} cart
   * @param {number} dt
   */
  update(track, cart, dt) {
    this._clock += dt;
    const cartPos = track.getPositionAt(cart.t);
    const tangent = track.getTangentAt(cart.t);
    const speedRatio = Math.min(1, cart.speed / cart.maxSpeedMs); // 상한 대비 속도(연출용 0~1)
    const seg = track.getSegmentAt(cart.t);
    const isHanging = track.stageData.railType === 'hanging'; // 인버티드: 카트가 레일 아래 — 카메라도 레일보다 낮게
    const bankFactor = seg.requiredLean || 0;

    // 급하강: 시선을 경사 비례로 아래로 당기고 FOV·흔들림을 더 크게(떨어질 때 더 빠르게)
    const dive = cart.launched ? Math.max(0, -tangent.y - 0.2) : 0;
    this._dive = BABYLON.Scalar.Lerp(this._dive, dive, Math.min(1, dt * 4));

    // ── 3인칭 목표: 낮고 가깝게(후방 6.2m·위 2m, 커브 세기 비례로 더 멀리·높이) ──
    const behind = tangent.scale(-(isHanging ? 8 + bankFactor * 4 : 6.2 + bankFactor * 4));
    const lift = cart.onChainLift ? 1.5 : 0; // 체인 리프트: 살짝 높여 멀리 풍경이 보이게
    const up3 = new BABYLON.Vector3(0, isHanging ? -1.1 - bankFactor : 2.0 + bankFactor * 2.5 + lift, 0);
    const pos3 = cartPos.add(behind).add(up3).add(tangent.scale(-this._push));
    const look3 = cartPos.add(tangent.scale(5)).add(new BABYLON.Vector3(0, (isHanging ? -0.8 : 1.0) - this._dive * 9, 0));
    const fov3 = 0.72 + speedRatio * 0.6 + this._dive * 0.28;

    // ── 1인칭 목표: 카트 기준 위쪽(트랙 법선) + 앞좌석 ──
    let right = BABYLON.Vector3.Cross(BABYLON.Vector3.Up(), tangent);
    if (right.lengthSquared() < 0.01) right = this._lastRight || BABYLON.Vector3.Right(); // 수직 구간 특이점
    right.normalize();
    this._lastRight = right;
    const localUp = BABYLON.Vector3.Cross(tangent, right).normalize();
    const pos1 = cartPos.add(localUp.scale(isHanging ? -0.45 : 1.1)).add(tangent.scale(1.1));
    const look1 = pos1.add(tangent.scale(10)).add(new BABYLON.Vector3(0, -this._dive * 5, 0));
    const fov1 = 0.82 + speedRatio * 0.33 + this._dive * 0.2;

    // ── 시점 blend ──
    // 큰 급하강(트랙이 미리 계산한 25m 이상 연속 낙하) 시작점을 지나는 순간 1인칭 펄스 — 에어타임 언덕·물(착수)은 해당 없음
    // (4·5단계는 낙하가 t=0에서 바로 시작 — 발사 첫 틱은 직전 위치를 t 바로 앞으로, 랩이 넘어갈 때(t 1→0)는 감아넘김으로 판정)
    if (cart.launched && !cart.rollback && track.bigDrops) {
      const p = this._prevT === undefined ? -1e-6 : this._prevT, t = cart.t;
      const wrapped = t < p - 0.5;
      for (const d of track.bigDrops) if (wrapped ? (d > p || d <= t) : (p < d && t >= d)) this.autoFirst(AUTO_FIRST.dropSec, 'drop', cart);
    }
    if (cart.launched) this._prevT = cart.t;
    const target = this._desiredBlend(cart, tangent);
    this._lastTarget = target;
    const step = dt / VIEW_BLEND_SEC;
    this._blendLin = target > this._blendLin ? Math.min(target, this._blendLin + step) : Math.max(target, this._blendLin - step);
    const w = this._blendLin * this._blendLin * (3 - 2 * this._blendLin); // smoothstep

    // 3인칭 스프링(발사 전엔 완전 고정)
    this._pos3 = cart.launched && !this._snap ? BABYLON.Vector3.Lerp(this._pos3, pos3, Math.min(1, dt * 5)) : pos3;
    this._snap = false;

    // 급하강 진입(접선이 아래로 크게 꺾이는 순간) — 짧고 강한 킥
    if (cart.launched && tangent.y < -0.45 && this._prevTangentY >= -0.45 && speedRatio > 0.3) this.kick(0.9);
    this._prevTangentY = tangent.y;

    // 흔들림: 속도² + 커브 곡률 + 급하강 + 순간 킥 — 여러 주파수 사인 합이라 규칙적인 떨림으로 안 보임
    this._impulse *= Math.exp(-dt * 6);
    this._fovKick *= Math.exp(-dt * 5);
    this._push *= Math.exp(-dt * 3);
    const amp = (cart.launched ? SHAKE.speed * speedRatio * speedRatio + SHAKE.curve * bankFactor * speedRatio + SHAKE.dive * this._dive : 0)
      + this._impulse;
    const k = amp * (1 - w * (1 - SHAKE.firstPersonScale));
    const T = this._clock;
    const shake = new BABYLON.Vector3(
      (Math.sin(T * 37.1) + 0.6 * Math.sin(T * 23.3 + 1.3)) * k,
      (Math.sin(T * 41.7 + 2.1) + 0.5 * Math.sin(T * 19.1 + 0.4)) * k,
      Math.sin(T * 31.9 + 0.7) * k * 0.5
    );
    const pos = BABYLON.Vector3.Lerp(this._pos3, pos1, w);
    let look = BABYLON.Vector3.Lerp(look3, look1, w);
    if (this.focus) look = BABYLON.Vector3.Lerp(look, this.focus, 0.85); // 레일 이탈 중: 날아가는 카트를 따라 봄
    this.camera.position = pos.add(shake);
    this.camera.setTarget(look.add(shake.scale(0.3)));

    const fovT = fov3 + (fov1 - fov3) * w;
    this._fov = BABYLON.Scalar.Lerp(this._fov, fovT, Math.min(1, dt * 6));
    const cap = 1.45 + (1.25 - 1.45) * w;
    this.camera.fov = Math.min(cap, this._fov + this._fovKick * (1 - 0.4 * w));

    // 커브 구간 뱅킹(roll) — 1인칭에서 체감 크게 (setTarget이 roll을 초기화하므로 별도 상태로 유지 후 적용)
    let rollTarget = 0;
    if (seg.requiredLean > 0) {
      const rollAmount = seg.curveDirection === 'left' ? -0.15 : 0.15;
      rollTarget = rollAmount * (0.4 + 0.6 * w);
    }
    this._roll = BABYLON.Scalar.Lerp(this._roll, rollTarget, Math.min(1, dt * 4));
    this.camera.rotation.z = this._roll;
  }
}

window.CAMERA_MODES = CAMERA_MODES;
window.AUTO_FIRST = AUTO_FIRST;
window.CoasterCamera = CoasterCamera;
window.ViewSettings = ViewSettings;
