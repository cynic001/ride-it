/**
 * legacy/onehand-pad.js — 사용 중지된 "한손 엄지 패드" 조작(2026-10-01, 조작 개편 13번에서 양손 조작으로 통일)
 * 삭제하지 않고 보관만 함 — 게임에서 로드하지 않음(index.html/sw.js 목록에 없음).
 * 원래 위치: js/input.js InputController의 메서드, js/ui.js _driveControlsHTML의 패드 DOM, index.html의 패드 CSS.
 * 동작: 하단 가로 전체 패드 — 좌우로 밀기 = 밸런스(PAD_FULL_LEAN_PX 비례), 톡(TAP_MAX_SECONDS 미만) = 부스트, 꾹 = 손 들기
 * 상수: TAP_MAX_SECONDS = 0.12, TAP_MAX_MOVE = 14, PAD_FULL_LEAN_PX = 90
 */

// ── js/input.js (InputController 메서드) ──
class LegacyPadInput { // 원래 InputController 메서드(this = InputController)
  _onPadDown(e) {
    if (this.state !== 'launched') return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* iOS Safari 대응 */ }
    // 탭 판정은 손가락이 닿은 순간 기준 — 떼는 순간(최대 0.12초 뒤)이 아니라 지금의 게이트 타이밍을 저장해 둠
    const p = { x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, hold: false, gate: this.cart.gateTiming() };
    p.timer = setTimeout(() => { p.hold = true; this._syncHold(); }, TAP_MAX_SECONDS * 1000);
    this._pointers.set(e.pointerId, p);
    this._leanPointer = e.pointerId;
    window.dispatchEvent(new CustomEvent('pad-touch', { detail: { x: e.clientX, y: e.clientY, down: true } }));
  }

  _onPadMove(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x0;
    if (Math.abs(dx) > TAP_MAX_MOVE || Math.abs(e.clientY - p.y0) > TAP_MAX_MOVE) p.moved = true;
    if (this.mode === 'onehand' && e.pointerId === this._leanPointer) {
      this._leanTarget = Math.max(-1, Math.min(1, dx / PAD_FULL_LEAN_PX));
      this._leanRate = LEAN_FOLLOW.direct;
    }
    window.dispatchEvent(new CustomEvent('pad-touch', { detail: { x: e.clientX, y: e.clientY, down: true } }));
  }

  _onPadUp(e, cancelled = false) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    clearTimeout(p.timer);
    this._pointers.delete(e.pointerId);
    const dur = (performance.now() - p.t0) / 1000;
    if (!cancelled && !p.moved && dur < TAP_MAX_SECONDS) this._boost(p.gate);
    if (e.pointerId === this._leanPointer) {
      this._leanPointer = null;
      if (this.mode === 'onehand') this._leanTarget = 0; // 떼면 중립 복귀
    }
    this._syncHold();
    if (!this._pointers.size) window.dispatchEvent(new CustomEvent('pad-touch', { detail: { down: false } }));
  }

  _syncHold() {
    const padHold = [...this._pointers.values()].some(p => p.hold);
    this.cart.airtimeHolding = padHold || this._handsBtn || this._keys.has(' ');
  }


}

// ── js/ui.js _driveControlsHTML (onehand/tilt 분기) ──
/*
    const hint = mode === 'tilt' ? '폰 기울이기 = 밸런스 · 톡 = 부스트 · 꾹 = 손 들기' : '← 밀기 = 밸런스 → · 톡 = 부스트 · 꾹 = 손 들기';
    return `<div class="drive-controls" id="driveControls">
      <div class="thumb-pad" id="thumbPad">
        <div class="pad-lean"><div class="pad-lean-mark" id="padLeanMark"></div></div>
        <div class="pad-hint">${hint}</div>
        ${keys}
        <div class="pad-thumb" id="padThumb"></div>
      </div>
    </div>`;
  },


*/

// ── index.html CSS ──
/*
  /\* 한손/기울기: 가로 전체 엄지 패드 — 왼손/오른손 어느 쪽으로 잡아도 닿도록 *\/
  .thumb-pad {
    position: relative; height: 150px; border-radius: 26px; touch-action: none; overflow: hidden;
    background: linear-gradient(180deg, rgba(20,26,51,.18), rgba(20,26,51,.42)); border: 2px solid rgba(255,255,255,.55);
  }
  .pad-lean { position: absolute; left: 18px; right: 18px; top: 16px; height: 8px; border-radius: 999px; background: rgba(255,255,255,.35); }
  .pad-lean::before { content: ''; position: absolute; left: 50%; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: rgba(255,255,255,.8); }
  .pad-lean-mark { position: absolute; top: -5px; left: 50%; width: 18px; height: 18px; margin-left: -9px; border-radius: 50%; background: var(--yellow); box-shadow: 0 0 0 2px var(--navy); }
  .pad-hint { position: absolute; left: 0; right: 0; bottom: 14px; text-align: center; font-size: 13px; color: #fff; opacity: .9; -webkit-text-stroke: 3px var(--navy); paint-order: stroke fill; }
  .thumb-pad .key-hint { position: absolute; left: 0; right: 0; bottom: 36px; text-align: center; }
  .pad-thumb {
    position: absolute; left: 0; top: 0; width: 60px; height: 60px; border-radius: 50%; pointer-events: none;
    background: radial-gradient(circle, rgba(255,184,13,.9) 0 30%, rgba(255,184,13,.25) 31% 100%); border: 3px solid #fff;
    opacity: 0; transition: opacity .12s ease;
  }
  .pad-thumb.on { opacity: 1; }

*/
