/**
 * cart.js
 * 카트 이동 물리 (에너지 보존: v² = v0² + 2gΔh, 마찰은 dt 독립적 초당 감쇠율로 별도 적용)
 * 고정 타임스텝(FIXED_DT)으로 매 프레임 호출되는 update()에서 계산
 */

const G = 9.8;
const FRICTION_RETAIN_PER_SECOND = 0.975; // 평지·무입력 기준 초당 2.5% 감속 (dt 무관하게 Math.pow(., dt)로 적용)
const MIN_SPEED = 2;          // 최소 속도 (m/s) — 완전 정지 방지
// 부스트 = 일정 거리 동안 지속되는 가속(순간 배율 곱하기 대신). accel은 기본 속도 대비 초당 가속량, distance는 화면 진행 m.
// Perfect는 길고 강하게, Good은 짧고 약하게, Miss는 없음 — 속도 상한(기본×1.5)은 그대로 적용
const BOOST = { perfect: { accel: 0.6, distance: 80 }, good: { accel: 0.35, distance: 40 } };
// 게임용 속도 과장 — 물리 속도(=HUD 표시, 실제 모티브 km/h 범위)는 그대로 두고, 트랙 위 진행만 이 배율로 빠르게.
// 1.8(요청 범위 1.6~1.8의 최대): 게이트 판정이 시간 기준이라 속도를 올려도 판정 난이도는 그대로. 부스트 게이트를 세그먼트
// 중앙으로 옮긴 뒤 연속 이벤트(게이트/커브 진입) 최소 간격 0.73초(≥0.6), 완주 15.0초 이상 — 개발기록 36번 측정표
const GAME_SPEED_SCALE = 1.8;
// 커브 밸런스 실패 감속 — 초당 3% (이전: 틱당 ×0.995 = 초당 약 26%로, 평균 플레이가 최저속도로 수 분씩 정체하던 주원인)
const BALANCE_MISS_RETAIN_PER_SECOND = 0.97;
// 최저 속도 보장(부스터 타이어): 기본 속도의 trigger 미만이면 발동, tau초 시정수로 target까지 끌어올리고 release 이상이면 해제
const ASSIST = { trigger: 0.6, target: 0.85, release: 0.78, tau: 0.5 };
// 최고속도 상한 = 스테이지 기본 속도 × 이 배율 — 부스트 연속 성공 시 배율이 누적되어 1500km/h 넘게 폭주하던 문제 방지
const MAX_SPEED_FACTOR = 1.5;

