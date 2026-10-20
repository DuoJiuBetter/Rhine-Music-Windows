import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { musicSelectionWave, settlingWave, damp } from '../src/motion.ts';

const preview=process.argv[2];
assert.ok(preview,'Pass the rendered, local visualization preview HTML as the first argument.');
const out=path.resolve('artifacts/ripple-2d');await fs.mkdir(out,{recursive:true});
const clamp=x=>Math.max(-.24,Math.min(.24,x));
const field=(row,time,pulses)=>clamp(pulses.reduce((sum,p)=>sum+musicSelectionWave(Math.abs(row-p.row),time-p.time),0));

// Fixed 60Hz mathematics, independent from browser refresh / remote display.
function experiment(rate){
  const current=[],quiet=[];let pending,selection=0,next=0,maxCount=0,maxRaw=0,maxInputJump=0,clippedFrames=0;
  const duration=11/rate+3.5;
  for(let frame=0;frame<=duration*60;frame++){
    const time=frame/60;
    while(next<12 && next/rate<=time+1e-9){
      selection++;const before=current.slice();current.push({row:selection,time});if(current.length>6)current.shift();
      for(let row=selection-20;row<=selection+20;row+=.25)maxInputJump=Math.max(maxInputJump,Math.abs(field(row,time,before)-field(row,time,current)));
      pending={row:selection,time};next++;maxCount=Math.max(maxCount,current.length);
    }
    if(pending && time-pending.time>=.18){quiet.splice(0,quiet.length,{row:pending.row,time});pending=undefined;}
    while(current.length && time-current[0].time>=3.2)current.shift();
    let clipped=false;
    for(let row=-20;row<=32;row+=.5){
      const raw=current.reduce((sum,p)=>sum+musicSelectionWave(Math.abs(row-p.row),time-p.time),0);
      maxRaw=Math.max(maxRaw,Math.abs(raw));if(Math.abs(raw)>.24)clipped=true;
    }
    if(clipped)clippedFrames++;
  }
  return{switchesPerSecond:rate,inputs:12,maxPulses:maxCount,maxRawRipple:maxRaw,maxAllowedRipple:.24,
    maxInstantRippleJumpAtInput:maxInputJump,clippedFrames,clippedDurationSeconds:clippedFrames/60,
    note:'Scalar animation field only; no 3D rendering, covers, shaders or GPU cost.'};
}
const deterministic=[2,4,8,12].map(experiment);
assert.ok(deterministic.every(r=>r.maxPulses===6 && r.maxInstantRippleJumpAtInput>0));
assert.ok(deterministic.some(r=>r.maxRawRipple>.24),'overlapping pulses reach the real scene clamp');

const errors=[];let browser;
const watchdog=setTimeout(()=>void browser?.close(),45000);
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--mute-audio']});
  const page=await browser.newPage({viewport:{width:736,height:1100}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(preview)).href);
  await page.frameLocator('iframe').locator('#rhine-ripple-lab-20261016 canvas').first().waitFor();
  const frame=page.frames().find(f=>f!==page.mainFrame());assert.ok(frame);
  await frame.waitForFunction(()=>document.getElementById('rhine-ripple-lab-20261016')?.waveLab);
  const samples=Array.from({length:160},(_,i)=>({distance:i*.13,age:(i%37)*.1-.1}));
  const scalar=await frame.evaluate(samples=>{
    const lab=document.getElementById('rhine-ripple-lab-20261016').waveLab;
    return samples.map(({distance,age})=>{
      const spring={value:distance/4,velocity:age};lab.damp(spring,.9,4.5,1/60);
      return{wave:lab.musicSelectionWave(distance,age),base:lab.settlingWave(distance,26.56),spring};
    });
  },samples);
  for(let i=0;i<samples.length;i++){
    const {distance,age}=samples[i],spring={value:distance/4,velocity:age};damp(spring,.9,4.5,1/60);
    assert.ok(Math.abs(scalar[i].wave-musicSelectionWave(distance,age))<1e-12);
    assert.ok(Math.abs(scalar[i].base-settlingWave(distance,26.56))<1e-12);assert.deepEqual(scalar[i].spring,spring);
  }
  await frame.locator('[data-act="next"]').click();
  assert.equal(await frame.evaluate(()=>document.getElementById('rhine-ripple-lab-20261016').waveLab.state.row),1);
  await frame.locator('[data-act="prev"]').click();
  assert.equal(await frame.evaluate(()=>document.getElementById('rhine-ripple-lab-20261016').waveLab.state.row),0);
  await frame.locator('[data-act="burst"]').click();
  await frame.waitForFunction(()=>document.getElementById('rhine-ripple-lab-20261016').waveLab.state.delivered===12);
  await page.screenshot({path:path.join(out,'overlap.png'),fullPage:true});
  await frame.locator('[data-input="isolate"]').check();
  await page.screenshot({path:path.join(out,'isolated.png'),fullPage:true});
  await frame.waitForFunction(()=>!document.getElementById('rhine-ripple-lab-20261016').waveLab.state.running,{},{timeout:15000});
  const runtime=await frame.evaluate(()=>{
    const {state}=document.getElementById('rhine-ripple-lab-20261016').waveLab;
    const values=state.intervals.slice().sort((a,b)=>a-b);
    return{delivered:state.delivered,maxPulses:state.maxPulses,frameSamples:values.length,
      frameP95:values[Math.floor(values.length*.95)],over50ms:values.filter(v=>v>50).length,
      fps:1000/(values.reduce((a,b)=>a+b,0)/values.length),maxRippleJump:state.sourceJump,
      offPulses:state.pulses.off.length,rafStopped:state.frame===0};
  });
  assert.equal(runtime.delivered,12);assert.equal(runtime.maxPulses,6);assert.equal(runtime.offPulses,0);assert.equal(runtime.rafStopped,true);
  await page.setViewportSize({width:360,height:1100});
  const narrow=await frame.evaluate(()=>{const r=document.getElementById('rhine-ripple-lab-20261016');return{width:r.clientWidth,scroll:r.scrollWidth};});
  assert.ok(narrow.scroll<=narrow.width+1,'narrow view fits without horizontal scrolling');
  await page.screenshot({path:path.join(out,'narrow.png'),fullPage:true});assert.deepEqual(errors,[]);
  const result={passed:true,sourceMathComparisons:160,deterministic,runtime,narrow,errors,
    scope:'One muted, GPU-disabled 2D run. Source scalar equations, 6-pulse cap and 3.2s lifetime matched. Three.js/GPU bottlenecks and real playback not tested.'};
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{clearTimeout(watchdog);await browser?.close();}
