import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// A single DOM/2D/audio fixture. No WebGL, real library, account or audible output.
const root='artifacts/visualizer-ui';
await fs.mkdir(root,{recursive:true});
const rate=48000,frames=rate*3,wav=Buffer.alloc(44+frames*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40);
for(let i=0;i<frames;i++)wav.writeInt16LE(Math.round((Math.sin(i*440*2*Math.PI/rate)+Math.sin(i*1800*2*Math.PI/rate))*.25*32767),44+i*2);
await fs.writeFile(`${root}/tone.wav`,wav);
await fs.writeFile(`${root}/index.html`,`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#08121e;color:#dde5ed;font:16px 'Microsoft YaHei UI',sans-serif}#stage{position:relative;width:1200px;height:760px;--ink:#dde5ed;--muted:#8c9aa9;--line:#314151;--accent:#d4a273}header{padding:28px 40px;font-size:28px;font-weight:bold}#song-view{position:absolute;top:150px;left:700px;width:440px}#song-lyrics{height:260px!important;min-height:0!important}#mini-playback-below{position:absolute;top:100px;right:35px;width:290px}.sample-line{margin:20px 0;color:var(--muted)}.sample-line.current{color:var(--ink);font-size:25px}.lyric-order-row{height:30px}.song-time{font-size:12px}#settings{position:absolute;top:70px;left:50px}</style>
<div id="stage" class="music-app" data-theme="night"><header>RHINE LAB <small style="font-size:12px;color:#8494a7">音浪功能验证 · 合成音源</small></header>
<div id="song-view" data-song="a"><h1>频谱与进度条</h1><section id="song-lyric-view"><div id="song-lyrics"><div class="sample-line">440 Hz 与 1800 Hz 合成测试音源</div><div class="sample-line current">音浪跟随真实音频信号</div><div class="sample-line">窗口输出已由浏览器参数静音</div></div><div class="lyric-transport"><div class="lyric-order-row">↻</div><input class="playback-seek" type="range" value="30"><div class="song-time"><span>1:24</span><span>4:18</span></div></div></section></div>
<div id="mini-playback-below" data-song="a" hidden><span>合成测试音源</span><input class="playback-seek" type="range"></div><div id="settings"></div><div class="music-bottomline">LOCAL COLLECTION</div></div>
<script type="module">
import '/src/music-song-view.css';import '/src/music-visualizer.css';
import {MusicVisualizer,visualizerMarkup} from '/src/music-visualizer.ts';import {MusicSpectrum} from '/src/music-spectrum.ts';
window.spectrum=new MusicSpectrum();spectrum.setEnabled(true);spectrum.unlock();
window.audio=new Audio('./tone.wav');audio.loop=true;
window.state={currentTrack:{id:'a'},transport:'playing',playing:true,loading:false};window.detail=true;window.blocked=false;window.reduced=false;
window.options={enabled:true,position:'progress',style:'bars'};
window.visualizer=new MusicVisualizer(document.querySelector('#stage'),t=>spectrum.read(t),()=>({state,detail,blocked,reduced,sampleRate:spectrum.sampleRate}));
window.configure=(next)=>{Object.assign(options,next);spectrum.setEnabled(options.enabled,true);visualizer.configure(options);document.querySelector('#settings').innerHTML=visualizerMarkup(options);};
configure({});spectrum.attach(audio);await audio.play();window.ready=true;
</script>`);
let server,browser;const errors=[];
const watchdog=setTimeout(()=>{void browser?.close();void server?.close();},45000);
try {
  server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--mute-audio','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1200,height:760}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/${root}/index.html`);await page.waitForFunction(()=>window.ready===true);
  await page.waitForFunction(()=>{const b=new Uint8Array(512);return spectrum.read(b)&&b.some(v=>v>20);});
  await page.waitForTimeout(180);
  const measure=()=>page.evaluate(()=>{
    const c=document.querySelector('.music-visualizer'),i=document.querySelector(detail?'#song-view .playback-seek':'#mini-playback-below .playback-seek');
    const a=c.getBoundingClientRect(),b=i.getBoundingClientRect();return{hidden:c.hidden,parent:c.parentElement.className,x:a.x,y:a.y,width:a.width,height:a.height,seekX:b.x,seekY:b.y,seekWidth:b.width};
  });
  const progress=await measure();assert.equal(progress.height,168);assert.equal(progress.width,progress.seekWidth);assert.equal(progress.x,progress.seekX);assert.ok(progress.y+progress.height<=progress.seekY);
  await page.screenshot({path:`${root}/progress-bars.png`});
  await page.evaluate(()=>{document.querySelector('#song-view').style.width='340px';document.querySelector('#song-lyrics').style.setProperty('height','150px','important');});
  await page.waitForTimeout(80);const resized=await measure();assert.equal(resized.width,resized.seekWidth);assert.ok(resized.seekY<progress.seekY);
  await page.evaluate(()=>configure({style:'dots'}));await page.waitForTimeout(80);await page.screenshot({path:`${root}/progress-dots.png`});
  await page.evaluate(()=>{detail=false;document.querySelector('#song-view').hidden=true;document.querySelector('#mini-playback-below').hidden=false;visualizer.refresh();});
  await page.waitForTimeout(80);const miniProgress=await measure();assert.equal(miniProgress.width,miniProgress.seekWidth);assert.equal(miniProgress.height,72);
  await page.evaluate(()=>configure({position:'bottom',style:'bars'}));await page.waitForTimeout(80);
  assert.equal(await page.locator('.music-bottomline').evaluate(n=>getComputedStyle(n).visibility),'hidden');
  const bottomBars=await page.evaluate(()=>visualizer.levels.length);assert.ok(bottomBars>128);
  await page.evaluate(()=>configure({style:'dots'}));await page.waitForTimeout(80);
  const bottomDots=await page.evaluate(()=>({columns:visualizer.levels.length,pitch:visualizer.width/visualizer.levels.length}));
  assert.ok(bottomDots.columns>bottomBars);assert.ok(bottomDots.pitch<3.1);
  await page.screenshot({path:`${root}/bottom-dots.png`});
  await page.evaluate(()=>configure({style:'outline'}));await page.waitForTimeout(120);
  const wave=await page.evaluate(()=>({bands:visualizer.levels.length,peak:Math.max(...visualizer.levels),height:visualizer.height}));
  assert.equal(wave.bands,32);assert.ok(wave.peak>0);assert.equal(wave.height,288);
  assert.deepEqual(await page.evaluate(()=>({fft:spectrum.analyser.fftSize,samples:visualizer.samples.length})),{fft:4096,samples:2048});
  await page.locator('.music-visualizer').screenshot({path:`${root}/bottom-filled-wave.png`});
  await page.evaluate(()=>configure({style:'dots'}));await page.waitForTimeout(40);
  assert.equal(await page.evaluate(()=>visualizer.levels.length),bottomDots.columns,'leaving the wave restores the dense point grid');
  await page.evaluate(()=>configure({style:'outline'}));await page.waitForTimeout(80);
  const waveShape=await page.evaluate(()=>{
    cancelAnimationFrame(visualizer.frame);visualizer.frame=0;
    const previous=visualizer.levels.slice(),c=visualizer.canvas,ctx=c.getContext('2d');
    visualizer.levels.fill(.6);visualizer.paint();
    const pixel=y=>Array.from(ctx.getImageData(Math.floor(c.width/2),Math.floor(c.height*y),1,1).data);
    const crestY=(visualizer.height-.6*(visualizer.height-6))/visualizer.height;
    const top=pixel(.2),crest=pixel(crestY),middle=pixel(.6),base=pixel(.9),oldGradient=visualizer.waveFill;
    const side=Array.from(ctx.getImageData(0,Math.floor(c.height*.8),1,1).data);
    const endCaps=[0,c.width-1].map(x=>ctx.getImageData(x,Math.floor(c.height*.6),1,1).data[3]);
    const stage=document.querySelector('#stage');
    stage.style.setProperty('--ink','#202820');stage.style.setProperty('--accent','#b56834');stage.dataset.theme='day';
    visualizer.refresh();visualizer.paint();
    const dayMiddle=pixel(.6),dayBase=pixel(.9),themeGradientChanged=oldGradient!==visualizer.waveFill;
    stage.style.removeProperty('--ink');stage.style.removeProperty('--accent');stage.dataset.theme='night';visualizer.refresh();
    visualizer.levels.fill(.0001);visualizer.paint();
    const lowCrests=[.05,.5,.95].map(x=>ctx.getImageData(Math.floor(c.width*x),c.height-2,1,1).data[3]);
    visualizer.levels.fill(0);visualizer.paint();const silent=ctx.getImageData(0,0,c.width,c.height).data.every(v=>v===0);
    visualizer.levels.set(previous);visualizer.refresh();
    return{top,crest,middle,base,side,endCaps,dayMiddle,dayBase,themeGradientChanged,lowCrests,silent};
  });
  assert.equal(waveShape.top[3],0,'area above the wave stays transparent');
  assert.ok(waveShape.middle[3]>20 && waveShape.middle[3]<180 && waveShape.base[3]<waveShape.middle[3],'translucent fill fades towards the baseline');
  assert.ok(waveShape.crest[3]>180 && waveShape.side[3]<100,`only the outward crest is strongly outlined, without a box edge: ${JSON.stringify(waveShape)}`);
  assert.ok(waveShape.lowCrests.every(alpha=>alpha>150),'very low crests stay visible across left, centre and right, without threshold gaps or bottom clipping');
  assert.deepEqual(waveShape.endCaps,[0,0],'both endpoints taper into the baseline instead of cutting the first peak vertically');
  assert.ok(waveShape.middle[2]>waveShape.middle[0] && waveShape.dayMiddle[0]>waveShape.dayMiddle[2] && waveShape.themeGradientChanged,'night is ice blue, day is warm gold, updated immediately');assert.equal(waveShape.silent,true);
  await page.evaluate(()=>{const stage=document.querySelector('#stage');stage.dataset.theme='day';stage.style.background='#e8e5e1';visualizer.refresh();});
  await page.waitForTimeout(40);await page.locator('.music-visualizer').screenshot({path:`${root}/wave-day.png`});
  await page.evaluate(()=>{const stage=document.querySelector('#stage');stage.dataset.theme='night';stage.style.background='#08121f';visualizer.refresh();});
  await page.waitForTimeout(40);await page.locator('.music-visualizer').screenshot({path:`${root}/wave-night.png`});
  await page.evaluate(()=>{configure({position:'progress'});detail=true;document.querySelector('#song-view').hidden=false;document.querySelector('#mini-playback-below').hidden=true;visualizer.refresh();});
  await page.waitForTimeout(80);const waveProgress=await measure();assert.equal(waveProgress.width,waveProgress.seekWidth);
  assert.equal(waveProgress.height,168);
  assert.equal(waveProgress.seekY,resized.seekY,'all styles share the same footprint and progress baseline');
  const overlay=await page.locator('.music-visualizer').evaluate(n=>({pointerEvents:getComputedStyle(n).pointerEvents,zIndex:getComputedStyle(n).zIndex}));
  assert.equal(overlay.pointerEvents,'none');assert.equal(overlay.zIndex,'2');
  await page.locator('.music-visualizer').screenshot({path:`${root}/progress-filled-wave.png`});
  await page.evaluate(()=>{detail=false;document.querySelector('#song-view').hidden=true;document.querySelector('#mini-playback-below').hidden=false;visualizer.refresh();});
  await page.waitForTimeout(60);const miniWave=await measure();assert.equal(miniWave.height,72);assert.equal(miniWave.seekY,miniProgress.seekY);
  await page.evaluate(()=>configure({position:'bottom',style:'dots'}));
  await page.evaluate(()=>document.querySelector('#stage').style.width='3000px');await page.waitForTimeout(80);
  const cappedDots=await page.evaluate(()=>visualizer.levels.length);assert.equal(cappedDots,768,'wide layouts remain bounded');
  await page.evaluate(()=>{document.querySelector('#stage').style.width='1200px';configure({style:'mini'});});await page.waitForTimeout(80);
  const bottom=await measure();assert.equal(bottom.width,1144);assert.equal(bottom.height,288);assert.ok(bottom.parent.split(' ').includes('music-app'));
  await page.screenshot({path:`${root}/bottom-five-bars.png`});
  const sharedStyles=await page.evaluate(()=>{
    cancelAnimationFrame(visualizer.frame);visualizer.frame=0;
    const saved=visualizer.wave.levels.slice(),results=[];
    visualizer.wave.levels.fill(.6);
    for(const theme of ['day','night'])for(const style of ['bars','dots','mini','outline']){
      document.querySelector('#stage').dataset.theme=theme;configure({style});visualizer.paint();
      const data=visualizer.context.getImageData(0,0,visualizer.canvas.width,visualizer.canvas.height).data;
      let alpha=0,rgb=[];
      for(let i=0;i<data.length;i+=4)if(data[i+3]>alpha){alpha=data[i+3];rgb=Array.from(data.slice(i,i+3));}
      results.push({theme,style,height:visualizer.height,fft:spectrum.analyser.fftSize,samples:visualizer.samples.length,alpha,rgb,source:visualizer.wave.levels[5],pointer:getComputedStyle(visualizer.canvas).pointerEvents});
    }
    visualizer.wave.levels.set(saved);configure({style:'bars'});visualizer.refresh();return results;
  });
  for(const row of sharedStyles){
    assert.equal(row.height,288);assert.equal(row.fft,4096);assert.equal(row.samples,2048);assert.equal(row.pointer,'none');
    assert.ok(row.alpha>150 && row.source>.59,'all styles preserve the same live spectrum and visible crest');
    assert.ok(row.theme==='night'?row.rgb[2]>row.rgb[0]:row.rgb[0]>row.rgb[2],'every style uses the shared day/night palette');
  }
  const continued=await page.evaluate(async()=>{
    configure({enabled:false});const a=audio.currentTime;
    await new Promise(r=>setTimeout(r,150));return{hidden:document.querySelector('.music-visualizer').hidden,advanced:audio.currentTime-a,paused:audio.paused};
  });assert.equal(continued.hidden,true);assert.ok(continued.advanced>.06);assert.equal(continued.paused,false);
  assert.equal(await page.locator('.music-bottomline').evaluate(n=>getComputedStyle(n).visibility),'visible');
  await page.evaluate(()=>{configure({enabled:true});audio.currentTime=.6;audio.pause();state.playing=false;state.transport='paused';visualizer.refresh();});
  await page.waitForTimeout(800);const paused=await page.evaluate(()=>({level:Math.max(...visualizer.levels),frame:visualizer.frame}));
  assert.ok(paused.level<.001);assert.equal(paused.frame,0);
  await page.evaluate(async()=>{await audio.play();state.playing=true;state.transport='playing';visualizer.refresh();});
  await page.waitForTimeout(160);
  const resumed=await page.evaluate(()=>({time:audio.currentTime,level:Math.max(...visualizer.levels)}));
  assert.ok(resumed.time>.65 && resumed.time<1.2,'resume keeps the paused media position');assert.ok(resumed.level>0);
  await page.evaluate(()=>{blocked=true;visualizer.refresh();});assert.equal((await measure()).hidden,true);
  await page.evaluate(()=>{blocked=false;visualizer.refresh();visualizer.setHidden(true);});assert.equal((await measure()).hidden,true);
  await page.evaluate(()=>{visualizer.dispose();spectrum.dispose();audio.pause();audio.removeAttribute('src');audio.load();});
  assert.equal(await page.locator('.music-visualizer').count(),0);assert.deepEqual(errors,[]);
  assert.equal(await page.locator('.music-bottomline').evaluate(n=>getComputedStyle(n).visibility),'visible');
  const result={passed:true,realSyntheticSpectrum:true,progress,resized,miniProgress,bottom,bottomBars,bottomDots,wave,waveShape,waveProgress,miniWave,overlay,sharedStyles,cappedDots,continued,paused,resumed,errors,scope:'Single DOM/2D fixture, GPU disabled, browser mute-audio; no Three.js/account/real music.'};
  await fs.writeFile(`${root}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {clearTimeout(watchdog);await browser?.close();await server?.close();}
