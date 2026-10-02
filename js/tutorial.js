/**
 * tutorial.js — 튜토리얼(13번): "꼬마 열차 연습장"(stages.js TUTORIAL_STAGE)에서 조작을 하나씩 직접 해보며 익힘
 *
 * 단계(순서대로, 성공해야 다음): 1 출발 → 2 밸런스 → 3 부스트 → 4 동시 조작(밸런스 유지 + 부스트) → 5 뒤로 떨어지기(연타) → 6 피니쉬
 * - 설명 카드(게임을 멈추고 조작법을 설명하는 화면)는 튜토리얼에서만 띄움 — 일반 스테이지는 짧은 신호만
 * - 실패 없음: 성공할 때까지 카트가 천천히 가거나(cart.tScale 0.6) 그 자리에서 기다리고(0), 부스트를 놓치면 게이트 앞으로 되감고 힌트
 * - 안내 문구는 입력 환경 기준: 키보드(← → / ↑·Space), 기울기 옵션(폰 기울이기), 터치(◀ ▶ / BOOST)
 * - 강조: 해당 버튼/게이지 둘레에 깜빡이는 테두리 + 손가락 아이콘(화면 회전 시 매 틱 위치 갱신)
 * - 점수/랭크/기록은 저장하지 않음. 완료하면 rc_tutorial_done, 첫 실행 권유에 답하면 rc_tutorial_asked
 */

const TUT_STEPS = ['start', 'balance', 'boost', 'combo', 'rollback', 'finish'];
const TUT_SLOW = 0.6;      // 설명 뒤 연습 구간 진행 배율(슬로모션)
const TUT_CARD_LEAD = 1.1; // 이벤트 지점 이만큼(초) 앞에서 설명 카드

const FINGER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" stroke="#141a33" stroke-width="1.4" stroke-linejoin="round" d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10l.3-.1a1.5 1.5 0 0 1 2 .9 1.5 1.5 0 0 1 2.2.9 1.5 1.5 0 0 1 2.3 1.1V16a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.6-2.2L5 16.6a1.6 1.6 0 0 1 2.3-2.2L9 16z"/></svg>';

