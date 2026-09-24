/**
 * stages.js
 * 스테이지별 트랙 제어점(Control Point), 세그먼트, 게이트 정의
 *
 * 좌표계: Babylon.js 기준 (X=좌우, Y=높이, Z=진행방향)
 * 제어점은 Blender에서 커브 오브젝트로 제작 후 좌표를 그대로 옮겨 적는 것을 전제로 함.
 * (Blender export 스크립트가 준비되면 이 배열을 자동 생성하도록 대체 예정)
 *
 * segment.type: 'straight' | 'curve' | 'drop' | 'loop'
 * segment.curveDirection: 'left' | 'right' | null   (밸런스 판정용)
 * segment.requiredLean: 0~1  (판정에 필요한 기울기 강도, 0=밸런스 불필요)
 * segment.leanWindow: 판정 허용 오차 (작을수록 어려움)
 * segment.gate: { type: 'boost'|'brake'|'finish', timingWindow: {start, end} } | null
 * segment.airtimeZone: boolean (해당 구간에서 손들기 입력 시 에어타임 보너스)
 */

const STAGES = [
  // ── 1단계: 우방타워랜드 (이월드 과거명) — 튜토리얼 ──────────────
  {
    id: 1,
    name: '우방타워랜드',
    motif: '이월드 (구 우방타워랜드) — 입문용 완만한 트랙',
    baseSpeedKmh: 45,
    trackLengthM: 350,
    controlPoints: [
      { x: 0,   y: 10, z: 0 },
      { x: 0,   y: 10, z: 40 },   // 리프트 힐(완만한 상승) 구간
      { x: 5,   y: 6,  z: 90 },   // 완만한 첫 내리막
      { x: 10,  y: 5,  z: 140 },  // 완만한 좌커브
      { x: 8,   y: 5,  z: 190 },  // 완만한 우커브
      { x: 0,   y: 3,  z: 240 },
      { x: 0,   y: 1,  z: 300 },  // 피니쉬 직전 감속 구간
      { x: 0,   y: 0,  z: 350 },
    ],
    segments: [
      { type: 'straight', curveDirection: null,  requiredLean: 0,   leanWindow: 0,   gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left', requiredLean: 0.3, leanWindow: 0.5, gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right',requiredLean: 0.3, leanWindow: 0.5, gate: null, airtimeZone: false },
      { type: 'straight', curveDirection: null,  requiredLean: 0,   leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.85, end: 1.0 } }, airtimeZone: false },
    ],
  },

  // ── 2단계: 도투락월드 — 급류의 계곡 (파에톤 모티브, 인버티드 루프) ──
  {
    id: 2,
    name: '도투락월드: 급류의 계곡',
    motif: '경주월드 파에톤 — 인버티드, 최고속도 72km/h, 길이 1148m, 360도 루프',
    baseSpeedKmh: 72,
    trackLengthM: 1148,
    controlPoints: [
      { x: 0,   y: 15, z: 0 },
      { x: 0,   y: 15, z: 60 },
      { x: 12,  y: 8,  z: 120 },   // 첫 급하강
      { x: 20,  y: 18, z: 180 },   // 루프 진입 (상승)
      { x: 20,  y: 28, z: 200 },   // 루프 정점
      { x: 20,  y: 18, z: 220 },   // 루프 이탈
      { x: 8,   y: 10, z: 280 },   // 좌커브
      { x: -5,  y: 6,  z: 340 },   // 우커브
      { x: 0,   y: 4,  z: 420 },
      { x: 0,   y: 0,  z: 500 },
    ],
    segments: [
      { type: 'straight', curveDirection: null,   requiredLean: 0,   leanWindow: 0,   gate: null, airtimeZone: false },
      { type: 'drop',     curveDirection: null,   requiredLean: 0,   leanWindow: 0,
        gate: { type: 'brake', timingWindow: { start: 0.4, end: 0.6 } }, airtimeZone: true },
      { type: 'loop',     curveDirection: null,   requiredLean: 0,   leanWindow: 0,   gate: null, airtimeZone: true },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.5, leanWindow: 0.35, gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.5, leanWindow: 0.35,
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: false },
      { type: 'straight', curveDirection: null,   requiredLean: 0,   leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.85, end: 1.0 } }, airtimeZone: false },
    ],
  },

  // ── 3단계: 도투락월드 — 외줄 타기 (스콜&하티 모티브, 싱글레일) ──────
  {
    id: 3,
    name: '도투락월드: 외줄 타기',
    motif: '경주월드 스콜&하티 — 아시아 최초 싱글레일, 좌우 밸런스가 핵심',
    baseSpeedKmh: 80,
    trackLengthM: 900,
    controlPoints: [
      { x: 0,   y: 18, z: 0 },
      { x: 0,   y: 18, z: 50 },
      { x: 6,   y: 14, z: 100 },
      { x: -6,  y: 10, z: 150 },
      { x: 6,   y: 8,  z: 200 },   // 좌우 연속 스윙 (싱글레일 특유의 불안정감)
      { x: -8,  y: 6,  z: 250 },
      { x: 8,   y: 5,  z: 300 },
      { x: 0,   y: 3,  z: 380 },
      { x: 0,   y: 0,  z: 450 },
    ],
    segments: [
      // 판정창(leanWindow)을 다른 스테이지보다 좁게 설정 — 싱글레일 컨셉 반영
      { type: 'straight', curveDirection: null,   requiredLean: 0,   leanWindow: 0,    gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.6, leanWindow: 0.2,  gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.6, leanWindow: 0.2,  gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.7, leanWindow: 0.15,
        gate: { type: 'boost', timingWindow: { start: 0.4, end: 0.5 } }, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.7, leanWindow: 0.15, gate: null, airtimeZone: false },
      { type: 'straight', curveDirection: null,   requiredLean: 0,   leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.85, end: 1.0 } }, airtimeZone: false },
    ],
  },

  // ── 4단계: 도투락월드 — 수직 강하 (드라켄 모티브, 90도 다이브) ─────
  {
    id: 4,
    name: '도투락월드: 수직 강하',
    motif: '경주월드 드라켄 — 90도 수직 다이브, 최고높이 70m, 최고속도 104km/h',
    baseSpeedKmh: 104,
    trackLengthM: 1000,
    controlPoints: [
      { x: 0,   y: 70, z: 0 },     // 최고높이 70m 리프트 힐 정상
      { x: 0,   y: 70, z: 20 },    // 정상에서 잠시 정지 (다이브 직전 긴장감 연출)
      { x: 0,   y: 40, z: 25 },    // 90도 수직 낙하 진입
      { x: 0,   y: 5,  z: 30 },    // 낙하 완료 지점 (거의 수직)
      { x: 10,  y: 4,  z: 90 },    // 낙하 직후 좌커브
      { x: -10, y: 5,  z: 160 },
      { x: 0,   y: 3,  z: 260 },
      { x: 0,   y: 0,  z: 350 },
    ],
    segments: [
      { type: 'straight', curveDirection: null,   requiredLean: 0,   leanWindow: 0,   gate: null, airtimeZone: false },
      // 핵심 기믹: 90도 낙하 직전 손들기(에어타임) 판정 — 각도가 클수록 판정창이 좁음
      { type: 'drop',      curveDirection: null,   requiredLean: 0,   leanWindow: 0,
        gate: { type: 'brake', timingWindow: { start: 0.55, end: 0.65 } },  // 판정창 좁음 (dropAngle=90 반영)
        dropAngle: 90, airtimeZone: true },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.5, leanWindow: 0.3, gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.5, leanWindow: 0.3,
        gate: { type: 'boost', timingWindow: { start: 0.4, end: 0.5 } }, airtimeZone: false },
      { type: 'straight', curveDirection: null,   requiredLean: 0,   leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.85, end: 1.0 } }, airtimeZone: false },
    ],
  },

  // ── 5단계(최종): 자연농원 (T익스프레스 모티브) ─────────────────────
  {
    id: 5,
    name: '자연농원',
    motif: '에버랜드 (구 자연농원) T익스프레스 — 77도 낙하, 4.5G, 12회 무중력, 1.6km, 하이브리드 목재+스틸',
    baseSpeedKmh: 104,
    trackLengthM: 1600,
    controlPoints: [
      { x: 0,  y: 56, z: 0 },      // 최고높이 56m
      { x: 0,  y: 56, z: 30 },
      { x: 5,  y: 10, z: 60 },     // 77도 급낙하
      { x: 15, y: 20, z: 120 },
      { x: 15, y: 8,  z: 180 },    // 에어타임 1
      { x: -5, y: 22, z: 260 },
      { x: -5, y: 6,  z: 340 },    // 에어타임 2
      { x: 10, y: 18, z: 420 },
      { x: 10, y: 5,  z: 500 },    // 에어타임 3
      { x: -12,y: 16, z: 600 },
      { x: -12,y: 4,  z: 700 },    // 에어타임 4
      { x: 0,  y: 12, z: 820 },
      { x: 0,  y: 3,  z: 950 },    // 에어타임 5 (이후 실제 구현 시 12개소까지 확장)
      { x: 8,  y: 6,  z: 1100 },
      { x: -8, y: 5,  z: 1250 },
      { x: 0,  y: 3,  z: 1400 },
      { x: 0,  y: 0,  z: 1600 },
    ],
    segments: [
      { type: 'straight', curveDirection: null,   requiredLean: 0,   leanWindow: 0,   gate: null, airtimeZone: false },
      { type: 'drop',     curveDirection: null,   requiredLean: 0,   leanWindow: 0,
        gate: { type: 'brake', timingWindow: { start: 0.5, end: 0.62 } }, dropAngle: 77, airtimeZone: true },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.6, leanWindow: 0.25,
        gate: { type: 'boost', timingWindow: { start: 0.4, end: 0.5 } }, airtimeZone: true },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.6, leanWindow: 0.25, gate: null, airtimeZone: true },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.6, leanWindow: 0.2,
        gate: { type: 'boost', timingWindow: { start: 0.4, end: 0.5 } }, airtimeZone: true },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.7, leanWindow: 0.2, gate: null, airtimeZone: true },
      { type: 'straight', curveDirection: null,   requiredLean: 0,   leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.9, end: 1.0 } }, airtimeZone: false },
    ],
  },
];

// 전역 노출 (모듈 번들러 없이 script 태그로 로드하는 구조 전제)
window.STAGES = STAGES;
