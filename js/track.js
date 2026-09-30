/**
 * track.js
 * 스테이지의 제어점(controlPoints) → 연속 커브 생성
 * 세그먼트(밸런스/게이트) 데이터를 커브 진행률(t: 0~1)에 매핑
 * + 레일/지지대/스테이션 glTF를 커브를 따라 인스턴싱 배치 (loadTrackMeshes)
 */

// Kenney Coaster Kit(CC0) — 트랙 패밀리별 1m 반복 레일 타일 / 카트 / 지지대
const KIT_DIR = 'assets/vendor/kenney-coaster-kit/';
// 키트 원본은 레거시 자체 모델의 약 0.7배 크기(레일 폭 0.7m) — 기존 트랙 스케일(제어점 좌표·카메라 거리)에 맞추려 일괄 확대
const KIT_SCALE = 1.5;
const KIT_FAMILIES = {
  mouse:    { rail: 'coaster-mouse-track.glb',    cart: 'coaster-train.glb',         pillar: 'support-small.glb' },
  hanging:  { rail: 'coaster-hanging-track.glb',  cart: 'coaster-train-hanging.glb', pillar: 'support-small.glb' },
  monorail: { rail: 'coaster-monorail-track.glb', cart: 'train-monorail.glb',        pillar: 'support-small.glb' },
  steel:    { rail: 'coaster-steel-track.glb',    cart: 'coaster-train.glb',         pillar: 'support-large.glb' },
  wood:     { rail: 'coaster-wood-track.glb',     cart: 'coaster-train-wooden.glb',  pillar: 'support-large.glb' },
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

  get family() {
    return KIT_FAMILIES[this.stageData.railType] || KIT_FAMILIES.steel;
  }

  /** 레일/지지대/스테이션 glTF 로드 후 커브를 따라 인스턴싱 배치 */
  async loadTrackMeshes() {
    const fam = this.family;
    const isHanging = this.stageData.railType === 'hanging';

    const [railTemplate, pillarTemplate, stationTemplate, armTemplate] = await Promise.all([
      this._loadTemplate(fam.rail),
      this._loadTemplate(fam.pillar),
      this._loadTemplate('station.glb'),
      isHanging ? this._loadTemplate('support-small-horizontal.glb') : null,
    ]);

    const railSpacing = this._extent(railTemplate).z * KIT_SCALE;
    this._sampleLoop(railSpacing).forEach(({ pos, tangent, t }, k) => {
      const inst = railTemplate.createInstance(`rail_${k}`);
      inst.scaling.setAll(KIT_SCALE);
      inst.position.copyFrom(pos);
      inst.lookAt(pos.add(tangent), 0, 0, this.getBankRollAt(t));
      this._meshes.push(inst);
    });

    // 지지대: 바닥(y=0)에서 레일 밑면까지. 인버티드(hanging)는 카트가 레일 아래에 매달려 지나가므로
    // 기둥을 트랙 옆으로 비켜 세우고 위에서 가로 암으로 레일 상단을 붙잡는 형태(실제 인버티드 코스터 구조)
    const pillarBB = this._extent(pillarTemplate);
    const railTopY = this._extent(railTemplate).y * KIT_SCALE;
    const HANGING_SIDE_OFFSET = 2.2;
    this._sampleLoop(PILLAR_SPACING_M).forEach(({ pos, tangent }, k) => {
      if (pos.y < 0.5) return; // 지면 높이 근처는 지지대 불필요
      const side = new BABYLON.Vector3(-tangent.z, 0, tangent.x).normalize();
      const base = isHanging ? pos.add(side.scale(HANGING_SIDE_OFFSET)) : pos;
      const topY = isHanging ? pos.y + railTopY : pos.y;
      const inst = pillarTemplate.createInstance(`pillar_${k}`);
      inst.scaling.set(KIT_SCALE, topY / pillarBB.y, KIT_SCALE);
      inst.position.set(base.x, 0, base.z);
      this._meshes.push(inst);

      if (isHanging) {
        const arm = armTemplate.createInstance(`pillarArm_${k}`);
        const mid = pos.add(side.scale(HANGING_SIDE_OFFSET / 2));
        arm.position.set(mid.x, topY, mid.z);
        arm.lookAt(new BABYLON.Vector3(base.x, topY, base.z)); // 암의 긴 축(Z)이 기둥↔레일을 잇도록
        arm.scaling.set(KIT_SCALE, KIT_SCALE, HANGING_SIDE_OFFSET / this._extent(armTemplate).z);
        this._meshes.push(arm);
      }
    });

    // 스테이션: 1.5m 플랫폼 타일을 출발점(t=0) 앞뒤로 이어 붙임 — 뱅킹 없이 수평 유지
    const stationSpacing = this._extent(stationTemplate).z * KIT_SCALE;
    const STATION_HALF_LEN = 4.5;
    this._sampleLoop(stationSpacing)
      .filter(({ s, L }) => s <= STATION_HALF_LEN || s >= L - STATION_HALF_LEN)
      .forEach(({ pos, tangent }, k) => {
        const inst = stationTemplate.createInstance(k === 0 ? 'station' : `station_${k}`);
        inst.scaling.setAll(KIT_SCALE);
        inst.position.copyFrom(pos);
        inst.lookAt(pos.add(new BABYLON.Vector3(tangent.x, 0, tangent.z)));
        this._meshes.push(inst);
      });

    this._placeBackgroundProps();
  }

  /** 저비용 배경 나무 실루엣(원기둥 몸통+원뿔 수관 조합, 별도 모델링 없이 절차적 생성)을
   * 트랙 주변 지면 근처에 인스턴싱 배치 — 그래픽 프리셋의 backgroundPropCount로 개수 차등
   * (low는 0개로 생략). Track.dispose()가 관리하도록 this._meshes에 편입. */
  _placeBackgroundProps() {
    const count = QualityManager.settings.backgroundPropCount;
    if (count <= 0) return;

    const trunk = BABYLON.MeshBuilder.CreateCylinder('propTrunk', { height: 4, diameterTop: 0.6, diameterBottom: 0.9 }, this.scene);
    trunk.position.y = 2;
    const canopy = BABYLON.MeshBuilder.CreateCylinder('propCanopy', { height: 5, diameterTop: 0, diameterBottom: 4, tessellation: 6 }, this.scene);
    canopy.position.y = 6;
    const treeTemplate = BABYLON.Mesh.MergeMeshes([trunk, canopy], true);
    treeTemplate.name = 'BackgroundTree';
    const mat = new BABYLON.StandardMaterial('propMat', this.scene);
    mat.diffuseColor = new BABYLON.Color3(0.25, 0.42, 0.22);
    mat.specularColor = BABYLON.Color3.Black();
    treeTemplate.material = mat;
    treeTemplate.setEnabled(false);
    this._meshes.push(treeTemplate);

    const pts = this.points;
    const step = Math.max(1, Math.floor(pts.length / count));
    let placed = 0;
    for (let i = 0; i < pts.length && placed < count; i += step) {
      const p = pts[i];
      const tangent = this.getTangentAt(i / (pts.length - 1));
      const side = placed % 2 === 0 ? 1 : -1;
      const perp = new BABYLON.Vector3(-tangent.z, 0, tangent.x).normalize().scale(18 * side);
      const inst = treeTemplate.createInstance(`tree_${i}`);
      inst.position.set(p.x + perp.x, 0, p.z + perp.z);
      const scale = 0.8 + Math.random() * 0.6;
      inst.scaling.set(scale, scale, scale);
      this._meshes.push(inst);
      placed++;
    }
  }

  /** 템플릿 메시의 로컬 바운딩박스 크기(x=폭, y=높이, z=진행방향 길이) — KIT_SCALE 적용 전 원본 값 */
  _extent(mesh) {
    const bb = mesh.getBoundingInfo().boundingBox;
    return bb.maximum.subtract(bb.minimum);
  }

  /** glTF 로드 → 실제 지오메트리 메시(루트 다음 자식)를 템플릿으로 반환, 템플릿 자체는 비활성화 */
  async _loadTemplate(fileName) {
    const result = await BABYLON.SceneLoader.ImportMeshAsync('', KIT_DIR, fileName, this.scene);
    result.meshes.forEach(m => this._meshes.push(m));
    const mesh = result.meshes[1]; // meshes[0]은 빈 __root__ 트랜스폼 노드
    mesh.setEnabled(false); // 인스턴스만 렌더, 템플릿 자체는 숨김
    return mesh;
  }

  /** 폐곡선을 실측 호 길이 spacing(m)마다 샘플링 — 마지막 점→첫 점 이음매 구간까지 포함.
   * 반환: [{ pos, tangent, t, s(누적 호 길이), L(전체 길이) }] — 첫 샘플은 출발점(s=0) */
  _sampleLoop(spacing) {
    const pts = [...this.points, this.points[0]];
    const samples = [];
    let s = 0;
    let next = 0;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const segLen = BABYLON.Vector3.Distance(prev, pts[i]);
      if (segLen === 0) continue;
      const tangent = pts[i].subtract(prev).scale(1 / segLen);
      // 한 점 간격 안에 여러 타일이 들어갈 수 있으므로 점 사이를 선형 보간해 정확히 spacing마다 배치
      while (next < s + segLen) {
        const f = (next - s) / segLen;
        samples.push({
          pos: BABYLON.Vector3.Lerp(prev, pts[i], f),
          tangent,
          t: Math.min(1, (i - 1 + f) / (this.points.length - 1)),
          s: next,
        });
        next += spacing;
      }
      s += segLen;
    }
    samples.forEach(p => { p.L = s; });
    return samples;
  }

  /** 스테이지 재로드 시 이전 트랙의 레일/지지대/스테이션 리소스 정리 */
  dispose() {
    this._meshes.forEach(m => m.dispose());
    this._meshes = [];
  }
}

window.Track = Track;