const Tutorial = {
  active: false,
  hold: false,      // 설명 카드가 떠 있는 동안 물리 정지(main.js가 확인)
  step: null,

  /** main.js loadTutorial()에서 스테이지·HUD·입력 준비가 끝난 직후 */
  begin(game) {
    this.end();
    this.active = true;
    this.game = game;
    this.cart = game.cart;
    this.track = game.track;
    this.cart.mashTimeout = Infinity; // 연타로 직접 올라갈 때까지 기다림(자동 도움 없음)
    this._segs = this.track.segmentRanges;
    this._gates = this.track.gateCenters();
    this._focusEls = [];
    this._listeners = [];
    this._on('cart-launched', () => { if (this.step === 'start') this._next(); });
    this._on('balance-judge', e => this._onBalance(e.detail));
    this._on('gate-result', e => this._onGate(e.detail));
    this._on('rollback', e => this._onRollback(e.detail.phase));
    this._on('resize', () => this._placeFocus());
    this._setStep('start');
  },

  end() {
    (this._listeners || []).forEach(([t, f]) => window.removeEventListener(t, f));
    this._listeners = [];
    this._clearFocus();
    document.querySelectorAll('.tut-card-overlay').forEach(el => el.remove());
    this.active = false;
    this.hold = false;
    this.step = null;
    if (this.game && this.game.input) this.game.input.blocked = false;
  },

  _on(type, fn) { window.addEventListener(type, fn); this._listeners.push([type, fn]); },

  /** 입력 환경: 'keyboard' | 'tilt' | 'touch' — 마지막으로 쓴 입력 우선, 아직 없으면 기기 특성 */
  kind() {
    const inp = this.game && this.game.input;
    if (inp && inp.mode === 'tilt') return 'tilt';
    const li = inp && inp.lastInputKind;
    if (li === 'keyboard') return 'keyboard';
    if (li === 'touch' || li === 'mouse') return 'touch';
    return window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches ? 'keyboard' : 'touch';
  },

  /** 단계별 안내 문구(입력 환경별) */
  _text(key) {
    const k = this.kind();
    const lean = { keyboard: '<b>← →</b> 키', tilt: '<b>폰을 좌우로 기울여</b>', touch: '왼쪽 아래 <b>◀ ▶</b>' }[k];
    const boost = k === 'keyboard' ? '<b>↑</b> 또는 <b>Space</b>' : '오른쪽 아래 <b>BOOST</b>';
    return {
      start: k === 'keyboard' ? '<b>↓</b>를 누르고 있다가 <b>↑</b>로 출발!' : '스타트 바를 <b>아래로 당겼다가 위로 휙</b> 밀어 올려요',
      balanceCard: `커브에선 ${lean}${k === 'tilt' ? '서' : '로'} <b>▼ 커서</b>를 <b>초록 띠</b> 안에 넣고 <b>1.5초</b> 버텨요. 파란 띠(Perfect)면 보너스!`,
      balanceBanner: '초록 띠 안에서 1.5초!',
      balanceHint: `커서(▼)를 초록 띠 안으로! ${lean}`,
      boostCard: `<b>바깥 원이 안쪽 원과 겹치는 순간</b> ${boost}!`,
      boostBanner: `원이 겹칠 때 ${boost}`,
      comboCard: `이번엔 동시에! 밸런스를 유지하면서 원이 겹칠 때 ${boost}.`,
      comboBanner: '밸런스 유지 + 부스트',
      rollbackCard: `언덕에서 <b>뒤로 미끄러져요!</b> ${boost}를 <b>빠르게 연타</b>하면 올라가요.`,
      rollbackBanner: `${boost} 연타!`,
      finishCard: '<b>피니쉬 아치</b>를 지나면 완주! 원이 겹칠 때 누르면 보너스 점수!',
      finishBanner: '아치를 통과하면 완주!',
    }[key];
  },

  _setStep(step) {
    this.step = step;
    const n = TUT_STEPS.indexOf(step) + 1;
    const title = { start: '출발', balance: '밸런스', boost: '부스트', combo: '동시 조작', rollback: '뒤로 떨어지기', finish: '피니쉬' }[step];
    this._stepLabel = `${n}/${TUT_STEPS.length} ${title}`;
    this._carded = false;
    this._waiting = false;
    this._hintAt = 0;
    this.cart.tScale = 1;
    if (step === 'start') {
      this.banner(this._text('start'));
      this.focus(['#startBar'], '#startBarHandle');
    } else {
      this.banner(null);
      this._clearFocus();
    }
  },

  _next() {
    const i = TUT_STEPS.indexOf(this.step);
    UI.flashSignal('좋아요!', 'perfect small');
    AudioManager.playLapChime(false);
    if (i + 1 < TUT_STEPS.length) this._setStep(TUT_STEPS[i + 1]);
  },

  /** 남은 거리(트랙 진행률 차)를 현재 속도로 걸리는 시간(초) */
  _secTo(t) {
    const c = this.cart;
    return (t - c.t) * this.track.lengthM / Math.max(0.5, c.speed * Cart.speedScale);
  },

  /** main.js 고정 스텝마다(물리 전) */
  tick() {
    if (!this.active || this.hold) return;
    const c = this.cart;
    this._placeFocus();
    if (!c.launched) return;
    const S = this._segs;
    if (this.step === 'balance') {
      const seg = S[1];
      if (!this._carded && this._secTo(seg.tStart) <= TUT_CARD_LEAD) {
        this._carded = true;
        this.card('밸런스 게이지 읽는 법', this._text('balanceCard'), UI.gaugeDiagram(), () => {
          c.tScale = TUT_SLOW;
          this.banner(this._text('balanceBanner'));
          this.focus(['#balGauge', this.kind() === 'touch' ? '.lean-btns' : null].filter(Boolean), this.kind() === 'touch' ? this._dirBtn(seg) : '#balGauge');
        });
      }
      // 구간 85%까지 못 채우면 그 자리에서 기다림(구간을 벗어나지 않으니 Miss 없음) + 힌트
      if (this._carded && c.t >= seg.tStart + (seg.tEnd - seg.tStart) * 0.85 && c.t < seg.tEnd) {
        if (!this._waiting) { this._waiting = true; c.tScale = 0; }
        this._hint(this._text('balanceHint'));
      }
    } else if (this.step === 'boost' || this.step === 'combo' || this.step === 'finish') {
      const gi = this.step === 'boost' ? 0 : this.step === 'combo' ? 1 : 2;
      const g = this._gates[gi];
      const cardAt = this.step === 'combo' ? S[3].tStart : g.t;
      const lead = this.step === 'combo' ? TUT_CARD_LEAD : 2.2;
      if (!this._carded && this._secTo(cardAt) <= lead) {
        this._carded = true;
        const [title, body, pic] = this.step === 'boost' ? ['부스트 타이밍', this._text('boostCard'), UI.popupDiagram()]
          : this.step === 'combo' ? ['동시 조작', this._text('comboCard'), null] : ['피니쉬', this._text('finishCard'), null];
        this.card(title, body, pic, () => {
          c.tScale = this.step === 'finish' ? 0.8 : TUT_SLOW;
          this.banner(this._text(`${this.step}Banner`));
          const boostSel = this.kind() === 'keyboard' ? null : '#boostBtn';
          const sels = this.step === 'combo' ? ['#balGauge', '#gatePop', boostSel] : ['#gatePop', boostSel];
          this.focus(sels.filter(Boolean), boostSel || '#gatePop');
        });
      }
      // 누르지 않고 지나침 → 되감기(피니쉬는 통과만 하면 되니 제외)
      if (this.step !== 'finish' && this._carded) {
        const key = `${c.currentLap}:${S[this.step === 'boost' ? 2 : 3].tStart}`;
        if (!c._resolvedGates.has(key) && this._secTo(g.t) < -GATE_ATTEMPT_RANGE - 0.05) this._retry(key, '원이 겹칠 때 눌러요 — 다시!');
      }
    } else if (this.step === 'rollback') {
      const rz = this.track.rollbackZone;
      const trig = rz.tValley + (rz.tPeak - rz.tValley) * ROLLBACK.triggerFrac;
      if (!this._carded && this._secTo(trig) <= TUT_CARD_LEAD) {
        this._carded = true;
        this.card('뒤로 떨어지기', this._text('rollbackCard'), null, () => { c.tScale = 1; this.banner('언덕을 올라가요…'); });
      }
      const rb = c.rollback;
      if (rb && rb.phase === 'mash') {
        if (!this._mashShown) { this._mashShown = true; this.banner(this._text('rollbackBanner')); this.focus([this.kind() === 'keyboard' ? '#rbGauge' : '#boostBtn'], this.kind() === 'keyboard' ? '#rbGauge' : '#boostBtn'); }
        if (rb.mashTime > 3 && rb.gauge < 0.4) this._hint('더 빠르게 연타!');
      }
    }
  },

  /** 커브 방향 버튼(◀/▶) — 손가락 아이콘 위치 */
  _dirBtn(seg) { return seg.curveDirection === 'left' ? '#leanLeftBtn' : '#leanRightBtn'; },

  _onBalance(result) {
    if (this.step !== 'balance' || !this._carded || result === 'miss') return;
    this.cart.tScale = 1;
    this._next();
  },

  _onGate({ type, result }) {
    if (!this.active || !result || result === 'none') return;
    if (this.step === 'boost' && type === 'boost') {
      if (result === 'miss') this._retry(this._lastKey(), this._timingHint());
      else this._next();
    } else if (this.step === 'combo' && type === 'boost') {
      const bs = this.cart.balanceState;
      if (result === 'miss') this._retry(this._lastKey(), this._timingHint());
      else if (!bs || !bs.inBand) this._retry(this._lastKey(), '밸런스(초록 띠)를 유지한 채로 BOOST!');
      else this._next();
    }
  },

  _onRollback(phase) {
    if (this.step === 'rollback' && (phase === 'success' || phase === 'done')) { this._mashShown = false; this._next(); }
  },

  _lastKey() { return this.cart.lastGateKey || null; },

  _timingHint() {
    const r = this.cart._gateResults[this.cart._gateResults.length - 1];
    return r && r.err < 0 ? '조금 빨랐어요 — 원이 겹칠 때 다시!' : '조금 늦었어요 — 원이 겹칠 때 다시!';
  },

  /** 게이트 앞으로 되감기 — 그 게이트 판정 기록을 지우고 다시 시도(튜토리얼은 점수 저장 없음) */
  _retry(key, hint) {
    const c = this.cart, S = this._segs;
    const seg = this.step === 'boost' ? S[2] : S[3];
    if (key) c._resolvedGates.delete(key);
    const g = this._gates[this.step === 'boost' ? 0 : 1];
    const back = this.step === 'combo' ? seg.tStart + 0.002 : g.t - 2.4 * Math.max(0.5, c.speed * Cart.speedScale * TUT_SLOW) / this.track.lengthM;
    c.t = Math.max(seg.tStart - 0.05, back);
    c._lastHeight = this.track.getHeightAt(c.t);
    c._curve = null; c.balanceState = null; c.boostRemaining = 0; c.boostAccel = 0;
    c.tScale = TUT_SLOW;
    this._hint(hint, true);
  },

  /** 짧은 힌트(게임을 멈추지 않음) — 같은 힌트는 2.5초에 한 번 */
  _hint(text, force) {
    const now = performance.now();
    if (!force && now - this._hintAt < 2500) return;
    this._hintAt = now;
    this.banner(text, true);
  },

  /** 단계 안내줄(HUD 위쪽) — null이면 숨김 */
  banner(html, hint = false) {
    const el = document.getElementById('tutBanner');
    if (!el) return;
    if (!html) { el.classList.remove('on'); return; }
    el.innerHTML = `<small>${this._stepLabel || ''}</small>${html}`;
    el.classList.toggle('hint', hint);
    el.classList.add('on');
    if (hint) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  },

  /** 설명 카드 — 게임을 멈추고(hold) 확인 버튼(또는 Enter/Space)으로 계속 */
  card(title, body, pic, onOk) {
    this.hold = true;
    if (this.game.input) this.game.input.blocked = true;
    this.banner(null);
    this._clearFocus();
    const el = document.createElement('div');
    el.className = 'screen modal-overlay tut-card-overlay';
    el.id = 'tutCard';
    el.innerHTML = `<div class="card tut-card"><div class="tut-step">${this._stepLabel}</div><h2>${title}</h2>${pic ? `<div class="tut-pic">${pic}</div>` : ''}<p>${body}</p>
      <div class="actions"><button class="btn primary wide" id="tutOkBtn">해볼게요!</button></div></div>`;
    (UI.root || document.body).appendChild(el);
    const ok = () => {
      window.removeEventListener('keydown', onKey);
      el.remove();
      this.hold = false;
      if (this.game.input) this.game.input.blocked = false;
      this.game.lastTime = performance.now(); this.game.accumulator = 0;
      onOk && onOk();
    };
    const onKey = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ok(); } };
    window.addEventListener('keydown', onKey);
    el.querySelector('#tutOkBtn').addEventListener('click', ok);
  },

  /** 강조: 대상들 둘레 깜빡이는 테두리 + finger 대상 위 손가락 아이콘 */
  focus(sels, fingerSel) {
    this._clearFocus();
    this._focus = { sels, fingerSel };
    sels.forEach(() => { const r = document.createElement('div'); r.className = 'tut-ring'; document.body.appendChild(r); this._focusEls.push(r); });
    if (fingerSel) { const f = document.createElement('div'); f.className = 'tut-finger'; f.innerHTML = FINGER_SVG; document.body.appendChild(f); this._finger = f; }
    this._placeFocus();
  },

  _placeFocus() {
    if (!this._focus) return;
    this._focus.sels.forEach((sel, i) => {
      const t = document.querySelector(sel), r = this._focusEls[i];
      if (!t || !r) return;
      const b = t.getBoundingClientRect();
      r.style.cssText = `left:${b.left - 6}px;top:${b.top - 6}px;width:${b.width + 12}px;height:${b.height + 12}px;display:${b.width ? 'block' : 'none'}`;
    });
    if (this._finger) {
      const t = document.querySelector(this._focus.fingerSel);
      if (t) { const b = t.getBoundingClientRect(); this._finger.style.left = `${b.left + b.width / 2 - 18}px`; this._finger.style.top = `${b.top + b.height * 0.55}px`; }
    }
  },

  _clearFocus() {
    (this._focusEls || []).forEach(el => el.remove());
    this._focusEls = [];
    if (this._finger) { this._finger.remove(); this._finger = null; }
    this._focus = null;
  },

  /** 완주 — 기록 저장 없이 "준비 완료!" */
  complete() {
    this.end();
    try { localStorage.setItem('rc_tutorial_done', '1'); localStorage.setItem('rc_tutorial_asked', '1'); } catch (e) { /* 무시 */ }
    UI.showTutorialDone();
  },

  /** 건너뛰기 — 기록 없이 스테이지 선택으로 */
  skip() {
    this.end();
    try { localStorage.setItem('rc_tutorial_asked', '1'); } catch (e) { /* 무시 */ }
    this.game.exitToStageSelect();
  },
};

window.Tutorial = Tutorial;
