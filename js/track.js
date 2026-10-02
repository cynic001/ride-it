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
// 물 착수 연못 크기(m) — 트랙 방향 length × 옆 width, 수면 높이 level
const POND = { length: 80, width: 56, level: 0.3 };
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
    // 뒤로 떨어지기 구간: 폐곡선 CatmullRom은 controlPoints[1]에서 시작하고 제어점 구간마다 진행률이 균등하므로
    // 제어점 k의 t = (k-1)/n. 골짜기 = cp-1, 꼭대기 = cp
    const rb = stageData.rollback;
    if (rb) {
      const n = stageData.controlPoints.length;
      const tOf = k => (((k - 1) / n) % 1 + 1) % 1;
      this.rollbackZone = { mode: rb.mode, tValley: tOf(rb.cp - 1), tPeak: tOf(rb.cp) };
    }
    // 물 착수 지점: splash.cp 제어점 근처(±0.05)에서 실제 곡선이 가장 낮은 곳(곡선 처짐까지 반영)
    if (stageData.splash) {
      const n = stageData.controlPoints.length;
      const tc = (((stageData.splash.cp - 1) / n) % 1 + 1) % 1;
      let best = null;
      this.points.forEach((q, i) => {
        const t = i / (this.points.length - 1);
        if (Math.abs(t - tc) < 0.05 && (!best || q.y < best.pos.y)) best = { t, pos: q };
      });
      this.splash = { t: best.t, pos: best.pos, level: stageData.splash.level, tangent: this.getTangentAt(best.t) };
    }
    this.bigDrops = this._findBigDrops();
    this.liftZones = this._findLiftZones().filter(z => !this.rollbackZone || z.t1 < this.rollbackZone.tValley || z.t0 > this.rollbackZone.tPeak);
  }

  /** 뒤로 떨어지기 구간 안의 게이트인지 — 억울한 실패 방지로 판정/만점/표시에서 제외 */
  inRollbackZone(t) {
    const z = this.rollbackZone;
    return !!z && t >= z.tValley - 0.01 && t <= z.tPeak + 0.02;
  }

  /** 큰 급하강 시작점(t) 목록 — 경사 < -0.35가 이어지는 동안 25m 이상 떨어지는 구간(카메라 자동 1인칭 펄스용).
   * 5단계 에어타임 언덕(15~20m)·짧은 딥은 제외 */
  _findBigDrops() {
    const S = this._sampleLoop(2), out = [];
    let st = null;
    S.forEach((p, k) => {
      const down = p.tangent.y < -0.35;
      if (down && st === null) st = k;
      if ((!down || k === S.length - 1) && st !== null) {
        if (S[st].pos.y - p.pos.y >= 25) out.push(S[st].t);
        st = null;
      }
    });
    return out;
  }

  /** 체인 리프트: 경사 > 0.15가 50m 이상 이어지는 긴 오르막(에어타임 언덕은 상승 25m 미만이면 제외 — 5단계 복귀 리프트는 포함).
   * tCrest = 리프트가 끝난 뒤 300m 안에서 급한 내리막(경사 < -0.3)이 시작되는 지점 — 정상 직전 멈칫 위치(없으면 null).
   * 4·5단계처럼 리프트 끝 → 스테이션 평지 → 낙하면 평지를 건너 낙하 시작점에서 멈칫 */
  _findLiftZones() {
    const S = this._sampleLoop(2);
    const zones = [];
    let st = null;
    S.forEach((p, k) => {
      const up = p.tangent.y > 0.15;
      if (up && st === null) st = k;
      if ((!up || k === S.length - 1) && st !== null) {
        const mid = S[Math.floor((st + k) / 2)].t;
        const rise = p.pos.y - S[st].pos.y;
        if ((k - st) * 2 >= 50 && (!this.getSegmentAt(mid).airtimeZone || rise >= 25)) {
          let tCrest = null;
          for (let j = 0; j < 150; j++) { const q = S[(k + j) % S.length]; if (q.tangent.y < -0.3) { tCrest = q.t; break; } }
          zones.push({ t0: S[st].t, t1: p.t, tCrest });
        }
        st = null;
      }
    });
    return zones;
  }

  liftZoneAt(t) {
    return this.liftZones.find(z => t >= z.t0 && t <= z.t1) || null;
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

    this._placeWater();
    this._placeGateMarkers(railTopY, isHanging);
    this._placeEventMarkers(railTopY, isHanging);
    this._placeTrackside(railTopY, isHanging);
    this._placeTunnels(isHanging);
    await Promise.all([this._placeNatureProps(), this._placeParkProps()]);
    this._placeCarnival();
  }

  /** 이벤트 구간 바닥 표시(9번) — 레일 사이에 눕힌 인스턴스 판. 종류별 색/모양:
   *  부스트 = 노란 화살표 띠(진행 방향으로 흐르는 애니메이션) / 에어타임 = 하늘색 띠 + 손 / 커브 = 커브 방향 쉐브론 /
   *  급하강·물 = 주황 경고 줄무늬 / 뒤로 떨어지기 = 빨간 역방향 화살표(매 플레이 두 번째 랩부터).
   * 인스턴스 색(instancedBuffers.color)으로 카트가 다가올수록 밝아짐(updateEventMarkers). 겹치면 우선순위 높은 것만 */
  _placeEventMarkers(railTopY, isHanging) {
    const scene = this.scene;
    const L = this.lengthM;
    const wrap = t => ((t % 1) + 1) % 1;
    const draw = {
      up: c => { c.beginPath(); c.moveTo(64, 14); c.lineTo(118, 70); c.lineTo(96, 92); c.lineTo(64, 60); c.lineTo(32, 92); c.lineTo(10, 70); c.closePath(); c.fill(); },
      down: c => { c.beginPath(); c.moveTo(64, 114); c.lineTo(118, 58); c.lineTo(96, 36); c.lineTo(64, 68); c.lineTo(32, 36); c.lineTo(10, 58); c.closePath(); c.fill(); },
      right: c => { c.beginPath(); c.moveTo(114, 64); c.lineTo(58, 10); c.lineTo(36, 32); c.lineTo(68, 64); c.lineTo(36, 96); c.lineTo(58, 118); c.closePath(); c.fill(); },
      left: c => { c.beginPath(); c.moveTo(14, 64); c.lineTo(70, 10); c.lineTo(92, 32); c.lineTo(60, 64); c.lineTo(92, 96); c.lineTo(70, 118); c.closePath(); c.fill(); },
      hand: c => { c.globalAlpha = 0.45; c.fillRect(0, 0, 128, 128); c.globalAlpha = 1; // 띠 바탕 + 손바닥
        c.beginPath(); c.arc(64, 80, 26, 0, Math.PI * 2); c.fill();
        [[38, 26], [54, 18], [70, 18], [86, 26]].forEach(([x, y]) => { c.beginPath(); c.roundRect ? c.roundRect(x - 7, y, 14, 46, 7) : c.rect(x - 7, y, 14, 46); c.fill(); });
        c.save(); c.translate(96, 70); c.rotate(-0.7); c.fillRect(-7, -6, 14, 34); c.restore(); },
      stripes: c => { for (let i = -128; i < 256; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 16, 0); c.lineTo(i + 144, 128); c.lineTo(i + 128, 128); c.closePath(); c.fill(); } },
    };
    const groups = {};
    const makeGroup = (key, shape, color, size, scroll) => {
      const tex = new BABYLON.DynamicTexture(`mk_${key}`, { width: 128, height: 128 }, scene, true);
      const ctx = tex.getContext();
      ctx.clearRect(0, 0, 128, 128);
      ctx.fillStyle = '#ffffff';
      draw[shape](ctx);
      tex.hasAlpha = true;
      tex.update();
      if (scroll) tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
      const m = new BABYLON.StandardMaterial(`mkMat_${key}`, scene);
      // 인스턴스 색이 곱해지려면 조명 경로가 살아 있어야 함(disableLighting이면 결과가 검정) — 확산색은 검정, 자체발광 흰색×모양 텍스처
      m.emissiveTexture = tex; m.opacityTexture = tex; m.backFaceCulling = false;
      m.diffuseColor = BABYLON.Color3.Black(); m.specularColor = BABYLON.Color3.Black(); m.emissiveColor = BABYLON.Color3.White();
      const plane = BABYLON.MeshBuilder.CreatePlane(`mk_${key}_tpl`, { width: size[0], height: size[1] }, scene);
      plane.rotation.x = Math.PI / 2; // 레일 위에 눕히고 그림의 위쪽이 +Z(진행 방향)
      plane.bakeCurrentTransformIntoVertices();
      plane.material = m;
      plane.registerInstancedBuffer('color', 4);
      plane.instancedBuffers.color = new BABYLON.Color4(1, 1, 1, 1);
      plane.setEnabled(false);
      this._meshes.push(plane, m, tex);
      groups[key] = { key, plane, tex, color, list: [], scroll };
      return groups[key];
    };
    makeGroup('boost', 'up', [1, 0.78, 0.1], [1.3, 1.0], true);
    makeGroup('rollback', 'down', [1, 0.25, 0.6], [1.6, 1.2], false); // 분홍빛 빨강 — 1단계의 붉은 레일과 구분되게
    makeGroup('drop', 'stripes', [1, 0.5, 0.1], [1.4, 1.2], false);
    makeGroup('curveL', 'left', [0.35, 1, 0.55], [1.2, 1.0], false);
    makeGroup('curveR', 'right', [0.35, 1, 0.55], [1.2, 1.0], false);

    const occupied = [];
    const up = isHanging ? -0.08 : railTopY + 0.05;
    const add = (g, t) => {
      t = wrap(t);
      const s = t * L;
      if (occupied.some(o => Math.min(Math.abs(o - s), L - Math.abs(o - s)) < 1.4)) return; // 이미 더 중요한 표시가 있음
      occupied.push(s);
      const p = this.getPositionAt(t), tn = this.getTangentAt(t);
      const inst = g.plane.createInstance(`mk_${g.key}_${g.list.length}`);
      inst.position = p.add(new BABYLON.Vector3(0, up, 0));
      inst.lookAt(inst.position.add(tn), 0, 0, this.getBankRollAt(t));
      inst.instancedBuffers.color = new BABYLON.Color4(g.color[0] * 0.4, g.color[1] * 0.4, g.color[2] * 0.4, 1);
      g.list.push({ inst, t });
      this._meshes.push(inst);
    };
    const step = (t0, t1, spacing, g) => { for (let s = t0 * L; s <= t1 * L; s += spacing) add(g, s / L); };
    // 우선순위 순서대로 배치: 부스트 > 뒤로 떨어지기 > 급하강/물 > 커브 (손 들기 하늘색 띠는 13번에서 제거)
    this.gateCenters().filter(x => x.type === 'boost').forEach(({ t }) => step(t - 20 / L, t + 40 / L, 3, groups.boost));
    if (this.rollbackZone) step(this.rollbackZone.tValley, this.rollbackZone.tPeak, 3, groups.rollback);
    const S = this._sampleLoop(2.5);
    S.forEach(q => { if (q.tangent.y < -0.35) add(groups.drop, q.t); });
    if (this.splash) step(this.splash.t - 20 / L, this.splash.t + 20 / L, 2.5, groups.drop);
    this.segmentRanges.forEach(seg => {
      if (seg.requiredLean > 0) step(seg.tStart, Math.min(seg.tEnd, seg.tStart + 30 / L), 4, seg.curveDirection === 'left' ? groups.curveL : groups.curveR);
    });
    groups.rollback.list.forEach(({ inst }) => inst.setEnabled(false)); // 매 플레이 첫 랩은 숨김
    this._markerGroups = Object.values(groups);
    this._rollbackMarkers = groups.rollback.list.map(x => x.inst);
  }

  /** 카트 앞 120m 안의 표시는 가까울수록 밝게(0.4→1.0), 지나간 표시는 어둡게. animate=false(low)면 부스트 흐름 애니메이션 생략 */
  updateEventMarkers(cartT, dt, animate) {
    if (!this._markerGroups) return;
    if (this._lastMarkerT !== undefined && Math.abs(cartT - this._lastMarkerT) * this.lengthM < 1 && !animate) return;
    this._lastMarkerT = cartT;
    const L = this.lengthM, AHEAD = 120;
    this._markerGroups.forEach(g => {
      if (g.scroll && animate) g.tex.vOffset -= dt * 1.6; // 화살표가 진행 방향으로 흐르는 빛
      g.list.forEach(({ inst, t }) => {
        let d = (t - cartT) * L;
        if (d < -L / 2) d += L; else if (d > L / 2) d -= L;
        const k = d >= 0 && d <= AHEAD ? 0.4 + 0.6 * (1 - d / AHEAD) : d < 0 && d > -10 ? 1 : 0.4;
        if (Math.abs((inst._mkK ?? -1) - k) < 0.02) return; // 변화가 있을 때만 버퍼 갱신
        inst._mkK = k;
        inst.instancedBuffers.color = new BABYLON.Color4(g.color[0] * k, g.color[1] * k, g.color[2] * k, 1);
      });
    });
  }

  /** main.js가 랩이 바뀔 때 호출 — 두 번째 랩부터 경고 표시 */
  setRollbackMarkersVisible(on) {
    (this._rollbackMarkers || []).forEach(m => m.setEnabled(on));
  }

  /** 근거리 시각 흐름: 트랙 좌우 1.7m에 7m 간격으로 조명 기둥/깃발(레일 높이에 부착, 뱅킹 따라 기울어짐).
   * 카트(반폭 약 0.55m)·3인칭 카메라(중심선 위 2m)와 닿지 않되 바로 옆을 휙휙 지나가는 거리 */
  _placeTrackside(railTopY, isHanging) {
    const scene = this.scene;
    const mat = (name, c, emissive) => {
      const m = new BABYLON.StandardMaterial(name, scene);
      m.diffuseColor = c; m.specularColor = BABYLON.Color3.Black();
      if (emissive) { m.emissiveColor = c; m.disableLighting = true; }
      return m;
    };
    const poleMat = mat('tsPole', new BABYLON.Color3(0.08, 0.1, 0.2));
    const lampMat = mat('tsLamp', new BABYLON.Color3(1, 0.86, 0.45), true);
    const flagMats = [mat('tsFlagY', new BABYLON.Color3(1, 0.72, 0.05), true), mat('tsFlagR', new BABYLON.Color3(1, 0.35, 0.3), true)];
    const H = 1.2; // 기둥 높이(m) — 카메라(2m)보다 충분히 낮게
    const build = (kind, k) => {
      const pole = BABYLON.MeshBuilder.CreateCylinder(`tsPoleG_${kind}`, { height: H, diameter: 0.07, tessellation: 6 }, scene);
      pole.position.y = H / 2;
      pole.material = poleMat;
      let head;
      if (kind === 'lamp') {
        head = BABYLON.MeshBuilder.CreateSphere('tsHead', { diameter: 0.26, segments: 6 }, scene);
        head.position.y = H;
        head.material = lampMat;
      } else {
        head = BABYLON.MeshBuilder.CreatePlane('tsFlag', { width: 0.55, height: 0.32, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        head.position.set(0, H - 0.18, -0.28); // 진행 반대 방향으로 나부끼는 깃발
        head.rotation.y = Math.PI / 2;
        head.material = flagMats[k % 2];
      }
      const m = BABYLON.Mesh.MergeMeshes([pole, head], true, true, undefined, false, true);
      m.name = `trackside_${kind}_${k}`;
      m.setEnabled(false);
      this._meshes.push(m);
      return m;
    };
    const templates = [build('lamp', 0), build('flag', 0), build('flag', 1)];
    // 3인칭 카메라 경로(camera.js와 같은 오프셋, 스프링 전 목표점) — 급커브에선 카메라가 커브 바깥으로 크게 돌아
    // 트랙 옆 기둥에 붙음(실측 0.26m) → 경로에서 1.3m 안에 드는 기둥은 생략
    const camPath = this._sampleLoop(2).map(({ pos, tangent, t }) => {
      const lean = this.getSegmentAt(t).requiredLean || 0;
      return pos.add(tangent.scale(-(isHanging ? 8 + lean * 4 : 6.2 + lean * 4))).add(new BABYLON.Vector3(0, isHanging ? -1.1 - lean : 2.0 + lean * 2.5, 0));
    });
    const nearCam = p => camPath.some(c => BABYLON.Vector3.DistanceSquared(c, p) < 1.3 * 1.3);
    const base = isHanging ? 0 : railTopY;
    const station = this.getPositionAt(0);
    this._sampleLoop(7).forEach(({ pos, tangent, t }, i) => {
      if (Math.hypot(pos.x - station.x, pos.z - station.z) < 14) return; // 스테이션 플랫폼 구간 제외
      const roll = this.getBankRollAt(t);
      const right = BABYLON.Vector3.Cross(BABYLON.Vector3.Up(), tangent);
      if (right.lengthSquared() < 0.01) return; // 수직 낙하 구간은 생략
      right.normalize();
      const side = i % 2 ? 1 : -1;
      const inst = templates[i % 4 === 0 ? 0 : 1 + (i >> 2) % 2].createInstance(`ts_${i}`);
      const at = pos.add(right.scale(2.0 * side)).add(new BABYLON.Vector3(0, base, 0)); // 2.0m(1.7m는 커브에서 카메라와 0.26m까지 접근)
      if (nearCam(at) || nearCam(at.add(new BABYLON.Vector3(0, 1.2, 0)))) { inst.dispose(); return; }
      inst.position = at;
      inst.lookAt(inst.position.add(tangent), 0, 0, roll);
      this._meshes.push(inst);
    });
  }

  /** 머리 위로 스치는 구조물: 직선·완만한 구간 2~3곳에 게이트형 프레임 5개(3m 간격) 터널. 기둥은 지면에서 올라오고
   * 가로 빔은 레일 위 3.3m(3인칭 카메라 2m, 1인칭 1.1m보다 높게 — "닿을 것 같은" 거리). 인버티드는 빔을 레일 위 1m에 두고
   * 기둥을 옆 지지대(2.2m)보다 바깥(3.2m)에. 다른 트랙 구간이 프레임을 지나거나 게이트/스테이션과 가까우면 그 자리는 건너뜀 */
  _placeTunnels(isHanging) {
    const scene = this.scene;
    const m = new BABYLON.StandardMaterial('tunnelMat', scene);
    m.diffuseColor = new BABYLON.Color3(0.95, 0.95, 1);
    m.specularColor = BABYLON.Color3.Black();
    const stripe = new BABYLON.StandardMaterial('tunnelStripe', scene);
    stripe.diffuseColor = new BABYLON.Color3(1, 0.45, 0.25);
    stripe.specularColor = BABYLON.Color3.Black();
    const HALF0 = isHanging ? 3.2 : 2.6, BEAM0 = isHanging ? 1.0 : 3.3;
    const L = this.lengthM;
    const gates = this.gateCenters().map(g => g.t);
    const station = this.getPositionAt(0);
    const probe = this._sampleLoop(2);
    // 커브 구간도 허용하되(5단계는 거의 전 구간이 커브) 커브 세기(requiredLean)만큼 빔을 높이고 폭을 넓힘 —
    // 3인칭 카메라가 커브에서 2+2.5×lean m까지 올라가고 바깥으로 치우치므로 그만큼 여유를 더함
    const leanAt = t0 => {
      let lean = 0;
      for (let d = -12; d <= 14; d += 2) lean = Math.max(lean, this.getSegmentAt(((t0 + d / L) % 1 + 1) % 1).requiredLean || 0);
      return lean;
    };
    const ok = t0 => {
      const lean = leanAt(t0), HALF = HALF0 + lean * 1.5;
      for (let d = -2; d <= 14; d += 2) {
        const t = ((t0 + d / L) % 1 + 1) % 1;
        if (Math.abs(this.getTangentAt(t).y) > 0.25) return false;
      }
      const p0 = this.getPositionAt(t0);
      if (Math.hypot(p0.x - station.x, p0.z - station.z) < 40) return false;
      // 세그먼트 데이터상 직선이어도 실제 커브가 휘어 있으면 안쪽 기둥이 카메라에 붙음 — 14m 동안 방향 변화 10° 이내만
      const ta = this.getTangentAt(t0), tb = this.getTangentAt(((t0 + 14 / L) % 1 + 1) % 1);
      if (BABYLON.Vector3.Dot(ta, tb) < Math.cos((lean > 0 ? 18 : 10) * Math.PI / 180)) return false;
      if (gates.some(g => Math.abs(g - t0) * L < 30)) return false;
      // 다른 트랙 구간이 프레임 폭 안(수평 HALF+2m, 높이 −2~+6m)으로 지나가면 제외
      return !probe.some(p => {
        const dt = Math.min(Math.abs(p.t - t0), 1 - Math.abs(p.t - t0)) * L;
        return dt > 30 && Math.hypot(p.pos.x - p0.x, p.pos.z - p0.z) < HALF + 2 && Math.abs(p.pos.y - p0.y) < 6;
      });
    };
    const spots = [];
    for (let t = 0.08; t < 0.86 && spots.length < 3; t += 0.01) { // 트랙 끝(스테이션 진입부)은 제외
      if (ok(t) && spots.every(s => (t - s) * L > 120)) spots.push(t);
    }
    this.passMarkers = this.passMarkers || [];
    spots.forEach((t0, n) => {
      this.passMarkers.push({ t: t0, kind: 'tunnel' });
      const lean = leanAt(t0);
      const HALF = HALF0 + lean * 1.5, BEAM_Y = BEAM0 + (isHanging ? 0 : lean * 2.5 + 0.3 * (lean > 0));
      const parts = [];
      for (let f = 0; f < 5; f++) {
        const t = t0 + (f * 3) / L;
        const pos = this.getPositionAt(t), tan = this.getTangentAt(t);
        const right = BABYLON.Vector3.Cross(BABYLON.Vector3.Up(), tan).normalize();
        const topY = pos.y + BEAM_Y;
        [-1, 1].forEach(sd => {
          const post = BABYLON.MeshBuilder.CreateBox(`tunPost_${n}_${f}_${sd}`, { width: 0.3, depth: 0.3, height: topY }, scene);
          const p = pos.add(right.scale(HALF * sd));
          post.position.set(p.x, topY / 2, p.z);
          post.lookAt(new BABYLON.Vector3(p.x + tan.x, topY / 2, p.z + tan.z));
          post.material = f % 2 ? stripe : m;
          parts.push(post);
        });
        const beam = BABYLON.MeshBuilder.CreateBox(`tunBeam_${n}_${f}`, { width: HALF * 2 + 0.3, depth: 0.35, height: 0.35 }, scene);
        beam.position.set(pos.x, topY, pos.z);
        beam.lookAt(new BABYLON.Vector3(pos.x + tan.x, topY, pos.z + tan.z));
        beam.material = f % 2 ? m : stripe;
        parts.push(beam);
      }
      // 터널 하나 = 재질별 메시 2개(드로우콜 2) — 멀티머티리얼 병합은 원본 박스마다 서브메시가 남아 15콜이 됨(실측 low 59콜)
      [m, stripe].forEach((mat, k) => {
        const group = parts.filter(x => x.material === mat);
        if (!group.length) return;
        const merged = BABYLON.Mesh.MergeMeshes(group, true, true);
        merged.name = `tunnel_${n}_${k}`;
        merged.material = mat;
        merged.freezeWorldMatrix();
        this._meshes.push(merged);
      });
    });
    this._meshes.push(m, stripe);
  }

  /** 피니쉬 게이트 아치 — 피니쉬 판정 기준점(t)에 트랙을 가로지르는 테마 색 기둥+빔 + 체크무늬 배너.
   * 이 지점이 랩 기준점(main.js가 통과 시 LAP/FINAL LAP/FINISH 표시). 빔은 레일 위 4.3m(3인칭 카메라 2m보다 충분히 높게),
   * 인버티드는 레일 위 1.4m(카트·카메라는 레일 아래). 기둥은 옆 지지대(2.2m)보다 바깥 */
  _placeFinishArch(t, railTopY, isHanging) {
    const scene = this.scene;
    this.finishT = t;
    const pos = this.getPositionAt(t), tan = this.getTangentAt(t);
    const f = new BABYLON.Vector3(tan.x, 0, tan.z).normalize();
    const right = new BABYLON.Vector3(f.z, 0, -f.x);
    const HALF = isHanging ? 3.4 : 3.0;
    const beamY = pos.y + (isHanging ? 1.4 : railTopY + 4.3);
    const theme = BABYLON.Color3.FromHexString(this.stageData.theme || '#ffb80d');
    const mat = new BABYLON.StandardMaterial('archMat', scene);
    mat.diffuseColor = theme; mat.emissiveColor = theme.scale(0.35); mat.specularColor = BABYLON.Color3.Black();
    const parts = [];
    [-1, 1].forEach(sd => {
      const post = BABYLON.MeshBuilder.CreateBox('archPost', { width: 0.5, depth: 0.5, height: beamY + 0.4 }, scene);
      const p = pos.add(right.scale(HALF * sd));
      post.position.set(p.x, (beamY + 0.4) / 2, p.z);
      post.lookAt(new BABYLON.Vector3(p.x + f.x, post.position.y, p.z + f.z));
      parts.push(post);
      const cap = BABYLON.MeshBuilder.CreateSphere('archCap', { diameter: 0.9, segments: 8 }, scene);
      cap.position.set(p.x, beamY + 0.75, p.z);
      parts.push(cap);
    });
    const beam = BABYLON.MeshBuilder.CreateBox('archBeam', { width: HALF * 2 + 0.6, depth: 0.5, height: 0.6 }, scene);
    beam.position.set(pos.x, beamY + 0.1, pos.z);
    beam.lookAt(new BABYLON.Vector3(pos.x + f.x, beam.position.y, pos.z + f.z));
    parts.push(beam);
    const arch = BABYLON.Mesh.MergeMeshes(parts, true, true);
    arch.name = 'finishArch';
    arch.material = mat;
    // 체크무늬 배너(양면) — 통과 시 흔들림(main.js)
    const tex = new BABYLON.DynamicTexture('checkerTex', { width: 256, height: 64 }, scene, true);
    const ctx = tex.getContext();
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { ctx.fillStyle = (i + j) % 2 ? '#141a33' : '#ffffff'; ctx.fillRect(i * 16, j * 16, 16, 16); }
    tex.update();
    const bm = new BABYLON.StandardMaterial('bannerMat', scene);
    bm.diffuseTexture = tex; bm.emissiveColor = new BABYLON.Color3(0.45, 0.45, 0.45); bm.backFaceCulling = false; bm.specularColor = BABYLON.Color3.Black();
    const banner = BABYLON.MeshBuilder.CreatePlane('finishBanner', { width: HALF * 2 - 0.6, height: 0.8 }, scene);
    banner.material = bm;
    banner.setPivotPoint(new BABYLON.Vector3(0, 0.4, 0)); // 위쪽 모서리를 축으로 흔들림
    banner.position.set(pos.x, beamY - 0.6, pos.z);
    banner.lookAt(new BABYLON.Vector3(pos.x + f.x, banner.position.y, pos.z + f.z));
    this.finishBanner = banner;
    this._bannerBaseRotX = banner.rotation.x;
    this._meshes.push(arch, mat, banner, bm, tex);
    this.passMarkers.push({ t, kind: 'tunnel' });
  }

  /** 게이트 중심(cart.js와 같은 기준점)의 진행률 목록 — 표시물과 판정이 같은 지점을 가리키도록 */
  gateCenters() {
    return this.segmentRanges.filter(s => s.gate).map(s => {
      const w = s.gate.timingWindow;
      return { t: s.tStart + (s.tEnd - s.tStart) * (w.start + w.end) / 2, type: s.gate.type };
    }).filter(g => !this.inRollbackZone(g.t));
  }

  /** 가속 구간 표시: 게이트 중심에 빛나는 링(카트가 통과), 중심 앞 20m ~ 뒤 40m 레일 위 화살표 띠(이미시브, 조명 무관).
   * 진행률 ↔ 거리는 cart.js와 같은 모델(t × lengthM)로 환산 */
  _placeGateMarkers(railTopY, isHanging) {
    const scene = this.scene;
    const ring = BABYLON.MeshBuilder.CreateTorus('gateRing', { diameter: 5.6, thickness: 0.28, tessellation: 32 }, scene);
    ring.rotation.x = Math.PI / 2; // 링 면이 진행 방향(Z)에 수직
    ring.bakeCurrentTransformIntoVertices();
    const ringMat = new BABYLON.StandardMaterial('gateRingMat', scene);
    ringMat.emissiveColor = new BABYLON.Color3(1, 0.72, 0.05);
    ringMat.disableLighting = true;
    ring.material = ringMat;
    ring.setEnabled(false);
    const finishRing = ring.clone('finishRing');
    finishRing.material = ringMat.clone('finishRingMat');
    finishRing.material.emissiveColor = new BABYLON.Color3(0.25, 1, 0.55);
    finishRing.setEnabled(false);
    this._meshes.push(ring, finishRing, ringMat, finishRing.material);
    this.passMarkers = [];
    this.gateCenters().forEach(({ t, type }, g) => {
      const pos = this.getPositionAt(t), tan = this.getTangentAt(t);
      if (type === 'finish') { this._placeFinishArch(t, railTopY, isHanging); return; } // 피니쉬는 링 대신 아치(8번)
      const r = ring.createInstance(`gateRing_${g}`);
      r.position = pos.add(new BABYLON.Vector3(0, isHanging ? -0.5 : 1.0, 0));
      r.lookAt(r.position.add(tan));
      this._meshes.push(r);
      this.passMarkers.push({ t, kind: 'ring' });
    });
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

  /** 물 착수 연못 안인지(나무·소품이 물 위에 서지 않게) */
  inPond(x, z) {
    const sp = this.splash;
    if (!sp) return false;
    const f = new BABYLON.Vector3(sp.tangent.x, 0, sp.tangent.z).normalize();
    const dx = x - sp.pos.x, dz = z - sp.pos.z;
    const along = dx * f.x + dz * f.z, side = -dx * f.z + dz * f.x;
    return Math.abs(along) < POND.length / 2 + 4 && Math.abs(side) < POND.width / 2 + 4;
  }

  /** 착수 지점 아래 연못 — 트랙 방향으로 긴 사각 수면. 물결은 텍스처 스크롤(main.js _render, low는 정지) */
  _placeWater() {
    const sp = this.splash;
    if (!sp) return;
    const scene = this.scene;
    const pond = BABYLON.MeshBuilder.CreateGround('pond', { width: POND.width, height: POND.length }, scene);
    pond.position.set(sp.pos.x, POND.level, sp.pos.z);
    pond.rotation.y = Math.atan2(sp.tangent.x, sp.tangent.z);
    const tex = new BABYLON.DynamicTexture('pondTex', { width: 128, height: 128 }, scene, true);
    const ctx = tex.getContext();
    ctx.fillStyle = '#2f86c9'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '20,70,140'},${(0.08 + Math.random() * 0.14).toFixed(2)})`;
      const x = Math.random() * 128, y = Math.random() * 128, w = 6 + Math.random() * 18;
      for (const [ox, oy] of [[0, 0], [-128, 0], [128, 0], [0, -128], [0, 128]]) { ctx.beginPath(); ctx.ellipse(x + ox, y + oy, w, w * 0.3, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    tex.update();
    tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.uScale = 5; tex.vScale = 7;
    const m = new BABYLON.StandardMaterial('pondMat', scene);
    m.diffuseTexture = tex;
    m.specularColor = new BABYLON.Color3(0.9, 0.95, 1);
    m.specularPower = 64;
    m.emissiveColor = new BABYLON.Color3(0.05, 0.18, 0.3);
    pond.material = m;
    pond.receiveShadows = true;
    this.pondTexture = tex;
    this._meshes.push(pond, m, tex);
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
      if (/^leafs/.test(m.name)) m.albedoColor = new BABYLON.Color3(0.13, 0.5, 0.1); // 밝고 선명한 초록(밝은 낮 스타일)
      else if (/^grass/.test(m.name)) m.albedoColor = new BABYLON.Color3(0.22, 0.58, 0.08);
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
      if (this.inPond(x, z)) continue;

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
      if (this._minTrackDistXZ(x, z) < 6 || this.inPond(x, z)) return;
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
    this._parkFrame = { origin, fwd, right, side }; // 놀이공원 장식(_placeCarnival)이 같은 광장 기준을 씀

    PARK_LAYOUT.forEach(([file, along, lateral, facing], k) => {
      const x = origin.x + fwd.x * along + right.x * lateral * side;
      const z = origin.z + fwd.z * along + right.z * lateral * side;
      if (this._minTrackDistXZ(x, z) < 4 || this.inPond(x, z)) return;
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

  /** 놀이공원 분위기 장식 — 알록달록한 깃발 줄, 풍선, 파라솔·천막, 꽃밭. 스테이션 광장(_parkFrame)과 트랙 바깥쪽에 배치.
   * 전부 정점 색 + 비조명 재질로 한 메시에 병합(드로우콜 1회), 색은 스테이지 palette.accents. 레일에서 9m 이상 떨어진 곳에만, low는 개수 절반 */
  _placeCarnival() {
    const f = this._parkFrame;
    if (!f) return;
    const scene = this.scene, q = QualityManager.current;
    const k = q === 'low' ? 0.5 : q === 'medium' ? 0.8 : 1;
    const acc = (this.stageData.palette || { accents: ['#ffe14d', '#ff8fb1', '#7fd8ff', '#ffffff'] }).accents.map(h => BABYLON.Color3.FromHexString(h));
    const rand = seededRandom(this.stageData.id * 4421 + 17);
    const pick = () => acc[Math.floor(rand() * acc.length)];
    const white = new BABYLON.Color3(1, 0.97, 0.92);
    const parts = [];
    const colorize = (mesh, c) => {
      const n = mesh.getTotalVertices(), cols = [];
      for (let i = 0; i < n; i++) cols.push(c.r, c.g, c.b, 1);
      mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols);
      return mesh;
    };
    const put = (mesh, c, x, y, z) => { colorize(mesh, c).position.set(x, y, z); parts.push(mesh); return mesh; };
    const W = (a, l) => new BABYLON.Vector3(f.origin.x + f.fwd.x * a + f.right.x * l * f.side, 0, f.origin.z + f.fwd.z * a + f.right.z * l * f.side);
    const clear = (v, d) => this._minTrackDistXZ(v.x, v.z) >= d && !this.inPond(v.x, v.z);
    const cyl = (h, dTop, dBot, tess) => BABYLON.MeshBuilder.CreateCylinder('c', { height: h, diameterTop: dTop, diameterBottom: dBot, tessellation: tess }, scene);

    const parasol = (v, c) => { put(cyl(3.2, 0.15, 0.15, 6), white, v.x, 1.6, v.z); put(cyl(1.3, 0, 4.6, 12), c, v.x, 3.85, v.z); };
    const tent = (v, c) => { put(cyl(2.4, 6, 6, 12), white, v.x, 1.2, v.z); put(cyl(3.4, 0, 7.4, 12), c, v.x, 4.1, v.z); put(BABYLON.MeshBuilder.CreateSphere('b', { diameter: 0.7, segments: 4 }, scene), pick(), v.x, 6.0, v.z); };
    const bed = (v) => {
      const a = pick(), b = pick(), c = pick();
      [[2.6, 0.05, new BABYLON.Color3(0.25, 0.6, 0.2)], [2.2, 0.08, a], [1.5, 0.11, b], [0.8, 0.14, c]].forEach(([r, y, col]) =>
        put(BABYLON.MeshBuilder.CreateDisc('d', { radius: r, tessellation: 14 }, scene), col, v.x, y, v.z).rotation.x = Math.PI / 2);
    };
    const balloons = (v, count) => {
      put(cyl(5, 0.12, 0.12, 5), new BABYLON.Color3(0.85, 0.85, 0.9), v.x, 2.5, v.z);
      for (let i = 0; i < count; i++) put(BABYLON.MeshBuilder.CreateSphere('bl', { diameter: 1.5, segments: 5 }, scene), pick(), v.x + (rand() - 0.5) * 3, 6.4 + rand() * 3.2, v.z + (rand() - 0.5) * 3);
    };
    // 깃발 줄: 두 기둥 사이를 늘어뜨린 선 + 2m마다 삼각 깃발(수작업 삼각형 하나의 정점 데이터로 누적)
    const tri = { positions: [], colors: [], indices: [] };
    const addTri = (p0, p1, p2, c) => {
      const base = tri.positions.length / 3;
      [p0, p1, p2].forEach(p => { tri.positions.push(p.x, p.y, p.z); tri.colors.push(c.r, c.g, c.b, 1); });
      tri.indices.push(base, base + 1, base + 2);
    };
    const bunting = (a, b, topY) => {
      put(cyl(topY, 0.18, 0.18, 6), new BABYLON.Color3(0.8, 0.8, 0.85), a.x, topY / 2, a.z);
      put(cyl(topY, 0.18, 0.18, 6), new BABYLON.Color3(0.8, 0.8, 0.85), b.x, topY / 2, b.z);
      const len = BABYLON.Vector3.Distance(a, b), n = Math.max(2, Math.round(len / 2)), dir = b.subtract(a).normalize();
      const side = new BABYLON.Vector3(-dir.z, 0, dir.x);
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const u = i / n, sag = 4 * u * (1 - u) * 1.4; // 가운데가 1.4m 처짐
        const p = a.add(dir.scale(len * u)); p.y = topY - sag;
        if (prev) { // 줄(가는 삼각형 두 장)
          const e = side.scale(0.06);
          addTri(prev.add(e), prev.subtract(e), p.add(e), new BABYLON.Color3(0.9, 0.9, 0.95)); addTri(prev.subtract(e), p.subtract(e), p.add(e), new BABYLON.Color3(0.9, 0.9, 0.95));
        }
        if (i < n) { const m = a.add(dir.scale(len * (u + 0.5 / n))); m.y = topY - 4 * (u + 0.5 / n) * (1 - u - 0.5 / n) * 1.4; addTri(m.subtract(dir.scale(0.6)), m.add(dir.scale(0.6)), m.add(new BABYLON.Vector3(0, -1.2, 0)), pick()); }
        prev = p;
      }
    };

    // ── 스테이션 광장: 깃발 줄 3줄, 풍선 묶음, 파라솔·천막, 꽃밭
    const plaza = [
      ['bunting', -18, 12, -18, 36], ['bunting', 18, 12, 18, 36], ['bunting', -18, 36, 18, 36],
    ];
    plaza.slice(0, k < 1 ? 2 : 3).forEach(([, a1, l1, a2, l2]) => { const A = W(a1, l1), B = W(a2, l2); if (clear(A, 8) && clear(B, 8)) bunting(A, B, 7.5); });
    [[-14, 16], [14, 16], [-22, 24], [22, 24], [-16, 32], [16, 32]].slice(0, Math.max(3, Math.round(6 * k))).forEach(([a, l]) => { const v = W(a, l); if (clear(v, 6)) parasol(v, pick()); });
    [[-28, 22], [28, 22], [0, 46]].slice(0, Math.max(1, Math.round(3 * k))).forEach(([a, l]) => { const v = W(a, l); if (clear(v, 8)) tent(v, pick()); });
    [[-10, 36], [10, 36], [0, 4]].slice(0, Math.max(1, Math.round(3 * k))).forEach(([a, l]) => { const v = W(a, l); if (clear(v, 6)) balloons(v, Math.round(9 * k) + 2); });
    [[-12, 10], [12, 10], [-20, 8], [20, 8], [-25, 15], [25, 15], [-8, 4], [8, 4], [-14, 28], [14, 28]].slice(0, Math.max(4, Math.round(10 * k))).forEach(([a, l]) => { const v = W(a, l); if (clear(v, 5)) bed(v); });

    // ── 트랙 바깥쪽: 일정 간격으로 꽃밭/풍선/파라솔을 번갈아(트랙 위로 높이 뜬 구간은 지면에서 멀어 건너뜀)
    const samples = this._sampleLoop(10);
    const count = Math.round(16 * k), stride = Math.max(1, Math.floor(samples.length / count));
    for (let i = 0, n = 0; i < samples.length && n < count; i += stride, n++) {
      const s = samples[i];
      if (s.pos.y > 25) continue;
      const nrm = new BABYLON.Vector3(s.tangent.z, 0, -s.tangent.x).normalize().scale(n % 2 ? 1 : -1);
      const v = new BABYLON.Vector3(s.pos.x + nrm.x * 13, 0, s.pos.z + nrm.z * 13);
      if (!clear(v, 11)) continue;
      const kind = n % 3;
      if (kind === 0) bed(v); else if (kind === 1) balloons(v, Math.round(6 * k) + 2); else parasol(v, pick());
    }

    // ── 병합
    if (tri.indices.length) {
      const m = new BABYLON.Mesh('carnivalFlags', scene);
      const vd = new BABYLON.VertexData();
      vd.positions = tri.positions; vd.indices = tri.indices; vd.colors = tri.colors;
      vd.uvs = new Array(tri.positions.length / 3 * 2).fill(0); // 병합하려면 다른 조각과 정점 속성이 같아야 함
      BABYLON.VertexData.ComputeNormals(tri.positions, tri.indices, vd.normals = []);
      vd.applyToMesh(m);
      parts.push(m);
    }
    if (!parts.length) return;
    const merged = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!scene._carnivalMat) {
      const m = new BABYLON.StandardMaterial('carnivalMat', scene);
      m.disableLighting = true; m.emissiveColor = new BABYLON.Color3(1, 1, 1); m.backFaceCulling = false; // 정점 색 그대로(깃발은 양면)
      scene._carnivalMat = m;
    }
    merged.name = 'carnival';
    merged.material = scene._carnivalMat;
    merged.isPickable = false;
    merged.freezeWorldMatrix();
    this._meshes.push(merged);
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
