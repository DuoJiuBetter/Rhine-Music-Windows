import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {build} from 'vite';
import {chromium} from 'playwright';
import {startFixture} from './windows-fixture.mjs';
import {launchNativeBenchmark,isolatedProfileArgument} from './native-benchmark-host.mjs';

// Explicit one-shot diagnostic. No native build, accounts, production overrides,
// gl.finish/readPixels, effect ablation loops, or automatic failure retries.
const outDir='artifacts/benchmark/model-cost-dist';
const output=process.env.RHINE_MODEL_COST_OUTPUT || 'artifacts/benchmark/model-switch-costs.json';
const frameOnly=process.env.RHINE_MODEL_COST_FRAME_ONLY === '1';
const wheelMode=process.env.RHINE_MODEL_COST_INPUT === 'wheel';
const cpuProfile=process.env.RHINE_MODEL_COST_CPU_PROFILE === '1';
const eventTrace=process.env.RHINE_MODEL_COST_EVENT_TRACE === '1';
const browserTrace=process.env.RHINE_MODEL_COST_BROWSER_TRACE === '1';
const inputInterval = Math.max(8, Math.min(100, Number(process.env.RHINE_MODEL_COST_INTERVAL)||40));
const reverseInput = process.env.RHINE_MODEL_COST_REVERSE === '1';
const calibrate = process.env.RHINE_MODEL_COST_CALIBRATE === '1';
const user2k = process.env.RHINE_MODEL_COST_PROFILE === 'user2k';
const preloadMetadata = process.env.RHINE_MODEL_COST_METADATA !== 'paged';
const playlistCounts = user2k ? [preloadMetadata?60:943,7,6,5,124] : [128,128,128];
const metadataDelay = preloadMetadata ? 0 : 120;
const nativeHost = process.env.RHINE_MODEL_COST_NATIVE === '1';
const visualOnly = process.env.RHINE_MODEL_COST_VISUAL_ONLY === '1';
const transformed=new Set();
const once=(source,marker,replacement)=>{
  assert.equal(source.split(marker).length,2,`Expected unique source marker: ${marker.slice(0,90)}`);
  return source.replace(marker,replacement);
};
const plugin={name:'isolated-model-cost-profile',enforce:'pre',transform(source,id){
  let s=source.replaceAll('\r\n','\n');
  if(eventTrace && id.endsWith('/src/music-title.ts')){
    s=once(s,'  const layout = () => {',`  const layout = () => {
      const capture=globalThis.__rhineModelCost,start=performance.now();
      try{return layoutRaw();}finally{if(capture?.captureActive && capture.workEvents.length<10000)
        capture.workEvents.push({label:'title.layout',at:start-capture.captureStarted,ms:performance.now()-start});}
    };
    const layoutRaw = () => {`);
    transformed.add('title');return s;
  }
  if(id.endsWith('/src/scene.ts')){
    if(frameOnly)return;
    s=once(s,'import { GpuFrameTiming } from "./gpu-frame-timing";',
      'import { RenderCostTiming as GpuFrameTiming } from "../scripts/render-cost-timing.mjs";');
    s=once(s,'    this.graphicsDevice = graphicsIdentity(this.renderer);',
      '    globalThis.__rhineCostTimer = this.gpuTiming;\n    this.graphicsDevice = graphicsIdentity(this.renderer);');
    s=once(s,'      this.covers.prepareFrame(requests, work.prepareJobs, work.prepareMs);',
      '      this.gpuTiming.cpu("coverPrepare", () => this.covers.prepareFrame(requests, work.prepareJobs, work.prepareMs));');
    transformed.add('scene');return s;
  }
  if(id.endsWith('/node_modules/three/build/three.module.js')){
    if(frameOnly)return;
    s=once(s,'shadowMap.render( shadowsArray, scene, camera );',
      'globalThis.__rhineCostTimer ? globalThis.__rhineCostTimer.measure("shadows", () => shadowMap.render( shadowsArray, scene, camera )) : shadowMap.render( shadowsArray, scene, camera );');
    const marker='function renderTransmissionPass( opaqueObjects, transmissiveObjects, scene, camera ) {';
    s=once(s,marker,`function renderTransmissionPass( ...args ) {
      return globalThis.__rhineCostTimer ? globalThis.__rhineCostTimer.measure("transmissionCapture", () => renderTransmissionPassRaw(...args)) : renderTransmissionPassRaw(...args);
    }
    function renderTransmissionPassRaw( opaqueObjects, transmissiveObjects, scene, camera ) {`);
    const start=s.indexOf('function renderTransmissionPassRaw('),end=s.indexOf('function renderObjects(',start);
    assert.ok(start>=0&&end>start,'Transmission implementation boundary');
    let transmission=s.slice(start,end);
    transmission=once(transmission,'renderObjects( opaqueObjects, scene, camera );',
      'globalThis.__rhineCostTimer.measure("transmissionOpaque", () => renderObjects( opaqueObjects, scene, camera ));');
    for(const [call,label] of [['updateMultisampleRenderTarget','transmissionResolve'],['updateRenderTargetMipmap','transmissionMipmaps']]){
      const draw=`textures.${call}( transmissionRenderTarget );`;
      assert.equal(transmission.split(draw).length,3,'Two original transmission resolve/mipmap sites');
      transmission=transmission.replaceAll(draw,`globalThis.__rhineCostTimer.measure("${label}", () => textures.${call}( transmissionRenderTarget ));`);
    }
    s=s.slice(0,start)+transmission+s.slice(end);
    transformed.add('three');return s;
  }
  if(id.endsWith('/src/music-app.ts')){
    s=once(s,'const frameTiming = new MusicFrameTiming();','const frameTiming = new MusicFrameTiming(1200);');
    s=once(s,'function frame(ms: number) {',`function frame(ms: number) {
      const timer=globalThis.__rhineCostTimer;
      const capture=globalThis.__rhineModelCost,start=performance.now();
      try { return timer ? timer.cpu("frameOther", () => costFrame(ms)) : costFrame(ms); }
      finally { if(${eventTrace} && capture?.captureActive && capture.frameEvents.length<2400)
        capture.frameEvents.push({at:start-capture.captureStarted,stamp:ms,cpuMs:performance.now()-start}); }
    }
    function costFrame(ms: number) {`);
    const marker='Object.assign(window, {\n  rhineMusic:';
    s=once(s,marker,`Object.assign(window, {
      __rhineModelCost: {
        async setup() {
          ${frameOnly ? `globalThis.__rhineCostTimer={cpu:(_label,draw)=>draw(),measure:(_label,draw)=>draw(),start(){},stop(){},snapshot:()=>({capture:null})};` : ''}
          accountActive=false; await playlistLibrary.load();
          ${preloadMetadata ? `for(let row=0;row<playlistLibrary.playlists.length;row++)
            for(let song=0;song<playlistLibrary.playlists[row].trackCount;song+=50) await playlistLibrary.ensure(row,song);
          ` : ''}
          accountActive=true; accountView=true; await rebuildPlaylistGrid();
          await navigatePlaylist(0,0); setOverview(false); scene.noteUserInteraction();
          const timer=globalThis.__rhineCostTimer;
          this.selectionEvents=[];this.frameEvents=[];this.workEvents=[];this.captureActive=false;
          ${eventTrace ? `const instrument=(target,key,label)=>{
            if(typeof target?.[key]!=='function')return;
            const original=target[key].bind(target);
            target[key]=(...args)=>{const start=performance.now();try{return original(...args);}
              finally{if(this.captureActive&&this.workEvents.length<10000)this.workEvents.push({label,at:start-this.captureStarted,ms:performance.now()-start});}};
          };
          for(const [target,key,label] of [[scene,'select','scene.select'],[scene.returningPool,'acquire','model.acquire'],
            [scene.appearance,'prepare','material.prepare'],[scene.covers,'select','cover.selectSync'],
            [scene.covers,'installSelectedImage','cover.installDecoded'],[scene.covers,'snapshot','cover.snapshot'],
            [scene.covers,'prepareFrame','cover.prepareFrame'],[scene.covers,'flushUploads','cover.flushUploads'],
            [scene.covers?.selectedCache,'acquire','selectedCache.acquire'],[scene.covers?.selectedCache,'refreshPrepared','selectedCache.refreshPrepared']])instrument(target,key,label);
          ` : ''}
          const select=scene.select.bind(scene);
          scene.select=(...args)=>{
            const before={...scene.selectedCell};const result=select(...args);
            if(this.captureActive && (before.row!==scene.selectedCell.row || before.lane!==scene.selectedCell.lane))
              this.selectionEvents.push({at:performance.now()-this.captureStarted,row:scene.selectedCell.row,lane:scene.selectedCell.lane});
            return result;
          };
          const original=scene.update.bind(scene);
          scene.update=(...args)=>timer.cpu("sceneUpdate",()=>original(...args));
          const render=scene.renderer.render.bind(scene.renderer);
          scene.renderer.render=(...args)=>scene.renderer.getRenderTarget()===scene.ao.normalRenderTarget
            ? timer.measure("aoNormalsDepth",()=>render(...args)) : render(...args);
        },
        read() { return {frame:frameTiming.snapshot(),scene:scene.getStats(),selected:currentAlbum()?.playlistCell,
          ui:{rapidTitle:!document.querySelector('.music-title-rapid')?.hidden,title:$("#selection-title").getAttribute('aria-label'),expectedTitle:currentAlbum()?.title},
          quality:JSON.parse($("#three-scene").dataset.renderQuality||'{}'),capture:globalThis.__rhineCostTimer.snapshot().capture}; },
        async cadence() {
          const suspended=frameSuspended;frameSuspended=true;cancelAnimationFrame(frameHandle);frameHandle=0;
          const stamps=[],start=performance.now();
          try {
            await new Promise(resolve=>{const tick=now=>{stamps.push(now);if(performance.now()-start>=1200)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
            const gaps=stamps.slice(1).map((now,i)=>now-stamps[i]),sorted=[...gaps].sort((a,b)=>a-b);
            return{samples:gaps.length,fps:1000*gaps.length/gaps.reduce((a,b)=>a+b,0),p50:sorted[Math.floor(sorted.length*.5)],
              p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1),over50:gaps.filter(n=>n>50).length,note:'Same document, app render suspended; RAF cadence only.'};
          } finally {frameSuspended=suspended;resetFrameTiming();if(!frameSuspended&&!frameDisposed)frameHandle=requestAnimationFrame(frame);}
        },
        async run() {
          const timer=globalThis.__rhineCostTimer; const inputs=[],longTasks=[],timeline=[];
          const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push({start:e.startTime,duration:e.duration});});
          observer.observe({type:'longtask',buffered:false});
          frameTiming.reset(); timer.start(); const start=performance.now(); let song=0;
          performance.mark('rhine-switch-capture-start');
          this.selectionEvents=[];this.frameEvents=[];this.workEvents=[];this.captureStarted=start;this.captureActive=true;
          const snapshots=setInterval(()=>timeline.push({at:performance.now()-start,...this.read()}),500);
          await new Promise(resolve=>{
            const interval=setInterval(()=>{
              if(performance.now()-start>=10000) {clearInterval(interval);resolve();return;}
              song=(song+1)%playlistLibrary.playlists[0].trackCount; inputs.push({at:performance.now()-start,song});
              scene.noteUserInteraction(); renderScheduler.wake(performance.now());
              ${wheelMode ? `scene.renderer.domElement.dispatchEvent(new WheelEvent('wheel',{deltaY:${reverseInput ? '(performance.now()-start>5000?-48:48)' : '48'},bubbles:true,cancelable:true}));`
                : `timer.cpu("selectSong",()=>void navigatePlaylist(0,song));`}
            },${inputInterval});
          });
          ${wheelMode ? 'await new Promise(resolve=>setTimeout(resolve,150));' : ''}
          clearInterval(snapshots);timer.stop();this.captureActive=false; const frame=frameTiming.snapshot(); observer.disconnect();
          const immediate=this.read(); await new Promise(resolve=>setTimeout(resolve,600));
          return {...immediate,frame,capture:timer.snapshot().capture,inputs,longTasks,
            selectionEvents:this.selectionEvents,frameEvents:this.frameEvents,workEvents:this.workEvents,
            timeline,recovery:this.read(),hidden:document.hidden,presentation:presentation.phase,overview};
        }
      },
      rhineMusic:`);
    transformed.add('app');return s;
  }
}};
let browser,fixture;const report={at:new Date().toISOString(),failures:[],note:
  'Single 10s rapid selection capture, 40ms requested interval, three synthetic 128-song playlists. Metadata preloaded; covers use unique local fixture URLs. Real navigatePlaylist path; no audio/accounts/network. GPU shares use summed EXCLUSIVE scopes from identical complete sampled frames, not sums of percentiles or FPS deltas. Transmission capture excludes physical-glass shading (in main scene). CPU timings are exclusive submission/wall times and can include driver waits; they are not GPU execution times. Headless Edge is not the packaged WebView2 or the user test PC.'};
