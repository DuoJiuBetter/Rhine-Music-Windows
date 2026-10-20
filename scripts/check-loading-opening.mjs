// Exercise the real SVG film and lifecycle with a virtual clock, no WebGL,
// private library, platform requests or audio.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server=await createServer({configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/release/**','**/src-tauri/target/**']}}});
await server.listen();
const browser=await chromium.launch({headless:true,args:['--disable-gpu','--mute-audio']});
const errors=[],reports=[];
async function fixture(width=1280,height=850){
  const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install();
  await page.route('**/opening-check',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>body{margin:0}#viewport{position:fixed;inset:0}</style><main id="viewport"><div id="stage"><button id="under">Underlying action</button></div></main><script type="module">import {LoadingOpening} from '/src/loading-opening/index.ts'; window.opening=new LoadingOpening(document.querySelector('#stage')); window.completed=false;</script>`}));
  await page.goto(server.resolvedUrls.local[0]+'opening-check');await page.waitForFunction(()=>!!window.opening);return page;
}
try{
  await fs.mkdir('artifacts/loading-opening',{recursive:true});
  const natural=await fixture();
  await natural.evaluate(()=>{void opening.completeLoading().then(()=>window.completed=true);});
  await natural.clock.runFor(9000);
  assert.equal(await natural.evaluate(()=>window.completed),false,'prepared model still waits for the film');
  assert.equal(await natural.locator('#stage').evaluate(n=>n.inert),true);
  await natural.screenshot({path:'artifacts/loading-opening/logo.png'});
  await natural.clock.runFor(7000);
  await natural.screenshot({path:'artifacts/loading-opening/orbit.png'});
  await natural.clock.runFor(4000);
  await natural.screenshot({path:'artifacts/loading-opening/welcome.png'});
  await natural.clock.runFor(2200);
  assert.equal(await natural.evaluate(()=>window.completed),true);
  assert.equal(await natural.locator('#stage').evaluate(n=>n.inert),false);
  assert.equal(await natural.evaluate(()=>opening.active),false);
  await natural.close();reports.push('natural 21.92 s film completion waits for both film and resources; model-ready alone does not end the film');
  const slow=await fixture();await slow.clock.runFor(22500);
  assert.equal(await slow.locator('.rhine-loading').getAttribute('data-state'),'waiting');
  assert.equal(await slow.locator('#stage').evaluate(n=>n.inert),true);
  await slow.evaluate(()=>opening.completeLoading());
  assert.equal(await slow.evaluate(()=>opening.active),false);
  await slow.close();reports.push('slow resource preparation holds a static screen without a spinner or film restart');
  const hidden=await fixture();await hidden.clock.runFor(600);
  const before=await hidden.locator('.opening-stage').getAttribute('data-boot-frame');
  await hidden.evaluate(()=>opening.setHidden(true));await hidden.clock.runFor(60000);
  assert.equal(await hidden.locator('.opening-stage').getAttribute('data-boot-frame'),before);
  await hidden.evaluate(()=>opening.setHidden(false));await hidden.clock.runFor(200);
  const after=Number(await hidden.locator('.opening-stage').getAttribute('data-boot-frame'));
  assert.ok(after>Number(before)&&after-Number(before)<8,'restore resumes rather than consuming hidden time');
  await hidden.evaluate(()=>{void opening.completeLoading().then(()=>window.completed=true);opening.setReduced(true);});
  assert.equal(await hidden.evaluate(()=>window.completed),true);
  await hidden.close();reports.push('native-hidden film stops RAF, resumes without catch-up, and live reduced motion skips it');
  const disposed=await fixture();await disposed.evaluate(()=>{void opening.completeLoading().then(()=>window.completed=true);opening.dispose();});
  assert.equal(await disposed.evaluate(()=>window.completed),true,'disposing unblocks pending startup');
  assert.equal(await disposed.locator('.rhine-loading').count(),0);
  await disposed.close();
  for(const [width,height] of [[2100,900],[800,1000]]){
    const page=await fixture(width,height);await page.clock.runFor(19500);
    const rect=await page.locator('.welcome').boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width+1&&rect.y+rect.height<=height+1);
    await page.screenshot({path:`artifacts/loading-opening/${width}x${height}.png`});await page.close();
  }
  reports.push('ultrawide and portrait welcome artwork remains inside the viewport; disposal releases startup waiters');
  assert.deepEqual(errors,[]);
  await fs.writeFile('artifacts/loading-opening/result.json',JSON.stringify({passed:true,reports,webgl:false,realAccount:false},null,2));console.log(JSON.stringify({passed:true,reports,webgl:false},null,2));
}finally{await browser.close();await server.close();}
