/**
 * cart.js
 * 카트 이동 물리 (에너지 보존: v² = v0² + 2gΔh, 마찰은 dt 독립적 초당 감쇠율로 별도 적용)
 * 고정 타임스텝(FIXED_DT)으로 매 프레임 호출되는 update()에서 계산
 */

const G = 9.8;
const FRICTION_RETAIN_PER_SECOND = 0.975; // 평지·무입력 기준 초당 2.5% 감속 (dt 무관하게 Math.pow(., dt)로 적용)
const MIN_SPEED = 2;          // 최소 속도 (m/s) — 완전 정지 방지
// boost 게이트 배율 — 실측 시뮬레이션(에너지보존식 기준) 결과 기존 1.25/1.1로는 하강 후 복귀
// 오르막(특히 스테이지 후반 리프트 구간)에서 속도가 MIN_SPEED까지 떨어져 수십 초씩 정체하는
// 현상을 확인, 리프트힐 체인모터 같은 "동력 보충" 역할을 하도록 상향 조정
const BOOST_MULTIPLIER = { perfect: 2.2, good: 1.6 };
// 최고속도 상한 = 스테이지 기본 속도 × 이 배율 — 부스트 연속 성공 시 배율이 누적되어 1500km/h 넘게 폭주하던 문제 방지
const MAX_SPEED_FACTOR = 1.5;

