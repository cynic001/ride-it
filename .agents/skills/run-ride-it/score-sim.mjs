#!/usr/bin/env node
/**
 * score-sim.mjs — 점수/랭크 밸런싱용 시뮬레이션 (헤드리스 Chromium에서 실제 Track/Cart 클래스로 60Hz 고정 스텝 주행)
 *
 * 플레이어 모델
 *  - perfect: 커브마다 목표 기울기 정확히, 게이트는 판정창 중앙에서 탭, 에어타임 구간 전부 홀드, pull=1·flick=1
 *  - average: "적당히 성공" — 커브 진입 후 15%는 반응 지연(중립), 커브의 75%는 판정창 안에서 흔들림(±0.8창),
 *             25%는 크게 벗어남(±2.5창). 게이트 85%만 탭하고 탭 오차는 실제 시간 기준 N(0, 0.12초)(판정 기준 오차 =
 *             cart.gateTiming().err, 터치 지연 보정 포함). 에어타임 구간 60%만 홀드.
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
const SCALE = args.scale ? Number(args.scale) : null; // 게임 속도 배율 실험
const HOLD0 = !!args.hold0; // 실험: 정상 멈칫 끄기

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); } });
}).listen(8132);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('PAGEERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
await page.goto('http://localhost:8132/index.html', { waitUntil: 'domcontentloaded', timeout: 90000 });
if (HOLD0) await page.addInitScript(() => { window.__simOverrides = () => { CHAIN_LIFT.crestHold = 0; }; });
await page.waitForFunction(() => window.STAGES && window.Track && window.Cart && window.Game && Game.scene, null, { timeout: 90000 });

const out = await page.evaluate(({ RUNS, LAPS, NOCAP, SCALE }) => {
  if (SCALE) Cart.speedScale = SCALE;
  if (window.__simOverrides) window.__simOverrides(); // 실험용 상수 덮어쓰기(--hold0 등)
  window.dispatchEvent = () => true; // 시뮬 중 오디오/UI 이벤트 무시
  const rng = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

  function play(sd, tr, model, seed) {
    const r = rng(seed);
    const cart = new Cart(tr, sd.baseSpeedKmh / 45, LAPS);
    if (NOCAP) cart.maxSpeedMs = Infinity;
    cart.launch(model === 'perfect' ? 1 : 0.7, 1);
    let time = 0, stag = 0, segKey = null, plan = null;
    const events = [...tr.gateCenters().map(g => g.t), ...tr.segmentRanges.filter(s => s.requiredLean > 0).map(s => s.tStart)].sort((a, b) => a - b);
    const hits = []; let prevT = 0; let climb = 0;
    const gatePlans = {};
    while (!cart.isFinished && time < 900) {
      const seg = tr.getSegmentAt(cart.t);
      const key = `${cart.currentLap}:${seg.tStart}`;
      const local = (cart.t - seg.tStart) / (seg.tEnd - seg.tStart);
      if (key !== segKey) {
        segKey = key;
        plan = model === 'perfect'
          ? { good: true, hold: seg.airtimeZone }
          : { good: r() < 0.75, hold: seg.airtimeZone && r() < 0.6 };
      }
      // 게이트 탭: 게이트마다(키 단위) 계획을 세우고, 판정 오차(err)가 계획 오차에 도달한 틱에 탭
      const g = cart.gateTiming();
      if (g) {
        if (!gatePlans[g.key]) gatePlans[g.key] = model === 'perfect' ? { tap: true, err: 0 } : { tap: r() < 0.85, err: gauss(r) * 0.12 };
        const gp = gatePlans[g.key];
        if (gp.tap && !gp.done && g.err >= gp.err && Math.abs(g.err) <= 0.4) { gp.done = true; cart.resolveGate(); }
      }
      const target = seg.requiredLean > 0 ? (seg.curveDirection === 'left' ? -seg.requiredLean : seg.requiredLean) : 0;
      if (model === 'perfect' || seg.requiredLean === 0) cart.leanInput = target;
      else if (local < 0.15) cart.leanInput = 0;
      else cart.leanInput = Math.max(-1, Math.min(1, target + (r() * 2 - 1) * seg.leanWindow * (plan.good ? 0.8 : 2.5)));
      cart.airtimeHolding = plan.hold;
      cart.update(1 / 60);
      time += 1 / 60;
      if (cart.currentLap === 1) { for (const e of events) if (prevT < e && cart.t >= e) hits.push(time); prevT = cart.t; }
      if (cart.speed <= 2.05) stag += 1 / 60;
      if (tr.getTangentAt(cart.t).y > 0.12) climb += 1 / 60; // 오르막 체류 시간
    }
    const judgeMax = (sd.segments.filter(g => g.gate).length * 300 + sd.segments.filter(g => g.requiredLean > 0).length * 100) * LAPS;
    const gTotal = sd.segments.filter(g => g.gate).length * LAPS;
    const gc = { perfect: 0, good: 0, miss: 0 };
    cart._gateResults.forEach(x => { gc[x.result] += 1; });
    gc.miss += gTotal - cart._gateResults.length; // 안 누른/범위 밖 게이트도 Miss로 집계
    let minGap = Infinity;
    for (let k = 1; k < hits.length; k++) minGap = Math.min(minGap, hits[k] - hits[k - 1]);
    return { climb, minGap, gc, gTotal, jr: (cart.scoreBreakdown.gate + cart.scoreBreakdown.balance) / judgeMax, low: cart.lowSpeedTime / cart.rideTime, assist: cart.assistTime / cart.rideTime, airDist: cart.airtimeDistance, score: cart.score, bd: cart.scoreBreakdown, time, stag, vmax: cart.maxSpeed * 3.6, cap: cart.maxSpeedMs * 3.6, maxCombo: cart.maxCombo };
  }

  return STAGES.map((sd, i) => {
    const tr = new Track(sd, Game.scene);
    // 긴 오르막 목록(경사 > 0.15가 30m 이상 이어지는 구간) — 체인 리프트 후보
    const climbs = []; { const S = tr._sampleLoop(2); let st = null;
      S.forEach((p, k) => { const up = p.tangent.y > 0.15; if (up && st === null) st = k; if ((!up || k === S.length - 1) && st !== null) { const len = (k - st) * 2; if (len >= 30) climbs.push({ t0: +S[st].t.toFixed(3), t1: +p.t.toFixed(3), len, rise: +(p.pos.y - S[st].pos.y).toFixed(1) }); st = null; } }); }
    const perfect = play(sd, tr, 'perfect', 1);
    const avgRuns = Array.from({ length: RUNS }, (_, k) => play(sd, tr, 'average', 1000 + k));
    tr.dispose();
    const mean = f => avgRuns.reduce((a, x) => a + f(x), 0) / RUNS;
    const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    return {
      stage: i + 1, climbs,
      perfect: { climbSec: +perfect.climb.toFixed(1), minEventGapSec: +perfect.minGap.toFixed(2), gatePGM: [perfect.gc.perfect, perfect.gc.good, perfect.gc.miss], judgeRatio: +perfect.jr.toFixed(2), lowRatio: +perfect.low.toFixed(3), assistRatio: +perfect.assist.toFixed(3), airDist: Math.round(perfect.airDist), score: Math.round(perfect.score), bd: round(perfect.bd), timeSec: +perfect.time.toFixed(1), stagSec: +perfect.stag.toFixed(1), vmaxKmh: Math.round(perfect.vmax), capKmh: Math.round(perfect.cap), maxCombo: perfect.maxCombo },
      average: {
        score: Math.round(mean(x => x.score)),
        min: Math.round(Math.min(...avgRuns.map(x => x.score))),
        max: Math.round(Math.max(...avgRuns.map(x => x.score))),
        ratio: +(mean(x => x.score) / perfect.score).toFixed(2),
        gatePGM: ['perfect', 'good', 'miss'].map(k => +(avgRuns.reduce((a, x) => a + x.gc[k], 0) / avgRuns.reduce((a, x) => a + x.gTotal, 0)).toFixed(2)),
        judgeRatio: +mean(x => x.jr).toFixed(2), judgeRatioP: (() => { const v = avgRuns.map(x => x.jr).sort((a, b) => a - b); return [0.2, 0.5, 0.8].map(q => +v[Math.min(v.length - 1, Math.floor(q * v.length))].toFixed(2)); })(), // p20/p50/p80
        rankDist: (() => { const c = { S: 0, A: 0, B: 0, C: 0 }; avgRuns.forEach(x => { c[x.jr >= 0.9 ? 'S' : x.jr >= 0.7 ? 'A' : x.jr >= 0.45 ? 'B' : 'C'] += 1; }); return c; })(),
        ratioMin: +(Math.min(...avgRuns.map(x => x.score)) / perfect.score).toFixed(2),
        ratioMax: +(Math.max(...avgRuns.map(x => x.score)) / perfect.score).toFixed(2),
        bd: round({ gate: mean(x => x.bd.gate), balance: mean(x => x.bd.balance), airtime: mean(x => x.bd.airtime), comboBonus: mean(x => x.bd.comboBonus), finishBonus: mean(x => x.bd.finishBonus) }),
        lowRatio: +mean(x => x.low).toFixed(3), lowRatioMax: +Math.max(...avgRuns.map(x => x.low)).toFixed(3), assistRatio: +mean(x => x.assist).toFixed(3), overPerfect: avgRuns.filter(x => x.score > perfect.score).length,
        climbSec: +mean(x => x.climb).toFixed(1),
        timeSec: +mean(x => x.time).toFixed(1), stagSec: +mean(x => x.stag).toFixed(1), maxStagSec: +Math.max(...avgRuns.map(x => x.stag)).toFixed(1), vmaxKmh: Math.round(mean(x => x.vmax)),
      },
    };
  });
}, { RUNS, LAPS, NOCAP, SCALE });

out.forEach(o => console.log(JSON.stringify(o)));
await browser.close();
server.close();
