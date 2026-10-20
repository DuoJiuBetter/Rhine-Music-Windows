// Real app/DOM, synthetic HTTP + scene. GPU disabled; no private data or audio.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const sceneStub = `import {records,playlistRows} from '/src/data.ts'; export class ArchiveScene {
  musicSelectionCell={lane:2,row:12}; musicOverviewProgress=0; musicPresentationPhase='archive';
  musicArchiveReady=true; musicArchiveInteractive=true; musicRenderTransitioning=false;
  graphicsIdentity={renderer:'Synthetic CPU fixture',vendor:'Test'};
  constructor(host){this.host=host;host.append(document.createElement('canvas'));window.fixture.constructed=true;}
  async load(){window.fixture.openingSnapshot={songs:records.length,covers:records.filter(r=>r.album?.coverUrl).length,playlists:playlistRows.length};window.fixture.modelWaiting=true;await new Promise(r=>window.fixture.releaseModel=r);if(window.fixture.modelError)throw Error('Synthetic missing model');}
  async prepareMusicRenderer(){window.fixture.warmWaiting=true;await new Promise(r=>window.fixture.releaseWarm=r);}
  update(time,cinema){window.fixture.draws++;if(cinema){window.fixture.firstCinema??=cinema;window.fixture.lastCinema=cinema;}}
  getStats(){return{drawCalls:0,triangles:0};} getOverviewColumns(){return[];}
  showMusicArchiveImmediately(){if(window.fixture.handoffError)throw Error('Synthetic handoff error');}
  setMode(){} setMusicOverview(){} finishMusicIntro(){window.fixture.introCompleted=true;}
  setQuality(){} setMusicArrayMode(){} enableSelectionLighting(){} setTheme(){} setReduced(){} setLightingExperiment(){}
  preloadCovers(){} resize(){} noteUserInteraction(){} noteWheelInteraction(){} setGlassOcclusion(){}
  dispose(){window.fixture.disposed=true;this.host.querySelector('canvas')?.remove();}
}`;
const server = await createServer({configFile:false,logLevel:'error',optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/release/**','**/src-tauri/target/**']}},plugins:[{
  name:'synthetic-startup-scene',enforce:'pre',
  load(id){if(id.replaceAll('\\','/').endsWith('/src/scene.ts'))return sceneStub;},
  transform(code,id){
    // Exercise the production timeout path without waiting 45 s in a unit fixture.
    if(id.replaceAll('\\','/').endsWith('/src/music-app.ts'))return code.replace('!panel), 45000','!panel), window.fixture.timeoutMs || 45000');
  },
}]});
await server.listen();
const browser = await chromium.launch({headless:true,args:['--disable-gpu','--mute-audio']});
const reports = [];
async function fixture(options={}) {
  const context=await browser.newContext({viewport:{width:1280,height:850}}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(15000);
  await page.addInitScript(options=>{
    window.fixture={draws:0,...options};
    if(!localStorage.getItem('rhine-music-preferences'))localStorage.setItem('rhine-music-preferences',JSON.stringify({startupOpening:options.startupOpening===true,reduced:options.reduced===true}));
    if(options.nativeWindow){
      window.fixture.windowState={fullscreen:false,maximized:false};window.fixture.windowActions=[];
      window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
        if(command==='desktop_window_state')return{...window.fixture.windowState};
        if(command!=='desktop_window_action')throw Error('Unexpected native command '+command);
        const state=window.fixture.windowState,action=args.action;window.fixture.windowActions.push(action);
        if(window.fixture.failWindow)throw Error('Synthetic window failure');
        if(action==='restore'){state.fullscreen=false;state.maximized=false;}
        else if(action==='maximize-window'){state.fullscreen=false;state.maximized=true;}
        else if(action==='enter-fullscreen'){state.maximized=false;state.fullscreen=true;}
        else if(action==='leave-fullscreen')state.fullscreen=false;
        else if(action==='fullscreen'){if(!state.fullscreen)state.maximized=false;state.fullscreen=!state.fullscreen;}
        else if(action==='maximize')state.maximized=!state.maximized;
        else throw Error('Unknown window action '+action);
        if(window.fixture.failAfterExpand&&action==='enter-fullscreen')throw Error('Synthetic focus failure');
        if(!window.fixture.noWindowEvents)window.dispatchEvent(new CustomEvent('rhine-desktop-window-state',{detail:{...state}}));
      }};
    }
    if(options.libraryTimeout){const timeout=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=ms=>timeout(ms===8000?100:ms);}
    if(options.extras){
      const job=()=>options.extras==='hang'?new Promise(()=>{}):Promise.reject(Error('Synthetic optional resource failure'));
      Object.defineProperty(navigator,'serviceWorker',{value:{getRegistrations:job}});
      document.fonts.load=job;
    }
  },options);
  let releaseLibrary;const libraryGate=new Promise(r=>releaseLibrary=r);
  await page.route('**/api/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/api/library'&&options.holdLibrary)await libraryGate;
    if(options.loggedIn && pathname.includes('/online/')) {
      const tracks = Array.from({length:8},(_,i)=>({id:'netease-opening-'+i,title:'Opening '+i,artist:'Synthetic artist',albumId:'album-'+i,duration:180,
        onlineSource:{provider:'netease',id:String(i),albumTitle:'Opening art',coverUrl:'https://example.invalid/cover-'+i+'.png',pageUrl:'https://music.163.com/#/song?id='+i}}));
      const json=pathname.endsWith('/auth/status')?{loggedIn:true,profile:{nickname:'Synthetic',userId:'synthetic'}}:
        pathname.endsWith('/playlists')?{playlists:[{id:'opening-playlist',name:'Opening playlist',trackCount:8,owned:true}],hasMore:false}:
        pathname.endsWith('/tracks')?{tracks,total:8}:{};
      await route.fulfill({json}).catch(()=>{});return;
    }
    await route.fulfill({json:pathname==='/api/library'?{version:1,albums:[],genres:[],roots:[],scan:{running:false},onlineEnabled:false}:pathname==='/api/audio/capabilities'?{decoderAvailable:false,nativeAvailable:false,devices:[]}:pathname.includes('/status')?{loggedIn:false}: {}}).catch(()=>{});
  });
  await page.goto(server.resolvedUrls.local[0],{waitUntil:'domcontentloaded'});
  await page.locator('[data-action="settings"]').first().waitFor();
  return{page,context,errors,releaseLibrary};
}
async function finish(page){
  await page.waitForFunction(()=>window.fixture.modelWaiting);
  await page.evaluate(()=>window.fixture.releaseModel());
  await page.waitForFunction(()=>window.fixture.warmWaiting);
  await page.evaluate(()=>window.fixture.releaseWarm());
  await page.waitForFunction(()=>!document.querySelector('#music-loading'));
}
try {
  const restored=await fixture({startupOpening:true,loggedIn:true});
  await restored.page.waitForFunction(()=>window.fixture.modelWaiting);
  assert.deepEqual(await restored.page.evaluate(()=>window.fixture.openingSnapshot),{songs:8,covers:8,playlists:1},
    'Saved account and opening songs/art URLs exist before model construction/prewarming');
  assert.equal(await restored.page.locator('.rhine-loading').getAttribute('data-state'),'playing',
    'Saved account restoration runs behind the opening film');
  assert.deepEqual(restored.errors,[]);await restored.context.close();
  reports.push('saved account playlists and cover metadata restored before model preparation, behind film; synthetic HTTP only');
  const opening=await fixture({startupOpening:true});
  await opening.page.locator('.rhine-loading').waitFor({state:'visible'});
  assert.equal(await opening.page.locator('#music-loading').evaluate(n=>n.hidden),true,'the film replaces the loading spinner');
  await opening.page.waitForFunction(()=>window.fixture.modelWaiting);
  assert.equal(await opening.page.locator('.rhine-loading').getAttribute('data-state'),'playing','model loading starts behind the film');
  await fs.mkdir('artifacts/loading-opening',{recursive:true});
  await opening.page.waitForTimeout(1800);
  await opening.page.screenshot({path:'artifacts/loading-opening/start.png'});
  await opening.page.locator('.opening-skip').click();
  assert.equal(await opening.page.locator('.rhine-loading').getAttribute('data-state'),'waiting','skip never exposes an unprepared model');
  await finish(opening.page);
  await opening.page.waitForFunction(()=>!!window.fixture.firstCinema);
  assert.equal(await opening.page.locator('.music-app').getAttribute('data-music-boot'),'running');
  assert.equal(await opening.page.locator('.music-opening').evaluate(n=>n.hidden),true,'startup shows the 3D wave without the 2D prologue');
  assert.equal(await opening.page.locator('.music-header').evaluate(n=>n.inert),true);
  const firstCinema=await opening.page.evaluate(()=>window.fixture.firstCinema);
  assert.equal(firstCinema.musicIntro,true);assert.ok(firstCinema.time>=21.92&&firstCinema.time<22.1);
  await opening.page.waitForFunction(()=>document.querySelector('.music-app').dataset.musicBoot==='done');
  assert.equal(await opening.page.evaluate(()=>window.fixture.introCompleted),true,'natural wave completion hands back to browsing');
  assert.equal(await opening.page.locator('.music-header').evaluate(n=>n.inert),false);
  await opening.page.locator('[data-action="settings"]').first().click();
  await opening.page.locator('.settings-window').waitFor({state:'visible'});
  await opening.page.locator('[data-category="appearance"]').click();
  assert.equal(await opening.page.locator('#startup-opening').isChecked(),true);
  await opening.page.locator('#startup-opening').uncheck();
  assert.equal(await opening.page.evaluate(()=>JSON.parse(localStorage.getItem('rhine-music-preferences')).startupOpening),false);
  assert.deepEqual(opening.errors,[]);await opening.context.close();
  reports.push('startup enters the original live 3D wave after renderer readiness, hides the 2D prologue, and restores settings interaction after natural completion');

  const reducedOpening=await fixture({startupOpening:true,reduced:true});await finish(reducedOpening.page);
  assert.equal(await reducedOpening.page.locator('.rhine-loading').count(),0);
  assert.equal(await reducedOpening.page.locator('.music-boot-overlay').evaluate(n=>n.hidden),true);
  assert.deepEqual(reducedOpening.errors,[]);await reducedOpening.context.close();
  reports.push('reduced motion bypasses both startup animations; startup preference is saved from appearance settings');

  const delayed=await fixture({holdLibrary:true,extras:'hang'});
  await delayed.page.locator('[data-action="settings"]').first().click();
  await delayed.page.locator('.settings-window').waitFor({state:'visible'});
  delayed.releaseLibrary();
  await delayed.page.waitForFunction(()=>window.fixture.modelWaiting);
  await delayed.page.locator('[data-category="display"]').click();
  await delayed.page.evaluate(()=>window.fixture.releaseModel());
  await delayed.page.waitForFunction(()=>window.fixture.warmWaiting);
  await delayed.page.locator('[data-category="developer"]').click();
  assert.equal(await delayed.page.locator('.music-header').evaluate(n=>n.inert),true);
  await delayed.page.evaluate(()=>window.fixture.releaseWarm());
  await delayed.page.waitForFunction(()=>!document.querySelector('#music-loading'));
  assert.equal(await delayed.page.locator('.music-header').evaluate(n=>n.inert),true,'startup completion preserves modal ownership');
  assert.equal(await delayed.page.locator('#music-browse').evaluate(n=>n.inert),true);
  await delayed.page.locator('[data-action="close-panel"]').click();
  await delayed.page.waitForFunction(()=>!document.querySelector('.settings-window'));
  await delayed.page.locator('[data-action="settings"]').first().click();
  await delayed.page.locator('.settings-window').waitFor({state:'visible'});
  assert.deepEqual(delayed.errors,[]);
  reports.push('settings remains interactive during delayed library, model and renderer; hanging extras do not block ready; modal ownership survives handoff');
  await delayed.context.close();

  const optionalFailure=await fixture({extras:'reject'});await finish(optionalFailure.page);
  assert.deepEqual(optionalFailure.errors,[]);await optionalFailure.context.close();
  reports.push('rejected service-worker/font jobs cannot abort startup');

  const offline=await fixture({holdLibrary:true,libraryTimeout:true});
  await finish(offline.page);
  assert.deepEqual(offline.errors,[],'timed-out local library falls back to empty scene without an unhandled rejection');
  offline.releaseLibrary();await offline.context.close();
  reports.push('a stalled local library is aborted and startup continues with an empty scene');

  for(const options of [{modelError:true},{modelError:true,startupOpening:true},{handoffError:true},{timeoutMs:120}]){
    const failed=await fixture(options);
    await failed.page.waitForFunction(()=>window.fixture.modelWaiting);
    await failed.page.evaluate(()=>window.fixture.releaseModel());
    if(!options.modelError){
      await failed.page.waitForFunction(()=>window.fixture.warmWaiting);
      if(!options.timeoutMs)await failed.page.evaluate(()=>window.fixture.releaseWarm());
    }
    await failed.page.locator('#music-loading [data-action="retry-startup"]').waitFor();
    assert.equal(await failed.page.locator('.rhine-loading').count(),0,'failure removes the film and restores recovery controls');
    assert.equal(await failed.page.evaluate(()=>window.fixture.disposed),true);
    await failed.page.locator('#music-loading [data-action="settings"]').click();
    await failed.page.locator('.settings-window').waitFor({state:'visible'});
    await failed.page.locator('[data-category="display"]').click();
    assert.deepEqual(failed.errors,[],'errors are presented by recovery UI, no secondary null-overlay failure');
    await failed.context.close();
  }
  reports.push('model rejection, renderer timeout and handoff exception show recovery actions; settings remains reachable');

  const hidden=await fixture();
  await hidden.page.evaluate(()=>window.dispatchEvent(new CustomEvent('rhine-desktop-visibility',{detail:{hidden:true}})));
  await finish(hidden.page);
  assert.equal(await hidden.page.evaluate(()=>window.fixture.draws),0,'native-hidden startup does not restart the main render loop');
  await hidden.page.evaluate(()=>window.dispatchEvent(new CustomEvent('rhine-desktop-visibility',{detail:{hidden:false}})));
  await hidden.page.waitForFunction(()=>window.fixture.draws>0);
  assert.deepEqual(hidden.errors,[]);await hidden.context.close();
  reports.push('native-hidden startup waits for visibility before main rendering');

  const native=await fixture({nativeWindow:true,noWindowEvents:true});await finish(native.page);
  await native.page.locator('.desktop-chrome').waitFor();
  await native.page.locator('[data-action="settings"]').first().click();
  await native.page.locator('[data-category="display"]').click();
  const modes=native.page.locator('#window-display-mode');
  const fps=native.page.locator('#frame-limit');
  assert.deepEqual(await fps.locator('option').allTextContents(),['30 FPS','60 FPS','90 FPS','120 FPS','144 FPS','165 FPS','240 FPS','不限制']);
  await fps.selectOption('144');
  await native.page.locator('[data-category="appearance"]').click();
  await native.page.locator('[data-key-preset="swapped"]').click();
  await native.page.locator('[data-key-binding="seekForward"]').click();await native.page.keyboard.press('l');
  assert.equal(await native.page.locator('[data-key-binding="seekForward"]').innerText(),'L');
  await native.page.locator('[data-category="display"]').click();
  assert.deepEqual(await modes.locator('option').allTextContents(),['最大化模式','全屏模式']);
  await modes.selectOption('fullscreen');
  assert.equal(await native.page.evaluate(()=>window.fixture.windowActions.length),0,'setting a preference does not resize the window');
  assert.equal(await native.page.evaluate(()=>JSON.parse(localStorage.getItem('rhine-music-preferences')).windowDisplayMode),'fullscreen');
  await native.page.locator('[data-action="close-panel"]').click();
  await native.page.waitForFunction(()=>!document.querySelector('.music-panel'));
  const middle=native.page.locator('[data-window="maximize"]');
  await middle.click();await native.page.waitForFunction(()=>document.documentElement.classList.contains('desktop-fullscreen'));
  assert.equal(await native.page.locator('.desktop-chrome').evaluate(n=>getComputedStyle(n).visibility),'visible');
  for(const action of ['minimize','maximize','close'])assert.equal(await native.page.locator(`[data-window="${action}"]`).isVisible(),true);
  assert.equal(await middle.getAttribute('aria-label'),'还原');
  await middle.click();await native.page.waitForFunction(()=>!document.documentElement.classList.contains('desktop-fullscreen'));
  assert.equal(await middle.getAttribute('aria-label'),'全屏');
  await native.page.locator('[data-action="settings"]').first().click();await native.page.locator('[data-category="display"]').click();
  await modes.selectOption('maximized');
  const before=await native.page.evaluate(()=>window.fixture.windowActions.length);
  await native.page.locator('[data-action="close-panel"]').click();await native.page.waitForFunction(()=>!document.querySelector('.music-panel'));
  await middle.click();await native.page.waitForFunction(()=>document.documentElement.classList.contains('desktop-maximized'));
  assert.equal(await native.page.evaluate(()=>window.fixture.windowActions.at(-1)),'maximize-window');
  await middle.click();await native.page.waitForFunction(()=>!document.documentElement.classList.contains('desktop-maximized'));
  assert.equal(await native.page.evaluate(()=>window.fixture.windowActions.length),before+2);
  await native.page.keyboard.press('F11');await native.page.waitForFunction(()=>document.documentElement.classList.contains('desktop-fullscreen'));
  await native.page.keyboard.press('Escape');await native.page.waitForFunction(()=>!document.documentElement.classList.contains('desktop-fullscreen'));
  assert.equal(await middle.getAttribute('aria-label'),'最大化','F11/Esc never changes the preferred middle-button mode');
  await native.page.locator('[data-action="settings"]').first().click();await native.page.locator('[data-category="display"]').click();
  await modes.selectOption('fullscreen');await native.page.locator('[data-action="close-panel"]').click();await native.page.waitForFunction(()=>!document.querySelector('.music-panel'));
  await native.page.locator('.desktop-drag').dispatchEvent('mousedown',{button:0,detail:2});
  await native.page.waitForFunction(()=>document.documentElement.classList.contains('desktop-fullscreen'));
  await middle.click();await native.page.waitForFunction(()=>!document.documentElement.classList.contains('desktop-fullscreen'));
  await native.page.evaluate(()=>window.fixture.failWindow=true);
  await middle.click();await native.page.waitForFunction(()=>document.querySelector('#music-toast').textContent.includes('Synthetic window failure'));
  assert.equal(await middle.getAttribute('aria-label'),'全屏','failed expansion leaves the window restored and preference intact');
  assert.equal(await native.page.locator('#music-toast').textContent(),'桌面操作失败：Error: Synthetic window failure');
  await native.page.evaluate(()=>{window.fixture.failWindow=false;window.fixture.failAfterExpand=true;});
  await middle.click();await native.page.waitForFunction(()=>document.documentElement.classList.contains('desktop-fullscreen'));
  assert.equal(await middle.getAttribute('aria-label'),'还原','a partial native failure still refreshes actual window state');
  await middle.click();await native.page.waitForFunction(()=>!document.documentElement.classList.contains('desktop-fullscreen'));
  await native.page.reload({waitUntil:'domcontentloaded'});await finish(native.page);
  await native.page.locator('.desktop-chrome').waitFor();
  await native.page.waitForFunction(()=>document.querySelector('[data-window="maximize"]').getAttribute('aria-label')==='全屏');
  await native.page.locator('[data-action="settings"]').first().click();await native.page.locator('[data-category="display"]').click();
  assert.equal(await modes.inputValue(),'fullscreen','preference survives reopening the app');
  assert.equal(await fps.inputValue(),'144','FPS preference survives reopening the app');
  await fps.selectOption('0');assert.equal(await native.page.evaluate(()=>JSON.parse(localStorage.getItem('rhine-music-preferences')).frameLimit),0);
  await native.page.locator('[data-category="appearance"]').click();
  assert.equal(await native.page.locator('[data-key-binding="songNext"]').innerText(),'↓');
  assert.equal(await native.page.locator('[data-key-binding="seekForward"]').innerText(),'L');
  await native.page.locator('[data-key-binding="songNext"]').scrollIntoViewIfNeeded();
  assert.equal(await native.page.locator('[data-key-binding="songNext"]').evaluate(n=>n.getBoundingClientRect().height),36);
  await fs.mkdir('artifacts/shortcut-settings',{recursive:true});
  await native.page.screenshot({path:'artifacts/shortcut-settings/application-settings.png'});
  assert.deepEqual(native.errors,[]);await native.context.close();
  reports.push('two persistent button-behavior options; selection does not resize; middle button and double-click expand/restore; controls remain visible in fullscreen; F11/Escape and failures do not change the preference');
  await fs.mkdir('artifacts/startup-responsiveness',{recursive:true});
  await fs.writeFile('artifacts/startup-responsiveness/ui-result.json',JSON.stringify({passed:true,reports,webgl:false,realAccount:false},null,2));
  console.log(JSON.stringify({passed:true,reports,webgl:false},null,2));
} finally {await browser.close();await server.close();}
