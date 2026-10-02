/**
 * ui-kit.js — 개발 전용 UI 키트(`index.html?ui-kit`). 모든 컴포넌트를 기본/눌림/선택/비활성/포커스 상태로 한 화면에 나열.
 * 스크린샷과 대비 검사(.claude/skills/run-ride-it/contrast-check.mjs)의 기준 — data-kit(그룹)/data-state(상태) 속성을 검사가 읽음.
 * 서비스 워커가 캐시하지 않고(sw.js), 게임 본체는 시작하지 않음.
 */
(() => {
  const root = document.getElementById('uiRoot');
  const I = typeof ICONS !== 'undefined' ? ICONS : {};
  const row = (title, items) => `<section class="kit-sec"><h3>${title}</h3><div class="kit-row">${items.join('')}</div></section>`;
  const cell = (group, state, html, label) => `<div class="kit-cell" data-kit="${group}" data-state="${state}">${html}<small>${label || state}</small></div>`;
  const sw = (on, extra = '', cls = '') => `<button class="switch ${cls}" role="switch" aria-checked="${on}" ${extra}><span class="sw-text on">켜짐</span><span class="sw-text off">꺼짐</span><span class="sw-knob"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 7"/></svg></span></button>`;
  const seg = (sel, dis = -1) => `<div class="seg" role="radiogroup">${['3인칭', '1인칭', '자유'].map((t, i) => `<button class="seg-btn${i === sel ? ' on' : ''}" role="radio" aria-checked="${i === sel}"${i === dis ? ' disabled' : ''}>${t}</button>`).join('')}</div>`;
  const heart = off => `<svg class="heart-ico${off ? ' off' : ''}" viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.6A5.2 5.2 0 0 1 12 7.7a5.2 5.2 0 0 1 9.5 3.7C19.5 16.4 12 21 12 21z" stroke-linejoin="round"/></svg>`;
  root.innerHTML = `
  <style>
    .kit { position: fixed; inset: 0; overflow: auto; background: var(--nm-bg); color: var(--ink); padding: var(--s-3) var(--s-2); pointer-events: auto; }
    .kit h1 { font-size: 24px; margin-bottom: var(--s-2); } .kit h3 { font-size: 16px; color: var(--ink-2); margin: var(--s-2) 0 var(--s-1); }
    .kit-row { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: flex-start; }
    .kit-cell { display: flex; flex-direction: column; gap: var(--s-1); align-items: flex-start; } .kit-cell small { font-size: 14px; color: var(--ink-2); }
    .kit-scene { background: linear-gradient(180deg, var(--sky-top), var(--sky-bottom) 55%, #6fbf4a 55%); padding: var(--s-2); border-radius: var(--r-md); display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
    .kit-scene .kit-cell small { color: var(--on-accent); background: var(--nm-bg); padding: 0 var(--s-1); border-radius: var(--r-pill); }
  </style>
  <div class="kit" id="uiKit">
    <h1>UI 키트 <small style="font-size:14px;color:var(--ink-2)">뉴모픽 · 기본/눌림/선택/비활성/포커스</small></h1>
    ${row('버튼', [
      cell('button', 'default', '<button class="btn">기본 버튼</button>'),
      cell('button', 'primary', '<button class="btn primary">주요 버튼</button>'),
      cell('button', 'pressed', '<button class="btn pressed">눌림</button>'),
      cell('button', 'disabled', '<button class="btn" disabled>비활성</button>', 'disabled (점선·회색 글자)'),
      cell('button', 'focus', '<button class="btn force-focus">포커스</button>', 'focus (노랑+남색 링)'),
    ])}
    ${row('아이콘 버튼', [
      cell('icon-btn', 'default', `<button class="icon-btn" aria-label="설정">${I.gear || ''}</button>`),
      cell('icon-btn', 'selected', `<button class="icon-btn on" aria-label="선택됨" data-kit-icon>${I.sparkle || ''}</button>`, 'selected (채움)'),
      cell('icon-btn', 'pressed', `<button class="icon-btn pressed" aria-label="눌림">${I.help || ''}</button>`),
      cell('icon-btn', 'disabled', `<button class="icon-btn" disabled aria-label="비활성">${I.info || ''}</button>`),
    ])}
    ${row('토글 스위치 (홈 + 노브, 켜짐 글자 병행)', [
      cell('switch', 'off', sw(false)), cell('switch', 'on', sw(true)), cell('switch', 'disabled', sw(false, 'disabled')), cell('switch', 'focus', sw(true, '', 'force-focus')),
    ])}
    ${row('세그먼트 (선택 칩 raised + 굵은 글자 + 노란 점)', [
      cell('seg', 'first', seg(0), '첫째 선택'), cell('seg', 'second', seg(1), '둘째 선택'), cell('seg', 'disabled', seg(0, 2), '셋째 비활성'),
    ])}
    ${row('진행도 트랙 (inset)', [
      cell('value-meter', '30', '<div class="meter" style="width:160px"><i style="width:30%"></i></div>', '30%'), cell('value-meter', '100', '<div class="meter" style="width:160px"><i style="width:100%"></i></div>', '100%'),
    ])}
    ${row('칩', [
      cell('chip', 'default', '<span class="chip">기본 14px</span>'), cell('chip', 'ok', '<span class="chip ok">✓ 완료</span>', 'ok (✓ 병행)'),
      cell('chip', 'warn', '<span class="chip warn">! 주의</span>', 'warn (! 병행)'), cell('chip', 'accent', '<span class="chip accent">NEW</span>'),
      cell('badge', 'clear', '<span class="badge clear">최고 3,200</span>', '배지(홈 위)'), cell('badge', 'rank', '<span class="badge rank-badge">A</span>'), cell('badge', 'plain', '<span class="badge">NEW</span>'),
    ])}
    ${row('카드 · 스테이지 버튼 · 홈 필드', [
      cell('card', 'raised', '<div class="card" style="width:200px"><h2>카드</h2><p>raised-lg 면 위의 본문 글자입니다.</p></div>'),
      cell('stage', 'default', '<button class="stage-btn" style="width:240px"><span class="stage-num">1</span><span class="stage-info"><span class="stage-name">우방타워랜드</span><span class="stage-meta">45km/h</span></span><span class="stage-side"><span class="badge rank-badge">A</span></span></button>'),
      cell('stage', 'pressed', '<button class="stage-btn pressed-kit" style="width:240px;transform:scale(.97)"><span class="stage-num">2</span><span class="stage-info"><span class="stage-name">도투락월드</span><span class="stage-meta">72km/h</span></span><span class="stage-side"><span class="badge">NEW</span></span></button>'),
      cell('field', 'inset', '<div class="stat" style="width:160px"><small>최고 점수</small><b>3,200</b></div>'),
    ])}
    <section class="kit-sec"><h3>HUD 칩 변형 (불투명 크림 + 흰 테두리 + 아래 그림자, 3D 장면 위)</h3>
      <div class="kit-scene">
        ${cell('hud', 'lap', '<span class="hud-chip lap-chip"><b>바퀴 1/3</b><small>커브 2/6</small></span>')}
        ${cell('hud', 'speed', '<span class="hud-chip speed-chip"><i class="max-tag">MAX</i><span class="num">112</span><small>km/h</small></span>')}
        ${cell('hud', 'speed-max', '<span class="hud-chip speed-chip capped"><i class="max-tag">MAX</i><span class="num">156</span><small>km/h</small></span>', 'capped (MAX 글자 병행)')}
        ${cell('hud', 'combo', '<span class="hud-chip accent combo-chip"><small>콤보</small><b>12</b><small class="mult">×1.1</small></span>')}
        ${cell('hud', 'hearts', `<span class="hud-chip hud-hearts">${heart(false)}${heart(false)}${heart(true)}</span>`, '하트 2/3 (빈 하트는 점선)')}
        ${cell('hud-btn', 'default', `<button class="hud-btn" aria-label="일시정지">${I.pause || ''}</button>`)}
        ${cell('hud-btn', 'pressed', `<button class="hud-btn pressed" aria-label="눌림">${I.pause || ''}</button>`)}
        ${cell('hud-btn', 'disabled', `<button class="hud-btn" disabled aria-label="비활성">${I.pause || ''}</button>`)}
      </div></section>
    ${row('팝업 패널 (모양 예시 — 실제 팝업은 UI.popup)', [
      cell('popup', 'sample', `<div class="popup" style="width:min(88vw,420px);animation:none"><div class="popup-head"><span class="popup-title">팝업 제목</span></div><div class="popup-body"><div class="popup-block"><p>본문 16px, 줄 간격 1.5, 단어 중간에서 줄바꿈하지 않아요.</p></div></div><div class="popup-foot"><span class="spacer"></span><span class="popup-dots"><i class="on"></i><i></i><i></i></span><button class="btn primary">다음</button></div></div>`),
    ])}
  </div>`;
})();
