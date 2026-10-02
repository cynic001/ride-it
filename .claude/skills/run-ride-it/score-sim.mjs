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
const SLOPPY = Number(args.sloppy ?? 0.25);        // 평균 플레이어가 커브마다 "엉성"하게 누를 확률(기본 25% — 기존 기준선)
const D_SLOPPY = Number(args.dsloppy ?? 0.12);      // 레일 이탈 시뮬(derailSim)의 평균 플레이어: 이탈 규칙을 아는 플레이어는 커브의 12%만 놓친다고 가정(초보 25%는 failRateNovice)
const DEVICE = args.device || 'bar'; // 밸런스 입력 모델: bar(균형 바 드래그, 기본: 손가락 위치로 노브가 22/초로 따라감) | keyboard(← → 초당 1.2씩 이동) | tilt(기울기, 6/초) | button(예전 ◀▶ 0.3초 램프, 비교용으로만 남김)

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); } });
}).listen(Number(args.port ?? 8132));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('PAGEERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
await page.goto(`http://localhost:${Number(args.port ?? 8132)}/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
if (HOLD0) await page.addInitScript(() => { window.__simOverrides = () => { CHAIN_LIFT.crestHold = 0; }; });
await page.waitForFunction(() => window.STAGES && window.Track && window.Cart && window.Game && Game.scene, null, { timeout: 90000 });

const out = await page.evaluate(({ RUNS, LAPS, NOCAP, SCALE, DEVICE, SLOPPY, D_SLOPPY }) => {
  if (SCALE) Cart.speedScale = SCALE;
  if (window.__simOverrides) window.__simOverrides(); // 실험용 상수 덮어쓰기(--hold0 등)
  window.dispatchEvent = () => true; // 시뮬 중 오디오/UI 이벤트 무시
  const rng = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

  function play(sd, tr, model, seed, derail = false, sloppy = derail ? D_SLOPPY : SLOPPY) {
    const r = rng(seed);
    const cart = new Cart(tr, sd.baseSpeedKmh / 45, LAPS, { derail });
    if (NOCAP) cart.maxSpeedMs = Infinity;
    cart.launch(model === 'perfect' ? 1 : 0.7, 1);
    let time = 0, stag = 0, segKey = null, plan = null;
    const events = [...tr.gateCenters().map(g => g.t), ...tr.segmentRanges.filter(s => s.requiredLean > 0).map(s => s.tStart)].sort((a, b) => a - b);
    const hits = []; let prevT = 0; let climb = 0;
    const gatePlans = {};
    const mashRate = model === 'perfect' ? 9 : Math.max(3.5, 6 + gauss(r) * 1.2); // 초당 연타 횟수
    let mashAcc = 0, crests = 0, wasHold = false; const dsegs = [];
    const curveSecs = []; let curveIn = null; // 커브 세그먼트별 체류 시간(초) — 밸런스 1.5초 유지 판정 가능 여부
    while (!cart.isFinished && !cart.failed && time < 900) {
      const seg = tr.getSegmentAt(cart.t);
      const key = `${cart.currentLap}:${seg.tStart}`;
      const local = (cart.t - seg.tStart) / (seg.tEnd - seg.tStart);
      if (key !== segKey) {
        if (curveIn) curveSecs.push({ i: curveIn.i, sec: +(time - curveIn.t0).toFixed(2) });
        curveIn = seg.requiredLean > 0 && !tr.inRollbackZone(seg.tStart) ? { i: tr.segmentRanges.indexOf(seg), t0: time } : null;
        segKey = key;
        plan = model === 'perfect'
          ? { good: true }
          : { good: r() < 1 - sloppy };
        plan.modulate = model === 'perfect' || r() < 0.2; // 버튼/키: 톡톡 눌러 목표 근처를 맞추는 커브 비율
        plan.pressOn = true; plan.pressUntil = 0;
      }
      // 게이트 탭: 게이트마다(키 단위) 계획을 세우고, 판정 오차(err)가 계획 오차에 도달한 틱에 탭
      const g = cart.gateTiming();
      if (g) {
        if (!gatePlans[g.key]) gatePlans[g.key] = model === 'perfect' ? { tap: true, err: 0 } : { tap: r() < 0.85, err: gauss(r) * 0.12 };
        const gp = gatePlans[g.key];
        if (gp.tap && !gp.done && g.err >= gp.err && Math.abs(g.err) <= 0.4) { gp.done = true; cart.resolveGate(); }
      }
      const target = seg.requiredLean > 0 ? (seg.curveDirection === 'left' ? -seg.requiredLean : seg.requiredLean) : 0;
      const dirS = Math.sign(target) || 1;
      const reacting = model !== 'perfect' && local < 0.15; // 커브 진입 직후 반응 지연(모든 조작 방식 동일)
      if (seg.requiredLean === 0) {
        if (DEVICE === 'button' || DEVICE === 'keyboard') cart.leanInput = Math.max(0, Math.abs(cart.leanInput) - 1 / 60 / 0.3) * Math.sign(cart.leanInput);
        else cart.leanInput = 0;
      } else if (DEVICE === 'button' || DEVICE === 'keyboard') {
        // 버튼/키: 누르면 0.3초 램프로 ±1, 떼면 0.3초에 0. 기본은 "커브 방향으로 누르고 있기", 일부는 목표 근처에서 톡톡
        let press = !reacting;
        if (press && plan.modulate) press = Math.abs(cart.leanInput) < Math.abs(target); // 목표를 넘으면 뗐다가 다시 누름
        if (press && !plan.good) { // 엉성: 0.25초 단위로 누르다 떼다(누르는 비율 55%, 키보드 60%)
          if (time >= plan.pressUntil) { plan.pressOn = r() < (DEVICE === 'keyboard' ? 0.6 : 0.55); plan.pressUntil = time + 0.25; }
          press = plan.pressOn;
        }
        const goal = press ? dirS : 0, upStep = DEVICE === 'keyboard' ? 1.2 / 60 : 1 / 60 / 0.3, downStep = 1 / 60 / 0.3; // 키보드는 누르는 동안 천천히(1.2/초), 놓으면 0.3초에 복귀
        const cur = cart.leanInput;
        if (goal === 0) cart.leanInput = cur > 0 ? Math.max(0, cur - downStep) : Math.min(0, cur + downStep);
        else cart.leanInput = goal > cur ? Math.min(goal, cur + upStep) : Math.max(goal, cur - upStep);
      } else {
        // 패드/기울기: 같은 실력 = 같은 오차 모델(0.25초마다 새 오차, 60Hz 떨림 아님). 차이는 실제 input.js 추종 속도만(패드 18/s, 기울기 6/s)
        // 바는 손가락으로 위치를 직접 정해 기울기보다 흔들림이 작다고 가정(좋은 플랜 σ 0.06, 엉성 0.15 — 기울기/버튼은 0.12/0.25)
        if (time >= (plan.errUntil || 0)) { plan.errMul = plan.good ? 1 : 0.1 + r() * 1.2; plan.errAdd = gauss(r) * (plan.good ? (DEVICE === 'bar' ? 0.06 : 0.12) : (DEVICE === 'bar' ? 0.15 : 0.25)); plan.errUntil = time + 0.25; }
        let desired;
        if (model === 'perfect') desired = target;
        else if (reacting) desired = 0;
        else desired = target * plan.errMul + plan.errAdd;
        desired = Math.max(-1, Math.min(1, desired));
        const follow = DEVICE === 'tilt' ? 6 : DEVICE === 'bar' ? 22 : 18;
        cart.leanInput = model === 'perfect' ? desired : cart.leanInput + (desired - cart.leanInput) * (1 - Math.exp(-follow / 60));
      }
      if (cart.rollback && cart.rollback.phase === 'mash') { mashAcc += mashRate / 60; while (mashAcc >= 1) { mashAcc -= 1; cart.mashTap(); } }
      const dBefore = cart.derails;
      cart.update(1 / 60);
      if (cart.derails > dBefore) dsegs.push(tr.segmentRanges.findIndex(x => x.tStart === cart.derailState.tStart));
      if (cart._crestHold > 0 && !wasHold) crests += 1; wasHold = cart._crestHold > 0; // 체인 리프트 정상 멈칫 횟수
      time += 1 / 60;
      if (cart.currentLap === 1) { for (const e of events) if (prevT < e && cart.t >= e) hits.push(time); prevT = cart.t; }
      if (cart.speed <= 2.05) stag += 1 / 60;
      if (tr.getTangentAt(cart.t).y > 0.12) climb += 1 / 60; // 오르막 체류 시간
    }
    const gTotal = tr.gateCenters().length * LAPS;
    const gc = { perfect: 0, good: 0, miss: 0 };
    cart._gateResults.forEach(x => { gc[x.result] += 1; });
    gc.miss += gTotal - cart._gateResults.length; // 안 누른/범위 밖 게이트도 Miss로 집계
    let minGap = Infinity;
    for (let k = 1; k < hits.length; k++) minGap = Math.min(minGap, hits[k] - hits[k - 1]);
    const mash = cart.rollbackLog.filter(x => x.mode === 'mash');
    const curveN = sd.segments.filter(g => g.requiredLean > 0).length * LAPS;
    return { curveSecs, crests, curveRate: (cart.curvesCleared || 0) / curveN, perfectRate: cart.balancePerfects / curveN, mashSec: mash.length ? mash[0].climbSec : null, mashAssisted: mash.some(x => x.assisted), mashBonus: cart.scoreBreakdown.mashBonus, climb, minGap, gc, gTotal, jr: cart.judgeSummary().ratio, rank: cart.judgeSummary().rank, low: cart.lowSpeedTime / cart.rideTime, assist: cart.assistTime / cart.rideTime, dsegs, derails: cart.derails, failed: cart.failed, score: cart.score, bd: cart.scoreBreakdown, time, stag, vmax: cart.maxSpeed * 3.6, cap: cart.maxSpeedMs * 3.6, maxCombo: cart.maxCombo };
  }

  return STAGES.map((sd, i) => {
    const tr = new Track(sd, Game.scene);
    // 긴 오르막 목록(경사 > 0.15가 30m 이상 이어지는 구간) — 체인 리프트 후보
    const climbs = []; { const S = tr._sampleLoop(2); let st = null;
      S.forEach((p, k) => { const up = p.tangent.y > 0.15; if (up && st === null) st = k; if ((!up || k === S.length - 1) && st !== null) { const len = (k - st) * 2; if (len >= 30) climbs.push({ t0: +S[st].t.toFixed(3), t1: +p.t.toFixed(3), len, rise: +(p.pos.y - S[st].pos.y).toFixed(1) }); st = null; } }); }
    const perfect = play(sd, tr, 'perfect', 1);
    const avgRuns = Array.from({ length: RUNS }, (_, k) => play(sd, tr, 'average', 1000 + k));
    // 레일 이탈 ON(게임 기본값): 같은 시드의 평균 플레이어가 몇 번 이탈하고 몇 %가 3번 이탈로 실패하는지
    const dRuns = Array.from({ length: RUNS }, (_, k) => play(sd, tr, 'average', 1000 + k, true));
    const nRuns = Array.from({ length: RUNS }, (_, k) => play(sd, tr, 'average', 1000 + k, true, 0.25));
    const dHist = [0, 1, 2, 3].map(n => dRuns.filter(x => x.derails === n).length);
    const derailSim = { derailsAvg: +(dRuns.reduce((a, x) => a + x.derails, 0) / RUNS).toFixed(2), failRate: +(dRuns.filter(x => x.failed).length / RUNS).toFixed(3), failRateNovice: +(nRuns.filter(x => x.failed).length / RUNS).toFixed(3), derailsAvgNovice: +(nRuns.reduce((a, x) => a + x.derails, 0) / RUNS).toFixed(2), derailHist: dHist, derailSegs: (() => { const h = {}; dRuns.forEach(x => x.dsegs.forEach(g => { h[g] = (h[g] || 0) + 1; })); return h; })(), perfectDerails: play(sd, tr, 'perfect', 1, true).derails };
    tr.dispose();
    const mean = f => avgRuns.reduce((a, x) => a + f(x), 0) / RUNS;
    const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    return {
      stage: i + 1, climbs, derailSim,
      perfect: { curveSecs: perfect.curveSecs.map(x => x.sec), crests: perfect.crests, curveRate: +perfect.curveRate.toFixed(2), perfectRate: +perfect.perfectRate.toFixed(2), mashSec: perfect.mashSec === null ? null : +perfect.mashSec.toFixed(2), climbSec: +perfect.climb.toFixed(1), minEventGapSec: +perfect.minGap.toFixed(2), gatePGM: [perfect.gc.perfect, perfect.gc.good, perfect.gc.miss], judgeRatio: +perfect.jr.toFixed(2), lowRatio: +perfect.low.toFixed(3), assistRatio: +perfect.assist.toFixed(3), score: Math.round(perfect.score), bd: round(perfect.bd), timeSec: +perfect.time.toFixed(1), stagSec: +perfect.stag.toFixed(1), vmaxKmh: Math.round(perfect.vmax), capKmh: Math.round(perfect.cap), maxCombo: perfect.maxCombo },
      average: {
        score: Math.round(mean(x => x.score)),
        min: Math.round(Math.min(...avgRuns.map(x => x.score))),
        max: Math.round(Math.max(...avgRuns.map(x => x.score))),
        ratio: +(mean(x => x.score) / perfect.score).toFixed(2),
        gatePGM: ['perfect', 'good', 'miss'].map(k => +(avgRuns.reduce((a, x) => a + x.gc[k], 0) / avgRuns.reduce((a, x) => a + x.gTotal, 0)).toFixed(2)),
        judgeRatio: +mean(x => x.jr).toFixed(2), judgeRatioP: (() => { const v = avgRuns.map(x => x.jr).sort((a, b) => a - b); return [0.2, 0.5, 0.8].map(q => +v[Math.min(v.length - 1, Math.floor(q * v.length))].toFixed(2)); })(), // p20/p50/p80
        rankDist: (() => { const c = { S: 0, A: 0, B: 0, C: 0 }; avgRuns.forEach(x => { c[x.rank] += 1; }); return c; })(),
        ratioMin: +(Math.min(...avgRuns.map(x => x.score)) / perfect.score).toFixed(2),
        ratioMax: +(Math.max(...avgRuns.map(x => x.score)) / perfect.score).toFixed(2),
        bd: round({ gate: mean(x => x.bd.gate), balance: mean(x => x.bd.balance), mashBonus: mean(x => x.bd.mashBonus), balancePerfect: mean(x => x.bd.balancePerfect), comboBonus: mean(x => x.bd.comboBonus), finishBonus: mean(x => x.bd.finishBonus) }),
        lowRatio: +mean(x => x.low).toFixed(3), lowRatioMax: +Math.max(...avgRuns.map(x => x.low)).toFixed(3), assistRatio: +mean(x => x.assist).toFixed(3), overPerfect: avgRuns.filter(x => x.score > perfect.score).length,
        climbSec: +mean(x => x.climb).toFixed(1), crests: +mean(x => x.crests).toFixed(2), curveSecMin: +Math.min(...avgRuns.flatMap(x => x.curveSecs.map(c => c.sec))).toFixed(2),
        curveRate: +mean(x => x.curveRate).toFixed(2), perfectRate: +mean(x => x.perfectRate).toFixed(2),
        mashSec: avgRuns[0].mashSec === null ? null : +mean(x => x.mashSec).toFixed(2), mashAssistRate: +(avgRuns.filter(x => x.mashAssisted).length / RUNS).toFixed(2),
        mashSecRange: avgRuns[0].mashSec === null ? null : [Math.min(...avgRuns.map(x => x.mashSec)), Math.max(...avgRuns.map(x => x.mashSec))].map(v => +v.toFixed(2)),
        timeSec: +mean(x => x.time).toFixed(1), stagSec: +mean(x => x.stag).toFixed(1), maxStagSec: +Math.max(...avgRuns.map(x => x.stag)).toFixed(1), vmaxKmh: Math.round(mean(x => x.vmax)),
      },
    };
  });
}, { RUNS, LAPS, NOCAP, SCALE, DEVICE, SLOPPY, D_SLOPPY });

out.forEach(o => console.log(JSON.stringify(o)));
await browser.close();
server.close();
