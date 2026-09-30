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
      this.startBgm();
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
    const k = Math.min(1, flickMultiplier / 1.6);
    const peak = 0.15 + k * 0.15;
    this._blip({ freq, freqEnd: freq * 1.8, duration: 0.35, type: 'sawtooth', peak });
    this.playBoostHit(0.6 + 0.5 * pullStrength * k); // 캐터펄트처럼 "쿵" + 바람 — 튀어나가는 느낌
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

  /** main.js가 매 고정 스텝마다 속도 비율(현재 속도 ÷ 스테이지 최고속도 상한, 0~1)로 호출 — 0이면 무음.
   * 볼륨·밝기(로우패스)·피치(재생 속도)를 모두 비선형으로 키워 저속↔고속 차이가 확실히 들리게 */
  updateWind(ratio) {
    if (!this._ready() || !this._windGain) return;
    const t = this.ctx.currentTime;
    const norm = Math.max(0, Math.min(1, ratio));
    this._windFilter.frequency.setTargetAtTime(350 + norm * norm * 6500, t, 0.08);
    this._windSource.playbackRate.setTargetAtTime(0.7 + norm * 0.8, t, 0.1);
    this._windGain.gain.setTargetAtTime(norm > 0 ? 0.02 + Math.pow(norm, 1.6) * 0.38 : 0, t, 0.08);
  },

  /** 부스트 성공 "쾅" — 저음 쿵 + 위로 쓸려 올라가는 바람 + 기존 부스트 톤 */
  playBoostHit(strength = 1) {
    if (!this._ready()) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(110, t0);
    osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.28);
    g.gain.setValueAtTime(0.45 * strength, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    osc.connect(g).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.35);
    this._whoosh(t0, 0.45, 500, 4200, 0.3 * strength);
  },

  /** 부스터 타이어 보조 추진 — 짧게 차오르는 모터음 + 바람(도움받는 느낌이 아니라 가속되는 느낌) */
  playAssist() {
    if (!this._ready()) return;
    this._blip({ freq: 170, freqEnd: 560, duration: 0.45, type: 'sawtooth', peak: 0.09 });
    this._whoosh(this.ctx.currentTime, 0.5, 300, 2600, 0.16);
  },

  _whoosh(t0, dur, f0, f1, peak) {
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
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

  // ── 8) 배경음악 — 외부 음원 없이 합성한 4마디 루프(C-G-Am-F, 118BPM) ─────────────
  // 16분음표 스텝 시퀀서: setInterval(25ms)로 0.12초 앞까지 미리 예약(Web Audio 시계 기준이라 타이머 지터와 무관).
  // mode: 'menu'(드럼 없이 잔잔) / 'ride'(드럼 추가) / 'pause'(볼륨만 낮춤). 마스터 게인 경유라 사운드 토글에 자동 연동
  _bgm: null,
  _bgmMode: 'menu',

  startBgm() {
    if (!this.ctx || this._bgm) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.masterGain);
    const leadFilter = this.ctx.createBiquadFilter(); // 사각파 멜로디의 날카로운 배음을 깎아 부드럽게
    leadFilter.type = 'lowpass';
    leadFilter.frequency.value = 1800;
    leadFilter.connect(gain);
    const len = Math.floor(this.ctx.sampleRate * 0.25);
    const noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._bgm = { gain, leadFilter, noise, step: 0, nextTime: this.ctx.currentTime + 0.1 };
    this._bgmTimer = setInterval(() => this._scheduleBgm(), 25);
    this.setBgmMode(this._bgmMode);
  },

  setBgmMode(mode) {
    this._bgmMode = mode;
    if (!this._bgm) return;
    const vol = { menu: 0.5, ride: 0.42, pause: 0.15 }[mode] ?? 0.5;
    this._bgm.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.25);
  },

  _scheduleBgm() {
    const b = this._bgm;
    const now = this.ctx.currentTime;
    const stepDur = 60 / 118 / 4;
    // 탭 백그라운드 등으로 타이머가 한참 밀렸으면 지난 음을 몰아서 내지 않고 현재 시점부터 이어감
    if (b.nextTime < now - 0.2) b.nextTime = now + 0.05;
    while (b.nextTime < now + 0.12) {
      if (this.enabled) this._bgmStep(b.step, b.nextTime, stepDur);
      b.nextTime += stepDur;
      b.step = (b.step + 1) % 64;
    }
  },

  _bgmStep(step, t, dur) {
    const midi = m => 440 * Math.pow(2, (m - 69) / 12);
    const bar = step >> 4, s = step & 15;
    const CHORDS = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]]; // C, G, Am, F
    const MELODY = [ // 마디별 16스텝, -1 = 쉼
      [72, -1, 76, -1, 79, -1, 76, -1, 74, -1, 72, -1, 74, -1, -1, -1],
      [71, -1, 74, -1, 79, -1, 74, -1, 71, -1, 74, -1, -1, -1, 67, -1],
      [72, -1, 76, -1, 81, -1, 79, -1, 76, -1, 74, -1, 72, -1, -1, -1],
      [69, -1, 72, -1, 77, -1, 76, -1, 74, -1, 72, -1, 71, -1, -1, -1],
    ];
    const chord = CHORDS[bar];
    const out = this._bgm.gain;
    if (s % 2 === 0) this._bgmNote(midi(chord[0] - 12 + (s % 8 === 4 ? 7 : 0)), t, dur * 1.8, 'triangle', 0.22, out); // 베이스(루트/5도)
    this._bgmNote(midi(chord[[0, 1, 2, 1][s % 4]] + 12), t, dur * 0.9, 'triangle', 0.06, out); // 아르페지오
    const m = MELODY[bar][s];
    if (m > 0) this._bgmNote(midi(m), t, dur * 1.7, 'square', 0.045, this._bgm.leadFilter);

    if (this._bgmMode === 'ride') {
      if (s % 8 === 0) this._bgmKick(t);
      if (s === 4 || s === 12) this._bgmNoise(t, 0.12, 'bandpass', 1800, 0.18);
      if (s % 2 === 0) this._bgmNoise(t, 0.03, 'highpass', 7000, s % 4 === 2 ? 0.07 : 0.04);
    }
  },

  _bgmNote(freq, t, dur, type, peak, dest) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },

  _bgmKick(t) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(this._bgm.gain);
    osc.start(t);
    osc.stop(t + 0.2);
  },

  _bgmNoise(t, dur, filterType, freq, peak) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._bgm.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this._bgm.gain);
    src.start(t);
    src.stop(t + dur + 0.02);
  },

  // ── 7) 완주 결과화면 등장음 — 3음 상승 아르페지오 ──────────────────────
  playResultFanfare() {
    [523, 659, 784].forEach((freq, i) => {
      setTimeout(() => this._blip({ freq, duration: 0.25, type: 'triangle', peak: 0.18 }), i * 110);
    });
  },
};

// input.js의 게이트 탭 판정 / cart.js의 밸런스 판정은 이벤트로만 통지 — 오디오와 물리/입력을 분리
window.addEventListener('gate-result', e => {
  AudioManager.playGateResult(e.detail.type, e.detail.result);
  if (e.detail.type === 'boost' && (e.detail.result === 'perfect' || e.detail.result === 'good')) {
    AudioManager.playBoostHit(e.detail.result === 'perfect' ? 1 : 0.7);
  }
});
window.addEventListener('booster-assist', () => AudioManager.playAssist());
window.addEventListener('balance-result', e => AudioManager.playBalanceResult(e.detail));

window.addEventListener('cart-launched', () => AudioManager.setBgmMode('ride'));
// 백그라운드 탭/홈 화면 전환 시 오디오 정지(모바일 배터리·iOS 정책), 복귀 시 재개
document.addEventListener('visibilitychange', () => {
  if (!AudioManager.ctx) return;
  if (document.hidden) AudioManager.ctx.suspend();
  else AudioManager.ctx.resume();
});

window.AudioManager = AudioManager;
