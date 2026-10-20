import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';
import { chromium } from 'playwright';
import { startFixture } from './windows-fixture.mjs';

// Full-scene cache-ablation test. Instrumentation exists ONLY in this build.
// Both sides retain identical shared tile layout, decode cache and shaders.
// Bypass forces an already decoded/ready print to repaint/reupload on rebind.
const matrix = process.env.RHINE_COVER_MATRIX === '1';
const output = process.env.RHINE_RESIDENCY_OUTPUT || (matrix
  ? 'artifacts/benchmark/cover-optimization-four-way.json'
  : 'artifacts/benchmark/cover-residency-scene.json');
const outDir = 'artifacts/benchmark/residency-dist';
const delayMs = Math.max(0, Math.min(60000, Number(process.env.RHINE_RESIDENCY_DELAY_MS) || 0));
if (delayMs) {
  console.log(`Waiting ${delayMs / 1000} seconds for user RDP disconnect.`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}
const execFileAsync = promisify(execFile);
const readSession = async () => {
  if (process.platform !== 'win32') return {state:'Unavailable'};
  try {
    const {stdout} = await execFileAsync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',
      String.raw`$taskSessionId=(Get-Process -Id $PID).SessionId; $taskLines=& "$env:WINDIR\System32\query.exe" session $taskSessionId 2>$null; $taskText=$taskLines -join ' '; $taskState=if($taskText -match '\bDisc\b|断开'){'Disconnected'}elseif($taskText -match '\bActive\b|活动'){'Active'}else{'Unknown'}; [pscustomobject]@{sessionId=$taskSessionId;state=$taskState}|ConvertTo-Json -Compress`],
      {timeout:5000,windowsHide:true});
    return {...JSON.parse(stdout),at:new Date().toISOString()};
  } catch { return {state:'Unavailable',at:new Date().toISOString()}; }
};
const sessionAtStart=await readSession();
console.log(JSON.stringify({phase:'session-at-start',...sessionAtStart}));
let browser, fixture;
let pacingControl;
const runs = [];
const failures = [];
let closing;
const cleanup = () => closing ??= (async () => {
  await browser?.close().catch(() => {});
  await fixture?.close().catch(() => {});
})();
const deadline = setTimeout(() => {
  failures.push('Eight-minute deadline exceeded; no retry.');
  console.error(failures.at(-1));
  void cleanup();
}, 8 * 60000);
deadline.unref();
const plugin = {
  name: 'cover-residency-experiment-only', enforce: 'pre',
  transform(source, id) {
    if (id.endsWith('/src/cover-atlas.ts')) {
      const marker = '    if (entry) {\n      entry.used = ++this.residencyClock;';
      let normalized = source.replaceAll('\r\n', '\n');
      const constructorMarker = '    this.rows = Math.ceil(count / this.columns);';
      assert.ok(normalized.includes(constructorMarker));
      normalized = normalized.replace(constructorMarker,
        '    globalThis.__rhineCoverBenchAtlas = this;\n' + constructorMarker);
      assert.ok(normalized.includes(marker), 'Exact cache branch must match');
      return normalized.replace(marker, `    if (entry) {
      if (globalThis.__rhineCoverBenchMode === 'bypass' && entry.ready) {
        const decoded = this.cachedImage(record?.album?.coverUrl);
        if (decoded) {
          this.paintResident(entry, record, decoded);
          entry.ready = false;
          globalThis.__rhineCoverBenchBypasses++;
        }
      }
      entry.used = ++this.residencyClock;`);
    }
    if (id.endsWith('/src/music-app.ts')) {
      const marker = 'Object.assign(window, {\n  rhineMusic:';
      const normalized = source.replaceAll('\r\n', '\n');
      assert.ok(normalized.includes(marker), 'Exact diagnostics branch must match');
      return normalized.replace(marker, `Object.assign(window, {
  __rhineCoverBench: {
    mode(value, batch = true) {
      globalThis.__rhineCoverBenchMode = value; globalThis.__rhineCoverBenchBypasses = 0;
      globalThis.__rhineCoverBenchAtlas.batchUploads = batch;
    },
    resetTiming() { frameTiming.reset(); },
    read() { return {frame:frameTiming.snapshot(), scene:scene?.getStats(),
      selected:currentAlbum()?.id, bypasses:globalThis.__rhineCoverBenchBypasses || 0}; }
  },
  rhineMusic:`);
    }
  },
};
await fs.mkdir('artifacts/benchmark', { recursive: true });
try {
  console.log('Building isolated benchmark assets; no native compilation.');
  await build({ logLevel: 'error', plugins: [plugin],
    build: { outDir, emptyOutDir: false, reportCompressedSize: false } });
  fixture = await startFixture(outDir, 128);
  browser = await chromium.launch({
    executablePath: process.env.RHINE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, timeout: 20000, args: ['--enable-gpu-benchmarking'],
  });
  for (const arrayBudget of matrix ? [0] : [1, 0]) {
    const inputs = arrayBudget ? 80 : 60;
    const context = await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1.5});
    await context.addInitScript(budget => {
      localStorage.clear();
      globalThis.__rhineCoverBenchMode = 'hit';
      localStorage.setItem('rhine-music-preferences', JSON.stringify({
        bgm:false,sound:false,volume:0,quality:'original',theme:'night',
        renderQuality:{scale:100,pixelRatio:1.5,antialias:'off',shadows:1024,
          arrayBudget:budget,aoSamples:16,aoResolution:.5,depthOfField:100,transmission:.5,anisotropy:8},
      }));
    }, arrayBudget);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('Page error: '+error.message); });
    page.on('crash', () => { errors.push('Browser page crashed; no retry.'); void cleanup(); });
    page.setDefaultTimeout(60000);
    await page.goto(fixture.url+'?scene=archive&lab=0&scheduler=1&render=optimized&coverBatch=1');
    const startupReporter = setInterval(() => {
      void page.evaluate(() => ({loading:document.querySelector('#music-loading')?.textContent,
        stats:window.rhineMusic?.stats()?.graphics})).then(status => console.log(JSON.stringify({phase:'startup',arrayBudget,...status}))).catch(() => {});
    },15000);
    try {
      await page.waitForFunction(() => window.rhineMusic?.stats()?.loaded && !document.querySelector('#music-loading'),null,{timeout:150000});
    } finally { clearInterval(startupReporter); }
    await page.waitForTimeout(1500);
    const keys = Array.from({length:inputs}, (_, i) => i%4===0?'ArrowRight':'ArrowDown');
    const reverse = [...keys].reverse().map(key => key==='ArrowRight'?'ArrowLeft':'ArrowUp');
    const navigate = async sequence => {
      for (const key of sequence) {
        if (errors.length) throw new Error(errors.join('; '));
        await page.keyboard.press(key);
        await page.waitForTimeout(100);
      }
    };
    const read = () => page.evaluate(() => {
      const host=document.querySelector('#three-scene');
      const gl=host.querySelector('canvas').getContext('webgl2');
      return {...window.__rhineCoverBench.read(), glError:gl.getError(),
        quality:JSON.parse(host.dataset.renderQuality||'{}')};
    });
    console.log(JSON.stringify({phase:'warmup',arrayBudget,inputs}));
    const origin = await read();
    await navigate(keys); await navigate(reverse);
    await page.waitForTimeout(2000);
    const conditions = matrix ? [
      {group:1,batch:false,mode:'bypass'}, {group:2,batch:true,mode:'bypass'},
      {group:3,batch:false,mode:'hit'}, {group:4,batch:true,mode:'hit'},
      {group:4,batch:true,mode:'hit'}, {group:3,batch:false,mode:'hit'},
      {group:2,batch:true,mode:'bypass'}, {group:1,batch:false,mode:'bypass'},
    ] : ['bypass','hit','hit','bypass'].map(mode=>({batch:true,mode}));
    for (const [order,condition] of conditions.entries()) {
      const {mode,batch,group:groupId}=condition;
      const ready = await read();
      assert.equal(ready.selected, origin.selected, 'Return to identical starting album');
      assert.equal(ready.scene.covers.pendingImages,0,'No image decoding during measured navigation start');
      await page.evaluate(({mode,batch}) => { window.__rhineCoverBench.mode(mode,batch); }, {mode,batch});
      const session=await readSession();
      // Session queries occur before resetting timing, outside the measured window.
      await page.evaluate(() => window.__rhineCoverBench.resetTiming());
      const initial=await read();
      assert.equal(initial.scene.covers.batchUploads,batch);
      const started=Date.now();
      await navigate(keys);
      const final=await read();
      const a=initial.scene.covers,b=final.scene.covers;
      const run={arrayBudget,inputs,order,mode,batch,group:groupId,session,elapsedMs:Date.now()-started,
        initial,final,frame:final.frame,
        delta:{uploadedTiles:b.uploadedTiles-a.uploadedTiles,uploadCalls:b.uploadCalls-a.uploadCalls,
          uploadedBytes:b.uploadedBytes-a.uploadedBytes,batchedTiles:b.batchedTiles-a.batchedTiles,
          residentReuses:b.residentReuses-a.residentReuses,
          residentReadyReuses:b.residentReadyReuses-a.residentReadyReuses,
          residentEvictions:b.residentEvictions-a.residentEvictions},errors:[...errors]};
      runs.push(run);
      console.log(JSON.stringify({phase:'measured',arrayBudget,order,mode,batch,group:groupId,frame:run.frame,delta:run.delta,
        bypasses:final.bypasses,gpu:final.scene.graphics.renderer,glError:final.glError}));
      assert.deepEqual(errors,[]);
      assert.equal(final.glError,0);
      assert.equal(final.scene.graphics.contextLost,false);
      assert.equal(run.delta.residentEvictions,0,'Atlas capacity must not confound reuse');
      if(mode==='bypass') assert.ok(final.bypasses>0 && run.delta.uploadCalls>0);
      else {
        assert.ok(run.delta.residentReadyReuses>0,'Hit condition must actually reuse resident images');
        assert.equal(run.delta.uploadCalls,0,'Fully warmed hit route must avoid atlas transfers');
      }
      if (!batch) assert.equal(run.delta.batchedTiles,0,'Batch-off condition cannot coalesce tiles');
      // Return motion is excluded; use hit mode for the same recovery in both conditions.
      await page.evaluate(() => window.__rhineCoverBench.mode('hit'));
      await navigate(reverse);
      await page.waitForTimeout(2000);
    }
    const group=runs.filter(run=>run.arrayBudget===arrayBudget);
    for(const run of group){
      assert.deepEqual(run.initial.quality,group[0].initial.quality);
      assert.deepEqual(run.final.quality,group[0].final.quality);
      assert.equal(run.final.selected,group[0].final.selected);
      assert.deepEqual(run.initial.scene.selectedCell,group[0].initial.scene.selectedCell);
      assert.deepEqual(run.final.scene.selectedCell,group[0].final.scene.selectedCell);
      assert.deepEqual(run.initial.scene.poolBounds,group[0].initial.scene.poolBounds);
      assert.equal(run.initial.scene.covers.dirtyTiles,0);
      assert.equal(run.initial.scene.covers.residentTiles,128);
    }
    await context.close();
  }
  // Separate empty-page control characterizes host/browser RAF pacing only.
  const blankContext=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1.5});
  const blank=await blankContext.newPage();
  await blank.goto('about:blank');
  pacingControl=await blank.evaluate(async()=>{
    const times=[];
    await new Promise(resolve=>{const tick=t=>{times.push(t);if(times.length<121)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
    const gaps=times.slice(1).map((t,i)=>t-times[i]),sorted=[...gaps].sort((a,b)=>a-b);
    return{samples:gaps.length,fps:1000*gaps.length/(times.at(-1)-times[0]),p50:sorted[60],p95:sorted[114],max:sorted.at(-1),gaps};
  });
  await blankContext.close();
  console.log(JSON.stringify({phase:'blank-page-pacing',...pacingControl,gaps:undefined}));
} catch(error) {
  failures.push(String(error.stack||error));
  process.exitCode=1;
  console.error(error);
} finally {
  clearTimeout(deadline);
  await cleanup();
  const sessionAtEnd=await readSession();
  await fs.writeFile(output,JSON.stringify({at:new Date().toISOString(),runs,failures,pacingControl,sessionAtStart,sessionAtEnd,
    matrix,
    note:matrix
      ? 'Same-build 2x2 ablation: batching off/on x forced resident repaint/reupload / ready-resident reuse. All decoded images, shaders and route warmed. Shared atlas layout unchanged. Four conditions forward then reverse order; two runs each. Original array budget, 60 navigation inputs. Not an old-version or first-network-load test. Synthetic fixtures; no accounts.'
      : 'Same current build, batching always enabled, warmed decode/shader caches. Only ready-resident repaint/upload bypass changes. This ablation is not an old-version benchmark or first-network-load test. Single page per preset, ABBA order, identical forward/reverse keys. Synthetic fixtures; no accounts.',
    build:path.resolve(outDir)},null,2)+'\n');
  console.log('Saved '+output);
}
