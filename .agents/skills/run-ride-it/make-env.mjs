#!/usr/bin/env node
/**
 * make-env.mjs — Poly Haven .hdr → Babylon 프리필터드 .env 변환 (headless Chromium, 1회성 에셋 빌드 도구)
 * 런타임에 HDRCubeTexture로 .hdr을 직접 쓰면 모바일 CPU에서 프리필터링이 돌아 로딩이 느려지므로
 * 미리 변환한 .env만 배포한다.
 * Usage: node make-env.mjs <in.hdr(프로젝트 루트 기준)> <out.env> [size=256]
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const [inRel, outPath, size = '256'] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (req.url === '/') { res.end('<html><body><canvas id="c"></canvas></body></html>'); return; }
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); } else res.end(d); });
}).listen(8125);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => console.log('[page]', m.text()));
await page.goto('http://localhost:8125/');
await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/babylonjs/7.25.0/babylon.js' });
const b64 = await page.evaluate(async ({ inRel, size }) => {
  const engine = new BABYLON.Engine(document.getElementById('c'));
  const scene = new BABYLON.Scene(engine);
  const tex = new BABYLON.HDRCubeTexture('/' + inRel, scene, size, false, true, false, true);
  await new Promise(r => tex.onLoadObservable.addOnce(r));
  const buf = await BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync(tex, { imageType: 'image/png' });
  let s = ''; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}, { inRel, size: Number(size) });
fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes');
await browser.close();
server.close();
