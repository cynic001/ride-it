---
name: run-ride-it
description: ride-it 게임 실행·스크린샷·전체 검증(verify/score-sim). 실행하거나 track/cart/stages 변경을 확인할 때 사용.
---

No bundler — `index.html` loads Babylon.js from a CDN and each
`js/*.js` file via plain `<script>` tags. There is no build step and
no app state beyond `window.Game`. Drive it with
`.claude/skills/run-ride-it/driver.mjs`, a headless-Chromium
(Playwright) script that serves the project root itself (Node's
built-in `http`, no separate dev-server dependency), clicks through
stage-select, and inspects `window.Game.track` / `window.Game.cart`
directly.

All paths below are relative to the project root (`ride-it/`).

## Setup

One-time, inside the skill directory (keeps Playwright out of the
game's own `package.json` — it's driver tooling, not a game dependency):

```bash
cd .claude/skills/run-ride-it
npm install
npx playwright install chromium
```

## Run (agent path)

```bash
cd .claude/skills/run-ride-it
node driver.mjs --stage=0 --pull=0.6 --shot=/tmp/ride-it-shots/stage0.png
```

This: starts a static server for the project root on `:8123` →
navigates to `index.html` → waits for the 5 stage-select buttons →
clicks `.stage-btn[data-index=<stage>]` → waits for the in-scene HUD
(`#startBar`, after glb loading finishes) → reads back `window.Game.track` (point/segment counts,
height profile) → calls `window.Game.cart.launch(<pull>)` → waits
1.5s of real gameplay ticks → reads back `window.Game.cart` (speed,
track progress `t`, combo, `isFinished`) → screenshots → prints all
console messages and page errors → exits non-zero if any `pageerror`
fired.

| flag | default | meaning |
|---|---|---|
| `--stage=N` | `0` | index into `STAGES` (0-4) to click on stage-select |
| `--pull=F` | `0.6` | drag-strength 0-1 passed to `cart.launch()` |
| `--shot=path` | `/tmp/ride-it.png` | screenshot destination (dir created if missing) |
| `--port=N` | `8123` | static server port |

Example output:

```
[driver] serving /Users/gon/dev/ride-it at http://localhost:8123
[driver] stage select loaded, 5 stages
[driver] stage 0 scene loaded
[driver] Track: {"pointCount":2241,"segmentCount":4,"heightAt0":10,"heightAt1":-2.886579864025407e-15}
[driver] Cart after launch: {"speed":11,"launched":true}
[driver] Cart after ~1.5s: {"speed":8.17,"t":0.041,"combo":0,"isFinished":false}
[driver] screenshot -> /tmp/ride-it-shots/stage0.png
--- console ---
[log] BJS - [...]: Babylon.js v7.25.0 - WebGL2
--- page errors ---
NONE
```

To check every stage's data loads without throwing, loop it:

```bash
for i in 0 1 2 3 4; do node driver.mjs --stage=$i --shot=/tmp/ride-it-shots/stage$i.png || echo "STAGE $i FAILED"; done
```

## Run (human path)

```bash
npm run dev   # npx http-server . -p 8080 -c-1, then open http://localhost:8080
```

Useless in a headless container — only for a human with a real browser.

## Test

No test suite exists yet (`package.json` has no `test` script). There
is a lint script:

```bash
npm run lint   # npx eslint js/
```

## 전체 검증 (코드 변경 후 마무리 단계)

순서대로 실행 (스킬 폴더 `.claude/skills/run-ride-it`에서, 긴 출력은 파일로 저장 후 `grep`/`tail`):

```bash
cd .claude/skills/run-ride-it
npm run --prefix ../../.. lint                                   # 0. 문법 (exit 0)
node verify.mjs --out=/tmp/ride-it-verify > /tmp/verify.log 2>&1; echo "verify exit=$?"
node score-sim.mjs --runs=60 > /tmp/score-sim.log 2>&1; echo "score-sim exit=$?"
grep -E "PASS|FAIL" /tmp/verify.log | tail -40; tail -40 /tmp/score-sim.log
```

통과 기준
- lint: exit 0
- verify.mjs: exit 0, 마지막 줄 `[verify] N/N checks passed, pageErrors=0`, `FAIL` 줄 0개 (CDP 터치 시나리오 A~G 전부 PASS)
- score-sim.mjs: exit 0, `PAGEERROR`/`CONSOLE` 오류 없음, 5단계 모두 완주,
  perfect 완주 시간 15초 이상, 연속 이벤트(게이트/커브 진입) 최소 간격 0.6초 이상,
  perfect/average 점수 비율이 이전 `개발기록.md` 기록에서 크게 벗어나지 않음
- 속도 배율·연출을 건드렸다면 위 시간·간격 기준을 특히 확인 (AGENTS.md "속도감 최우선")

보고 형식 (표 하나 + 한 줄 결론)

```
| 항목 | 결과 | 비고 |
| lint | PASS/FAIL | exit code |
| verify.mjs | PASS n / FAIL m | 실패 이름·pageerror |
| score-sim | PASS/FAIL | 단계별 완주 시간(최소~최대), 최소 이벤트 간격 |
결론: 통과 / 실패 항목과 원인 한 줄
```

실패 시 로그의 해당 줄만 인용하고, 임의로 기준을 완화하지 말고 사용자에게 알린다.

---

## Gotchas

- **`npx http-server` / `npx playwright` without a cached package
  prompts for confirmation and fails non-interactively** ("canceled
  due to missing packages and no YES option") on a machine that's
  never run them before. The driver sidesteps this for the server by
  using Node's built-in `http` module instead of `http-server`. For
  Playwright itself there's no stdlib equivalent — run the `Setup`
  step (`npm install` inside the skill dir) once; after that
  `npx playwright install chromium` is a cache hit and instant.
- **First-visit how-to overlay** (`#howtoOverlay`) intercepts clicks on
  the stage buttons — the driver pre-sets `localStorage.rc_howto_seen`
  via `addInitScript` so it never appears. Stage load waits for all
  Kenney glb files, so `#startBar` can take a few seconds.
- **`combo` stays `0` in the smoke run** — `cart.leanInput` is never
  set (that's `input.js`'s job via pointer-swipe events, which this
  driver doesn't simulate). Expected; the driver checks that physics
  *runs*, not full input-to-combo scoring. To exercise combo/gate
  logic, drive it via `page.evaluate(() => window.Game.cart.leanInput = ...)`
  or extend the driver with a `--lean=` flag.