Object.assign(report,{frameOnly,eventTrace,browserTrace,wheelMode,inputInterval,reverseInput,calibrate,user2k,preloadMetadata,playlistCounts,metadataDelay,nativeHost});
report.visualOnly=visualOnly;
if(frameOnly)report.note=`10s synthetic player capture with normal production GPU timer, no extra GPU/CPU stage queries. Input requested every ${inputInterval}ms; wheelMode=${wheelMode}, reverseInput=${reverseInput}; 150ms dispatch drain included for wheels. Host=${nativeHost?'isolated native Tauri/WebView2':'Headless Edge'}; metadata=${preloadMetadata?'preloaded':'paged, 120ms synthetic delay'}; playlist counts=${playlistCounts.join(',')}. Unique local synthetic cover URLs, no real accounts/audio/external network. Not other-GPU certification. Do not compare FPS causally with query-heavy profiler runs.`;
if(visualOnly)report.note='Visual/state check only; no timed performance capture. Real native host when nativeHost=true; synthetic data only.';
let closing;const cleanup=()=>closing??=(async()=>{await browser?.close().catch(()=>{});await fixture?.close().catch(()=>{});})();
const deadline=setTimeout(()=>{report.failures.push('180s deadline; no automatic retry.');void cleanup();},180000);deadline.unref();
try{
  await fs.mkdir(path.dirname(output),{recursive:true});
  await build({logLevel:'error',plugins:[plugin],build:{outDir,emptyOutDir:false,reportCompressedSize:false}});
  assert.deepEqual([...transformed].sort(),[...(frameOnly ? ['app'] : ['app','scene','three']),...(eventTrace?['title']:[])].sort());
  console.log('Isolated diagnostic built; production assets unchanged.');
  if (process.env.RHINE_MODEL_COST_BUILD_ONLY === '1') {
    report.buildOnly=true;report.completed=true;console.log('Build-only check: no browser or GPU test started.');
  } else {
  assert.ok(os.freemem()>=6*2**30,'At least 6 GiB free memory required; no automatic retry');
  fixture=nativeHost?await launchNativeBenchmark(outDir):await startFixture(outDir,24);
  browser=nativeHost?await chromium.connectOverCDP(fixture.debugUrl):await chromium.launch({executablePath:process.env.RHINE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,timeout:20000});
  const context=nativeHost?browser.contexts()[0]:await browser.newContext({viewport:user2k?{width:2048,height:1104}:{width:1280,height:800},deviceScaleFactor:user2k?1.25:1.5});
  if(nativeHost){
    const session=await browser.newBrowserCDPSession();
    const {arguments:args}=await session.send('Browser.getBrowserCommandLine');
    report.independentNativeProfile=isolatedProfileArgument(args,fixture.profile);
    assert.ok(report.independentNativeProfile,'Independent WebView profile required');
    await session.detach();
  }
  const renderQuality=user2k
    ? {scale:100,pixelRatio:2,antialias:'smaa',shadows:2048,aoSamples:16,aoResolution:.5,depthOfField:100,depthOfFieldResolution:.5,transmission:.75,anisotropy:16,arrayBudget:1,pixelBudget:3686400}
    : {scale:100,pixelRatio:1,antialias:'smaa',shadows:1024,aoSamples:8,aoResolution:.5,depthOfField:100,depthOfFieldResolution:.5,transmission:.25,anisotropy:8,arrayBudget:1,pixelBudget:1440000};
  await context.addInitScript(({renderQuality,user2k})=>{localStorage.clear();localStorage.setItem('rhine-music-preferences',JSON.stringify({
    bgm:false,sound:false,volume:0,qualityMode:'manual',quality:user2k?'discretePlus':'balanced',theme:'night',arrayMode:'filled',reduced:false,renderQuality}));},{renderQuality,user2k});
  const page=nativeHost?context.pages()[0]:await context.newPage();page.setDefaultTimeout(90000);
  if(nativeHost){const session=await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride',{width:2048,height:1104,deviceScaleFactor:1.25,mobile:false});
    await session.detach();report.nativeWindowScope='Real host/WebView2, emulated CSS viewport/DPR; native outer bounds separately recorded';}
  page.on('pageerror',e=>report.failures.push(e.message));
  page.on('console',e=>{if(e.type()==='error')report.failures.push(e.text());});
  page.on('crash',()=>{report.failures.push('Page crashed; no retry.');void cleanup();});
  await page.route('**/api/online/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/online/netease/playlists')return route.fulfill({json:{hasMore:false,playlists:playlistCounts.map((count,i)=>({id:String(i+1),name:'合成歌单 '+(i+1),trackCount:count,owned:true}))}});
    const match=/playlists\/(\d+)\/tracks/.exec(url.pathname);
    if(match){const offset=Number(url.searchParams.get('offset'))||0,row=Number(match[1]);
      if(metadataDelay)await new Promise(resolve=>setTimeout(resolve,metadataDelay));
      const total=playlistCounts[row-1];
      return route.fulfill({json:{total,tracks:Array.from({length:Math.min(50,total-offset)},(_,i)=>{
        const song=offset+i;return {id:'fixture-online-'+row+'-'+song,albumId:'a-'+row+'-'+song,title:(user2k?['合成中文歌曲与专辑标题','Original Version / Synthetic Cover','合成テスト・次の曲へ'][song%3]:'合成歌曲')+' '+song,artist:'合成测试',duration:180,format:'MP3',browserPlayable:true,audioUrl:'/fixture.wav',relativePath:'',onlineSource:{provider:'netease',id:row+'-'+song,albumTitle:'合成专辑 '+song,coverUrl:fixture.url+'demo-covers/'+(user2k?['square','portrait','landscape'][song%3]:'square')+'.png?cost='+row+'-'+song,pageUrl:fixture.url,fee:0}};
      })}});
    }
    return route.fulfill({json:{loggedIn:false}});
  });
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===new URL(fixture.url).origin||url.protocol==='data:'||url.protocol==='blob:')return route.fallback();
    return route.abort('blockedbyclient');
  });
  await page.goto(fixture.url+'?scene=archive&lab=0&scheduler=1&render=optimized'+(process.env.RHINE_MODEL_COST_EFFECTS==='off'?'&rapidEffects=off':''));
  await page.waitForFunction(()=>window.rhineMusic?.stats()?.loaded&&!document.querySelector('#music-loading'));
  assert.deepEqual(report.failures,[]);console.log('Renderer prepared. Loading synthetic playlist metadata.');
  await page.evaluate(()=>window.__rhineModelCost.setup());await page.waitForTimeout(1800);
  report.initial=await page.evaluate(()=>window.__rhineModelCost.read());
  report.browserEnvironment=await page.evaluate(()=>({native:typeof window.__TAURI_INTERNALS__==='object',browser:navigator.userAgent,
    width:innerWidth,height:innerHeight,dpr:devicePixelRatio,outerWidth,outerHeight}));
  if(nativeHost)assert.equal(report.browserEnvironment.native,true,'Actual Tauri bridge required');
  if(calibrate)report.cadenceBefore=await page.evaluate(()=>window.__rhineModelCost.cadence());
  console.log(JSON.stringify({phase:'capture-start',renderer:report.initial.scene.graphics.renderer,quality:report.initial.quality,selected:report.initial.selected}));
  if(!visualOnly) {
  let profiler,tracer;
  if(browserTrace){
    tracer=await context.newCDPSession(page);
    await tracer.send('Tracing.start',{transferMode:'ReturnAsStream',categories:'devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.user_timing'});
  }
  if(cpuProfile){
    profiler=await context.newCDPSession(page);await profiler.send('Performance.enable');
    report.browserMetricsBefore=(await profiler.send('Performance.getMetrics')).metrics;
    await profiler.send('Profiler.enable');await profiler.send('Profiler.setSamplingInterval',{interval:1000});
    await profiler.send('Profiler.start');
  }
  report.result=await page.evaluate(()=>window.__rhineModelCost.run());
  if(tracer){
    const completed=new Promise(resolve=>tracer.once('Tracing.tracingComplete',resolve));
    await tracer.send('Tracing.end');const {stream}=await completed;
    const tracePath=output.replace(/\.json$/,'.trace.json'),file=await fs.open(tracePath,'w');let bytes=0;
    try{for(;;){const chunk=await tracer.send('IO.read',{handle:stream,size:1024*1024});
      const buffer=Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8');bytes+=buffer.length;
      assert.ok(bytes<=64*1024*1024,'Browser trace exceeds bounded 64 MiB capture');await file.write(buffer);
      if(chunk.eof)break;
    }}finally{await file.close();await tracer.send('IO.close',{handle:stream});await tracer.detach();}
    report.browserTraceFile=tracePath;
  }
  if(calibrate)report.cadenceAfter=await page.evaluate(()=>window.__rhineModelCost.cadence());
  if(profiler){report.cpuProfile=(await profiler.send('Profiler.stop')).profile;
    report.browserMetricsAfter=(await profiler.send('Performance.getMetrics')).metrics;
    await profiler.detach();}
  assert.deepEqual(report.failures,[]);assert.equal(report.result.hidden,false);assert.equal(report.result.overview,false);
  assert.ok(report.result.inputs.length>=20,'Continuous real selections required');
  if(!wheelMode)assert.equal(report.result.selected.songIndex,report.result.inputs.at(-1).song);
  // A complete 128-song circuit legitimately returns to song zero. Verify the
  // unwrapped model coordinate, which must advance once per real selection.
  if(wheelMode)assert.ok(report.result.selectionEvents.length>=20,'Wheel events must cause actual model navigation');
  else assert.equal(report.result.scene.selectedCell.row-report.initial.scene.selectedCell.row,report.result.inputs.length);
  assert.equal(report.result.scene.graphics.contextLost,false);
  report.finalGlError=await page.evaluate(()=>document.querySelector('#three-scene canvas').getContext('webgl2').getError());
  assert.equal(report.finalGlError,0,'No GL errors after capture/recovery');
  if(report.result.scene.rapidSwitchBudget?.enabled) {
    const active=report.result.timeline.filter(t=>t.scene.rapidSwitchBudget?.active);
    assert.ok(active.length>=10,'Temporary budget must activate throughout the real switch window');
    assert.ok(active.every(t=>t.scene.returningFiles<=4),'Outgoing models remain bounded during burst');
    assert.ok(active.every(t=>t.ui.rapidTitle && t.ui.title===t.ui.expectedTitle),'Fast title follows the real current selection');
    const recovery=report.result.recovery;
    assert.equal(recovery.scene.rapidSwitchBudget.active,false,'Full effects recover after inputs stop');
    assert.equal(recovery.scene.rapidSwitchBudget.aoSamples,renderQuality.aoSamples);
    assert.equal(recovery.scene.optimization.bokehBudget.colorSamples,13);
    assert.equal(recovery.ui.rapidTitle,false,'Normal title layout restored');
    assert.equal(recovery.ui.title,recovery.ui.expectedTitle,'No stale final title');
  }
  } else report.result=await page.evaluate(()=>window.__rhineModelCost.read());
  if(process.env.RHINE_MODEL_COST_VISUAL==='1') {
    // Screenshots are outside the recorded timing window; their readback cost
    // must never be included in the performance comparison.
    const screenshotBase=output.replace(/\.json$/,'');
    await page.evaluate(()=>{window.__rhineVisualInput=setInterval(()=>document.querySelector('.music-navigation [data-action="next"]').click(),40);});
    await page.waitForTimeout(160);await page.screenshot({path:screenshotBase+'-moving.png'});
    report.visualMoving=await page.evaluate(()=>window.__rhineModelCost.read());
    await page.evaluate(()=>clearInterval(window.__rhineVisualInput));
    assert.equal(report.visualMoving.ui.rapidTitle,true,'Moving screenshot must actually use the rapid title');
    await page.waitForTimeout(1000);await page.screenshot({path:screenshotBase+'-settled.png'});
    report.visualSettled=await page.evaluate(()=>window.__rhineModelCost.read());
    assert.equal(report.visualSettled.ui.rapidTitle,false);
    assert.equal(report.visualSettled.scene.rapidSwitchBudget.active,false);
    assert.equal(report.visualSettled.ui.title,report.visualSettled.ui.expectedTitle);
  }
  report.completed=true;
  console.log(JSON.stringify({visualOnly,frame:visualOnly?undefined:report.result.frame,capture:{...report.result.capture,frames:undefined},inputs:report.result.inputs?.length}));
  }
}catch(error){report.failures.push(String(error.stack||error));process.exitCode=1;console.error(error);}
finally{clearTimeout(deadline);await cleanup();await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log('Saved '+output);}