// 점수 체계 — 모든 획득 점수에 콤보 배율(콤보 10마다 +0.1, 최대 2배) 적용, 피니쉬 배율은 마지막에 총점에 곱함
const SCORE = {
  gate: { perfect: 300, good: 100, miss: 0 },
  balancePerCurve: 100,     // 커브 세그먼트 하나를 밸런스 성공으로 통과 시 1회
  balanceClearRatio: 0.7,   // 그 커브 구간 틱 중 판정창 안(good 이상) 비율이 이 이상이면 성공
  airtimePerMeter: 4.4,     // 홀드한 채 달린 거리 1m당 — 완벽 플레이 에어타임 총량(전 스테이지 합 약 8,400)이 시간 기준(초당 120) 시절과 같도록 맞춘 계수
};
// 게이트 판정(시간 기준): 모바일 터치 지연 보정 — 탭 이벤트가 실제 손가락 접촉보다 약 이만큼 늦게 도착한다고 보고
// 판정 시각을 앞당겨 계산. 기기별 체감이 다르면 이 값 하나만 조정
const INPUT_LATENCY_OFFSET = 0.05; // 초
// 게이트 중심 도달 시각과의 차이가 이 범위(초) 밖인 탭은 판정 자체를 하지 않음(엉뚱한 탭으로 게이트를 날리지 않도록)
const GATE_ATTEMPT_RANGE = 0.4;
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
    this.baseSpeedMs = track.stageData.baseSpeedKmh / 3.6;
    this.maxSpeedMs = this.baseSpeedMs * MAX_SPEED_FACTOR; // 물리(=표시) 속도 기준 — 화면 진행은 여기에 GAME_SPEED_SCALE이 곱해짐
    this.assistActive = false;
    this.assistTime = 0;      // 보조 추진이 걸린 시간(초) — 결과 화면 통계
    this.rideTime = 0;
    this.lowSpeedTime = 0;    // 기본 속도 70% 미만으로 달린 시간(밸런싱 지표)
    this.airtimeDistance = 0;
    this.atSpeedCap = false;  // HUD 강조용
    // 점수 원천별 내역 — 콤보 배율로 늘어난 몫은 comboBonus로 따로 집계(합계 = score)
    this.scoreBreakdown = { gate: 0, balance: 0, airtime: 0, comboBonus: 0, finishBonus: 0 };
    this._curve = null;        // 진행 중인 커브 세그먼트 { key, inWindow, total }
    this._resolvedGates = new Set(); // 게이트당(랩별) 판정 1회 — 연타로 점수/부스트를 반복 획득하는 것 방지
    this.boostRemaining = 0;  // 남은 가속 거리(m)
    this.boostAccel = 0;      // 가속량(m/s²) — 연출(방사형 블러 등)이 세기로 사용
    this.boostTime = 0;
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

  /** 부스터 타이어: 기본 속도의 60% 아래로 떨어지면 부드럽게(지수 접근) 85%까지 끌어올림 — 중력보다 우선 */
  _updateAssist(dt) {
    const base = this.baseSpeedMs;
    if (!this.assistActive && this.speed < base * ASSIST.trigger) {
      this.assistActive = true;
      window.dispatchEvent(new CustomEvent('booster-assist'));
    }
    if (!this.assistActive) return;
    this.speed += (base * ASSIST.target - this.speed) * (1 - Math.exp(-dt / ASSIST.tau));
    this.assistTime += dt;
    if (this.speed >= base * ASSIST.release) this.assistActive = false;
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
    this._stepDistance = 0;
    this._capSpeed();
    this._lastHeight = this.track.getHeightAt(0);
  }

  /** 고정 타임스텝 물리 업데이트 */
  update(dt) {
    if (!this.launched) return;

    // 진행률은 실제 커브 길이 기준 — stageData.trackLengthM(실제 코스터 길이)은 모델링된 커브보다 10~50% 길어서
    // 그대로 쓰면 화면상 카트가 표시 속도보다 느리게 움직였음
    const trackLength = this.track.lengthM;
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
    if (this.boostRemaining > 0) {
      this.speed += this.boostAccel * dt;
      this.boostRemaining -= this._stepDistance || 0;
      this.boostTime += dt;
      if (this.boostRemaining <= 0) { this.boostRemaining = 0; this.boostAccel = 0; }
    }
    this._updateAssist(dt);
    this._capSpeed();

    // 진행률 갱신 (속도 × 게임 배율 × dt / 트랙길이)
    this._stepDistance = this.speed * Cart.speedScale * dt;
    this.t += this._stepDistance / trackLength;
    this.rideTime += dt;
    if (this.speed < this.baseSpeedMs * 0.7) this.lowSpeedTime += dt;
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
        this.speed *= Math.pow(BALANCE_MISS_RETAIN_PER_SECOND, dt); // 감속 패널티(초당 3%) — 실수의 대가는 주로 점수(콤보 리셋·밸런스 점수 미획득)
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
    // 에어타임(손들기) 보너스 — 홀드한 채 달린 거리 기준(시간 기준이면 느리게 갈수록 점수가 쌓이는 역전이 생김)
    if (seg.airtimeZone && this.airtimeHolding) {
      this._addScore('airtime', SCORE.airtimePerMeter * this._stepDistance);
      this.airtimeDistance += this._stepDistance;
    }

    // 게이트 판정은 input.js의 탭 이벤트에서 별도 처리 (타이밍 윈도우 대조)
  }

  /** 현재 세그먼트 앞뒤 1칸까지의 게이트 후보 — 중심 지점(timingWindow 중앙)까지 남은 진행률(dT, 음수면 이미 지남) */
  _gateCandidates() {
    const segs = this.track.segmentRanges;
    const n = segs.length;
    let i = segs.findIndex(s => this.t >= s.tStart && this.t < s.tEnd);
    if (i === -1) i = n - 1;
    const out = [];
    for (const off of [-1, 0, 1]) {
      let j = i + off, lap = this.currentLap;
      if (j < 0) { j += n; lap -= 1; }
      if (j >= n) { j -= n; lap += 1; }
      if (lap < 1 || lap > this.totalLaps || !segs[j].gate) continue;
      const s = segs[j];
      const w = s.gate.timingWindow;
      const center = s.tStart + (s.tEnd - s.tStart) * (w.start + w.end) / 2;
      out.push({ seg: s, type: s.gate.type, key: `${lap}:${s.tStart}`, dT: (lap - 1 + center) - (this.currentLap - 1 + this.t) });
    }
    return out;
  }

  /** 가장 가까운 미판정 게이트의 시간 정보 — HUD 가이드와 판정이 같은 값을 쓰도록 단일 소스.
   * timeTo: 현재 속도로 중심 지점까지 남은 시간(초), err: 지금 탭하면 판정될 오차(초, 음수=이름/양수=늦음, 터치 지연 보정 포함) */
  gateTiming() {
    const tPerSec = Math.max(0.1, this.speed * Cart.speedScale) / this.track.lengthM; // cart.t 진행 속도와 동일 모델
    let best = null;
    for (const c of this._gateCandidates()) {
      if (this._resolvedGates.has(c.key)) continue;
      const timeTo = c.dT / tPerSec;
      const err = -timeTo - INPUT_LATENCY_OFFSET;
      if (!best || Math.abs(err) < Math.abs(best.err)) best = { ...c, timeTo, err };
    }
    if (best) Object.assign(best, this.track.stageData.gateTiming);
    return best;
  }

  /** input.js에서 게이트 탭 시 호출 — 실제 시간(초) 기준 판정. 판정 대상 게이트 종류는 lastGateType에 남김 */
  resolveGate(snapshot) {
    this.lastGateType = null;
    // snapshot: 패드 "톡"은 떼는 순간에야 탭으로 확정되므로, 손가락이 닿은 순간 계산해 둔 타이밍으로 판정
    const g = snapshot && !this._resolvedGates.has(snapshot.key) ? snapshot : this.gateTiming();
    if (!g || Math.abs(g.err) > GATE_ATTEMPT_RANGE) return 'none';
    this._resolvedGates.add(g.key); // 게이트당(랩별) 판정 1회
    const e = Math.abs(g.err);
    const result = e <= g.perfect ? 'perfect' : e <= g.good ? 'good' : 'miss';
    this.lastGateType = g.type;
    this._applyGateResult(g.type, result);
    this._gateResults.push({ type: g.type, result, t: this.t, err: g.err });
    return result;
  }

  _applyGateResult(gateType, result) {
    if (gateType === 'boost' && BOOST[result]) {
      // 더 센 부스트가 이미 걸려 있으면 약한 판정으로 덮어쓰지 않음
      const b = BOOST[result];
      const accel = b.accel * this.baseSpeedMs;
      if (accel >= this.boostAccel || this.boostRemaining <= 0) { this.boostAccel = accel; this.boostRemaining = b.distance; }
    }

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

Cart.speedScale = GAME_SPEED_SCALE; // 밸런싱 시뮬레이션(score-sim --scale)에서 바꿔 보기 위한 정적 값
window.Cart = Cart;
