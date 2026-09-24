/**
 * camera.js
 * - 스타트 구간: 3인칭 고정 (토글 비활성화)
 * - 런칭 이후: 1인칭 / 3인칭 토글 가능, 전환 시 부드러운 보간
 * - 3인칭: 속도 비례 FOV 확장, 스프링(lag) 추적
 * - 1인칭: 트랙 접선 방향 유지 + 커브 구간 롤(뱅킹) 틸트
 */

const CAMERA_MODES = { THIRD_PERSON: 'third', FIRST_PERSON: 'first' };

class CoasterCamera {
  constructor(scene, canvas) {
    this.scene = scene;
    this.camera = new BABYLON.UniversalCamera('coasterCam', new BABYLON.Vector3(0, 10, -20), scene);
    this.camera.minZ = 0.1;
    this.camera.attachControl(canvas, false); // 카트가 주도, 사용자 자유시점 없음

    this.mode = CAMERA_MODES.THIRD_PERSON;
    this.locked = true; // 스타트 구간에는 토글 잠금

    this.baseFov = 0.8;
    this._transitionT = 1; // 1이면 전환 완료 상태
    this._fromPos = this.camera.position.clone();
    this._toPos = this.camera.position.clone();
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
    const speedRatio = Math.min(cart.speed / 30, 1); // 정규화된 속도 (연출용)

    let targetPos, targetLookAt, targetFov;

    if (this.mode === CAMERA_MODES.THIRD_PERSON) {
      const behind = tangent.scale(-8);
      const up = new BABYLON.Vector3(0, 3, 0);
      targetPos = cartPos.add(behind).add(up);
      targetLookAt = cartPos;
      targetFov = this.baseFov + speedRatio * 0.25; // 속도감 연출: FOV 확장
    } else {
      targetPos = cartPos.add(new BABYLON.Vector3(0, 1.2, 0));
      targetLookAt = cartPos.add(tangent.scale(10));
      targetFov = this.baseFov + speedRatio * 0.15;
    }

    // 전환 중이면 보간(lerp), 아니면 스프링 추적으로 부드럽게 따라감
    if (this._transitionT < 1) {
      this._transitionT = Math.min(1, this._transitionT + dt / 0.25); // 0.25초 전환
      this.camera.position = BABYLON.Vector3.Lerp(this.camera.position, targetPos, this._transitionT);
    } else {
      const springFactor = this.mode === CAMERA_MODES.THIRD_PERSON ? 5 : 12;
      this.camera.position = BABYLON.Vector3.Lerp(this.camera.position, targetPos, Math.min(1, dt * springFactor));
    }

    this.camera.setTarget(targetLookAt);
    this.camera.fov = targetFov;

    // 커브 구간 뱅킹(roll) 연출 — 1인칭에서만 체감 크게
    const seg = track.getSegmentAt(cart.t);
    if (seg.requiredLean > 0) {
      const rollAmount = seg.curveDirection === 'left' ? -0.15 : 0.15;
      const rollTarget = this.mode === CAMERA_MODES.FIRST_PERSON ? rollAmount : rollAmount * 0.4;
      this.camera.rotation.z = BABYLON.Scalar.Lerp(this.camera.rotation.z, rollTarget, dt * 4);
    } else {
      this.camera.rotation.z = BABYLON.Scalar.Lerp(this.camera.rotation.z, 0, dt * 4);
    }
  }
}

window.CAMERA_MODES = CAMERA_MODES;
window.CoasterCamera = CoasterCamera;
