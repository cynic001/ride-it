/**
 * legacy/lean-buttons-input.js — 균형 바(UI 개선 2차, 3번)로 교체되기 전의 ◀ ▶ 버튼 입력 코드 발췌. 게임에서 로드하지 않음(기록용).
 *  - 왼쪽 아래 ◀ ▶ 버튼을 누르는 동안 0.3초 램프로 ±1.0, 떼면 0.3초에 0 (키보드 ← →도 같은 램프)
 *  - 두 버튼을 동시에 누르면 나중에 누른 쪽 (_leanOrder), 손가락(pointerId)마다 버튼에 묶음
 *  현재 구현은 js/input.js의 균형 바 (손가락 위치 추종 22/초, 놓으면 0.3초 ease-out 복귀, 키보드 초당 1.2).
 */

/* ───── 바인딩 ───── */
    // 주행 버튼: ◀ ▶(누르고 있기) · BOOST(누르는 순간) — 손가락(pointerId)마다 따로
    const bindBtn = (id, name) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (this.state !== 'launched' || this.blocked) return;
        this.lastInputKind = e.pointerType === 'mouse' ? 'mouse' : 'touch';
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* iOS Safari 대응 */ }
        this._press(e.pointerId, name);
      }, opt);
      const up = e => this._release(e.pointerId, name);
      el.addEventListener('pointerup', up, opt);
      el.addEventListener('pointercancel', up, opt);
      el.addEventListener('lostpointercapture', up, opt);
      el.addEventListener('contextmenu', e => e.preventDefault(), opt);
    };
    bindBtn('leanLeftBtn', 'left');
    bindBtn('leanRightBtn', 'right');
    bindBtn('boostBtn', 'boost');

/* ───── press / release ───── */
  /** 버튼 누름 — pointerId별로 기억. BOOST는 누르는 순간 판정 */
  _press(pointerId, name) {
    this._btnPointers.set(pointerId, name);
    if (name === 'boost') this._boost();
    else { this._leanOrder = this._leanOrder.filter(id => id !== pointerId); this._leanOrder.push(pointerId); }
    this._syncPressed();
  }

  /** 버튼 뗌 — 그 손가락(pointerId)만. name을 주면 그 버튼에 묶인 손가락일 때만 */
  _release(pointerId, name) {
    const cur = this._btnPointers.get(pointerId);
    if (!cur || (name && cur !== name)) return;
    this._btnPointers.delete(pointerId);
    this._leanOrder = this._leanOrder.filter(id => id !== pointerId);
    this._syncPressed();
  }


/* ───── _syncPressed / _btnLean ───── */
  /** 눌린 버튼 표시 + 현재 ◀▶ 방향 */
  _syncPressed() {
    const held = new Set(this._btnPointers.values());
    for (const [id, name] of [['leanLeftBtn', 'left'], ['leanRightBtn', 'right'], ['boostBtn', 'boost']]) {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('pressed', held.has(name));
    }
  }

  get _btnLean() {
    const last = this._leanOrder[this._leanOrder.length - 1];
    const name = last === undefined ? null : this._btnPointers.get(last);
    return name === 'left' ? -1 : name === 'right' ? 1 : 0;
  }


/* ───── update ───── */
  /** main.js 고정 스텝마다(cart.update 전) — 버튼/키보드/기울기를 leanInput으로 합성 */
  update(dt) {
    if (this.state !== 'launched') return;
    const keyLean = (this._keys.has('ArrowRight') ? 1 : 0) - (this._keys.has('ArrowLeft') ? 1 : 0);
    const held = keyLean || this._btnLean;
    if (this.mode === 'tilt' && !held) {
      this._updateTilt();
      if (this.mode === 'tilt') { // 기울기: 지수 추종(거의 즉시)
        this.cart.leanInput += (this._leanTarget - this.cart.leanInput) * (1 - Math.exp(-dt * this._leanRate));
        return;
      }
    }
    // 버튼/키: 일정 속도(1/LEAN_RAMP_SEC)로 선형 램프 — 누르면 0.3초에 1.0, 떼면 0.3초에 0
    const goal = held || 0;
    const stepAmt = dt / LEAN_RAMP_SEC;
    const cur = this.cart.leanInput;
    this.cart.leanInput = goal > cur ? Math.min(goal, cur + stepAmt) : Math.max(goal, cur - stepAmt);
  }

