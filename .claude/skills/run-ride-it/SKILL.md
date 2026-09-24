---
name: run-ride-it
description: Build, run, and drive the ride-it (떨어진다!!!) Babylon.js browser game. Use when asked to run ride-it, start its dev server, load a stage, screenshot its scene, or verify track.js/cart.js/stages.js changes actually work in a browser.
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
(`#startHint`) → reads back `window.Game.track` (point/segment counts,
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
[driver] serving /Users/gon/Downloads/ride-it at http://localhost:8123
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
npm run lint   # npx eslint js/ --no-eslintrc --env browser,es2021 --parser-options=ecmaVersion:2021
```

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
- **No real GLB/track meshes yet** — `main.js` only draws a debug
  `BABYLON.MeshBuilder.CreateLines` for the track, so screenshots show
  a thin white line on a sky-blue background, not a rendered coaster.
  That's expected at this stage of the project (see `개발기록.md`), not
  a driver bug.
- **`combo` stays `0` in the smoke run** — `cart.leanInput` is never
  set (that's `input.js`'s job via pointer-swipe events, which this
  driver doesn't simulate). Expected; the driver checks that physics
  *runs*, not full input-to-combo scoring. To exercise combo/gate
  logic, drive it via `page.evaluate(() => window.Game.cart.leanInput = ...)`
  or extend the driver with a `--lean=` flag.