// 점수 체계 — 모든 획득 점수에 콤보 배율(콤보 10마다 +0.1, 최대 2배) 적용, 피니쉬 배율은 마지막에 총점에 곱함
const SCORE = {
  gate: { perfect: 300, good: 100, miss: 0 },
  balancePerCurve: 100,     // 커브 세그먼트 하나를 밸런스 성공으로 통과 시 1회
  balanceClearRatio: 0.7,   // 그 커브 구간 틱 중 판정창 안(good 이상) 비율이 이 이상이면 성공
  airtimePerSecond: 120,    // 기존 값 유지(2점 × 60틱)
};
const AIRTIME_MIN_SPEED = 4; // m/s — 이 속도 이하(최저속도로 기어가는 정체 상태)에서는 에어타임 점수 없음
const FINISH_MULTIPLIER = { perfect: 1.5, good: 1.2, miss: 1.0 };

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
    this._lastBalanceTier = null; // 밸런스 판정 tier 변화 감지용(오디오 이벤트 중복 발생 방지)

    // 결과 화면 통계용(판정/물리에는 관여하지 않음)
    this.maxCombo = 0;
    this.balanceTicks = { perfect: 0, good: 0, miss: 0 }; // 커브 구간 고정 스텝(1/60초) 단위 판정 누적
    this.maxSpeed = 0;
    this.maxSpeedMs = track.stageData.baseSpeedKmh * MAX_SPEED_FACTOR / 3.6;
    this.atSpeedCap = false;  // HUD 강조용
    // 점수 원천별 내역 — 콤보 배율로 늘어난 몫은 comboBonus로 따로 집계(합계 = score)
    this.scoreBreakdown = { gate: 0, balance: 0, airtime: 0, comboBonus: 0, finishBonus: 0 };
    this._curve = null;        // 진행 중인 커브 세그먼트 { key, inWindow, total }
    this._resolvedGates = new Set(); // 게이트당(랩별) 판정 1회 — 연타로 점수/부스트를 반복 획득하는 것 방지
  }

  /** 현재 콤보 배율: 콤보 10마다 +0.1배, 최대 2배 */
  get comboMultiplier() {
    return Math.min(2, 1 + Math.floor(this.combo / 10) * 0.1);
  }

  /** 원천별 기본 점수에 콤보 배율을 적용해 가산 */
  _addScore(source, base) {
    if (base <= 0) return;
    const m = this.comboMultiplier;
    this.scoreBreakdown[source] += base;
    this.scoreBreakdown.comboBonus += base * (m - 1);
    this.score += base * m;
  }

  _capSpeed() {
    // 상한에 붙어 달리면 매 틱 마찰로 아주 조금씩 밑돌므로 1.5% 이내는 상한 도달로 취급(HUD 강조 깜빡임 방지)
    this.atSpeedCap = this.speed >= this.maxSpeedMs * 0.985;
    if (this.speed > this.maxSpeedMs) this.speed = this.maxSpeedMs;
  }

  /** 커브 세그먼트를 빠져나올 때(또는 완주 시) 그 구간의 밸런스 성공 여부로 1회 점수 */
  _finalizeCurve() {
    const c = this._curve;
    this._curve = null;
    if (c && c.total > 0 && c.inWindow / c.total >= SCORE.balanceClearRatio) {
      this._addScore('balance', SCORE.balancePerCurve);
      this.curvesCleared = (this.curvesCleared || 0) + 1;
    }
  }

  /** 스타트: 드래그 거리(pullStrength) × release 순간 속도(flickMultiplier)로 초기 속도 부여 */
  launch(pullStrength, flickMultiplier = 1) {
    // pullStrength: 0~1 (드래그 거리를 정규화한 값), flickMultiplier: 0.3~1.6 (release 속도 정규화값) — input.js에서 계산
    this.speed = (5 + pullStrength * 10) * flickMultiplier * this.stageMultiplier; // m/s
    this.launched = true;
    this._capSpeed();
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
    this._capSpeed();

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
    if (this.isFinished) this._finalizeCurve();
  }

  /** 현재 세그먼트의 밸런스/게이트 판정 처리 */
  _evaluateSegment(dt) {
    const seg = this.track.getSegmentAt(this.t);
    const segKey = `${this.currentLap}:${seg.tStart}`;
    if (this._curve && this._curve.key !== segKey) this._finalizeCurve();

    // 좌우 밸런스 판정 — 통과/실패 기준(leanWindow)은 그대로, tier는 오디오 피드백 선택용으로만 추가
    if (seg.requiredLean > 0) {
      const targetLean = seg.curveDirection === 'left' ? -seg.requiredLean : seg.requiredLean;
      const diff = Math.abs(this.leanInput - targetLean);
      let tier;
      if (diff <= seg.leanWindow) {
        this.combo += 1;
        tier = diff <= seg.leanWindow * 0.4 ? 'perfect' : 'good';
      } else {
        this.speed *= Math.pow(0.995, dt * 60); // 감속 패널티 — 1/60초 기준 튜닝값, dt 무관하게 동일 초당 감쇠율 유지
        this.combo = 0;
        tier = 'miss';
      }
      this.balanceTicks[tier] += 1;
      if (!this._curve) this._curve = { key: segKey, inWindow: 0, total: 0 };
      this._curve.total += 1;
      if (tier !== 'miss') this._curve.inWindow += 1;
      // tier가 바뀔 때만 이벤트 발생 — 매 틱(60Hz) 발사하면 사운드가 겹쳐 스팸이 됨
      if (tier !== this._lastBalanceTier) {
        window.dispatchEvent(new CustomEvent('balance-result', { detail: tier }));
        this._lastBalanceTier = tier;
      }
    } else {
      this._lastBalanceTier = null; // 밸런스 불필요 구간을 지나면 리셋 — 다음 커브 진입 시 다시 엣지 감지되도록
    }

    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.maxSpeed = Math.max(this.maxSpeed, this.speed);

    // 에어타임(손들기) 보너스
    // 최저속도 근처로 기어가는 중엔 제외 — 초당 점수라 정체될수록 오히려 점수가 쌓여 평균 플레이가 완벽 플레이를
    // 이기는 역전이 시뮬레이션에서 확인됨(5단계 평균 48,016 vs 완벽 19,184). 정상 주행 시 획득률은 그대로
    if (seg.airtimeZone && this.airtimeHolding && this.speed > AIRTIME_MIN_SPEED) {
      this._addScore('airtime', SCORE.airtimePerSecond * dt); // 초당 보너스 점수(기존 값 유지)
    }

    // 게이트 판정은 input.js의 탭 이벤트에서 별도 처리 (타이밍 윈도우 대조)
  }

  /** input.js에서 게이트 탭 시 호출 */
  resolveGate(localT) {
    const seg = this.track.getSegmentAt(this.t);
    if (!seg.gate) return 'none';
    const gateKey = `${this.currentLap}:${seg.tStart}`;
    if (this._resolvedGates.has(gateKey)) return 'none';
    this._resolvedGates.add(gateKey);

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
      if (result === 'perfect') this.speed *= BOOST_MULTIPLIER.perfect;
      else if (result === 'good') this.speed *= BOOST_MULTIPLIER.good;
    } else if (gateType === 'brake') {
      if (result === 'perfect') this.speed *= 0.9;
      else if (result === 'miss') this.speed *= 0.6; // 이탈 위험 연출
    }
    this._capSpeed();

    if (result === 'perfect') this.combo += 3;
    else if (result === 'miss') this.combo = 0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);

    this._addScore('gate', SCORE.gate[result]);
    if (gateType === 'finish') {
      // 피니쉬 배율(기존 유지)은 그때까지의 총점에 곱함 — 늘어난 몫을 finishBonus로 기록
      const multiplier = FINISH_MULTIPLIER[result];
      this.scoreBreakdown.finishBonus += this.score * (multiplier - 1);
      this.score *= multiplier;
    }
  }

  get isFinished() {
    return this.t >= 1;
  }
}

window.Cart = Cart;
