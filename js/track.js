/**
 * track.js
 * 스테이지의 제어점(controlPoints) → 연속 커브 생성
 * 세그먼트(밸런스/게이트) 데이터를 커브 진행률(t: 0~1)에 매핑
 */

class Track {
  /**
   * @param {object} stageData - STAGES 배열의 항목 하나
   * @param {BABYLON.Scene} scene
   */
  constructor(stageData, scene) {
    this.stageData = stageData;
    this.scene = scene;

    const vecPoints = stageData.controlPoints.map(
      p => new BABYLON.Vector3(p.x, p.y, p.z)
    );

    // 제어점 수에 비례해 보간 포인트 개수 결정 (촘촘할수록 부드러움, 너무 많으면 메모리 낭비)
    const nbInterpolated = Math.max(200, vecPoints.length * 40);
    this.curve = BABYLON.Curve3.CreateCatmullRomSpline(vecPoints, nbInterpolated, false);
    this.points = this.curve.getPoints(); // 실제 카트가 따라갈 점들의 배열

    // 각 세그먼트가 전체 트랙에서 차지하는 t범위를 균등 분할
    // (실제로는 제어점 위치 기반으로 비균등 분할하는 게 더 정확하지만, 초기 골격은 균등 분할로 시작)
    const segCount = stageData.segments.length;
    this.segmentRanges = stageData.segments.map((seg, i) => ({
      ...seg,
      tStart: i / segCount,
      tEnd: (i + 1) / segCount,
    }));
  }

  /** 진행률 t(0~1)에 해당하는 월드 좌표 반환 */
  getPositionAt(t) {
    const idx = Math.min(
      this.points.length - 1,
      Math.max(0, Math.floor(t * (this.points.length - 1)))
    );
    return this.points[idx];
  }

  /** 진행률 t에서의 진행 방향(tangent) 반환 — 카메라/카트 정렬에 사용 */
  getTangentAt(t) {
    const idx = Math.min(this.points.length - 2, Math.max(0, Math.floor(t * (this.points.length - 1))));
    const p0 = this.points[idx];
    const p1 = this.points[idx + 1];
    return p1.subtract(p0).normalize();
  }

  /** 진행률 t가 속한 세그먼트(밸런스/게이트 데이터) 반환 */
  getSegmentAt(t) {
    return this.segmentRanges.find(s => t >= s.tStart && t < s.tEnd) || this.segmentRanges[this.segmentRanges.length - 1];
  }

  /** 두 지점 간 높이 차 — 에너지 보존 물리 계산용 */
  getHeightAt(t) {
    return this.getPositionAt(t).y;
  }
}

window.Track = Track;
