/**
 * legacy/old-title.js — 타이틀 새 디자인(2차 UI 개선 2번) 이전의 타이틀·메뉴 배경 마크업. 게임에서 로드하지 않음(기록용).
 * 새 구현: js/title.js, css/title.css. 옛 CSS는 legacy/old-title.css.
 */
const PILLAR_TOPS = [88, 50, 22, 28, 76, 108, 84, 56, 70, 90]; // 실루엣 곡선의 x=20,60,…,380 지점 높이
const MENU_BG = `
  <div class="menu-bg" aria-hidden="true">
    <div class="rays"></div>
    <div class="cloud" style="top:12%;width:70px;height:26px;animation-duration:46s;animation-delay:-8s"></div>
    <div class="cloud" style="top:24%;width:54px;height:20px;animation-duration:58s;animation-delay:-30s"></div>
    <div class="cloud" style="top:6%;width:44px;height:16px;animation-duration:70s;animation-delay:-50s"></div>
    <svg class="coaster" viewBox="0 0 400 140" preserveAspectRatio="none">
      <path d="M0 140 V96 C40 96 60 20 110 20 C160 20 170 110 220 110 C262 110 270 54 310 54 C350 54 360 92 400 92 V140 Z" fill="#141a33" opacity=".18"/>
      <g stroke="#141a33" stroke-width="3" opacity=".5">
        ${PILLAR_TOPS.map((y, i) => `<line x1="${20 + i * 40}" y1="140" x2="${20 + i * 40}" y2="${y}"/>`).join('')}
      </g>
      <path d="M0 92 C40 92 60 16 110 16 C160 16 170 106 220 106 C262 106 270 50 310 50 C350 50 360 88 400 88" fill="none" stroke="#141a33" stroke-width="7" stroke-linecap="round"/>
      <path d="M0 92 C40 92 60 16 110 16 C160 16 170 106 220 106 C262 106 270 50 310 50 C350 50 360 88 400 88" fill="none" stroke="#ffb80d" stroke-width="2.5" stroke-dasharray="6 6"/>
    </svg>
  </div>`;

const LOGO = (small = false) => `
  <div class="logo${small ? ' small' : ''}">
    <div class="logo-ko">${t('brand.stem')}<span class="bang">!</span><span class="bang">!</span><span class="bang">!</span></div>
    <div class="logo-en">RIDE IT</div>
  </div>`;


/* 옛 showTitle */
/*
  showTitle(onStart) {
    this._setScreen(`<div class="screen title-screen" id="titleScreen">${MENU_BG}${LOGO()}<div class="tap-hint">화면을 터치해서 시작</div><div class="studio">chaechae studio</div></div>`);
    document.getElementById('titleScreen').addEventListener('click', onStart, { once: true });
  },
*/
