/**
 * camera.js
 * - 스타트 구간: 3인칭 고정 (토글 비활성화)
 * - 런칭 이후: 1인칭 / 3인칭 토글 가능, 전환 시 부드러운 보간
 * - 3인칭: 속도 비례 FOV 확장, 스프링(lag) 추적
 * - 1인칭: 트랙 접선 방향 유지 + 커브 구간 롤(뱅킹) 틸트
 * - 속도감: 속도(상한 대비) 비례 FOV·흔들림, 커브 곡률 비례 흔들림, 급하강 진입/부스트 성공 시 짧고 강한 킥(kick)
 */

// 흔들림 진폭(m) — 1인칭은 멀미를 피하려고 더 약하게
const SHAKE = { speed: 0.12, curve: 0.08, firstPersonScale: 0.45 };

const CAMERA_MODES = { THIRD_PERSON: 'third', FIRST_PERSON: 'first' };

class CoasterCamera {
  constructor(scene, canvas) {
    this.scene = scene;
    this.camera = new BABYLON.UniversalCamera('coasterCam', new BABYLON.Vector3(0, 10, -20), scene);
    this.camera.minZ = 0.1;
    this.camera.attachControl(canvas, false); // 카트가 주도, 사용자 자유시점 없음
    this.camera.maxZ = 3000;
    scene.activeCamera = this.camera; // 스테이지 재로드 시 새 카메라가 확실히 활성화되도록

    this.mode = CAMERA_MODES.THIRD_PERSON;
    this.locked = true; // 스타트 구간에는 토글 잠금

    this.baseFov = 0.8;
    this._transitionT = 1; // 1이면 전환 완료 상태
    this._pos = this.camera.position.clone(); // 흔들림을 뺀 추적 위치(스프링 상태) — 흔들림이 누적되지 않도록 분리
    this._fov = this.baseFov;
    this._roll = 0;
    this._time = 0;
    this._impulse = 0;   // 순간 흔들림(m), 지수 감쇠
    this._fovKick = 0;   // 순간 FOV 확대(rad), 지수 감쇠
    this._prevTangentY = 0;
    this._push = 0;      // 발사/부스트 순간 카메라가 뒤로 밀리는 거리(m), 지수 감쇠 — 스프링이 따라붙으며 "튀어나가는" 느낌
  }

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

  dispose() {
    this.camera.detachControl();
    this.camera.dispose();
  }

  unlockToggle() {
    this.locked = false;
  }

  toggleMode() {
    if (this.locked) return;
    this.mode = this.mode === CAMERA_MODES.THIRD_PERSON ? CAMERA_MODES.FIRST_PERSON : CAMERA_MODES.THIRD_PERSON;
    this._transitionT = 0; // 전환 애니메이션 시작
  }

