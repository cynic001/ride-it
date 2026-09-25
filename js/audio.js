/**
 * audio.js
 * Web Audio API 순수 합성 기반 사운드 시스템 — 외부 오디오 라이브러리/샘플 없음
 * (기존 chaechae 게임들과 동일한 방식: OscillatorNode/BufferSource로 즉석 합성)
 *
 * iOS Safari 등 자동재생 제한 대응: AudioContext는 반드시 첫 사용자 제스처(pointerdown)
 * 안에서 생성/resume — main.js가 window 최상위 pointerdown(capture, once)에서 unlock() 호출.
 */
const AudioManager = {
  ctx: null,
  masterGain: null,
  enabled: localStorage.getItem('rc_audio') !== 'off', // 기본값 켜짐

  _windSource: null,
  _windFilter: null,
  _windGain: null,
  _airtimeGain: null,
  _airtimeActive: false,

  /** 첫 사용자 제스처에서 호출 — AudioContext 생성 + 지속음(바람/에어타임) 그래프 준비 */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return; // 미지원 브라우저는 조용히 무시(사운드 없이 정상 진행)
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.enabled ? 1 : 0;
      this.masterGain.connect(this.ctx.destination);
      this._initWind();
      this._initAirtimeTone();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  /** 스테이지 선택 화면의 사운드 토글 버튼 — QualityManager.setPreset과 동일한 저장 패턴 */
  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem('rc_audio', on ? 'on' : 'off');
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  },

  _ready() {
    return !!this.ctx && this.ctx.state === 'running';
  },

  /** 짧은 효과음 공통 헬퍼 — 오실레이터 1개 + 선형 어택/릴리즈 게인 엔벨로프 */
  _blip({ freq, freqEnd = null, duration = 0.15, type = 'sine', peak = 0.2 }) {
    if (!this._ready()) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.linearRampToValueAtTime(freqEnd, t0 + duration);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.01);
    gain.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  },

  // ── 1) 스타트 flick 발사음 — 당김 강도/릴리스 속도에 비례한 피치·볼륨 ──────
  playLaunch(pullStrength, flickMultiplier) {
    const freq = 140 + pullStrength * 260;
    const peak = 0.15 + Math.min(1, flickMultiplier / 1.6) * 0.15;
    this._blip({ freq, freqEnd: freq * 1.8, duration: 0.35, type: 'sawtooth', peak });
  },

  // ── 2) 주행 중 바람 소리 — 필터링된 화이트노이즈, 속도에 비례해 밝기/볼륨 갱신 ──
  _initWind() {
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    this._windSource = this.ctx.createBufferSource();
    this._windSource.buffer = buffer;
    this._windSource.loop = true;
    this._windFilter = this.ctx.createBiquadFilter();
    this._windFilter.type = 'lowpass';
    this._windFilter.frequency.value = 300;
    this._windGain = this.ctx.createGain();
    this._windGain.gain.value = 0; // 속도 0일 땐 무음 — 시작/정지 상태 관리 없이 updateWind()만으로 충분
    this._windSource.connect(this._windFilter).connect(this._windGain).connect(this.masterGain);
    this._windSource.start();
  },

  /** main.js가 매 고정 스텝마다 cart.speed(m/s)로 호출 */
  updateWind(speedMs) {
    if (!this._ready() || !this._windGain) return;
    const t = this.ctx.currentTime;
    const norm = Math.min(1, speedMs / 40); // 40m/s(≈144km/h) 근방에서 최대치로 클램프
    this._windFilter.frequency.setTargetAtTime(300 + norm * 2200, t, 0.1);
    this._windGain.gain.setTargetAtTime(norm * 0.18, t, 0.1);
  },

  // ── 3) 밸런스 판정 성공/실패(perfect/good/miss) — cart.js가 tier 변화 시에만 dispatch ──
  playBalanceResult(tier) {
    if (tier === 'perfect') this._blip({ freq: 880, duration: 0.1, type: 'sine', peak: 0.15 });
    else if (tier === 'good') this._blip({ freq: 600, duration: 0.08, type: 'sine', peak: 0.12 });
    else this._blip({ freq: 140, duration: 0.12, type: 'square', peak: 0.12 });
  },

  // ── 4) 게이트(부스트/브레이크) 판정 + 6) 피니쉬 판정 사운드(같은 경로, type으로 구분) ──
  playGateResult(type, result) {
    const peak = result === 'perfect' ? 0.2 : result === 'good' ? 0.15 : 0.1;
    if (type === 'finish') {
      this._blip({ freq: 700, duration: 0.12, type: 'triangle', peak });
      setTimeout(() => this._blip({ freq: 1050, duration: 0.15, type: 'triangle', peak }), 90);
    } else if (type === 'boost') {
      this._blip({ freq: 260, freqEnd: 520, duration: 0.18, type: 'sawtooth', peak });
    } else if (type === 'brake') {
      this._blip({ freq: 320, freqEnd: 120, duration: 0.2, type: 'square', peak });
    }
  },

  // ── 5) 에어타임 홀드 중 사운드(지속) — 살짝 어긋난 두 오실레이터로 두둥실한 셰이머 효과 ──
  _initAirtimeTone() {
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 440;
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 446;
    this._airtimeGain = this.ctx.createGain();
    this._airtimeGain.gain.value = 0;
    osc1.connect(this._airtimeGain);
    osc2.connect(this._airtimeGain);
    this._airtimeGain.connect(this.masterGain);
    osc1.start();
    osc2.start();
  },

  /** main.js가 매 고정 스텝마다 (currentSegment.airtimeZone && cart.airtimeHolding)로 호출 */
  setAirtimeHold(active) {
    if (!this._ready() || !this._airtimeGain || active === this._airtimeActive) return;
    this._airtimeActive = active;
    this._airtimeGain.gain.setTargetAtTime(active ? 0.12 : 0, this.ctx.currentTime, 0.08);
  },

  // ── 7) 완주 결과화면 등장음 — 3음 상승 아르페지오 ──────────────────────
  playResultFanfare() {
    [523, 659, 784].forEach((freq, i) => {
      setTimeout(() => this._blip({ freq, duration: 0.25, type: 'triangle', peak: 0.18 }), i * 110);
    });
  },
};

// input.js의 게이트 탭 판정 / cart.js의 밸런스 판정은 이벤트로만 통지 — 오디오와 물리/입력을 분리
window.addEventListener('gate-result', e => AudioManager.playGateResult(e.detail.type, e.detail.result));
window.addEventListener('balance-result', e => AudioManager.playBalanceResult(e.detail));

window.AudioManager = AudioManager;
