import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';

// One bounded Canvas 2D run of production TypeScript. No WebGL, music or account.
const out=path.resolve('artifacts/ripple-handoff');await fs.mkdir(out,{recursive:true});
const prior=execFileSync('git',['show','03a65f3:src/music-selection-ripples.ts'],{encoding:'utf8'});
const priorJS=ts.transpileModule(prior.replace(/^import[^\r\n]*\r?\n/m,'').replace('export interface','interface')
 .replace('export class MusicSelectionRipples','class PriorPolicy'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#080f18;color:#e1e8ef;font:16px system-ui}h2,p{margin:20px}canvas{width:100%;height:280px}</style>
<h2>连续切换：波浪合并与平滑退场</h2><p id="status"></p><canvas width="1000" height="280"></canvas>
<script type="module">
import {MusicSelectionRipples} from '/src/music-selection-ripples.ts';
import {musicSelectionWave,smooth} from '/src/motion.ts';
${priorJS}
const policy=new MusicSelectionRipples(),canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
const state=window.rippleTest={delivered:0,frames:0,stopped:false,active:0,snapshot:null};
let start;const begin=now=>{start=now;requestAnimationFrame(tick)};
function tick(now){
 const time=(now-start)/1000;
 while(state.delivered<12&&state.delivered/8<=time){policy.request({row:state.delivered,lane:2},time);state.delivered++}
 const waves=policy.update(time);state.active=waves.length;state.snapshot=policy.snapshot();state.frames++;
 ctx.clearRect(0,0,1000,280);ctx.strokeStyle='#738b9b';ctx.lineWidth=2;ctx.beginPath();
 for(let i=0;i<=300;i++){const row=-8+i*.12;let y=waves.reduce((sum,p)=>sum+musicSelectionWave(Math.abs(row-p.row),time-p.time)*p.gain,0);y=Math.max(-.24,Math.min(.24,y));const x=i/300*1000;if(i===0)ctx.moveTo(x,145-y*300);else ctx.lineTo(x,145-y*300)}ctx.stroke();
 for(let row=-8;row<29;row++){const x=(row+8)/36*1000;ctx.fillStyle=row===state.delivered-1?'#efb979':'#455967';ctx.fillRect(x,166,10,row===state.delivered-1?52:28)}
 document.querySelector('#status').textContent='已切换 '+state.delivered+' / 12 · 活跃波浪 '+waves.length+' · 已发出 '+state.snapshot.emitted+' · 合并 '+state.snapshot.coalesced;
 if(time<5.4)requestAnimationFrame(tick);else state.stopped=true;
}
window.startRippleTest=()=>requestAnimationFrame(begin);
window.startSecondSwitchTest=()=>{
 const before=new PriorPolicy(),after=new MusicSelectionRipples();let start,delivered=0;
 const result=window.secondSwitch={stopped:false,time:0,frames:0,delivered:0,
  before:{minimumAmplitude:1,weakFrames:0},after:{minimumAmplitude:1,weakFrames:0}};
 function frame(now){
  start??=now;const time=(now-start)/1000;result.time=time;result.frames++;
  while(delivered<2&&[0,.45][delivered]<=time){const cell={row:delivered,lane:2};before.request(cell,time);after.request(cell,time);delivered++}
  result.delivered=delivered;ctx.clearRect(0,0,1000,280);
  for(const [index,[name,policy]] of [['before',before],['after',after]].entries()){
   const waves=policy.update(time);let amplitude=0;ctx.beginPath();ctx.strokeStyle=index?'#efb979':'#738b9b';ctx.lineWidth=2;
   for(let i=0;i<=400;i++){const row=-15+i*.1;let y=waves.reduce((sum,p)=>sum+musicSelectionWave(Math.abs(row-p.row),time-p.time)*p.gain,0);y=Math.max(-.24,Math.min(.24,y));amplitude=Math.max(amplitude,Math.abs(y));const x=i/400*1000,py=70+index*140-y*300;if(i===0)ctx.moveTo(x,py);else ctx.lineTo(x,py)}ctx.stroke();
   ctx.fillStyle=index?'#efb979':'#738b9b';ctx.font='16px system-ui';ctx.fillText(index?'新版：保持运动后交接':'上版：先退场，再重新起步',20,24+index*140);
   if(time>=.65&&time<=.85){result[name].minimumAmplitude=Math.min(result[name].minimumAmplitude,amplitude);if(amplitude<.005)result[name].weakFrames++}
  }
  document.querySelector('#status').textContent='两次切换间隔450ms · 时间 '+time.toFixed(2)+'s · 同一波形与位置';
  if(time<1.5)requestAnimationFrame(frame);else result.stopped=true;
 }
 requestAnimationFrame(frame);
};
</script>`;
let server,browser;const errors=[];
const watchdog=setTimeout(()=>void browser?.close(),25000);
try{
 server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{
  name:'isolated-ripple-fixture',configureServer(dev){
   dev.middlewares.use((req,res,next)=>{if(req.url!=='/__ripple_test')return next();res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)});
  },
 }]});
 await server.listen();const port=server.httpServer.address().port;
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--mute-audio']});
 const page=await browser.newPage({viewport:{width:1000,height:390}});page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+port+'/__ripple_test');await page.waitForFunction(()=>window.startRippleTest);await page.evaluate(()=>window.startRippleTest());
 await page.waitForFunction(()=>window.rippleTest.delivered>=6);
 const during=await page.evaluate(()=>window.rippleTest);assert.equal(during.snapshot.emitted,0);assert.equal(during.active,0);
 await page.screenshot({path:path.join(out,'coalescing.png')});
 await page.waitForFunction(()=>window.rippleTest.snapshot.emitted===1&&window.rippleTest.active===1);
 await page.waitForFunction(()=>window.rippleTest.frames>130);
 await page.screenshot({path:path.join(out,'final-ripple.png')});
 await page.waitForFunction(()=>window.rippleTest.stopped,{},{timeout:10000});
 const result=await page.evaluate(()=>window.rippleTest);
 assert.equal(result.delivered,12);assert.equal(result.snapshot.emitted,1);assert.equal(result.snapshot.coalesced,11);
 assert.equal(result.snapshot.peakActive,1);assert.equal(result.active,0);assert.deepEqual(errors,[]);
 await page.evaluate(()=>window.startSecondSwitchTest());
 await page.waitForFunction(()=>window.secondSwitch.time>=.7);
 await page.screenshot({path:path.join(out,'second-switch.png')});
 await page.waitForFunction(()=>window.secondSwitch.stopped);
 const secondSwitch=await page.evaluate(()=>window.secondSwitch);
 assert.equal(secondSwitch.delivered,2);assert.ok(secondSwitch.before.weakFrames>0);assert.equal(secondSwitch.after.weakFrames,0);
 assert.ok(secondSwitch.after.minimumAmplitude>secondSwitch.before.minimumAmplitude*10);assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'browser.json'),JSON.stringify({passed:true,...result,secondSwitch,errors,scope:'One GPU-disabled Canvas 2D session: production scheduler and immutable Ripple1 control; full 3D / native runtime / FPS improvement not tested.'},null,2));
 console.log(JSON.stringify({passed:true,...result,secondSwitch,errors}));
}finally{clearTimeout(watchdog);await browser?.close();await server?.close();}
