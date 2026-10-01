// camera-log.mjs — 3인칭 설정으로 실제 게임 루프 1랩 주행(게이트 자동 정타)하며 카메라 시점 변화·원인·1인칭 비율 기록(13번 2-7)
// Usage: node camera-log.mjs [스테이지 인덱스 목록, 기본 2,3,4] [port]
// 3인칭 설정으로 실제 게임 루프 1랩 주행 — 프레임마다 카메라 목표/블렌드와 원인(부스트/급하강/수동/설정) 기록
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'), PORT=Number(process.argv[3]||8156), STAGES_TO=(process.argv[2]||'2,3,4').split(',').map(Number);
const srv=http.createServer((q,r)=>{const f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/octet-stream'});r.end(d)})}).listen(PORT);
const b=await chromium.launch({ args: ['--use-angle=metal'] }); const errs=[]; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const result={};
for (const st of STAGES_TO) {
  const ctx=await b.newContext({viewport:{width:375,height:667}}); const p=await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message));
  await ctx.addInitScript(()=>{localStorage.clear();localStorage.setItem('rc_howto_seen','1');localStorage.setItem('rc_tutorial_done','1');localStorage.setItem('rc_quality','low');localStorage.setItem('rc_laps','1');localStorage.setItem('rc_view','third')});
  await p.goto(`http://localhost:${PORT}/index.html`); await p.click('#titleScreen'); await p.click(`.stage-btn[data-index="${st}"]`); await p.click('#stageStartBtn');
  await p.waitForSelector('#startBar',{timeout:30000}); await sleep(500);
  await p.evaluate(()=>{ // 게이트 자동 정타 + 프레임 로그
    window.__log=[]; const tap=()=>{const c=Game.cart;const g=c.gateTiming&&c.gateTiming(); if(g&&!g.done&&Math.abs(g.err)<0.02&&!window['__g'+g.key]){window['__g'+g.key]=1; const res=c.resolveGate(); window.dispatchEvent(new CustomEvent('gate-result',{detail:{type:c.lastGateType,result:res}}));}
      if(c.rollback&&c.rollback.phase==='mash') c.mashTap();
      const cam=Game.camera, tr=Game.track, ty=tr.getTangentAt(c.t).y;
      window.__log.push({ts:performance.now(),t:c.t,lap:c.currentLap,fin:c.isFinished,target:cam._lastTarget,blend:cam._blendLin,boost:c.boostRemaining>0,dive:ty<-0.35,auto:(Game.camera.autoLog.at(-1)||{}).reason,rb:!!c.rollback,view:ViewSettings.mode,manual:cam._clock<cam._manualUntil,splash:tr.splash?Math.abs(c.t-tr.splash.t)<0.01:false,launched:c.launched});
      if(!c.isFinished) requestAnimationFrame(tap);}; requestAnimationFrame(tap);});
  await p.keyboard.down('ArrowDown'); await sleep(600); await p.keyboard.up('ArrowDown'); await p.keyboard.press('ArrowUp');
  await p.waitForFunction(()=>Game.cart.isFinished,null,{timeout:90000}).catch(()=>{});
  const log=await p.evaluate(()=>window.__log.filter(x=>x.launched));
  // 구간화: blend>=0.5 = 1인칭
  const t0=log[0].ts, T=(log.at(-1).ts-t0)/1000; let firstSec=0, ev=[], prev=null, prevTarget=null;
  for(let i=1;i<log.length;i++){const x=log[i],dt=(x.ts-log[i-1].ts)/1000; if(x.blend>=0.5) firstSec+=dt;
    if(x.target!==prevTarget){ev.push(`${((x.ts-t0)/1000).toFixed(1)}s ${x.target? '→1인칭':'→3인칭'} (t=${x.t.toFixed(3)} 원인=${x.target?x.auto:'-'} boost=${x.boost} dive=${x.dive} rb=${x.rb})`); prevTarget=x.target;}}
  const extra=await p.evaluate(()=>({bigDrops:Game.track.bigDrops.map(x=>+x.toFixed(3)),autoLog:Game.camera.autoLog}));
  result[st+1]={...extra,rideSec:+T.toFixed(1), firstRatio:+(firstSec/T).toFixed(2), boostRatio:+(log.filter(x=>x.boost).length/log.length).toFixed(2), diveRatio:+(log.filter(x=>x.dive).length/log.length).toFixed(2), view:log[0].view, events:ev};
  await ctx.close();
}
console.log(JSON.stringify(result,null,1)); console.log('errors',errs.length?errs:'NONE'); await b.close(); srv.close();