  /**
   * @param {Track} track
   * @param {Cart} cart
   * @param {number} dt
   */
  update(track, cart, dt) {
    const cartPos = track.getPositionAt(cart.t);
    const tangent = track.getTangentAt(cart.t);
    const speedRatio = Math.min(1, cart.speed / cart.maxSpeedMs); // 상한 대비 속도(연출용 0~1)
    const seg = track.getSegmentAt(cart.t);

    let targetPos, targetLookAt, targetFov;

    // 인버티드(hanging)는 카트가 레일 아래에 매달려 있으므로 카메라도 레일보다 낮게 — 위에서 보면 레일이 카트를 가림
    const isHanging = track.stageData.railType === 'hanging';

    if (this.mode === CAMERA_MODES.THIRD_PERSON) {
      // 급커브(requiredLean 높음)일수록 카메라를 더 멀리·높이 띄워 지지대/레일을 뚫고 들어가
      // 보이는 것을 방지 (헤어핀 급커브에서 고정 8m 후방 지점이 안쪽 지지대와 겹치는 문제 확인)
      const bankFactor = seg.requiredLean || 0;
      const behind = tangent.scale(-(isHanging ? 10 + bankFactor * 5 : 8 + bankFactor * 6));
      // 인버티드는 카트 높이(레일 아래) 뒤쪽에서 — 레일 바로 위/안이면 레일 상자가 화면을 통째로 가림
      const up = new BABYLON.Vector3(0, isHanging ? -1.1 - bankFactor : 3 + bankFactor * 4, 0);
      targetPos = cartPos.add(behind).add(up).add(tangent.scale(-this._push));
      // 카트 자체가 아니라 카트 앞쪽 약간 위를 바라봄 — 화면이 땅으로 기울지 않고 하늘/진행 방향이 더 보이는 구도
      targetLookAt = cartPos.add(tangent.scale(5)).add(new BABYLON.Vector3(0, isHanging ? -0.8 : 1.2, 0));
      targetFov = 0.74 + speedRatio * 0.46; // 속도감: 가속 시 앞으로 빨려드는 느낌(0.74→1.20rad)
    } else {
      // 월드 위쪽이 아니라 카트 기준 위쪽(트랙 법선)으로 띄우고 앞좌석 쪽으로 당김 — 월드 +Y로만 띄우면
      // 4·5단계 급낙하처럼 카트가 크게 기울 때 카메라가 카트 몸체 안으로 들어가 화면이 통째로 가려졌음
      let right = BABYLON.Vector3.Cross(BABYLON.Vector3.Up(), tangent);
      if (right.lengthSquared() < 0.01) right = this._lastRight || BABYLON.Vector3.Right(); // 수직 구간 특이점
      right.normalize();
      this._lastRight = right;
      const localUp = BABYLON.Vector3.Cross(tangent, right).normalize();
      // 카트 앞끝(길이 약 2m의 절반 너머)에 두어 앞좌석 등받이가 화면 아래 1/3을 가리지 않게
      targetPos = cartPos.add(localUp.scale(isHanging ? -0.45 : 1.1)).add(tangent.scale(1.1));
      targetLookAt = targetPos.add(tangent.scale(10));
      targetFov = 0.82 + speedRatio * 0.28; // 1인칭은 변화폭을 줄여 어지럽지 않게(최대 1.10rad)
    }

    const first = this.mode === CAMERA_MODES.FIRST_PERSON;

    // 전환 중이면 보간(lerp), 아니면 스프링 추적으로 부드럽게 따라감
    if (this._transitionT < 1) {
      this._transitionT = Math.min(1, this._transitionT + dt / 0.25); // 0.25초 전환
      this._pos = BABYLON.Vector3.Lerp(this._pos, targetPos, this._transitionT);
    } else if (!cart.launched) {
      // 스타트 화면: 카메라 완전 고정(스프링 수렴 중 미끄러지는 움직임도 없게) — 당기는 조작에 집중
      this._pos = targetPos;
    } else if (first) {
      // 1인칭은 탑승자 시점이라 카트에 고정 — 스프링을 두면 100km/h 이상에서 목표보다 2m 넘게 뒤처져 카트 몸체가 화면을 가림
      this._pos = targetPos;
    } else {
      this._pos = BABYLON.Vector3.Lerp(this._pos, targetPos, Math.min(1, dt * 5));
    }

    // 급하강 진입(접선이 아래로 크게 꺾이는 순간) — 짧고 강한 킥
    if (cart.launched && tangent.y < -0.45 && this._prevTangentY >= -0.45 && speedRatio > 0.3) this.kick(0.7);
    this._prevTangentY = tangent.y;

    // 흔들림: 속도² + 커브 곡률(requiredLean) + 순간 킥 — 여러 주파수 사인 합이라 규칙적인 떨림으로 안 보임
    this._time += dt;
    this._impulse *= Math.exp(-dt * 6);
    this._fovKick *= Math.exp(-dt * 5);
    this._push *= Math.exp(-dt * 3);
    const amp = (cart.launched ? SHAKE.speed * speedRatio * speedRatio + SHAKE.curve * (seg.requiredLean || 0) * speedRatio : 0)
      + this._impulse;
    const k = amp * (first ? SHAKE.firstPersonScale : 1);
    const T = this._time;
    const shake = new BABYLON.Vector3(
      (Math.sin(T * 37.1) + 0.6 * Math.sin(T * 23.3 + 1.3)) * k,
      (Math.sin(T * 41.7 + 2.1) + 0.5 * Math.sin(T * 19.1 + 0.4)) * k,
      Math.sin(T * 31.9 + 0.7) * k * 0.5
    );
    this.camera.position = this._pos.add(shake);
    this.camera.setTarget(targetLookAt.add(shake.scale(0.3)));

    this._fov = BABYLON.Scalar.Lerp(this._fov, targetFov, Math.min(1, dt * 6));
    this.camera.fov = Math.min(first ? 1.2 : 1.35, this._fov + this._fovKick * (first ? 0.6 : 1));

    // 커브 구간 뱅킹(roll) 연출 — 1인칭에서만 체감 크게 (setTarget이 roll을 초기화하므로 별도 상태로 유지 후 적용)
    let rollTarget = 0;
    if (seg.requiredLean > 0) {
      const rollAmount = seg.curveDirection === 'left' ? -0.15 : 0.15;
      rollTarget = first ? rollAmount : rollAmount * 0.4;
    }
    this._roll = BABYLON.Scalar.Lerp(this._roll, rollTarget, Math.min(1, dt * 4));
    this.camera.rotation.z = this._roll;
  }
}

window.CAMERA_MODES = CAMERA_MODES;
window.CoasterCamera = CoasterCamera;
