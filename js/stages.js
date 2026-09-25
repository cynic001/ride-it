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
 *
 * railType: 'standard' | 'single' | 'hybrid' — track.js가 assets/models/rail_<type>.glb를 커브를 따라 인스턴싱 배치.
 *   지지대는 railType==='hybrid'면 pillar_wood.glb, 그 외엔 pillar_steel.glb 사용 (motif의 실제 소재 반영).
 *
 * 모든 스테이지는 폐곡선(마지막 제어점이 첫 제어점과 가까운 위치·진행방향)으로 설계 — track.js가
 * Curve3.CreateCatmullRomSpline을 closed:true로 생성해 이음매 없이 순환.
 */

const STAGES = [
  // ── 1단계: 우방타워랜드 (이월드 과거명) — 튜토리얼 ──────────────
  {
    id: 1,
    name: '우방타워랜드',
    motif: '이월드 (구 우방타워랜드) — 입문용 완만한 트랙',
    railType: 'standard',
    baseSpeedKmh: 45,
    trackLengthM: 480,
    // 폐곡선(스타디움형 오벌) — 좌측으로 나갔다가 원거리 턴을 돌아 우측으로 돌아옴. 5개 스테이지 중 가장 완만한 기복.
    controlPoints: [
      { x: 0,   y: 10,  z: 0 },    // 출발(스테이션)
      { x: -10, y: 9,   z: 30 },
      { x: -24, y: 7,   z: 70 },   // 완만한 첫 내리막
      { x: -27, y: 8.5, z: 110 },  // 완만한 언덕(첫 에어타임 힐)
      { x: -25, y: 5,   z: 150 },
      { x: -15, y: 5.5, z: 180 },  // 원거리 턴 진입
      { x: 0,   y: 6,   z: 205 },  // 원거리 턴 정점
      { x: 15,  y: 5.5, z: 180 },  // 원거리 턴 이탈 → 복귀 구간 시작
      { x: 25,  y: 5,   z: 150 },
      { x: 27,  y: 7,   z: 110 },  // 복귀 구간 언덕
      { x: 24,  y: 4,   z: 70 },   // 복귀 구간 낮은 지점
      { x: 12,  y: 6,   z: 35 },
      { x: 4,   y: 9,   z: 10 },   // 근거리 턴 — 스테이션 복귀 직전
    ],
    segments: [
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.3,  leanWindow: 0.45,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.25, leanWindow: 0.45,
        gate: null, airtimeZone: true },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.35, leanWindow: 0.4,
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.3,  leanWindow: 0.45,
        gate: null, airtimeZone: false },
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.85, end: 1.0 } }, airtimeZone: false },
    ],
  },

  // ── 2단계: 도투락월드 — 급류의 계곡 (파에톤 모티브, 인버티드 루프) ──
  {
    id: 2,
    name: '도투락월드: 급류의 계곡',
    motif: '경주월드 파에톤 — 인버티드, 최고속도 72km/h, 길이 1148m, 360도 루프',
    railType: 'standard',
    baseSpeedKmh: 72,
    trackLengthM: 1180,
    // 폐곡선 — 출발 직후 인버티드 루프, 이후 원거리 턴을 돌아 복귀. 스테이지1보다 기복/커브 밀도 상승.
    controlPoints: [
      { x: 0,   y: 15, z: 0 },     // 출발(스테이션)
      { x: -12, y: 14, z: 45 },
      { x: -25, y: 8,  z: 95 },    // 첫 급하강
      { x: -30, y: 16, z: 140 },   // 루프 진입 (상승)
      { x: -30, y: 30, z: 165 },   // 루프 정점
      { x: -30, y: 14, z: 190 },   // 루프 이탈
      { x: -25, y: 10, z: 235 },   // 루프 직후 좌커브
      { x: -28, y: 16, z: 290 },   // 두번째 언덕(에어타임)
      { x: -22, y: 6,  z: 340 },
      { x: -10, y: 7,  z: 385 },   // 원거리 턴 진입
      { x: 0,   y: 9,  z: 410 },   // 원거리 턴 정점
      { x: 14,  y: 7,  z: 385 },
      { x: 24,  y: 6,  z: 340 },   // 복귀 구간 저점
      { x: 30,  y: 15, z: 290 },   // 복귀 구간 언덕
      { x: 27,  y: 9,  z: 235 },
      { x: 18,  y: 5,  z: 190 },
      { x: 8,   y: 7,  z: 120 },
      { x: 2,   y: 12, z: 45 },    // 근거리 턴 — 스테이션 복귀 직전
    ],
    segments: [
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: null, airtimeZone: false },
      { type: 'drop',     curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: { type: 'brake', timingWindow: { start: 0.4, end: 0.5 } }, airtimeZone: true },
      { type: 'loop',     curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: null, airtimeZone: true },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.45, leanWindow: 0.35,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.4,  leanWindow: 0.35,
        gate: null, airtimeZone: true },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.5,  leanWindow: 0.3,
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.5,  leanWindow: 0.3,
        gate: null, airtimeZone: false },
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.85, end: 1.0 } }, airtimeZone: false },
    ],
  },

  // ── 3단계: 도투락월드 — 외줄 타기 (스콜&하티 모티브, 싱글레일) ──────
  {
    id: 3,
    name: '도투락월드: 외줄 타기',
    motif: '경주월드 스콜&하티 — 아시아 최초 싱글레일, 좌우 밸런스가 핵심',
    railType: 'single',
    baseSpeedKmh: 80,
    trackLengthM: 960,
    // 폐곡선 — 좌우 연속 스윙(싱글레일 특유의 불안정감)을 원거리 턴 전후로 촘촘하게 배치, 스테이지2보다 커브 밀도 상승.
    controlPoints: [
      { x: 0,   y: 18, z: 0 },     // 출발(스테이션)
      { x: 12,  y: 16, z: 35 },
      { x: -14, y: 13, z: 75 },
      { x: 16,  y: 10, z: 115 },
      { x: -18, y: 8,  z: 155 },
      { x: 20,  y: 6,  z: 195 },
      { x: -12, y: 7,  z: 225 },   // 원거리 턴 진입
      { x: 0,   y: 9,  z: 245 },   // 원거리 턴 정점
      { x: 14,  y: 6,  z: 225 },
      { x: -18, y: 7,  z: 195 },   // 복귀 구간 스윙 시작
      { x: 16,  y: 8,  z: 155 },
      { x: -14, y: 10, z: 115 },
      { x: 18,  y: 13, z: 75 },
      { x: -10, y: 16, z: 35 },
      { x: 2,   y: 18, z: 10 },    // 근거리 턴 — 스테이션 복귀 직전
    ],
    segments: [
      // 판정창(leanWindow)을 다른 스테이지보다 좁게 설정 — 싱글레일 컨셉 반영
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.6,  leanWindow: 0.18,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.65, leanWindow: 0.16,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.7,  leanWindow: 0.14,
        gate: { type: 'boost', timingWindow: { start: 0.35, end: 0.45 } }, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.72, leanWindow: 0.13,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.75, leanWindow: 0.12,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.7,  leanWindow: 0.14,
        gate: { type: 'boost', timingWindow: { start: 0.6, end: 0.7 } }, airtimeZone: false },
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.85, end: 1.0 } }, airtimeZone: false },
    ],
  },

  // ── 4단계: 도투락월드 — 수직 강하 (드라켄 모티브, 90도 다이브) ─────
  {
    id: 4,
    name: '도투락월드: 수직 강하',
    motif: '경주월드 드라켄 — 90도 수직 다이브, 최고높이 70m, 최고속도 104km/h',
    railType: 'standard',
    baseSpeedKmh: 104,
    trackLengthM: 1080,
    // 폐곡선 — 출발 직후 90도 다이브(핵심 기믹)를 그대로 유지, 이후 언덕/커브를 촘촘히 배치하고
    // 마지막 구간에서 스테이션 높이(70m)까지 다시 상승해 복귀(귀환 리프트 연출).
    controlPoints: [
      { x: 0,   y: 70, z: 0 },     // 최고높이 70m 리프트 힐 정상(스테이션)
      { x: 0,   y: 70, z: 18 },    // 정상에서 잠시 정지 (다이브 직전 긴장감 연출)
      { x: 0,   y: 42, z: 24 },    // 90도 수직 낙하 진입
      { x: 0,   y: 5,  z: 30 },    // 낙하 완료 지점 (거의 수직)
      { x: 16,  y: 4,  z: 75 },    // 낙하 직후 좌커브
      { x: -18, y: 6,  z: 120 },
      { x: 14,  y: 3,  z: 160 },   // 저고도 두번째 딥
      { x: -16, y: 22, z: 195 },   // 두번째 언덕(다이나믹 상승)
      { x: -22, y: 5,  z: 235 },   // 다시 급하강
      { x: -10, y: 7,  z: 280 },
      { x: 8,   y: 6,  z: 320 },   // 원거리 턴 진입
      { x: 0,   y: 10, z: 345 },   // 원거리 턴 정점
      { x: -10, y: 8,  z: 320 },
      { x: 0,   y: 16, z: 260 },   // 복귀 구간 — 귀환 리프트 시작
      { x: 0,   y: 38, z: 160 },   // 복귀 구간 중간 상승
      { x: 0,   y: 58, z: 65 },    // 스테이션 높이 근접
    ],
    segments: [
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: null, airtimeZone: false },
      // 핵심 기믹: 90도 낙하 직전 손들기(에어타임) 판정 — 각도가 클수록 판정창이 좁음
      { type: 'drop',      curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: { type: 'brake', timingWindow: { start: 0.55, end: 0.65 } },  // 판정창 좁음 (dropAngle=90 반영)
        dropAngle: 90, airtimeZone: true },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.5,  leanWindow: 0.3,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.55, leanWindow: 0.28,
        gate: null, airtimeZone: true },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.55, leanWindow: 0.25,
        gate: { type: 'boost', timingWindow: { start: 0.4, end: 0.5 } }, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.6,  leanWindow: 0.25,
        gate: null, airtimeZone: false },
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.88, end: 1.0 } }, airtimeZone: false },
    ],
  },

  // ── 5단계(최종): 자연농원 (T익스프레스 모티브) ─────────────────────
  {
    id: 5,
    name: '자연농원',
    motif: '에버랜드 (구 자연농원) T익스프레스 — 77도 낙하, 4.5G, 12회 무중력, 1.6km, 하이브리드 목재+스틸',
    railType: 'hybrid',
    baseSpeedKmh: 104,
    trackLengthM: 1680,
    // 폐곡선 — 5개 스테이지 중 가장 다이나믹: 77도 급낙하 이후 무중력 힐을 최대한 촘촘히 연속 배치하고,
    // 원거리 턴을 돈 뒤 복귀 구간에서 다시 스테이션 높이(56m)까지 상승.
    // 에어타임 힐 10개소(오프닝 드롭 크레스트 포함 시 11회 무중력 체감) — controlPoints 28개를 균등 2개씩
    // 묶어 segments 14개로 재설계(아래 segments 배열 주석 참고). 12회(T익스프레스 원본) 대비 부족분은
    // 현재 트랙 길이(1680m)·턴 밀도에서 힐 간격을 더 좁히면 부자연스러워지는 한계선 — 더 늘리려면
    // 트랙 길이 자체를 늘리거나 복귀 구간을 재설계해야 함(다음 큰 설계 변경 후보로 개발기록에 남김).
    controlPoints: [
      { x: 0,   y: 56, z: 0 },     // 최고높이 56m(스테이션)
      { x: 0,   y: 56, z: 25 },    // 리프트 정상 — 여기서 바로 급낙하 시작 (진짜 77도 드롭 크레스트)
      { x: 6,   y: 10, z: 55 },    // 77도 급낙하 바닥
      { x: 16,  y: 24, z: 110 },   // 에어타임 1
      { x: 16,  y: 6,  z: 154 },
      { x: -8,  y: 25, z: 198 },   // 에어타임 2
      { x: -8,  y: 5,  z: 243 },
      { x: 12,  y: 22, z: 287 },   // 에어타임 3
      { x: 12,  y: 5,  z: 331 },
      { x: -14, y: 20, z: 375 },   // 에어타임 4
      { x: -14, y: 4,  z: 419 },
      { x: 10,  y: 19, z: 463 },   // 에어타임 5
      { x: 10,  y: 4,  z: 507 },
      { x: -12, y: 17, z: 552 },   // 에어타임 6
      { x: -12, y: 4,  z: 596 },
      { x: -16, y: 16, z: 640 },   // 에어타임 7 + 원거리 턴 진입
      { x: 0,   y: 10, z: 670 },   // 원거리 턴 정점
      { x: 16,  y: 15, z: 640 },
      { x: 10,  y: 4,  z: 580 },   // 복귀 구간 시작
      { x: -8,  y: 17, z: 530 },   // 에어타임 8
      { x: -8,  y: 5,  z: 480 },
      { x: 10,  y: 16, z: 420 },   // 에어타임 9
      { x: 10,  y: 5,  z: 380 },
      { x: -10, y: 15, z: 340 },   // 에어타임 10
      { x: 6,   y: 10, z: 300 },   // 힐 구간 종료 → 전환
      { x: 0,   y: 20, z: 180 },   // 복귀 상승 시작
      { x: 0,   y: 40, z: 90 },
      { x: 0,   y: 54, z: 25 },    // 스테이션 높이 근접
    ],
    // controlPoints 28개 ÷ 2개씩 = segments 14개(균등분할, track.js의 t=i/segCount 방식과 궁합이
    // 맞도록 정확히 나눠떨어지게 설계). 실측(getHeightAt 스캔)으로 각 세그먼트가 실제로 어느
    // 힐/구간을 담당하는지 검증 완료 — 개발기록.md 참고.
    segments: [
      { type: 'drop',      curveDirection: null,   requiredLean: 0,    leanWindow: 0,           // CP1~2: 진짜 77도 급낙하
        gate: { type: 'brake', timingWindow: { start: 0.5, end: 0.6 } }, dropAngle: 77, airtimeZone: true },
      { type: 'curve',     curveDirection: 'right', requiredLean: 0.6,  leanWindow: 0.24,        // 에어타임1
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.62, leanWindow: 0.23,        // 에어타임2
        gate: { type: 'boost', timingWindow: { start: 0.4, end: 0.5 } }, airtimeZone: true },
      { type: 'curve',     curveDirection: 'right', requiredLean: 0.65, leanWindow: 0.22,        // 에어타임3
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.68, leanWindow: 0.21,        // 에어타임4
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'right', requiredLean: 0.7,  leanWindow: 0.2,         // 에어타임5
        gate: { type: 'boost', timingWindow: { start: 0.4, end: 0.5 } }, airtimeZone: true },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.72, leanWindow: 0.19,        // 에어타임6
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.75, leanWindow: 0.18,        // 에어타임7 + 원거리 턴 진입
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'right', requiredLean: 0.6,  leanWindow: 0.22,        // 턴 이탈 → 복귀 구간 전환(크레스트 없음)
        gate: null, airtimeZone: false },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.7,  leanWindow: 0.2,         // 에어타임8
        gate: { type: 'boost', timingWindow: { start: 0.4, end: 0.5 } }, airtimeZone: true },
      { type: 'curve',     curveDirection: 'right', requiredLean: 0.72, leanWindow: 0.19,        // 에어타임9
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.75, leanWindow: 0.18,        // 에어타임10
        gate: null, airtimeZone: true },
      { type: 'straight',  curveDirection: null,   requiredLean: 0,    leanWindow: 0,            // 복귀 상승(크레스트 없음)
        gate: null, airtimeZone: false },
      { type: 'straight',  curveDirection: null,   requiredLean: 0,    leanWindow: 0,            // 스테이션 복귀 + 피니쉬
        gate: { type: 'finish', timingWindow: { start: 0.9, end: 1.0 } }, airtimeZone: false },
    ],
  },
];

// 전역 노출 (모듈 번들러 없이 script 태그로 로드하는 구조 전제)
window.STAGES = STAGES;
