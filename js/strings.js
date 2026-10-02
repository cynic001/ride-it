/**
 * strings.js — 모든 UI 문구를 키-문구로 한 곳에서 관리. 화면 코드는 t('키', { 값 })로만 불러온다.
 *  - 설정값에서 나오는 숫자(유지 시간·바퀴 수·하트 수 등)는 문구에 직접 쓰지 말고 {이름}으로 받아 코드 값을 넣을 것
 *    (유지 시간은 스테이지마다 다름: 3단계 1.2초, 5단계 0.9초 …)
 *  - 용어는 docs/용어집.md를 따른다(게이트→가속 지점, 밸런스→균형 잡기, 이탈→탈선, 턴→커브, 랩→바퀴, 피니쉬→결승선).
 *  - 글꼴 서브셋(tools/make-fonts.py)이 이 파일의 글자를 수집하므로, 문구를 바꾸면 한 번 다시 돌릴 것.
 */
const STRINGS = {
  // ── 공통 ──
  'common.ok': '알겠어요',
  'common.close': '닫기',
  'common.retry': '다시 도전',
  'common.stageSelect': '스테이지 선택',
  'common.on': '켜짐',
  'common.off': '꺼짐',

  // ── 설정 ──
  'settings.title': '설정',
  'settings.graphics': '그래픽',
  'settings.view': '시점',
  'settings.view.third': '3인칭',
  'settings.view.first': '1인칭',
  'settings.view.thirdDesc': '짜릿한 순간에만 잠깐 1인칭이 돼요',
  'settings.view.firstDesc': '계속 카트에 탄 시점으로 봐요',
  'settings.sound': '소리',
  'settings.soundDesc': '안 들리면 폰의 무음 모드를 꺼 주세요',
  'settings.control': '균형 조작',
  'control.twohand': '바 끌기',
  'control.tilt': '기울기',
  'control.twohandDesc': '왼쪽 아래 바를 손가락으로 끌어요',
  'control.tiltDesc': '폰을 좌우로 기울여요',
  'tutorial.ok': '해 볼게요!',
  'settings.derail': '탈선',
  'settings.derailDesc': '커브를 놓치면 레일 밖으로 나가요',
  'settings.howto': '조작법',
  'settings.credits': '크레딧',
  'settings.tutorial': '튜토리얼 다시 하기',

  // ── 그래픽 ──
  'graphics.title': '그래픽',
  'graphics.quality': '화질',
  'graphics.style': '화면 스타일',
  'graphics.quality.low': '낮음',
  'graphics.quality.medium': '보통',
  'graphics.quality.high': '높음',
  'graphics.quality.lowDesc': '오래된 폰에 좋아요. 그림자와 흐림 효과를 꺼요.',
  'graphics.quality.mediumDesc': '대부분의 폰에 알맞아요. 가벼운 효과가 있어요.',
  'graphics.quality.highDesc': '가장 화려해요. 그림자와 빠른 느낌 효과가 있어요.',
  'graphics.style.day': '카툰 낮',
  'graphics.style.toon': '카툰 노을',
  'graphics.style.pastel': '파스텔',
  'graphics.style.standard': '사실적',
  'graphics.style.dayDesc': '맑은 하늘과 구름, 밝고 산뜻한 낮이에요.',
  'graphics.style.toonDesc': '굵은 윤곽선과 노을빛. 빠를 때 모양이 또렷해요.',
  'graphics.style.pastelDesc': '부드럽고 따뜻한 파스텔 색이에요.',
  'graphics.style.standardDesc': '실제 같은 조명과 하늘이에요.',

  // ── 조작법 ──
  'howto.title': '조작법',
  'howto.launch': '출발',
  'howto.launchText': '스타트 바를 아래로 당겼다가 위로 확 밀어요. 많이 당기고 빠르게 밀수록 세게 나가요.',
  'howto.launchKeys': '키보드는 ↓를 누르고 있다가 ↑를 눌러요.',
  'howto.balance': '균형 잡기',
  'howto.balanceText': '커브에서는 왼쪽 아래 바를 끌어요. 노브를 초록 띠 안에 {hold}초 동안 두면 성공이에요.',
  'howto.balanceKeys': '키보드는 ← →, 기울기 설정이면 폰을 기울여요.',
  'howto.balancePerfect': '파란 띠 안에 있으면 PERFECT(완벽)!',
  'howto.boost': '부스트',
  'howto.boostText': '오른쪽 아래 BOOST 버튼 둘레의 링이 줄어들어요. 링이 버튼에 닿는 순간 누르면 PERFECT(완벽)!',
  'howto.boostKeys': '키보드는 ↑ 또는 스페이스예요.',
  'howto.rollback': '뒤로 미끄러짐',
  'howto.rollbackText': '언덕에서 카트가 뒤로 미끄러져요. 부스터가 밀어 주거나 BOOST를 마구 눌러 올라가요.',
  'howto.view': '시점 바꾸기',
  'howto.viewText': '오른쪽 눈 모양 버튼을 누르면 잠깐 시점이 바뀌어요. (키보드: C)',
  'howto.derail': '탈선',
  'howto.derailText': '커브를 놓치면 탈선해요. 하트가 하나 줄고, {hearts}번 놓치면 실패예요.',
  'howto.floor': '바닥 표시',
  'howto.floorBoost': '부스트',
  'howto.floorCurve': '커브',
  'howto.floorDrop': '내리막·물',
  'howto.floorBack': '뒤로 미끄러짐({lap}바퀴부터)',
  'howto.judge': '판정',
  'howto.judgeText': 'PERFECT(완벽) · GOOD(좋음) · MISS(아쉬움) 순서로 점수가 높아요.',
  'howto.tutorialTip': '처음이라면 스테이지 선택 맨 위의 튜토리얼부터 해 봐요.',

  // ── 크레딧 ──
  'credits.title': '크레딧',
  'credits.game': '떨어진다!!! RIDE IT',
  'credits.studio': 'chaechae studio',
  'credits.tester': '테스터',
  'credits.model': '3D 모델',
  'credits.modelText': 'Coaster Kit · Nature Kit — Kenney.nl (CC0)',
  'credits.sky': '하늘 이미지',
  'credits.skyText': 'Kloofendal 43d Clear (Pure Sky) — Greg Zaal, Poly Haven (CC0)',
  'credits.sfx': '효과음',
  'credits.sfxText': '환호 "Cheers", "OoOoOo" — Nocturnal_Vanguard / 물소리 — rubberduck (OpenGameArt.org, CC0) / 음성 — Kenney.nl (CC0). 나머지 소리와 음악은 직접 합성했어요.',
  'credits.font': '글꼴',
  'credits.fontText': 'Noto Sans KR · Jua — SIL Open Font License 1.1',
  'credits.engine': '엔진',

  // ── 그림 설명 ──
  'diagram.target': '목표',
  'diagram.knob': '내 노브',

  // ── 주행 중 ──
  'hud.balanceBar': '균형 바',
  'hud.curveLeft': '◀ 왼쪽 커브',
  'hud.curveRight': '오른쪽 커브 ▶',
  'hud.fallbackBar': '바를 끌어 주세요',

  // ── 일시정지·불러오기·실패·튜토리얼 안내 ──
  'pause.title': '잠깐 쉬어가요',
  'pause.stage': '{name}',
  'pause.resume': '계속하기',
  'loading.text': '코스터를 준비하고 있어요…',
  'loadError.title': '불러오지 못했어요',
  'loadError.text': '네트워크를 확인하고 다시 해 봐요.',
  'loadError.retry': '다시 시도',
  'fail.title': '아쉬워요, 실패!',
  'fail.text': '탈선을 {hearts}번 해서 멈췄어요.',
  'tutAsk.title': '환영해요!',
  'tutAsk.heading': '튜토리얼부터 해 볼까요?',
  'tutAsk.text': '꼬마 열차 연습장에서 출발, 균형 잡기, 부스트를 하나씩 해 봐요. 1분이면 끝나요.',
  'tutAsk.yes': '해 볼래요',
  'tutAsk.no': '건너뛰기',
  'tutDone.title': '준비 완료!',
  'tutDone.text': '출발, 균형 잡기, 부스트, 연타, 결승선까지 모두 해냈어요.',
  'tutDone.go': '1단계 출발',
  'update.toast': '새 버전이 있어요 · 눌러서 새로고침',
};

/** 문구 가져오기 — {이름} 자리를 값으로 바꿈. 키가 없으면 키 그대로 보여 줘서 빠뜨린 걸 바로 알 수 있게 함 */
function t(key, vars) {
  let s = STRINGS[key];
  if (s === undefined) { console.warn('[strings] 없는 키:', key); return key; }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return s;
}
window.STRINGS = STRINGS;
window.t = t;
