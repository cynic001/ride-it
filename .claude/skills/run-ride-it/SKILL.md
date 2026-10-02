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

순서대로 실행 (프로젝트 루트에서 lint, 스킬 폴더에서 나머지. 긴 출력은 파일로 저장 후 필요한 줄만 읽기):

```bash
npm run lint                                                         # 0. 문법
cd .claude/skills/run-ride-it
node verify.mjs --out=/tmp/ride-it-verify > /tmp/verify.log 2>&1; echo "verify exit=$?"
node score-sim.mjs --runs=60 > /tmp/score-sim.log 2>&1; echo "score-sim exit=$?"   # 스테이지별 JSON 한 줄씩
tail -1 /tmp/verify.log; grep -E "^FAIL" /tmp/verify.log
```

소요 시간 (2026-10-02 실측, 이탈 시뮬 추가 전): lint 1초 + verify 약 80초 + score-sim 약 1초 = **약 1분 30초**. 이탈 시뮬(`derailSim`)이 들어간 score-sim은 `--runs=60`에서 약 15초, verify-polish는 Chromium 약 1분·WebKit 약 1분.
20분을 한참 밑돌아 빠른 버전은 따로 두지 않음 — 20분을 넘기게 되면 `verify.mjs --stages=0,4`
+ `score-sim.mjs --runs=20`을 빠른 버전으로 쓸 것.

### 항목별 검증과 WebKit (UI 폴리시 세션 추가, 2026-10-03)
```bash
node verify-polish.mjs                      # Chromium: lap(랩 문구)·derail(레일 이탈)·tutlayout·progress(기록)·popup(부스트 팝업)·overlap·input(합성 PointerEvent) — 약 1분
node verify-polish.mjs --browser=webkit     # 같은 시나리오를 WebKit(iPhone Safari 엔진, 375×667 터치 프로필)에서
node verify-polish.mjs --only=derail,input  # 일부만
node tutorial-test.mjs --browser=webkit     # 튜토리얼 키보드 흐름(터치 흐름은 CDP 전용이라 WebKit에선 건너뜀 — 터치는 verify-polish input이 대신)
```
WebKit은 한 번만 `npx playwright install webkit`(이 폴더 안에서). 새 항목 검증은 `verify-polish.mjs`에 `section('이름', async () => {...})`로 추가.
기존 흐름 검증(`verify.mjs`)은 `rc_derail=off`로 돌려 이탈이 흐름을 끊지 않게 하고, 이탈은 `verify-polish.mjs`의 `derail`이 따로 본다.

### 합격 기준 (하나라도 어기면 실패 — 안 바뀌어야 하는 것만)
- lint exit 0
- verify.mjs exit 0, 마지막 줄 `N/N checks passed, pageErrors=0`, `FAIL` 줄 0개
- score-sim.mjs exit 0, `PAGEERROR`/`CONSOLE` 오류 없음, 5개 스테이지 모두 완주(perfect.timeSec 존재)
- 완주 시간(perfect/average `timeSec`) 15초 이상
- 연속 이벤트 간격 `perfect.minEventGapSec` 0.6초 이상
- 평균 점수가 완벽 점수를 넘지 않음 (`average.overPerfect` = 0, `average.score` < `perfect.score`)

### 기준선 표 (참고용 — 합격 기준 아님)
2026-10-03 측정(균형 바 도입 후), `--runs=60`, 1랩, **균형 바 모델**(`--device=bar`, 기본). 시뮬레이션은 시드 고정이라 코드가 같으면 결과도 같음.
균형 바로 입력이 바뀐 건 의도한 변경 — 이전 표(버튼 모델)와 달라진 값(완벽 점수 +1~5%, 평균 점수 +20~30%)은 정밀한 입력이라 밸런스 Perfect(+50)를 더 자주 받기 때문(랭크는 Perfect를 제외해 판정 비율 분포는 비슷).

