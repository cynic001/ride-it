#!/usr/bin/env node
/**
 * driver.mjs — launches ride-it in headless Chromium and drives one
 * representative flow: stage-select screen -> pick a stage -> scene
 * loads (Track/Cart constructed) -> cart.launch() -> run a bit ->
 * screenshot + console/page-error report.
 *
 * Zero external server dependency: serves the project root with
 * Node's built-in http module (avoids npx-installing http-server on
 * a machine with no cached packages).
 *
 * Usage:
 *   node driver.mjs [--stage=0] [--pull=0.6] [--shot=/tmp/ride-it.png] [--port=8123]
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..'); // .claude/skills/run-ride-it -> project root

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const STAGE = Number(args.stage ?? 0);
const PULL = Number(args.pull ?? 0.6);
const SHOT = args.shot ?? '/tmp/ride-it.png';
const PORT = Number(args.port ?? 8123);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.json': 'application/json' };

function startServer() {
  const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(ROOT, reqPath === '/' ? '/index.html' : reqPath);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const baseUrl = `http://localhost:${PORT}`;
  console.log(`[driver] serving ${ROOT} at ${baseUrl}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleMsgs = [];
  const pageErrors = [];
  page.on('console', msg => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => pageErrors.push(err.message));

  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.stage-btn', { timeout: 10000 });
    const stageCount = await page.locator('.stage-btn').count();
    console.log(`[driver] stage select loaded, ${stageCount} stages`);

    await page.locator(`.stage-btn[data-index="${STAGE}"]`).click();
    await page.waitForSelector('#startHint', { timeout: 10000 });
    console.log(`[driver] stage ${STAGE} scene loaded`);

    const track = await page.evaluate(() => {
      const t = window.Game.track;
      return t && {
        pointCount: t.points.length,
        segmentCount: t.segmentRanges.length,
        heightAt0: t.getHeightAt(0),
        heightAt1: t.getHeightAt(1),
      };
    });
    console.log('[driver] Track:', JSON.stringify(track));

    await page.evaluate(pull => window.Game.cart.launch(pull), PULL);
    const afterLaunch = await page.evaluate(() => ({ speed: window.Game.cart.speed, launched: window.Game.cart.launched }));
    console.log('[driver] Cart after launch:', JSON.stringify(afterLaunch));

    await page.waitForTimeout(1500);
    const afterRun = await page.evaluate(() => ({
      speed: window.Game.cart.speed, t: window.Game.cart.t,
      combo: window.Game.cart.combo, isFinished: window.Game.cart.isFinished,
    }));
    console.log('[driver] Cart after ~1.5s:', JSON.stringify(afterRun));

    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    await page.screenshot({ path: SHOT });
    console.log(`[driver] screenshot -> ${SHOT}`);
  } finally {
    console.log('--- console ---');
    consoleMsgs.forEach(m => console.log(m));
    console.log('--- page errors ---');
    pageErrors.length ? pageErrors.forEach(e => console.log('ERROR:', e)) : console.log('NONE');

    await browser.close();
    server.close();
  }

  if (pageErrors.length) process.exit(1);
}

main().catch(e => { console.error('[driver] FAILED:', e); process.exit(1); });
