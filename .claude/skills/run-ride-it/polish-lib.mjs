// verify-polish.mjs 공용 헬퍼 — 정적 서버 + 브라우저(chromium/webkit, 375×667 터치) 시작
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.json': 'application/json', '.m4a': 'audio/mp4', '.webmanifest': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function start({ browser = 'chromium', port = 8200, w = 375, h = 667, init = {}, url = '/index.html' } = {}) {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    fs.readFile(path.join(ROOT, p === '/' ? '/index.html' : p), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d);
    });
  });
  await new Promise(r => server.listen(port, r));
  const b = await (browser === 'webkit' ? webkit : chromium).launch();
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(o => { // 첫 실행 안내가 클릭을 가리지 않게
    if (!localStorage.getItem('rc_howto_seen')) localStorage.setItem('rc_howto_seen', '1');
    if (!localStorage.getItem('rc_tutorial_asked')) localStorage.setItem('rc_tutorial_asked', '1');
    for (const k in o) localStorage.setItem(k, o[k]);
  }, init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${port}${url}`);
  await page.waitForFunction(() => window.UI && window.STAGES, null, { timeout: 20000 });
  return { page, errors, close: async () => { await b.close(); server.close(); } };
}

export async function loadStage(page, i) {
  await page.evaluate(i => Game.loadStage(i), i);
  await page.waitForSelector('#startBar', { timeout: 30000 });
}
