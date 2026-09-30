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

// Kenney Nature Kit(CC0) — 트랙 주변 원경 소품. scale은 키트 원본(나무 약 1.5~1.9) 대비 배율 범위, weight는 등장 비율
const NATURE_DIR = 'assets/vendor/kenney-nature-kit/';
const NATURE_PROPS = [
  { file: 'tree_pineTallA.glb',  scale: [5, 7.5], weight: 3 },
  { file: 'tree_pineTallB.glb',  scale: [5, 7.5], weight: 3 },
  { file: 'tree_pineTallC.glb',  scale: [5, 7.5], weight: 2 },
  { file: 'tree_pineRoundA.glb', scale: [5, 7],   weight: 2 },
  { file: 'rock_largeA.glb',     scale: [4, 8],   weight: 1 },
  { file: 'rock_largeB.glb',     scale: [4, 8],   weight: 1 },
  { file: 'rock_smallA.glb',     scale: [4, 7],   weight: 1 },
  { file: 'grass_large.glb',     scale: [6, 9],   weight: 3 },
  { file: 'plant_bushSmall.glb', scale: [7, 10],  weight: 2 },
];
// 트랙(레일·지지대) 수평거리 이만큼 안쪽은 비움 — 나무 반경(~3m)+인버티드 지지대 옆 오프셋(2.2m)+여유
const NATURE_TRACK_CLEARANCE_M = 14;
// 스테이션 옆 지면 광장 — Coaster Kit 놀이공원 소품. [파일, 진행방향(m), 옆방향(m), 바라볼 방향('track'|'away')]
const PARK_SCALE = 2.5;
const PARK_LAYOUT = [
  ['park-entrance.glb',     0,  30, 'track'],
  ['stall-food.glb',       -9,  20, 'track'],
  ['stall-drinks.glb',     -4,  21, 'track'],
  ['stall-information.glb', 4,  21, 'track'],
  ['stall-toilets.glb',     9,  20, 'track'],
  ['bench.glb',            -7,  13, 'away'],
  ['bench.glb',             7,  13, 'away'],
  ['trash.glb',             0,  13, 'track'],
  ['ride-entrance.glb',    -3,   9, 'track'],
  ['ride-exit.glb',         3,   9, 'track'],
];

