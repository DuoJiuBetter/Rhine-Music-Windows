import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const fixture='artifacts/lyrics-motion/check.html';
await fs.mkdir('artifacts/lyrics-motion',{recursive:true});
await fs.writeFile(fixture,`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;width:100%;height:100%} .music-app{position:relative!important;width:100vw;height:100vh} </style>
<div id="stage" class="music-app" data-layout="desktop" data-theme="night"><section id="music-detail" class="music-detail"><article id="album-detail-content"></article></section><div id="mini"></div></div>
<script type="module">
import '/src/style.css'; import '/src/document-decryption.css';
import '/src/music.css'; import '/src/music-theme.css'; import '/src/music-shell.css';
import '/src/music-song-view.css'; import '/src/music-settings.css';
import {LyricSettingsPreview} from '/src/lyric-settings-preview.ts';
import {SurfaceTransition} from '/src/ui-transitions.ts';
import { MusicSongView } from '/src/music-song-view.ts';
import { albumTitleMarkup } from '/src/music-title.ts';
import { parseLyrics } from '/src/music-lyrics.ts';
window.SurfaceTransition=SurfaceTransition;
window.albumTitleMarkup=albumTitleMarkup;
window.setupLyrics=(reduced=false)=>{
  window.view?.dispose();
  document.querySelector('.music-app').classList.toggle('reduce-motion',reduced);
  const track={id:'test-song',title:'合成歌词测试',artist:'测试歌手',duration:300,onlineSource:{provider:'netease',id:'123'}};
  const album={id:'test-album',title:track.title,artist:track.artist,tracks:[track]};
  const mini=document.querySelector('#mini');mini.innerHTML='<span data-mini-lyric></span><input class="playback-seek" type="range">';
  window.state={currentTrack:track,currentTime:0,duration:300,transport:'playing',playing:true,loading:false};
  window.seeks=[];
  const view=window.view=new MusicSongView(mini,seconds=>window.seeks.push(seconds),()=>reduced);
  // Parser timestamps need valid minutes/seconds, including long fixtures.
  const lrc=Array.from({length:80},(_,i)=>'['+String(Math.floor(i*3/60)).padStart(2,'0')+':'+String(i*3%60).padStart(2,'0')+']第 '+String(i+1).padStart(2,'0')+' 句 · 让音乐缓缓流过每一行').join(String.fromCharCode(10));
  view.cache.set('netease:123',{at:Date.now(),lyricAt:1,lines:parseLyrics(lrc),info:{track,album:{title:'合成专辑'},lyrics:{original:lrc}}});
  document.querySelector('#album-detail-content').innerHTML='<div class="detail-overline">NETEASE / 合成歌单</div><h1>合成歌词测试</h1><p class="detail-artist">测试歌手</p>'+view.markup(album);
  view.mount(album,window.state,true);view.setVisible(true);view.update(window.state,true);
};
window.createPreview=(fallback=false)=>{window.preview?.dispose();window.preview=new LyricSettingsPreview(document.querySelector('#stage'),()=>fallback?{title:'歌词示例',artist:'',lines:[],current:0,time:0,duration:180}:window.view.lyricPreview());window.preview.bindControls(()=>true);};
window.advance=time=>{window.state={...window.state,currentTime:time};window.view.update(window.state,true);};
window.setupLyrics();
</script>`);
let browser,server;
const watchdog=setTimeout(()=>{void browser?.close();void server?.close();},45000);watchdog.unref();
try{
  server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
  browser=await chromium.launch({executablePath:process.env.RHINE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,timeout:15000,args:['--disable-gpu','--mute-audio']});
  const page=await browser.newPage({viewport:{width:2560,height:1440}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]+fixture);await page.waitForFunction(()=>window.view);
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#song-toggle-stop').getAttribute('aria-label'),'暂停播放');
  await page.evaluate(()=>{window.state={...window.state,transport:'paused',playing:false,currentTime:37};window.view.update(window.state,true);});
  assert.equal(await page.locator('#song-toggle-stop').getAttribute('aria-label'),'继续播放');
  await page.evaluate(()=>{window.state={...window.state,transport:'playing',playing:true};window.view.update(window.state,true);});
  assert.equal(await page.locator('#song-toggle-stop').getAttribute('aria-label'),'暂停播放');
  assert.equal(await page.locator('.playback-seek').first().inputValue(),'37');
  assert.equal(await page.locator('#song-tab-lyrics').getAttribute('aria-selected'),'true');
  await page.locator('#song-tab-info').click();
  assert.equal(await page.locator('#song-info').isVisible(),true);
  assert.equal(await page.locator('#song-lyric-view').isVisible(),false);
  await page.evaluate(()=>window.advance(3.1));
  assert.equal(await page.locator('#song-tab-info').getAttribute('aria-selected'),'true','Playback progress never forces the info tab away');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#song-tab-lyrics').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Home');assert.equal(await page.locator('#song-tab-info').getAttribute('aria-selected'),'true');
  await page.keyboard.press('End');assert.equal(await page.locator('#song-tab-together').getAttribute('aria-selected'),'true');
  await page.locator('#song-tab-lyrics').click();
  await page.evaluate(()=>{window.state={...window.state,transport:'idle',playing:false};window.view.update(window.state,true);});
  assert.equal(await page.locator('#song-lyric-view').isVisible(),true,'Lyrics remain available when playback stops');
  assert.equal(await page.locator('[data-duration]').textContent(),'5:00');
  await page.locator('#song-tab-info').click();
  await page.evaluate(()=>{window.view.update(window.state,false);window.state={...window.state,currentTime:0,transport:'playing',playing:true};window.view.update(window.state,true);});
  assert.equal(await page.locator('#song-tab-lyrics').getAttribute('aria-selected'),'true','Re-entering starts on lyrics');
  assert.equal(await page.locator('#song-lyrics').evaluate(n=>getComputedStyle(n).scrollbarWidth),'none');
  const orderButton = page.locator('.lyric-playback-mode');
  await orderButton.waitFor({state:'visible'});
  assert.equal(await orderButton.getAttribute('aria-label'), '顺序播放');
  const orderStyle = await orderButton.evaluate(n => {
    const style=getComputedStyle(n),r=n.getBoundingClientRect(),p=document.querySelector('.playback-seek').getBoundingClientRect();
    return {border:style.borderTopWidth,text:n.textContent.trim(),svg:n.querySelectorAll('svg').length,left:r.left,top:r.bottom,progressTop:p.top};
  });
  assert.equal(orderStyle.border,'0px'); assert.equal(orderStyle.text,''); assert.equal(orderStyle.svg,1);
  assert.ok(orderStyle.top<=orderStyle.progressTop+1,'Mode icon sits above the progress bar');
  await page.evaluate(()=>{window.state={...window.state,playbackMode:'shuffle'};window.view.update(window.state,true);});
  assert.equal(await orderButton.getAttribute('aria-label'),'随机播放');
  await page.evaluate(()=>{window.state={...window.state,playbackMode:'repeat-one'};window.view.update(window.state,true);});
  assert.equal(await orderButton.getAttribute('aria-label'),'单曲循环');
  assert.equal(await orderButton.locator('svg').count(),1);
  const layout=await page.evaluate(()=>{
    const a=document.querySelector('#album-detail-content').getBoundingClientRect(),l=document.querySelector('#song-lyrics').getBoundingClientRect(),p=document.querySelector('.lyric-transport').getBoundingClientRect();
    return{article:a.toJSON(),lyrics:l.toJSON(),transport:p.toJSON(),gap:a.bottom-p.bottom};
  });
  console.log(JSON.stringify({phase:'layout',...layout}));
  assert.ok(layout.lyrics.height>600,'Large viewport fills the remaining column');
  assert.ok(layout.gap>=-1&&layout.gap<30,'Progress stays near the column bottom');
  const titleWidthFull=await page.locator('#album-detail-content > h1').evaluate(n=>n.getBoundingClientRect().width);
  const heightFull = layout.lyrics.height;
  await page.evaluate(()=>document.querySelector('.music-app').style.setProperty('--lyric-area-scale','.5'));
  await page.waitForTimeout(150);
  const half=await page.locator('#song-lyrics').evaluate(n=>n.getBoundingClientRect().height);
  const panelHalf=await page.locator('#album-detail-content').evaluate(n=>n.getBoundingClientRect().height);
  assert.ok(Math.abs(panelHalf/layout.article.height-.5)<.03,'Only panel height follows the size preference');
  const centered=await page.locator('#album-detail-content').boundingBox();
  const centerFull={x:layout.article.x+layout.article.width/2,y:layout.article.y+layout.article.height/2};
  assert.ok(Math.abs(centered.x+centered.width/2-centerFull.x)<1,'Horizontal center stays fixed');
  assert.ok(Math.abs(centered.y-layout.article.y)<1,'Height adjustment stays anchored at the top');
  assert.ok(half<heightFull-200,'Lyric viewport becomes shorter');
  const progressBottom=await page.locator('.lyric-transport').evaluate(n=>n.getBoundingClientRect().bottom);
  assert.ok(progressBottom<layout.transport.bottom-200,'Progress moves upward with the scaled lyric panel');
  const progressWidth=await page.locator('.lyric-transport').evaluate(n=>n.getBoundingClientRect().width);
  assert.ok(Math.abs(progressWidth-layout.transport.width)<1,'Progress keeps full width');
  const lyricWidth=await page.locator('#song-lyrics').evaluate(n=>n.getBoundingClientRect().width);
  assert.ok(Math.abs(lyricWidth-layout.lyrics.width)<1,'Lyric width stays unchanged');
  const titleWidthHalf=await page.locator('#album-detail-content > h1').evaluate(n=>n.getBoundingClientRect().width);
  assert.ok(Math.abs(titleWidthHalf-titleWidthFull)<1,'Heading width stays unchanged');
  await page.evaluate(()=>{
    const transition=window.entryTransition=new window.SurfaceTransition(document.querySelector('#music-detail'),document.querySelector('#album-detail-content'),360,240,'right');
    transition.hide(true);transition.show(false);
  });
  const entrySizes=[];
  for(const delay of [0,100,320]){
    if(delay)await page.waitForTimeout(delay);
    entrySizes.push(await page.locator('#album-detail-content').evaluate(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,top:n.getBoundingClientRect().top})));
  }
  for(const size of entrySizes){assert.ok(Math.abs(size.width-layout.article.width)<1);assert.ok(Math.abs(size.height-panelHalf)<1,'Saved height applies on the first entrance frame and stays stable');assert.ok(Math.abs(size.top-layout.article.y)<1,'Top remains stable during entrance');}
  await page.evaluate(()=>window.entryTransition.dispose());
  await page.evaluate(()=>document.querySelector('.music-app').style.setProperty('--lyric-area-scale','1'));
  await page.waitForTimeout(150);
  await page.evaluate(()=>{
    const root=document.createElement('div');root.id='music-panel-root';
    root.innerHTML='<div class="music-panel-scrim settings-scrim"><section class="music-panel settings-window"><div class="panel-heading">设置</div><nav class="settings-navigation">个性化</nav><div id="panel-body"><section class="settings-page"><h2>个性化</h2><section class="panel-section"><h3>歌词显示</h3><label class="settings-row"><span>歌词区域高度</span><input id="lyric-area-size" type="range" min="40" max="100" value="100"></label></section></section></div></section></div>';
    document.querySelector('#stage').append(root);window.createPreview();
  });
  const sliderBefore=await page.locator('#lyric-area-size').boundingBox();
  await page.mouse.move(sliderBefore.x+sliderBefore.width*.8,sliderBefore.y+sliderBefore.height/2);
  await page.mouse.down();
  assert.equal(await page.evaluate(()=>window.preview.active),true,'Pressing the real slider starts preview');
  assert.equal(await page.locator('.settings-scrim').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('.settings-page h3').evaluate(n=>getComputedStyle(n).visibility),'hidden','Settings title is hidden while adjusting');
  assert.equal(await page.locator('.settings-row > span').evaluate(n=>getComputedStyle(n).visibility),'hidden','Only the slider remains visible');
  assert.equal(await page.locator('.settings-page > .panel-section').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)','No opaque card behind the slider');
  assert.equal(await page.locator('#lyric-area-size').evaluate(n=>getComputedStyle(n).visibility),'visible');
  const sliderAfter=await page.locator('#lyric-area-size').boundingBox();
  assert.ok(Math.abs(sliderBefore.x-sliderAfter.x)<1&&Math.abs(sliderBefore.y-sliderAfter.y)<1,'Preview does not move the active slider');
  assert.equal(await page.evaluate(()=>document.querySelectorAll('#song-lyrics').length),1,'Preview IDs stay isolated from playback document');
  await page.waitForTimeout(120);
  const previewFull=await page.locator('.lyric-settings-preview').evaluate(n=>n.shadowRoot.querySelector('#album-detail-content').getBoundingClientRect().height);
  await page.evaluate(()=>document.querySelector('#stage').style.setProperty('--lyric-area-scale','.5'));
  await page.waitForTimeout(120);
  const previewHalf=await page.locator('.lyric-settings-preview').evaluate(n=>n.shadowRoot.querySelector('#album-detail-content').getBoundingClientRect().height);
  assert.ok(previewFull>200&&Math.abs(previewHalf/previewFull-.5)<.03,'Transparent preview follows panel height live');
  await page.screenshot({path:'artifacts/lyrics-motion/settings-preview.png'});
  await page.mouse.up();
  assert.equal(await page.evaluate(()=>window.preview.active),false,'Pointer release restores settings');
  await page.evaluate(()=>{window.createPreview(true);window.preview.start();});
  assert.ok(await page.locator('.lyric-settings-preview').evaluate(n=>n.shadowRoot.textContent.includes('这一句是当前歌词的大小')),'Empty playback uses sample lyrics');
  await page.evaluate(()=>window.preview.stop());
  await page.locator('#lyric-area-size').focus();
  await page.keyboard.down('ArrowLeft');
  assert.equal(await page.evaluate(()=>window.preview.active),true,'Keyboard range adjustment also previews');
  await page.keyboard.up('ArrowLeft');
  assert.equal(await page.evaluate(()=>window.preview.active),false);
  await page.evaluate(()=>{window.preview.dispose();document.querySelector('#music-panel-root').remove();document.querySelector('#stage').style.setProperty('--lyric-area-scale','1');});
  assert.equal(await page.locator('.lyric-settings-preview').count(),0);
  await page.waitForTimeout(120);
  const before=await page.locator('#song-lyrics').evaluate(n=>n.scrollTop);
  await page.evaluate(()=>window.advance(9.1));
  const instant=await page.locator('#song-lyrics').evaluate(n=>n.scrollTop);
  await page.waitForTimeout(100);
  const middle=await page.locator('#song-lyrics').evaluate(n=>n.scrollTop);
  await page.waitForTimeout(700);
  const after=await page.locator('#song-lyrics').evaluate(n=>n.scrollTop);
  assert.ok(instant<after-20,'Playback does not jump instantly');
  assert.ok(middle>before&&middle<after-1,'Intermediate scroll position exists');
  await page.screenshot({path:'artifacts/lyrics-motion/desktop-2560.png'});
  const wheel=await page.evaluate(()=>{
    const n=document.querySelector('#song-lyrics'),start=n.scrollTop;
    const event=new WheelEvent('wheel',{deltaY:240,bubbles:true,cancelable:true});n.dispatchEvent(event);
    return{start,instant:n.scrollTop,prevented:event.defaultPrevented,hold:window.view.manualLyricsUntil-Date.now()};
  });
  assert.equal(wheel.prevented,true);assert.ok(wheel.hold>7900);
  await page.waitForTimeout(750);
  const manual=await page.locator('#song-lyrics').evaluate(n=>n.scrollTop);
  assert.ok(manual>wheel.start+100);
  await page.evaluate(()=>window.advance(12.1));await page.waitForTimeout(100);
  assert.ok(Math.abs(await page.locator('#song-lyrics').evaluate(n=>n.scrollTop)-manual)<2,'Manual browsing is not pulled back');
  await page.evaluate(()=>document.querySelector('[data-lyric-time="15"]').click());
  assert.equal(await page.evaluate(()=>window.seeks.at(-1)),15,'Click-to-seek preserved');
  await page.evaluate(()=>{window.view.manualLyricsUntil=Date.now()-1;window.advance(18.1);});await page.waitForTimeout(750);
  assert.equal(await page.locator('.lyric-line.current').getAttribute('data-lyric-time'),'18');
  for(const viewport of [{width:1920,height:1080},{width:1280,height:800},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await page.evaluate(()=>document.querySelector('.music-app').dataset.layout=innerWidth<700?'portrait':'desktop');
    await page.waitForTimeout(200);
    const bounds=await page.locator('#song-lyrics').boundingBox();
    assert.ok(bounds.width>100&&bounds.x>=0&&bounds.x+bounds.width<=viewport.width+1);
    await page.evaluate(()=>document.querySelector('#stage').style.setProperty('--lyric-area-scale','.4'));
    await page.waitForTimeout(100);
    assert.ok(await page.locator('#song-lyrics').evaluate(n=>n.clientHeight)>24,'Small configured panels retain a readable lyric row');
    await page.evaluate(()=>document.querySelector('#stage').style.setProperty('--lyric-area-scale','1'));
    if(viewport.width===390)await page.screenshot({path:'artifacts/lyrics-motion/portrait-390.png'});
  }
  const responsive=[];
  await page.evaluate(()=>{
    document.querySelector('#album-detail-content > h1').innerHTML=window.albumTitleMarkup('这是一首很长很长的歌曲名称，用来验证不同比例屏幕上的歌词空间与长标题布局（A very long translated live version title）');
    document.querySelector('.detail-artist').textContent='歌手甲、歌手乙、歌手丙与很长的合作艺人名单';
  });
  for(const viewport of [{width:3440,height:1440},{width:2560,height:1080},{width:2560,height:720},{width:1920,height:1080},{width:1440,height:1080},{width:1280,height:1024},{width:1280,height:720},{width:1024,height:768},{width:800,height:600},{width:960,height:540},{width:390,height:844},{width:1080,height:1920}]){
    await page.setViewportSize(viewport);
    await page.evaluate(()=>document.querySelector('.music-app').dataset.layout=innerWidth/innerHeight<1.05?'portrait':innerWidth<1100?'compact':'desktop');
    for(const scale of [1,.4]){
      await page.evaluate(scale=>document.querySelector('#stage').style.setProperty('--lyric-area-scale',String(scale)),scale);
      const bounds=await page.evaluate(()=>{
        const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON();
        return{title:rect('#album-detail-content > h1'),lyrics:rect('#song-lyrics'),transport:rect('.lyric-transport'),article:rect('#album-detail-content')};
      });
      assert.ok(bounds.lyrics.height>=150,`${viewport.width}x${viewport.height} @${scale}: lyric viewport ${bounds.lyrics.height}px must remain readable`);
      assert.ok(bounds.lyrics.height>bounds.title.height*1.5,'lyrics cannot be squeezed smaller than the song title');
      assert.ok(bounds.transport.bottom<=viewport.height+1&&bounds.transport.bottom<=bounds.article.bottom+1,'progress remains in the viewport');
      assert.ok(bounds.lyrics.width>100&&bounds.lyrics.right<=viewport.width+1,'lyric column stays inside the window');
      responsive.push({viewport,scale,titleHeight:bounds.title.height,lyricHeight:bounds.lyrics.height});
    }
    if(viewport.width===2560&&viewport.height===720)await page.screenshot({path:'artifacts/lyrics-motion/ultrawide-2560x720.png'});
  }
  await fs.writeFile('artifacts/lyrics-motion/responsive-result.json',JSON.stringify(responsive,null,2));
  await page.setViewportSize({width:1920,height:1080});
  await page.evaluate(()=>{document.querySelector('#stage').dataset.layout='desktop';document.querySelector('#stage').style.setProperty('--lyric-area-scale','1');});
  await page.evaluate(()=>window.setupLyrics(true));await page.waitForTimeout(50);
  const reduced=await page.evaluate(()=>{window.advance(30.1);const n=document.querySelector('#song-lyrics');return{top:n.scrollTop,duration:getComputedStyle(n.querySelector('.current')).transitionDuration};});
  assert.ok(reduced.top>100);assert.ok(parseFloat(reduced.duration)<=.001,'Reduced motion follows immediately; global CSS may retain a 1ms transition');
  const edges=await page.evaluate(()=>{
    window.advance(237.1);
    const n=document.querySelector('#song-lyrics'),current=n.querySelector('.current');
    const a=n.getBoundingClientRect(),b=current.getBoundingClientRect();
    const centerError=Math.abs((b.top+b.bottom)/2-a.top-n.clientHeight*.42);
    const zoom=new WheelEvent('wheel',{deltaY:-120,ctrlKey:true,cancelable:true,bubbles:true});n.dispatchEvent(zoom);
    const start=n.scrollTop;
    const wheel=new WheelEvent('wheel',{deltaY:-10000,cancelable:true,bubbles:true});n.dispatchEvent(wheel);
    return{centerError,zoomPrevented:zoom.defaultPrevented,wheelDistance:start-n.scrollTop,limit:Math.min(640,n.clientHeight*.9)};
  });
  assert.ok(edges.centerError<2,'Last lyric can follow to the same reading anchor');
  assert.equal(edges.zoomPrevented,false,'Pinch/browser zoom keeps its native owner');
  assert.ok(edges.wheelDistance<=edges.limit+1,'Large input cannot build a many-screen backlog');
  await page.evaluate(()=>{window.view.setVisible(false);window.view.dispose();});
  assert.deepEqual(errors,[]);
  await fs.writeFile('artifacts/lyrics-motion/results.json',JSON.stringify({passed:true,layout,follow:{before,instant,middle,after},wheel,manual,reduced,edges,errors,scope:'DOM-only synthetic lyric check; no player audio, accounts or WebGL scene.'},null,2)+'\n');
  console.log(JSON.stringify({passed:true,largeViewportLyricHeight:layout.lyrics.height,bottomGap:layout.gap,follow:{before,instant,middle,after},manualWheel:true,clickSeek:true,reduced:true}));
}finally{clearTimeout(watchdog);await browser?.close();await server?.close();await fs.rm(fixture,{force:true});}
