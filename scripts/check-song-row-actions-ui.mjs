import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createServer} from 'vite';import {chromium} from 'playwright';
const server=await createServer({configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'row-actions',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(req.url!=='/row-actions')return next();res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><head><style>body{margin:0}#search{position:absolute;left:30px;top:40px;width:620px}.music-app{position:relative!important;width:100vw;height:100vh}#overview{position:absolute;inset:0;pointer-events:none}</style></head><body><main class="music-app" id="stage" data-theme="night"><section id="search"></section><section id="overview"><div id="cards"></div></section></main><script type="module">
    import '/src/style.css';import '/src/music.css';import '/src/music-theme.css';import '/src/music-overview.css';
    import {OnlineMusicSearch} from '/src/online-music-search.ts';import {MusicOverviewUI} from '/src/music-overview-ui.ts';
    window.calls=[];window.track={id:'netease-123',title:'合成歌曲 · 名称很长时也要保留三个按钮',artist:'测试歌手',onlineSource:{provider:'netease',id:'123',albumTitle:'专辑',pageUrl:'https://music.163.com/#/song?id=123'}};
    window.search=new OnlineMusicSearch(()=>calls.push('play'),undefined,()=>calls.push('add'),()=>calls.push('next'));search.mount(document.querySelector('#search'));
    window.overview=new MusicOverviewUI(document.querySelector('#overview'),document.querySelector('#cards'),()=>{});overview.setActive(true,true);overview.update([{lane:2,name:'测试歌单',count:1200,x:850,y:200,selected:true,playlist:true}],1100,800,1,true,'歌单');overview.expand(2);
    window.paint=()=>overview.setPlaylistContent(2,{name:'测试歌单',total:1200,offset:0,tracks:[track,null]});paint();
    document.querySelector('#cards').addEventListener('click',event=>{const b=event.target.closest('button[data-action]');if(b)calls.push(b.dataset.action)});window.ready=true;
  </script></body></html>`);
});}}]});
await server.listen();const browser=await chromium.launch({headless:true,args:['--disable-gpu','--mute-audio']});
try{
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/online/netease/**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/search')?{provider:'netease',tracks:[{id:'netease-123',title:'合成歌曲',artist:'测试歌手',onlineSource:{provider:'netease',id:'123',albumTitle:'专辑',pageUrl:'https://music.163.com/#/song?id=123'}}],total:1,offset:0,limit:20}:{loggedIn:true,profile:{userId:'1',nickname:'合成用户'}}}));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/row-actions`);await page.waitForFunction(()=>window.ready);
  await page.locator('#online-search').fill('合成');await page.locator('.online-search-form button').click();await page.locator('[data-online-next]').waitFor();
  assert.equal(await page.locator('.online-song a').count(),0,'platform view links have been removed');
  for(const selector of ['.online-song .row-song-actions','.overview-song-row:first-child .row-song-actions']){
    const row=page.locator(selector);assert.equal(await row.locator('button').count(),3);
    const sizes=await row.locator('button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{x:r.x,y:r.y,width:r.width,height:r.height,border:s.borderTopWidth}}));
    assert.ok(sizes.every(r=>r.width>=25&&r.height>=28&&r.border==='0px'));
    assert.ok(Math.max(...sizes.map(r=>r.y))-Math.min(...sizes.map(r=>r.y))<1,'buttons share a row');
    assert.ok(sizes[0].x+sizes[0].width<=sizes[1].x&&sizes[1].x+sizes[1].width<=sizes[2].x);
  }
  await page.locator('[data-online-next]').click();await page.locator('[data-online-add]').click();assert.deepEqual(await page.evaluate(()=>calls),['next','add']);
  assert.equal(await page.locator('[data-online-add]').evaluate(n=>getComputedStyle(n).borderTopWidth),'0px','hover remains borderless');
  await page.locator('[data-online-add]').focus();
  assert.ok(await page.locator('[data-online-add]').evaluate(n=>parseFloat(getComputedStyle(n).outlineWidth)>=2),'keyboard focus stays visible');
  await page.locator('[data-online-track]').click();assert.deepEqual(await page.evaluate(()=>calls),['next','add','play']);
  await page.locator('[data-action="overview-next-song"]').first().click();await page.locator('[data-action="overview-add-song"]').first().click();
  assert.deepEqual((await page.evaluate(()=>calls)).slice(-2),['overview-next-song','overview-add-song']);
  assert.equal(await page.locator('.overview-song-row:nth-child(2) button:disabled').count(),4);
  await page.evaluate(()=>overview.setPlayback(track.id,true,false));assert.equal(await page.locator('[data-action="overview-start-song"]').first().getAttribute('aria-pressed'),'true');
  await page.locator('[data-action="overview-add-song"]').first().focus();await page.evaluate(()=>paint());
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'overview-add-song');
  await fs.mkdir('artifacts/song-row-actions-ui',{recursive:true});await page.screenshot({path:'artifacts/song-row-actions-ui/night.png'});
  await page.locator('.online-song').first().screenshot({path:'artifacts/song-row-actions-ui/buttons-night.png'});
  await page.evaluate(()=>document.querySelector('#stage').dataset.theme='day');await page.screenshot({path:'artifacts/song-row-actions-ui/day.png'});
  await page.setViewportSize({width:393,height:800});await page.evaluate(()=>{document.querySelector('#overview').hidden=true;document.querySelector('#search').style.cssText='left:16px;top:30px;width:361px';});
  const compact=await page.locator('.online-song-row').evaluate(n=>({width:n.getBoundingClientRect().width,scroll:n.scrollWidth}));assert.ok(compact.scroll<=compact.width+1,'small window has no horizontal overflow');
  assert.deepEqual(errors,[]);await page.evaluate(()=>{overview.dispose();search.dispose()});
  console.log('Song-row UI passed: 3 borderless inline buttons in search/drawer, keyboard focus, callbacks do not play accidentally, unavailable tracks, focus restoration, current playback, both themes and 393px window.');
}finally{await browser.close();await server.close()}