/** 스테이지마다 같은 배치가 나오도록 시드 고정 PRNG(mulberry32) — Math.random()이면 재도전마다 숲 모양이 바뀜 */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
    // 실제 커브 길이(m, 폐곡선 이음매 포함) — cart.js 진행률 계산 기준
    this.lengthM = this.points.reduce((acc, p, i) => acc + BABYLON.Vector3.Distance(p, this.points[(i + 1) % this.points.length]), 0);

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

    // 재질: 스틸 계열 레일/지지대는 금속, 목재 트랙은 원래 무광 유지 (Kenney 기본값은 전부 비금속·거친 면)
    const isWood = this.stageData.railType === 'wood';
    this._tuneMaterial(railTemplate, isWood ? { metallic: 0.1, roughness: 0.7 } : { metallic: 0.8, roughness: 0.3 });
    this._tuneMaterial(pillarTemplate, isWood ? { metallic: 0, roughness: 0.85 } : { metallic: 0.6, roughness: 0.45 });

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
    this._sampleLoop(PILLAR_SPACING_M).forEach(({ pos, tangent, s: arc }, k) => {
      if (pos.y < 0.5) return; // 지면 높이 근처는 지지대 불필요
      const side = new BABYLON.Vector3(-tangent.z, 0, tangent.x).normalize();
      const base = isHanging ? pos.add(side.scale(HANGING_SIDE_OFFSET)) : pos;
      if (this._pillarHitsLowerTrack(base, pos.y, arc)) return;
      // 일반 트랙은 레일 밑면보다 0.3m 낮게 — 경사 구간에서 기울어진 레일 타일 사이로 기둥 머리가 비죽 솟아 보이던 것 방지
      const topY = isHanging ? pos.y + railTopY : pos.y - 0.3;
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

    // 스테이션: 1.5m 플랫폼 타일을 출발점(t=0) "뒤쪽"(트랙 끝 = 스테이션 진입부)에만 이어 붙임 — 실제 열차처럼
    // 플랫폼 앞끝에서 출발(타일은 뱅킹 없이 피치만 따라감). 출발점 앞쪽은 4·5단계에서 곧바로 낙하 경사라, 앞뒤로 깔면 경사면에 계단식으로 박혔음
    const stationSpacing = this._extent(stationTemplate).z * KIT_SCALE;
    const STATION_LEN = 9;
    this._sampleLoop(stationSpacing)
      .filter(({ s, L }) => s === 0 || s >= L - STATION_LEN)
      .forEach(({ pos, tangent }, k) => {
        const inst = stationTemplate.createInstance(k === 0 ? 'station' : `station_${k}`);
        inst.scaling.setAll(KIT_SCALE);
        // 인버티드는 카트가 레일 아래 약 1.1m까지 매달리므로 플랫폼도 카트 바닥 높이로 내림(레일 옆에 있으면 허공 승강장)
        inst.position.copyFrom(isHanging ? pos.add(new BABYLON.Vector3(0, -1.6, 0)) : pos);
        inst.lookAt(inst.position.add(tangent)); // 트랙 경사를 그대로 따름 — 수평 고정이면 드롭 직전 크레스트(4·5단계)에서 계단처럼 어긋남
        this._meshes.push(inst);
      });

    await Promise.all([this._placeNatureProps(), this._placeParkProps()]);
  }

  /** PBR 재질의 금속성/거칠기 조정 — 템플릿의 재질을 바꾸면 인스턴스 전체에 반영 */
  _tuneMaterial(mesh, { metallic, roughness }) {
    const mats = mesh.material instanceof BABYLON.MultiMaterial ? mesh.material.subMaterials : [mesh.material];
    mats.forEach(mat => {
      if (!mat || !('metallic' in mat)) return;
      mat.metallic = metallic;
      mat.roughness = roughness;
    });
  }

  /** high 프리셋 그림자 캐스터 — 레일/지지대/스테이션/소품 인스턴스(풀·덤불은 그림자 효과 대비 비용이 커서 제외) */
  shadowCasters() {
    return this._meshes.filter(m => m instanceof BABYLON.InstancedMesh && !/^(grass|plant)/.test(m.name));
  }

  /** 지지대(base 수직선, 0~topY)가 아래쪽을 지나는 다른 트랙 구간을 관통하는지 — 교차 구간 위쪽 레일의
   * 지지대가 아래 레일을 뚫고 내려가는 것 방지(실제 코스터도 교차부는 옆으로 비켜 받침) */
  _pillarHitsLowerTrack(base, topY, arc) {
    if (!this._pillarProbe) this._pillarProbe = this._sampleLoop(1);
    const L = this._pillarProbe[0].L;
    return this._pillarProbe.some(p => {
      const d = Math.abs(p.s - arc);
      if (Math.min(d, L - d) < 12) return false; // 자기 자신 주변 구간 제외
      return p.pos.y < topY - 1 && Math.hypot(p.pos.x - base.x, p.pos.z - base.z) < 1.5;
    });
  }

  /** 트랙 수평거리 판정용 샘플 — 3m 간격이면 1680m 트랙도 560점 남짓이라 전수 비교해도 충분히 가벼움 */
  _minTrackDistXZ(x, z) {
    if (!this._xzSamples) this._xzSamples = this._sampleLoop(3).map(p => [p.pos.x, p.pos.z]);
    let best = Infinity;
    for (const [px, pz] of this._xzSamples) {
      const d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /** Kenney Nature Kit 나무/바위/풀을 트랙 바깥쪽에 흩뿌림 — 트랙 가까이(NATURE_TRACK_CLEARANCE_M)는 비우고
   * 멀수록 밀도가 옅어지게. 개수는 그래픽 프리셋 backgroundPropCount, 배치는 스테이지 id 시드로 고정 */
  async _placeNatureProps() {
    const count = QualityManager.settings.backgroundPropCount;
    if (count <= 0) return;
    const templates = await Promise.all(NATURE_PROPS.map(p => this._loadTemplate(p.file, NATURE_DIR)));
    // 키트 원본 잎 색(leafsDark)은 청록색 스타일(풀 재질 grass도 동일) — 잔디 바닥 초록과 어울리지 않아 숲 초록으로 교체(선형 색공간 값)
    templates.forEach(t => (t.material.subMaterials || [t.material]).forEach(m => {
      if (!m) return;
      if (/^leafs/.test(m.name)) m.albedoColor = new BABYLON.Color3(0.07, 0.26, 0.08);
      else if (/^grass/.test(m.name)) m.albedoColor = new BABYLON.Color3(0.12, 0.36, 0.07);
    }));
    const totalWeight = NATURE_PROPS.reduce((a, p) => a + p.weight, 0);
    const rand = seededRandom(this.stageData.id * 7919);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const MARGIN = 140;
    const station = this.getPositionAt(0);

    let placed = 0;
    for (let attempt = 0; attempt < count * 12 && placed < count; attempt++) {
      const x = minX - MARGIN + rand() * (maxX - minX + MARGIN * 2);
      const z = minZ - MARGIN + rand() * (maxZ - minZ + MARGIN * 2);
      const d = this._minTrackDistXZ(x, z);
      if (d < NATURE_TRACK_CLEARANCE_M) continue;
      if (rand() > Math.min(1, 40 / d)) continue; // 트랙에서 멀어질수록 드문드문
      if (Math.hypot(x - station.x, z - station.z) < 40) continue; // 스테이션 옆 놀이공원 광장 자리

      let pick = rand() * totalWeight, k = 0;
      while (pick > NATURE_PROPS[k].weight) pick -= NATURE_PROPS[k++].weight;
      const [s0, s1] = NATURE_PROPS[k].scale;
      const inst = templates[k].createInstance(`${NATURE_PROPS[k].file.split('.')[0]}_${placed}`);
      inst.position.set(x, 0, z);
      inst.rotation.y = rand() * Math.PI * 2;
      inst.scaling.setAll(s0 + rand() * (s1 - s0));
      this._meshes.push(inst);
      placed++;
    }

    // 스쳐 지나가는 나무(속도감): 트랙을 따라 일정 간격으로 좌우 번갈아 6.5~9m 옆에 — 원경 산포(14m 밖)와 별도.
    // 카트/카메라(3인칭 후방 카메라는 곡선 안쪽으로 최대 약 2m 치우침)·지지대(인버티드 옆 2.2m)와 겹치지 않게 수평 6m 여유
    const near = QualityManager.settings.nearPropCount || 0;
    const trees = templates.map((t, k) => ({ t, k })).filter(({ k }) => /^tree/.test(NATURE_PROPS[k].file));
    const samples = this._sampleLoop(Math.max(8, this.lengthM / Math.max(1, near)));
    samples.forEach(({ pos, tangent }, i) => {
      if (i === 0 || Math.hypot(pos.x - station.x, pos.z - station.z) < 40) return;
      const side = new BABYLON.Vector3(-tangent.z, 0, tangent.x).normalize().scale((i % 2 ? 1 : -1) * (6.5 + rand() * 2.5));
      const x = pos.x + side.x, z = pos.z + side.z;
      if (this._minTrackDistXZ(x, z) < 6) return;
      const { t, k } = trees[Math.floor(rand() * trees.length)];
      const inst = t.createInstance(`nearTree_${i}`);
      inst.position.set(x, 0, z);
      inst.rotation.y = rand() * Math.PI * 2;
      inst.scaling.setAll(3.5 + rand() * 2); // 원경보다 작게(약 6~10m) — 트랙 높이와 비슷해 옆으로 휙휙 지나가 보임
      this._meshes.push(inst);
    });
  }

  /** 스테이션(t=0) 옆 지면에 놀이공원 소품 광장 — 트랙이 위로 지나가는 쪽을 피해 좌/우 중 빈 쪽을 고르고,
   * 개별 소품도 다른 트랙 구간 지지대와 겹치면(수평 4m 이내) 생략 */
  async _placeParkProps() {
    const files = [...new Set(PARK_LAYOUT.map(l => l[0]))];
    const templates = Object.fromEntries(await Promise.all(files.map(async f => [f, await this._loadTemplate(f)])));

    const origin = this.getPositionAt(0);
    const t0 = this.getTangentAt(0);
    const fwd = new BABYLON.Vector3(t0.x, 0, t0.z).normalize();
    const right = new BABYLON.Vector3(fwd.z, 0, -fwd.x);
    const freeScore = sign => PARK_LAYOUT.reduce((n, [, a, l]) =>
      n + (this._minTrackDistXZ(origin.x + fwd.x * a + right.x * l * sign, origin.z + fwd.z * a + right.z * l * sign) > 4 ? 1 : 0), 0);
    const side = freeScore(1) >= freeScore(-1) ? 1 : -1;

    PARK_LAYOUT.forEach(([file, along, lateral, facing], k) => {
      const x = origin.x + fwd.x * along + right.x * lateral * side;
      const z = origin.z + fwd.z * along + right.z * lateral * side;
      if (this._minTrackDistXZ(x, z) < 4) return;
      const inst = templates[file].createInstance(`park_${k}`);
      inst.position.set(x, 0, z);
      inst.scaling.setAll(PARK_SCALE);
      // Kenney 소품 정면은 -Z — lookAt은 +Z를 목표로 돌리므로 정면이 향할 반대 방향을 목표로 준다
      const toTrack = right.scale(-side);
      const front = facing === 'track' ? toTrack : toTrack.negate();
      inst.lookAt(inst.position.subtract(front));
      this._meshes.push(inst);
    });
  }

  /** 템플릿 메시의 로컬 바운딩박스 크기(x=폭, y=높이, z=진행방향 길이) — KIT_SCALE 적용 전 원본 값 */
  _extent(mesh) {
    const bb = mesh.getBoundingInfo().boundingBox;
    return bb.maximum.subtract(bb.minimum);
  }

  /** glTF 로드 → 실제 지오메트리 메시를 템플릿으로 반환, 템플릿 자체는 비활성화.
   * Nature Kit처럼 재질별로 프리미티브가 나뉜 모델은 멀티머티리얼 단일 메시로 병합해 인스턴싱 가능하게 함 */
  async _loadTemplate(fileName, dir = KIT_DIR) {
    const result = await BABYLON.SceneLoader.ImportMeshAsync('', dir, fileName, this.scene);
    result.meshes.forEach(m => this._meshes.push(m));
    const geo = result.meshes.filter(m => m.getTotalVertices() > 0);
    let mesh = geo[0];
    // __root__(glTF 좌표계 변환용 미러링)에서 떼어냄 — 인스턴스는 부모 변환을 안 따르므로 화면은 그대로인데,
    // 템플릿만 미러링(행렬식 음수)이면 Babylon이 부호가 다른 인스턴스를 배칭하지 않고 한 개씩 그려
    // 드로우콜이 인스턴스 수만큼 늘어남(실측: 2스테이지 low 389콜). main.js 카트와 같은 방식
    geo.forEach(m => { m.parent = null; });
    if (geo.length > 1) {
      mesh = BABYLON.Mesh.MergeMeshes(geo, false, true, undefined, false, true);
      mesh.name = fileName;
      this._meshes.push(mesh);
      geo.forEach(m => m.setEnabled(false));
    }
    mesh.setEnabled(false); // 인스턴스만 렌더, 템플릿 자체는 숨김
    // Kenney glb는 metallicFactor를 생략 → glTF 기본값 1(완전 금속)로 읽혀 하늘빛만 반사해 파랗게 보임.
    // 기본은 비금속 무광으로 두고, 금속이어야 하는 레일/지지대만 loadTrackMeshes에서 다시 지정
    this._tuneMaterial(mesh, { metallic: 0, roughness: 0.85 });
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
