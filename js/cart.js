/**
 * cart.js
 * 카트 이동 물리 (에너지 보존: v² = v0² + 2gΔh, 마찰은 dt 독립적 초당 감쇠율로 별도 적용)
 * 고정 타임스텝(FIXED_DT)으로 매 프레임 호출되는 update()에서 계산
 */

const G = 9.8;
const FRICTION_RETAIN_PER_SECOND = 0.975; // 평지·무입력 기준 초당 2.5% 감속 (dt 무관하게 Math.pow(., dt)로 적용)
const MIN_SPEED = 2;          // 최소 속도 (m/s) — 완전 정지 방지

class Cart {
  /**
   * @param {Track} track
   * @param {number} stageMultiplier - 스테이지 배속 (1.1^(stage-1) 등)
   * @param {number} totalLaps - 완주까지 폐곡선을 돌아야 하는 횟수 (기본 1 = 기존과 동일 동작)
   */
  constructor(track, stageMultiplier = 1, totalLaps = 1) {
    this.track = track;
    this.stageMultiplier = stageMultiplier;
    this.totalLaps = totalLaps;
    this.currentLap = 1;

    this.t = 0;                // 트랙 진행률 (0~1, 랩당)
    this.speed = 0;            // m/s
    this.launched = false;

    this.combo = 0;
    this.score = 0;
    this.leanInput = 0;        // -1(좌) ~ 1(우), input.js에서 갱신
    this.airtimeHolding = false; // 손들기 입력 상태

    this._lastHeight = null;
    this._gateResults = [];    // 게이트 판정 기록 (디버그/리더보드용)
  }

  /** 스타트: 드래그 거리(pullStrength) × release 순간 속도(flickMultiplier)로 초기 속도 부여 */
  launch(pullStrength, flickMultiplier = 1) {
    // pullStrength: 0~1 (드래그 거리를 정규화한 값), flickMultiplier: 0.3~1.6 (release 속도 정규화값) — input.js에서 계산
    this.speed = (5 + pullStrength * 10) * flickMultiplier * this.stageMultiplier; // m/s
    this.launched = true;
    this._lastHeight = this.track.getHeightAt(0);
  }

  /** 고정 타임스텝 물리 업데이트 */
  update(dt) {
    if (!this.launched) return;

    const trackLength = this.track.stageData.trackLengthM;
    const currentHeight = this.track.getHeightAt(this.t);

    if (this._lastHeight !== null) {
      const dh = this._lastHeight - currentHeight; // 내려가면 양수
      // v² = v0² + 2g*dh (에너지 보존 — 마찰은 아래서 별도의 dt 독립적 감쇠로 적용)
      const vSquared = this.speed * this.speed + 2 * G * dh;
      this.speed = Math.sqrt(Math.max(vSquared, MIN_SPEED * MIN_SPEED));
    }
    this._lastHeight = currentHeight;

    // 마찰: 오르막/내리막에서는 위 에너지항이 지배적이라 체감이 작고, 평지에서만 초당 감쇠율이 뚜렷이 느껴짐
    this.speed *= Math.pow(FRICTION_RETAIN_PER_SECOND, dt);
    this.speed = Math.max(this.speed, MIN_SPEED);

    // 진행률 갱신 (속도 * dt / 트랙길이)
    this.t += (this.speed * dt) / trackLength;
    if (this.t >= 1) {
      if (this.currentLap < this.totalLaps) {
        this.currentLap += 1;
        this.t -= 1; // 다음 랩으로 감아넘김 — 오버플로 유지로 속도 끊김 없이 이어짐 (isFinished는 마지막 랩에서만 t>=1로 남음)
      } else {
        this.t = 1;
      }
    }

    this._evaluateSegment(dt);
  }

  /** 현재 세그먼트의 밸런스/게이트 판정 처리 */
  _evaluateSegment(dt) {
    const seg = this.track.getSegmentAt(this.t);

    // 좌우 밸런스 판정
    if (seg.requiredLean > 0) {
      const targetLean = seg.curveDirection === 'left' ? -seg.requiredLean : seg.requiredLean;
      const diff = Math.abs(this.leanInput - targetLean);
      if (diff <= seg.leanWindow) {
        this.combo += 1;
      } else {
        this.speed *= Math.pow(0.995, dt * 60); // 감속 패널티 — 1/60초 기준 튜닝값, dt 무관하게 동일 초당 감쇠율 유지
        this.combo = 0;
      }
    }

    // 에어타임(손들기) 보너스
    if (seg.airtimeZone && this.airtimeHolding) {
      this.score += 2 * dt * 60; // 초당 보너스 점수
    }

    // 게이트 판정은 input.js의 탭 이벤트에서 별도 처리 (타이밍 윈도우 대조)
  }

  /** input.js에서 게이트 탭 시 호출 */
  resolveGate(localT) {
    const seg = this.track.getSegmentAt(this.t);
    if (!seg.gate) return 'none';

    const { start, end } = seg.gate.timingWindow;
    const center = (start + end) / 2;
    const halfWindow = (end - start) / 2;
    const diff = Math.abs(localT - center);

    let result;
    if (diff <= halfWindow * 0.4) result = 'perfect';
    else if (diff <= halfWindow) result = 'good';
    else result = 'miss';

    this._applyGateResult(seg.gate.type, result);
    this._gateResults.push({ type: seg.gate.type, result, t: this.t });
    return result;
  }

  _applyGateResult(gateType, result) {
    if (gateType === 'boost') {
      if (result === 'perfect') this.speed *= 1.25;
      else if (result === 'good') this.speed *= 1.1;
    } else if (gateType === 'brake') {
      if (result === 'perfect') this.speed *= 0.9;
      else if (result === 'miss') this.speed *= 0.6; // 이탈 위험 연출
    } else if (gateType === 'finish') {
      const multiplier = result === 'perfect' ? 1.5 : result === 'good' ? 1.2 : 1.0;
      this.score *= multiplier;
    }

    if (result === 'perfect') this.combo += 3;
    else if (result === 'miss') this.combo = 0;
  }

  get isFinished() {
    return this.t >= 1;
  }
}

window.Cart = Cart;
