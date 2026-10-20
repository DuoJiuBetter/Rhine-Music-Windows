// Actual music-app + transport + playlist pagination + DOM; fake media/scene only.
// No credentials, real audio, platform requests or WebGL contexts.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const track = id => ({id,albumId:'synthetic-album',title:'Song '+id,artist:'Synthetic',duration:120,format:'WAV',browserPlayable:true,audioUrl:'/api/audio/'+id,relativePath:id+'.wav'});
const base=['a','b','c','d'].map(track), online=id=>({...track(id),id:'netease-'+id,onlineSource:{provider:'netease',id,albumTitle:'Synthetic album',pageUrl:'https://music.163.com/#/song?id='+id,fee:0}});
const sceneStub = `import{records,fileLocation}from'/src/data.ts';
export class ArchiveScene {
 selected=0;musicSelectionCell={lane:2,row:12};musicOverviewProgress=0;musicPresentationPhase='archive';musicPresentationReady=true;musicArchiveReady=true;musicArchiveInteractive=true;musicRenderTransitioning=false;decryptionFrame={clarity:1};graphicsIdentity={renderer:'Synthetic CPU',vendor:'Test'};
 constructor(host){this.host=host;host.append(document.createElement('canvas'));window.fixture.scene=this;}
 async load(){}async prepareMusicRenderer(){}update(){}resize(){}dispose(){}
 async refreshLibrary(index){this.select(index);window.fixture.refreshes++;}
 select(index){this.selected=index;this.musicSelectionCell=fileLocation(index);window.fixture.model=records[index]?.album?.tracks[0]?.id;}
 switchMusicAlbum(index){this.select(index)}setMode(mode){this.musicPresentationPhase=mode;}setMusicOverview(value){this.musicOverviewProgress=value?1:0;}
 showMusicArchiveImmediately(){this.musicPresentationPhase='archive'}finishMusicIntro(){}getOverviewColumns(){return []}
 getStats(){return{drawCalls:0,triangles:0,selectedAlbumId:records[this.selected]?.id}}
 setQuality(){}setMusicArrayMode(){}enableSelectionLighting(){}setTheme(){}setReduced(){}setLightingExperiment(){}preloadCovers(){}noteUserInteraction(){}noteWheelInteraction(){}setGlassOcclusion(){}
}`;
const server=await createServer({configFile:false,logLevel:'error',optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/release/**','**/src-tauri/target/**']}},plugins:[{name:'cpu-queue-scene',enforce:'pre',load(id){if(id.replaceAll('\\','/').endsWith('/src/scene.ts'))return sceneStub;}}]});
await server.listen();const browser=await chromium.launch({headless:true,args:['--disable-gpu','--mute-audio']});const reports=[];
async function fixture(account=false){
 let libraryTitle='Original album';
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
 await page.addInitScript(()=>{
   window.fixture={audios:[],refreshes:0};
   localStorage.setItem('rhine-music-preferences',JSON.stringify({reduced:true,volume:0,bgm:false,sound:false,songTransition:'gapless',visualizer:{enabled:false}}));
   class FakeAudio extends EventTarget {
     constructor(src=''){super();this.src=src;this.currentTime=0;this.duration=120;this.paused=true;this.ended=false;this.readyState=1;this.volume=0;fixture.audios.push(this);}
     play(){this.paused=false;this.ended=false;this.dispatchEvent(new Event('playing'));return Promise.resolve()}
     pause(){if(this.paused)return;this.paused=true;this.dispatchEvent(new Event('pause'))}load(){}removeAttribute(name){if(name==='src')this.src=''}
   }
   window.Audio=FakeAudio;
   // The fixture uses ordinary playback so no AudioContext can reach hardware.
   localStorage.setItem('rhine-music-preferences',JSON.stringify({...JSON.parse(localStorage.getItem('rhine-music-preferences')),songTransition:'fade-out'}));
 });
 await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),p=url.pathname;requests.push({path:p,method:route.request().method()});
   let json={};
   if(p==='/api/library')json={version:1,albums:[{id:'synthetic-album',title:libraryTitle,artist:'Synthetic',genreId:'test',rawGenres:[],folder:'synthetic',tracks:base,producers:[],offline:false}],genres:[{id:'test',name:'Test'}],roots:[],scan:{running:false},onlineEnabled:false};
   else if(p==='/api/audio/capabilities')json={decoderAvailable:false,nativeAvailable:false,devices:[]};
   else if(p.endsWith('/status'))json={loggedIn:account&&p.includes('/netease/'),profile:{userId:'synthetic',nickname:'Synthetic user'}};
   else if(p.endsWith('/playlists'))json={playlists:[{id:'synthetic-list',name:'Original playlist',trackCount:4,owned:true}],hasMore:false};
   else if(p.includes('/playlists/')&&p.endsWith('/tracks'))json={tracks:['a','b','c','d'].map(online),total:4};
   else if(p.endsWith('/search'))json={provider:'netease',tracks:[online('x'),online('d')],total:2,offset:0,limit:20,hasMore:false};
   else if(p.includes('/prepare/'))json={audioUrl:'/api/fixture-audio'};
   else if(p.includes('/song/'))json={track:online(p.split('/').at(-1)),album:{title:'Synthetic'},lyrics:{original:'[00:00.00]Synthetic lyric',translated:'',instrumental:false,unavailable:false}};
   await route.fulfill({json});
 });
 await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>!!window.rhineMusic&&!document.querySelector('#music-loading'));
 if(account)await page.waitForFunction(()=>document.querySelector('#stage').classList.contains('playlist-grid')&&rhineMusic.selectedAlbum?.playlistCell?.total===4);
 return{page,context,errors,requests,changeLibrary:()=>{libraryTitle='Updated original album'}};
}
const current=page=>page.evaluate(()=>rhineMusic.player.currentTrack?.id);
const finish=async page=>{await page.evaluate(()=>{const audio=fixture.audios.at(-1);audio.ended=true;audio.paused=true;audio.dispatchEvent(new Event('ended'));});};
const search=async page=>{await page.locator('[data-action="search"]').first().click();await page.locator('#online-search').fill('synthetic');await page.locator('.online-search-form button').click();await page.locator('[data-online-next]').first().waitFor();};
try{
 const local=await fixture(),p=local.page;
 const model=()=>p.evaluate(()=>rhineMusic.selectedAlbum?.id);
 const rows=()=>p.evaluate(async()=>{const data=await import('/src/data.ts');return{lane:data.queueShelfLane,ids:data.records.map(r=>r.id),queue:data.columnFiles(data.queueShelfLane).map(i=>data.records[i].album.tracks[0].id)};});
 for(const action of ['search','playlists','settings','play-queue'])assert.equal((await p.locator(`[data-action="${action}"]`).first().innerText()).trim(),'','top navigation is icon-only');
 await p.locator('[data-action="open"]').click();await p.locator('[data-track="b"]').click();await p.waitForFunction(()=>rhineMusic.player.currentTrack?.id==='b'&&rhineMusic.player.playing);
 await p.locator('[data-action="back"]').click();const originalModel=await model();
 await search(p);await p.locator('[data-online-next="netease-x"]').click();
 await p.waitForFunction(()=>document.querySelector('#stage').dataset.queueRow==='true');
 assert.equal(await current(p),'b');assert.equal(await model(),originalModel);assert.equal(await p.locator('#stage').getAttribute('data-queue-view'),'false');
 assert.deepEqual((await rows()).queue,['a','b','netease-x','c','d']);
 await p.locator('[data-action="close-panel"]').click();
 await p.locator('[data-action="overview"]').click();await p.waitForFunction(()=>document.querySelector('#stage').dataset.overview==='true'&&document.querySelector('#stage').dataset.queueRow==='false');assert.equal((await rows()).lane,-1);
 await p.locator('[data-action="overview-return"]').click();await p.waitForFunction(()=>document.querySelector('#stage').dataset.queueRow==='true');assert.equal(await model(),originalModel);
 await search(p);await p.locator('[data-online-track="netease-d"]').click();await p.waitForFunction(()=>rhineMusic.player.currentTrack?.id==='netease-d'&&rhineMusic.player.playing&&!document.querySelector('#music-panel-root').dataset.panel);
 await p.waitForFunction(async()=>{const data=await import('/src/data.ts');return data.columnFiles(data.queueShelfLane).map(i=>data.records[i].album.tracks[0].id).join(',')==='a,netease-d,netease-x,c,d';});
 assert.equal(await model(),originalModel);assert.equal(await p.locator('#stage').getAttribute('data-queue-view'),'false');
 assert.deepEqual(await p.evaluate(()=>rhineMusic.library.albums[0].tracks.map(t=>t.id)),['a','b','c','d']);
 await p.locator('[data-action="play-queue"]').click();await p.waitForFunction(()=>rhineMusic.selectedAlbum?.playback?.queueShelf&&document.querySelector('#stage').dataset.queueView==='true');
 assert.equal(await p.evaluate(()=>rhineMusic.selectedAlbum.tracks[0].id),'netease-d');assert.ok((await rows()).ids.includes(originalModel),'source model remains beside the queue');
 await p.locator('[data-queue-action="list"]').click();assert.equal(await p.locator('[data-queue-entry]').count(),5);
 await p.locator('[data-queue-action="remove"][data-queue-key="a"]').click();await p.waitForFunction(()=>rhineMusic.player.queue.length===4);await p.waitForFunction(async()=>{const d=await import('/src/data.ts');return d.columnFiles(d.queueShelfLane).length===4;});
 assert.equal(await current(p),'netease-d');
 await p.locator('[data-queue-action="up"][data-queue-key="c"]').click();await p.waitForFunction(()=>rhineMusic.player.queue[1].id==='c');
 await p.waitForFunction(async()=>{const d=await import('/src/data.ts');return d.records[d.columnFiles(d.queueShelfLane)[1]].album.tracks[0].id==='c';});
 await finish(p);await p.waitForFunction(()=>rhineMusic.player.currentTrack?.id==='c'&&rhineMusic.player.playing);
 await p.locator('[data-queue-action="back"]').click();await p.waitForFunction(()=>rhineMusic.selectedAlbum?.id==='synthetic-album');
 await finish(p);await p.waitForFunction(()=>rhineMusic.player.currentTrack?.id==='netease-x'&&rhineMusic.player.playing);assert.equal(await model(),originalModel,'automatic next never steals browsing');
 await p.locator('[data-action="play-queue"]').click();await p.waitForFunction(()=>rhineMusic.selectedAlbum?.playback?.queueShelf);
 if(await p.locator('[data-queue-action="list"]').getAttribute('aria-expanded')==='false')await p.locator('[data-queue-action="list"]').click();
 await fs.mkdir('artifacts/playback-queue',{recursive:true});await p.screenshot({path:'artifacts/playback-queue/day.png'});
 await p.locator('[data-action="settings"]').first().click();await p.locator('[data-category="appearance"]').click();await p.locator('[data-theme="night"]').click();await p.locator('[data-action="close-panel"]').click();await p.locator('.queue-view-tools').waitFor({state:'visible'});await p.screenshot({path:'artifacts/playback-queue/night.png'});
 for(const [width,height]of[[800,560],[800,1000],[1920,1080]]){await p.setViewportSize({width,height});const bounds=await p.locator('.queue-view-tools').evaluate(n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom}});assert.ok(bounds.left>=0&&bounds.right<=width+1&&bounds.bottom<=height+1);}
 assert.deepEqual(local.errors,[]);reports.push('icon-only top navigation; next-up inserts and search replaces the current slot; source unchanged; row edits preserve selection; overview hides row; button locates row; reorder/removal update models; automatic next keeps browsing; day/night and viewport checks');await local.context.close();

 const remote=await fixture(true),q=remote.page;
 await q.locator('[data-action="next"]').first().click();await q.waitForFunction(()=>rhineMusic.selectedAlbum?.tracks[0]?.id==='netease-b');
 await q.locator('[data-action="open"]').click();await q.waitForFunction(()=>rhineMusic.player.currentTrack?.id==='netease-b'&&rhineMusic.player.playing);await q.locator('[data-action="back"]').click();
 const sourceModel=await q.evaluate(()=>rhineMusic.selectedAlbum.id);
 await search(q);await q.locator('[data-online-next="netease-x"]').click();await q.locator('[data-action="close-panel"]').click();await q.waitForFunction(()=>document.querySelector('#stage').dataset.queueRow==='true');assert.equal(await q.evaluate(()=>rhineMusic.selectedAlbum.id),sourceModel);
 await q.locator('[data-action="playlists"]').click();await q.waitForFunction(()=>document.querySelector('#stage').dataset.overview==='true');assert.equal(await q.evaluate(async()=>(await import('/src/data.ts')).queueShelfLane),-1,'my playlists excludes queue models');
 await q.locator('[data-action="overview-return"]').click();await q.waitForFunction(()=>document.querySelector('#stage').dataset.queueRow==='true');
 await search(q);await q.locator('[data-online-track="netease-d"]').click();await q.waitForFunction(()=>rhineMusic.player.currentTrack?.id==='netease-d'&&rhineMusic.player.playing);
 assert.equal(await q.evaluate(()=>rhineMusic.selectedAlbum.id),sourceModel);assert.equal(await q.locator('#stage').getAttribute('data-queue-view'),'false');
 await finish(q);await q.waitForFunction(()=>rhineMusic.player.currentTrack?.id==='netease-x'&&rhineMusic.player.playing);await finish(q);await q.waitForFunction(()=>rhineMusic.player.currentTrack?.id==='netease-c'&&rhineMusic.player.playing);
 assert.equal(await q.locator('#stage').getAttribute('data-queue-view'),'false');
 await q.locator('[data-action="play-queue"]').click();await q.waitForFunction(()=>rhineMusic.selectedAlbum?.playback?.queueShelf);
 assert.ok(!remote.requests.some(r=>r.method==='POST'&&/playlist.*(edit|track|create|delete)/.test(r.path)));assert.ok(!remote.requests.some(r=>r.path.includes('queue-entry-')));assert.deepEqual(remote.errors,[]);
 reports.push('synthetic logged-in playlist keeps its model selected during insertion/search replacement; my playlists excludes queue row; source pagination resumes C after replacement and next-up; only queue button moves to row; no platform writes or occurrence IDs sent upstream');await remote.context.close();
 await fs.writeFile('artifacts/playback-queue/ui-result.json',JSON.stringify({passed:true,reports,webgl:false,realAudio:false,realAccount:false},null,2));console.log(JSON.stringify({passed:true,reports},null,2));
}finally{await browser.close();await server.close();}