| 단계 | 완벽 완주(초) | 평균 완주(초) | 완벽 점수 | 평균 점수 | 저속 비율 완벽/평균 | 게이트 P/G/M(평균) | 랭크 분포 S/A/B/C | 최소 이벤트 간격(초) |
|---|---|---|---|---|---|---|---|---|
| 1 | 17.9 | 20.3 | 3398 | 1980 | 0.045 / 0.072 | .47/.27/.26 | 11/22/15/12 | 1.12 |
| 2 | 17.8 | 18.6 | 4298 | 2565 | 0.047 / 0.045 | .53/.25/.23 | 4/18/28/10 | 0.98 |
| 3 | 15.2 | 18.3 | 5355 | 2725 | 0.000 / 0.036 | .47/.25/.28 | 0/20/31/9 | 0.88 |
| 4 | 22.7 | 24.9 | 6117 | 3069 | 0.029 / 0.027 | .47/.22/.31 | 4/16/28/12 | 1.03 |
| 5 | 21.9 | 22.5 | 8055 | 3886 | 0.027 / 0.025 | .34/.33/.33 | 0/15/38/7 | 0.75 |

입력 방식별 공정성(`--device=bar|keyboard|tilt|button`, 평균 플레이어 100회): 커브 성공률은 바 0.78~0.87 · 키보드 0.69~0.79 · 기울기 0.70~0.88 · 예전 버튼 0.73~0.78로 비슷하고, 판정 비율(랭크 기준)도 0.56~0.65로 같은 범위. 성공 띠 폭(minLean·perfectRange·holdSec)은 그대로 둠. 차이는 밸런스 Perfect 비율뿐(바 0.73~0.81 · 기울기 0.46~0.78 · 키보드 0.13~0.18) — 정밀한 입력일수록 Perfect가 쉬운 건 의도이고 랭크에는 안 들어감.

레일 이탈 시뮬(`derailSim`, 2026-10-03, `--runs=300`, 균형 바 모델, 합격 기준 아님 — 설계 목표: 1~2단계 5% 미만, 5단계 20% 미만): 같은 시드의 평균 플레이어가 이탈 규칙을 알고 커브의 12%를 놓친다고 가정(`--dsloppy`, 기본 0.12).
"초보"는 커브의 25%를 놓치는 느슨한 플레이(`failRateNovice`). 균형 바는 입력이 정밀해 초보 기준에서도 5단계 실패율이 19%로 내려감(버튼 모델은 49%).

| 단계 | 평균 이탈 횟수 | 실패율(3번 이탈) | 초보(25%) 평균 이탈 | 초보 실패율 |
|---|---|---|---|---|
| 1 | 0.49 | 1.7% | 1.00 | 11% |
| 2 | 0.39 | 1.3% | 0.96 | 9% |
| 3 | 0.56 | 2.7% | 1.27 | 15% |
| 4 | 0.27 | 0.7% | 0.58 | 4% |
| 5 | 0.69 | 3.3% | 1.42 | 19% |

기준선과 달라졌을 때
- 의도한 변경이면: 이유를 `개발기록.md`에 적고 이 표를 새 측정값으로 갱신 (경고 아님).
- 의도하지 않은 큰 변동(예: 평균 완주 시간 ±20% 이상)만 경고로 보고. 합격/불합격에는 영향 없음.

### 보고 형식 (표 하나 + 한 줄 결론)

```
| 항목 | 결과 | 비고 |
| lint | PASS/FAIL | exit code, 소요 시간 |
| verify.mjs | PASS n/n | 실패 이름·pageErrors, 소요 시간 |
| score-sim | PASS/FAIL | 합격 기준 위반 항목, 소요 시간 |
기준선 변동: 없음 / 의도한 변경(개발기록 갱신) / 경고(±20% 이상 항목)
결론: 통과 / 실패 항목과 원인 한 줄
```

실패하는 항목이 있으면 고치지 말고 로그의 해당 줄만 인용해 원인을 보고한다. 기준을 임의로 완화하지 않는다.

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
