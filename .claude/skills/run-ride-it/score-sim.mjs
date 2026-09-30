#!/usr/bin/env node
/**
 * score-sim.mjs — 점수/랭크 밸런싱용 시뮬레이션 (헤드리스 Chromium에서 실제 Track/Cart 클래스로 60Hz 고정 스텝 주행)
 *
 * 플레이어 모델
 *  - perfect: 커브마다 목표 기울기 정확히, 게이트는 판정창 중앙에서 탭, 에어타임 구간 전부 홀드, pull=1·flick=1
 *  - average: "적당히 성공" — 커브 진입 후 15%는 반응 지연(중립), 커브의 75%는 판정창 안에서 흔들림(±0.8창),
 *             25%는 크게 벗어남(±2.5창). 게이트 85%만 탭하고 탭 시점은 중앙 ± N(0, 0.7×반창). 에어타임 구간 60%만 홀드.
 *             pull=0.7·flick=1. 시드 고정 난수로 RUNS회 반복 평균.
 *
 * Usage: node score-sim.mjs [--runs=30] [--laps=1]
 * 출력: 스테이지별 perfect/average 점수, 원천별 내역, 랭크 비율(점수/perfect), 정체 시간, 최고속도
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const RUNS = Number(args.runs ?? 30);
const LAPS = Number(args.laps ?? 1);
const NOCAP = !!args.nocap; // 비교용: 속도 상한 해제

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); } });
}).listen(8132);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8132/index.html', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.STAGES && window.Track && window.Cart && window.Game && Game.scene, null, { timeout: 90000 });

const out = await page.evaluate(({ RUNS, LAPS, NOCAP }) => {
  window.dispatchEvent = () => true; // 시뮬 중 오디오/UI 이벤트 무시
  const rng = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

  function play(sd, tr, model, seed) {
    const r = rng(seed);
    const cart = new Cart(tr, sd.baseSpeedKmh / 45, LAPS);
    if (NOCAP) cart.maxSpeedMs = Infinity;
    cart.launch(model === 'perfect' ? 1 : 0.7, 1);
    let time = 0, stag = 0, segKey = null, plan = null;
    while (!cart.isFinished && time < 900) {
      const seg = tr.getSegmentAt(cart.t);
      const key = `${cart.currentLap}:${seg.tStart}`;
      const local = (cart.t - seg.tStart) / (seg.tEnd - seg.tStart);
      if (key !== segKey) {
        segKey = key;
        const w = seg.gate && seg.gate.timingWindow;
        const center = w ? (w.start + w.end) / 2 : 0, half = w ? (w.end - w.start) / 2 : 0;
        plan = model === 'perfect'
          ? { good: true, tapAt: w ? center : null, hold: seg.airtimeZone }
          : { good: r() < 0.75, tapAt: w && r() < 0.85 ? Math.min(0.999, Math.max(0, center + gauss(r) * half * 0.7)) : null, hold: seg.airtimeZone && r() < 0.6 };
        plan.tapped = false;
      }
      const target = seg.requiredLean > 0 ? (seg.curveDirection === 'left' ? -seg.requiredLean : seg.requiredLean) : 0;
      if (model === 'perfect' || seg.requiredLean === 0) cart.leanInput = target;
      else if (local < 0.15) cart.leanInput = 0;
      else cart.leanInput = Math.max(-1, Math.min(1, target + (r() * 2 - 1) * seg.leanWindow * (plan.good ? 0.8 : 2.5)));
      cart.airtimeHolding = plan.hold;
      if (plan.tapAt !== null && !plan.tapped && local >= plan.tapAt) { plan.tapped = true; cart.resolveGate(local); }
      cart.update(1 / 60);
      time += 1 / 60;
      if (cart.speed <= 2.05) stag += 1 / 60;
    }
    const judgeMax = (sd.segments.filter(g => g.gate).length * 300 + sd.segments.filter(g => g.requiredLean > 0).length * 100) * LAPS;
    return { jr: (cart.scoreBreakdown.gate + cart.scoreBreakdown.balance) / judgeMax, low: cart.lowSpeedTime / cart.rideTime, assist: cart.assistTime / cart.rideTime, airDist: cart.airtimeDistance, score: cart.score, bd: cart.scoreBreakdown, time, stag, vmax: cart.maxSpeed * 3.6, cap: cart.maxSpeedMs * 3.6, maxCombo: cart.maxCombo };
  }

  return STAGES.map((sd, i) => {
    const tr = new Track(sd, Game.scene);
    const perfect = play(sd, tr, 'perfect', 1);
    const avgRuns = Array.from({ length: RUNS }, (_, k) => play(sd, tr, 'average', 1000 + k));
    tr.dispose();
    const mean = f => avgRuns.reduce((a, x) => a + f(x), 0) / RUNS;
    const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    return {
      stage: i + 1,
      perfect: { judgeRatio: +perfect.jr.toFixed(2), lowRatio: +perfect.low.toFixed(3), assistRatio: +perfect.assist.toFixed(3), airDist: Math.round(perfect.airDist), score: Math.round(perfect.score), bd: round(perfect.bd), timeSec: +perfect.time.toFixed(1), stagSec: +perfect.stag.toFixed(1), vmaxKmh: Math.round(perfect.vmax), capKmh: Math.round(perfect.cap), maxCombo: perfect.maxCombo },
      average: {
        score: Math.round(mean(x => x.score)),
        min: Math.round(Math.min(...avgRuns.map(x => x.score))),
        max: Math.round(Math.max(...avgRuns.map(x => x.score))),
        ratio: +(mean(x => x.score) / perfect.score).toFixed(2),
        judgeRatio: +mean(x => x.jr).toFixed(2), judgeRatioP: avgRuns.map(x => x.jr).sort((a, b) => a - b).filter((_, k) => k % 6 === 0).map(v => +v.toFixed(2)),
        ratioMin: +(Math.min(...avgRuns.map(x => x.score)) / perfect.score).toFixed(2),
        ratioMax: +(Math.max(...avgRuns.map(x => x.score)) / perfect.score).toFixed(2),
        bd: round({ gate: mean(x => x.bd.gate), balance: mean(x => x.bd.balance), airtime: mean(x => x.bd.airtime), comboBonus: mean(x => x.bd.comboBonus), finishBonus: mean(x => x.bd.finishBonus) }),
        lowRatio: +mean(x => x.low).toFixed(3), lowRatioMax: +Math.max(...avgRuns.map(x => x.low)).toFixed(3), assistRatio: +mean(x => x.assist).toFixed(3), overPerfect: avgRuns.filter(x => x.score > perfect.score).length,
        timeSec: +mean(x => x.time).toFixed(1), stagSec: +mean(x => x.stag).toFixed(1), maxStagSec: +Math.max(...avgRuns.map(x => x.stag)).toFixed(1), vmaxKmh: Math.round(mean(x => x.vmax)),
      },
    };
  });
}, { RUNS, LAPS, NOCAP });

out.forEach(o => console.log(JSON.stringify(o)));
await browser.close();
server.close();
