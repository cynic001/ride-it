/**
 * track.js
 * 스테이지의 제어점(controlPoints) → 연속 커브 생성
 * 세그먼트(밸런스/게이트) 데이터를 커브 진행률(t: 0~1)에 매핑
 * + 레일/지지대/스테이션 glTF를 커브를 따라 인스턴싱 배치 (loadTrackMeshes)
 */

const RAIL_FILES = {
  standard: 'rail_standard.glb',
  single: 'rail_single.glb',
  hybrid: 'rail_hybrid.glb',
};

// 지지대 배치 간격(m) — 레일 타이 간격과 무관하게 저사양 기기(SE2) 성능을 고려해 성긴 간격 사용
const PILLAR_SPACING_M = 8;

// 커브 구간(segment.requiredLean>0) 레일 뱅킹 최대 각도 — requiredLean(0~1)에 비례해 적용
const MAX_BANK_RAD = 28 * Math.PI / 180;

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
    // 모든 스테이지가 폐곡선(출발=도착)이므로 closed:true로 이음매 없이 순환하는 커브 생성
    this.curve = BABYLON.Curve3.CreateCatmullRomSpline(vecPoints, nbInterpolated, true);
    this.points = this.curve.getPoints(); // 실제 카트가 따라갈 점들의 배열

    // 각 세그먼트가 전체 트랙에서 차지하는 t범위를 균등 분할
    // (실제로는 제어점 위치 기반으로 비균등 분할하는 게 더 정확하지만, 초기 골격은 균등 분할로 시작)
    const segCount = stageData.segments.length;
    this.segmentRanges = stageData.segments.map((seg, i) => ({
      ...seg,
      tStart: i / segCount,
      tEnd: (i + 1) / segCount,
    }));

    this._meshes = []; // 로드된 템플릿+인스턴스 전체 — dispose()에서 일괄 정리
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

  /** 세그먼트 자체의 뱅킹(롤) 각도(rad) — 전환 보간 없이 그 세그먼트가 원하는 목표값만 */
  _targetRollFor(seg) {
    if (seg.requiredLean <= 0) return 0;
    const bank = MAX_BANK_RAD * seg.requiredLean;
    return seg.curveDirection === 'left' ? -bank : bank;
  }

  /** 진행률 t에서의 뱅킹(롤) 각도(rad) — 레일 인스턴싱과 카트 메시가 항상 같은 값을 쓰도록
   * 단일 소스로 공유(따로 계산하면 둘이 어긋나 카트가 레일에서 떠 보이는 버그가 생김).
   * 세그먼트 앞뒤 BANK_TRANSITION 비율 구간은 인접 세그먼트 값과 선형 보간 — 세그먼트마다
   * requiredLean/curveDirection이 달라 경계에서 롤이 최대 40도 이상 순간적으로 꺾이던 것을
   * (실측: stage5에서 최대 41.2도 불연속 확인) 실제 코스터의 전환 곡선처럼 완만하게 이어지도록 함 */
  getBankRollAt(t) {
    const segs = this.segmentRanges;
    let i = segs.findIndex(s => t >= s.tStart && t < s.tEnd);
    if (i === -1) i = segs.length - 1;
    const seg = segs[i];
    const local = (t - seg.tStart) / (seg.tEnd - seg.tStart); // 세그먼트 내 진행률(0~1)
    const myRoll = this._targetRollFor(seg);

    const BANK_TRANSITION = 0.25; // 세그먼트 앞/뒤 각 25% 구간에서 인접 세그먼트 값으로 보간
    if (local < BANK_TRANSITION) {
      const prevRoll = this._targetRollFor(segs[(i - 1 + segs.length) % segs.length]);
      const w = 0.5 + (local / BANK_TRANSITION) * 0.5; // 경계(0.5:0.5) -> 세그먼트 값(1.0)으로 수렴
      return prevRoll * (1 - w) + myRoll * w;
    }
    if (local > 1 - BANK_TRANSITION) {
      const nextRoll = this._targetRollFor(segs[(i + 1) % segs.length]);
      const w = 0.5 + ((1 - local) / BANK_TRANSITION) * 0.5;
      return nextRoll * (1 - w) + myRoll * w;
    }
    return myRoll;
  }

  /** 레일/지지대/스테이션 glTF 로드 후 커브를 따라 인스턴싱 배치 */
  async loadTrackMeshes() {
    const railFile = RAIL_FILES[this.stageData.railType] || RAIL_FILES.standard;
    const pillarFile = this.stageData.railType === 'hybrid' ? 'pillar_wood.glb' : 'pillar_steel.glb';

    const [railTemplate, pillarTemplate, stationTemplate] = await Promise.all([
      this._loadTemplate(railFile),
      this._loadTemplate(pillarFile),
      this._loadTemplate('station_platform.glb'),
    ]);

    this._instanceAlongCurve(railTemplate, this._railExtentZ(railTemplate), (inst, pos, tangent, t) => {
      inst.position.copyFrom(pos);
      inst.lookAt(pos.add(tangent), 0, 0, this.getBankRollAt(t));
    });

    const pillarHeight = pillarTemplate.getBoundingInfo().boundingBox.maximum.y - pillarTemplate.getBoundingInfo().boundingBox.minimum.y;
    const pillarBottomY = pillarTemplate.getBoundingInfo().boundingBox.minimum.y;
    this._instanceAlongCurve(pillarTemplate, PILLAR_SPACING_M, (inst, pos) => {
      if (pos.y < 0.5) return; // 지면 높이 근처는 지지대 불필요
      const scale = pos.y / pillarHeight;
      inst.scaling.y = scale;
      inst.position.set(pos.x, -pillarBottomY * scale, pos.z);
    });

    const stationPos = this.getPositionAt(0);
    const stationTangent = this.getTangentAt(0);
    const station = stationTemplate.createInstance('station');
    station.position.copyFrom(stationPos);
    station.lookAt(stationPos.add(stationTangent));
    this._meshes.push(station);
  }

  /** 레일 인스턴스 1개가 커버하는 진행방향(Z) 길이 — 타일 간격으로 사용 */
  _railExtentZ(railTemplate) {
    const bb = railTemplate.getBoundingInfo().boundingBox;
    return bb.maximum.z - bb.minimum.z;
  }

  /** glTF 로드 → 실제 지오메트리 메시(루트 다음 자식)를 템플릿으로 반환, 템플릿 자체는 비활성화 */
  async _loadTemplate(fileName) {
    const result = await BABYLON.SceneLoader.ImportMeshAsync('', 'assets/models/', fileName, this.scene);
    result.meshes.forEach(m => this._meshes.push(m));
    const mesh = result.meshes[1]; // meshes[0]은 빈 __root__ 트랜스폼 노드
    mesh.setEnabled(false); // 인스턴스만 렌더, 템플릿 자체는 숨김
    return mesh;
  }

  /** 커브를 따라 실측 호 길이(spacing)마다 template.createInstance()를 배치 (폐곡선이므로 마지막→첫 점 이음매도 포함) */
  _instanceAlongCurve(template, spacing, placeFn) {
    const pts = [...this.points, this.points[0]]; // 마지막 점 → 첫 점으로 돌아오는 구간까지 순회
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      acc += BABYLON.Vector3.Distance(prev, curr);
      if (acc >= spacing) {
        const tangent = curr.subtract(prev).normalize();
        const inst = template.createInstance(`${template.name}_${i}`);
        const t = Math.min(1, i / (this.points.length - 1));
        placeFn(inst, curr, tangent, t);
        this._meshes.push(inst);
        acc = 0;
      }
    }
  }

  /** 스테이지 재로드 시 이전 트랙의 레일/지지대/스테이션 리소스 정리 */
  dispose() {
    this._meshes.forEach(m => m.dispose());
    this._meshes = [];
  }
}

window.Track = Track;
