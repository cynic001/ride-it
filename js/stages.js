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
 * segment.gate: { type: 'boost'|'finish', timingWindow: {start, end} } | null — 브레이크 게이트는 없앰(버튼 하나에 기능 하나)
 *   timingWindow는 이제 "게이트 위치"만 정함 — 판정 기준점 = 세그먼트 내 (start+end)/2 지점. 판정 자체는 실제 시간(초)
 *   기준으로 stage.gateTiming의 ±perfect/±good 초 이내인지로 결정(cart.js resolveGate) — 속도가 바뀌어도 난이도 일정
 * rollback: { cp, mode: 'auto'|'mash' } | 없음 — 뒤로 떨어지기 구간(언덕 꼭대기 제어점). 이 구간 안의 게이트는 판정/만점에서 제외
 * gateTiming: { perfect, good } (초) — 스테이지가 올라갈수록 조금씩 엄격하게
 *   부스트 게이트는 전부 {0.45, 0.55}(세그먼트 중앙) — 커브 시작 직후(10~15% 지점)에 있던 게이트는 게임 속도 1.7배에서
 *   커브 진입과 0.3초 차이로 겹쳐 반응할 수 없었음(최소 간격 0.6초 기준). 중앙이면 앞뒤로 0.6초 이상 확보.
 *   피니쉬 게이트는 전부 timingWindow {0.6, 0.8}(중심 0.7) — 예전 값(중심 0.925~0.95)은 트랙 끝까지 0.1초 남짓이라
 *   늦게 누를 여유가 없어 시간 기준 판정에서 늦은 탭이 전부 Miss가 됐음
 * segment.airtimeZone: boolean (해당 구간에서 손들기 입력 시 에어타임 보너스)
 *
 * railType: 'mouse' | 'hanging' | 'monorail' | 'steel' | 'wood' — Kenney Coaster Kit(CC0)의 트랙 패밀리.
 *   track.js가 assets/vendor/kenney-coaster-kit/coaster-<type>-track.glb(1m 반복 타일)를 커브를 따라
 *   인스턴싱 배치하고, 같은 패밀리에 맞는 카트(train)를 고른다 — 매핑은 track.js의 KIT_FAMILIES 참고.
 *
 * 주의: Babylon Curve3.CreateCatmullRomSpline(closed:true)의 첫 점은 controlPoints[1]이다 — 즉 t=0(출발점)은
 *   두 번째 제어점이고, controlPoints[0]→[1] 구간은 트랙 맨 끝(스테이션 진입부)이 된다. 세그먼트/게이트 튜닝은
 *   전부 이 기준으로 되어 있으므로 바꾸지 말 것. 스테이션 타일은 이 진입부(출발점 뒤쪽)에 깔린다.
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
    railType: 'mouse',
    baseSpeedKmh: 45,
    gateTiming: { perfect: 0.10, good: 0.20 }, // 게이트 판정창(초, ±)
    trackLengthM: 480,
    // 폐곡선(스타디움형 오벌) — 좌측으로 나갔다가 원거리 턴을 돌아 우측으로 돌아옴. 5개 스테이지 중 가장 완만한 기복.
    // 뒤로 떨어지기(6번): cp = 언덕 꼭대기 제어점 인덱스(골짜기는 cp-1). auto = 뒤로 미끄러진 뒤 부스터가 자동 발사(입문)
    rollback: { cp: 9, mode: 'auto' },
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
      { x: 27,  y: 22,  z: 110 },  // 복귀 구간 언덕 → (6번: 7→22) 부메랑 언덕 — 여기서 멈칫 후 뒤로 미끄러짐(rollback)
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
        // 복귀 구간 마지막 오르막 진입부 — 실측 시뮬레이션(perfect 밸런스+기존 boost 전부 활용)에서도
        // 이 구간 진입 직후 속도가 MIN_SPEED까지 떨어져 정체(약 38초)하는 것을 확인해 boost 추가
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: false },
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.6, end: 0.8 } }, airtimeZone: false },
    ],
  },

  // ── 2단계: 도투락월드 — 급류의 계곡 (파에톤 모티브, 인버티드 루프) ──
  {
    id: 2,
    name: '도투락월드: 급류의 계곡',
    motif: '경주월드 파에톤 — 인버티드, 최고속도 72km/h, 길이 1148m, 360도 루프',
    railType: 'hanging',
    baseSpeedKmh: 72,
    gateTiming: { perfect: 0.095, good: 0.19 }, // 게이트 판정창(초, ±)
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
        // 원래 brake였으나, 실측 시뮬레이션 결과 급하강 직후 인버티드 루프 정점(y30, 낙하지점 대비
        // +22m)까지 오를 에너지가 애초에 부족해 루프 진입부터 정체가 시작됨을 확인 — 루프 진입 직전
        // 부스터(체인모터 대신 순간 가속) 역할로 교체, timingWindow도 구간 초반으로 당겨 아직 속도가
        // 남아있는 시점에 boost가 걸리도록 함
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: true },
      { type: 'loop',     curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        // 루프 정점(y30)까지는 boost 1회로도 여전히 부족(실측: 약 7m 부족)해 두 번째 boost 추가
        // — 루프 하나에 연속 boost 2회는 실제 코스터의 체인/LSM 부스터 다중 구간과 유사한 연출
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: true },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.45, leanWindow: 0.35,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.4,  leanWindow: 0.35,
        gate: null, airtimeZone: true },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.5,  leanWindow: 0.3,
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.5,  leanWindow: 0.3,
        gate: null, airtimeZone: false },
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.6, end: 0.8 } }, airtimeZone: false },
    ],
  },

  // ── 3단계: 도투락월드 — 외줄 타기 (스콜&하티 모티브, 싱글레일) ──────
  {
    id: 3,
    name: '도투락월드: 외줄 타기',
    motif: '경주월드 스콜&하티 — 아시아 최초 싱글레일, 좌우 밸런스가 핵심',
    railType: 'monorail',
    baseSpeedKmh: 80,
    gateTiming: { perfect: 0.09, good: 0.18 }, // 게이트 판정창(초, ±)
    trackLengthM: 960, // (6-1: 제어점 수평 좌표 ×1.3 — 게임 속도 1.7배에서 완주 15초 미만이 되지 않도록, 높이는 그대로)
    // 폐곡선 — 좌우 연속 스윙(싱글레일 특유의 불안정감)을 원거리 턴 전후로 촘촘하게 배치, 스테이지2보다 커브 밀도 상승.
    // 물 착수(7번): cp = 수면 위를 스치는 골짜기 제어점, level 1~3 = 물보라 연출 단계(단계가 오를수록 화려하게)
    splash: { cp: 2, level: 1 },
    controlPoints: [
      { x: 0,   y: 18, z: 0 },     // 출발(스테이션)
      { x: 15.6, y: 16, z: 45.5 },    // ← 실제 출발점(t=0): Babylon 폐곡선 CatmullRom은 두 번째 제어점에서 시작
      { x: -18.2, y: 1.2, z: 97.5 },    // (7번: 10→1.2 물 착수 — 출발 직후 첫 하강으로 호수에 첨벙) B점검: 13→10 — 복귀 구간이 머리 위 3m로 지나가 3인칭 카메라가 레일을 뚫던 교차(t≈0.03) 수직 간격 확보
      { x: 20.8, y: 10, z: 149.5 },
      { x: -23.4, y: 8,  z: 201.5 },
      { x: 26,  y: 4,  z: 253.5 },   // B점검: 6→4 — 원거리 턴 앞 교차(t≈0.31↔0.49) 수직 2.4m → 확보
      { x: -15.6, y: 4,  z: 292.5 },   // 원거리 턴 진입 (7→4)
      { x: 0,   y: 9,  z: 318.5 },   // 원거리 턴 정점
      // 복귀 구간(스윙 시작~근거리 턴 직전)이 출발 구간과 거울대칭(X좌표 부호만 반대, 나머지
      // 동일)이라 출발 구간이 X=0을 지나는 지점과 복귀 구간이 X=0을 지나는 지점이 같은 Z대에서
      // 만나 레일이 서로 뚫고 지나가는 교차가 4곳 발생함을 실측(진행률 t 기준 0.026↔0.772,
      // 0.1↔0.7, 0.165↔0.635, 0.306↔0.494 지점에서 3D 거리 0.07~0.35m, 스크린샷으로 레일 X자
      // 교차 확인). X좌표만 옮기는 시도는 출발/복귀 모두 Z대가 겹치고 폭도 비슷해 다른 지점에서
      // 교차가 재발함(실측으로 확인) — 대신 복귀 구간 중간(스윙 시작~근거리 턴 직전 사이)을 8~9m
      // 더 높게 띄워(양 끝 idx는 인접 구간과의 연결을 위해 원래 높이 유지) 같은 X/Z를 지나더라도
      // 높이가 확실히 갈리도록 함 — 실제 코스터의 교차 구간(위/아래로 스쳐 지나가는 연출)과 동일한
      // 방식. X좌표는 원래 거울대칭 값 그대로 유지.
      { x: 18.2, y: 10, z: 292.5 },   // (B점검: 6→10)
      { x: -23.4, y: 15, z: 253.5 },   // 복귀 구간 스윙 시작 (+8)
      { x: 20.8, y: 17, z: 201.5 },   // (+9)
      { x: -18.2, y: 19, z: 149.5 },   // (+9)
      { x: 23.4, y: 23, z: 97.5 },    // (+8, B점검: 21→23)
      { x: -13, y: 24, z: 45.5 },    // (B점검: 16→24 — 출발 직후 구간 위로 충분히 높게 지나가도록)
      { x: 2.6, y: 18, z: 13 },    // 근거리 턴 — 스테이션 복귀 직전
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
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.72, leanWindow: 0.13,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.75, leanWindow: 0.12,
        // 원거리 턴 이탈 후 복귀 스윙 진입부 — 실측 시뮬레이션에서 이 구간 진입 직후 정체(약 116초)
        // 확인, boost 추가
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: false },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.7,  leanWindow: 0.14,
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: false },
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.6, end: 0.8 } }, airtimeZone: false },
    ],
  },

  // ── 4단계: 도투락월드 — 수직 강하 (드라켄 모티브, 90도 다이브) ─────
  {
    id: 4,
    name: '도투락월드: 수직 강하',
    motif: '경주월드 드라켄 — 90도 수직 다이브, 최고높이 70m, 최고속도 104km/h',
    railType: 'steel',
    baseSpeedKmh: 104,
    gateTiming: { perfect: 0.08, good: 0.17 }, // 게이트 판정창(초, ±)
    trackLengthM: 1080, // (6-1: 제어점 수평 좌표 ×1.3, 높이 유지)
    // 폐곡선 — 출발 직후 90도 다이브(핵심 기믹)를 그대로 유지, 이후 언덕/커브를 촘촘히 배치하고
    // 마지막 구간에서 스테이션 높이(70m)까지 다시 상승해 복귀(귀환 리프트 연출).
    // mash = 뒤로 미끄러진 뒤 부스트 연타로 다시 올라가야 함(6초 안에 못 올라가면 부스터가 자동으로 올려줌)
    rollback: { cp: 7, mode: 'mash' },
    // 물 착수(7번): cp = 수면 위를 스치는 골짜기 제어점, level 1~3 = 물보라 연출 단계(단계가 오를수록 화려하게)
    splash: { cp: 3, level: 2 },
    controlPoints: [
      { x: 0,   y: 70, z: 0 },     // 최고높이 70m 리프트 힐 정상(스테이션)
      { x: 0,   y: 70, z: 23.4 },    // 정상에서 잠시 정지 (다이브 직전 긴장감 연출)
      { x: 0,   y: 42, z: 31.2 },    // 90도 수직 낙하 진입
      { x: 0,   y: 3.6, z: 39 },    // 낙하 완료 지점 (거의 수직) — (7번: 5→3.6, 수직 다이브 곡선이 2.4m 처져 실제 최저점이 수면 위 약 1m)
      { x: 20.8, y: 4,  z: 97.5 },    // 낙하 직후 좌커브
      { x: -23.4, y: 6,  z: 156 },
      { x: 18.2, y: 3,  z: 208 },   // 저고도 두번째 딥
      { x: -20.8, y: 22, z: 253.5 },   // 두번째 언덕(다이나믹 상승)
      { x: -28.6, y: 5,  z: 305.5 },   // 다시 급하강
      { x: -13, y: 7,  z: 364 },
      { x: -18.2, y: 6,  z: 416 },   // 원거리 턴 진입 (B점검: 8→-14, 복귀가 출발 구간을 X자로 가로지르던 교차 제거)
      { x: 0,   y: 10, z: 448.5 },   // 원거리 턴 정점
      { x: 18.2, y: 8,  z: 416 },   // (B점검: -10→14)
      // 귀환 리프트(X=0) 원래 설계는 출발 직후 낙하 구간(0,70,0→0,42,24, 역시 X=0)과 완전히 같은
      // 수직면 위를 지나 실측 결과 t=0.013↔0.911 지점(약 y66, z20)에서 3D 거리 0.2m로 레일이 서로
      // 뚫고 지나가는 게 확인됨(스크린샷 확인) — 낙하 구간은 스테이션 바로 아래 고정 기믹이라 못
      // 옮기므로, 귀환 리프트를 옆으로 비켜 세워 별도 기둥으로 분리(실제 코스터의 리프트/브레이크런
      // 병렬 배치와 동일한 방식). 높이(y)/Z는 그대로 둬서 낙하량 기반 물리·게이트 타이밍 보존.
      { x: 26,  y: 16, z: 338 },   // 복귀 구간 — 귀환 리프트 시작
      { x: 28.6, y: 38, z: 208 },   // 복귀 구간 중간 상승
      { x: 28.6, y: 58, z: 91 },    // 스테이션 높이 근접
      // B점검: 원래 (12,58,65)에서 곧장 스테이션(z=0)으로 들어와 다시 +z로 출발하는 180도 헤어핀이라 t=0에
      // 커브가 꺾인 첨점(cusp)이 생겨 스테이션 타일이 낙하 경사면에 계단식으로 깔렸음 — 스테이션 뒤쪽(z<0)으로
      // 크게 돌아 +z 방향으로 진입하도록 제어점 2개 추가
      { x: 20.8, y: 66, z: -6.5 },
      { x: 7.8, y: 70, z: -39 },
    ],
    segments: [
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: null, airtimeZone: false },
      // 핵심 기믹: 90도 낙하 직전 손들기(에어타임) 판정 — 각도가 클수록 판정창이 좁음
      { type: 'drop',      curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } },  // (5번 개편: 브레이크 → 부스트 통일, 급하강 가속)
        dropAngle: 90, airtimeZone: true },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.5,  leanWindow: 0.3,
        gate: null, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.55, leanWindow: 0.28,
        gate: null, airtimeZone: true },
      { type: 'curve',    curveDirection: 'left',  requiredLean: 0.55, leanWindow: 0.25,
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: false },
      { type: 'curve',    curveDirection: 'right', requiredLean: 0.6,  leanWindow: 0.25,
        // 귀환 리프트 진입부 — 스테이션 높이(70m)까지 복귀 상승 중 가장 큰 순수 오르막(약 28m)이
        // 남아있는 지점, 실측 시뮬레이션에서 정체(약 80초) 확인해 boost 추가(구간 초반, 아직 속도가
        // 남아있을 때 걸리도록)
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: false },
      { type: 'straight', curveDirection: null,   requiredLean: 0,    leanWindow: 0,
        gate: { type: 'finish', timingWindow: { start: 0.6, end: 0.8 } }, airtimeZone: false },
    ],
  },

  // ── 5단계(최종): 자연농원 (T익스프레스 모티브) ─────────────────────
  {
    id: 5,
    name: '자연농원',
    motif: '에버랜드 (구 자연농원) T익스프레스 — 77도 낙하, 4.5G, 12회 무중력, 1.6km, 하이브리드 목재+스틸',
    railType: 'wood',
    baseSpeedKmh: 104,
    gateTiming: { perfect: 0.07, good: 0.16 }, // 게이트 판정창(초, ±)
    trackLengthM: 1680,
    // 폐곡선 — 5개 스테이지 중 가장 다이나믹: 77도 급낙하 이후 무중력 힐을 최대한 촘촘히 연속 배치하고,
    // 원거리 턴을 돈 뒤 복귀 구간에서 다시 스테이션 높이(56m)까지 상승.
    // 에어타임 힐 10개소(오프닝 드롭 크레스트 포함 시 11회 무중력 체감) — controlPoints 28개를 균등 2개씩
    // 묶어 segments 14개로 재설계(아래 segments 배열 주석 참고). 12회(T익스프레스 원본) 대비 부족분은
    // 현재 트랙 길이(1680m)·턴 밀도에서 힐 간격을 더 좁히면 부자연스러워지는 한계선 — 더 늘리려면
    // 트랙 길이 자체를 늘리거나 복귀 구간을 재설계해야 함(다음 큰 설계 변경 후보로 개발기록에 남김).
    // 물 착수(7번): cp = 수면 위를 스치는 골짜기 제어점, level 1~3 = 물보라 연출 단계(단계가 오를수록 화려하게)
    splash: { cp: 2, level: 3 },
    controlPoints: [
      { x: 0,   y: 56, z: 0 },     // 최고높이 56m(스테이션)
      { x: 0,   y: 56, z: 25 },    // 리프트 정상 — 여기서 바로 급낙하 시작 (진짜 77도 드롭 크레스트)
      { x: 6,   y: 1.9, z: 55 },    // 77도 급낙하 바닥 — (7번: 10→1.9 거대한 물기둥 착수, 곡선 처짐 감안)
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
      { x: 16,  y: 10, z: 682 },   // 원거리 턴 정점 (B점검: 복귀 레인을 +32 옆으로 옮기며 턴 반경 확대)
      { x: 48,   y: 15, z: 640 },   // B점검: 복귀 힐 구간 전체 x+32 — 출발 힐과 같은 Z대에서 XZ가 겹쳐 수직 1.9~2.7m로 스쳐 카트가 윗레일에 닿던 교차 3곳 제거(높이는 그대로 → 에너지 프로필 유지)
      { x: 42,   y: 4,  z: 580 },   // 복귀 구간 시작
      { x: 24,   y: 17, z: 530 },   // 에어타임 8
      { x: 24,   y: 5,  z: 480 },
      { x: 42,   y: 16, z: 420 },   // 에어타임 9
      { x: 42,   y: 5,  z: 380 },
      { x: 22,  y: 15, z: 340 },   // 에어타임 10
      { x: 38,    y: 10, z: 300 },   // 힐 구간 종료 → 전환
      // 복귀 상승(X=0)이 원래 오프닝 드롭 크레스트(0,56,25 / 0,56,0, 역시 X=0)와 같은 수직면이라
      // 실측 결과 t=0.002↔0.927 지점(y54 근방)에서 3D 거리 0.56m로 레일 교차(스크린샷의 스테이션
      // 카트 바로 옆 X자 교차) 확인 — 스테이지3(수직강하)과 동일한 원인/동일한 해법으로 복귀 상승만
      // 옆 기둥으로 분리. 높이(y)/Z는 그대로 둬서 낙하량 기반 물리·게이트 타이밍 보존.
      { x: 30,  y: 20, z: 180 },   // 복귀 상승 시작
      { x: 24,  y: 40, z: 90 },
      { x: 22,  y: 52, z: 20 },    // 스테이션 높이 근접
      // B점검: 4단계와 같은 180도 헤어핀 첨점 — 스테이션 뒤쪽으로 돌아 +z로 진입
      { x: 12,  y: 55, z: -25 },
      { x: 3,   y: 56, z: -35 },
    ],
    // controlPoints 28개 ÷ 2개씩 = segments 14개(균등분할, track.js의 t=i/segCount 방식과 궁합이
    // 맞도록 정확히 나눠떨어지게 설계). 실측(getHeightAt 스캔)으로 각 세그먼트가 실제로 어느
    // 힐/구간을 담당하는지 검증 완료 — 개발기록.md 참고.
    segments: [
      { type: 'drop',      curveDirection: null,   requiredLean: 0,    leanWindow: 0,           // CP1~2: 진짜 77도 급낙하
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, dropAngle: 77, airtimeZone: true }, // (브레이크 → 부스트 통일)
      { type: 'curve',     curveDirection: 'right', requiredLean: 0.6,  leanWindow: 0.24,        // 에어타임1
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.62, leanWindow: 0.23,        // 에어타임2
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: true },
      { type: 'curve',     curveDirection: 'right', requiredLean: 0.65, leanWindow: 0.22,        // 에어타임3
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.68, leanWindow: 0.21,        // 에어타임4
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'right', requiredLean: 0.7,  leanWindow: 0.2,         // 에어타임5
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: true },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.72, leanWindow: 0.19,        // 에어타임6
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.75, leanWindow: 0.18,        // 에어타임7 + 원거리 턴 진입
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'right', requiredLean: 0.6,  leanWindow: 0.22,        // 턴 이탈 → 복귀 구간 전환(크레스트 없음)
        gate: null, airtimeZone: false },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.7,  leanWindow: 0.2,         // 에어타임8
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: true },
      { type: 'curve',     curveDirection: 'right', requiredLean: 0.72, leanWindow: 0.19,        // 에어타임9
        gate: null, airtimeZone: true },
      { type: 'curve',     curveDirection: 'left',  requiredLean: 0.75, leanWindow: 0.18,        // 에어타임10
        gate: null, airtimeZone: true },
      { type: 'straight',  curveDirection: null,   requiredLean: 0,    leanWindow: 0,            // 복귀 상승(크레스트 없음)
        // 스테이션 높이(56m)까지 복귀하는 마지막 순수 오르막(약 35m, 5스테이지 전체에서 가장 큼) —
        // 실측 시뮬레이션에서 정체(약 104초) 확인해 boost 추가(구간 초반)
        gate: { type: 'boost', timingWindow: { start: 0.45, end: 0.55 } }, airtimeZone: false },
      { type: 'straight',  curveDirection: null,   requiredLean: 0,    leanWindow: 0,            // 스테이션 복귀 + 피니쉬
        gate: { type: 'finish', timingWindow: { start: 0.6, end: 0.8 } }, airtimeZone: false },
    ],
  },
];

// 전역 노출 (모듈 번들러 없이 script 태그로 로드하는 구조 전제)
window.STAGES = STAGES;
