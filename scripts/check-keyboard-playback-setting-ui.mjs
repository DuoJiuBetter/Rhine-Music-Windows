import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const fixture='artifacts/keyboard-playback-setting/check.html';
await fs.mkdir('artifacts/keyboard-playback-setting',{recursive:true});
await fs.writeFile(fixture,`<!doctype html><meta charset="utf-8"><style>#playlist-song-bars{width:400px;height:80px;--song-bar-step:24px}.playlist-song-bars-viewport{width:400px;overflow:auto}.playlist-song-bars-track{display:flex}.playlist-song-bar{width:24px;min-width:24px;height:30px}</style><div id="playlist-song-bars"></div><input id="edit">
<script type="module">
import {setupPlaylistSongBars} from '/src/playlist-song-bars.ts';
import {MusicPlaybackShortcuts} from '/src/music-playback-shortcuts.ts';
import {KeyboardPlaybackNavigation,keyboardMusicDirection} from '/src/music-keyboard-playback.ts';
window.state={selected:4,playing:4,sync:false,seeks:[],speed:1,playlist:0};
const s=window.state;
const nav=new KeyboardPlaybackNavigation(()=>s.sync,async index=>{s.playing=index;});
const browse=async index=>{s.selected=(index+10)%10;bars.update('synthetic',10,s.selected);return s.selected;};
const bars=setupPlaylistSongBars(document.querySelector('#playlist-song-bars'),{enabled:()=>true,playbackShortcutsActive:()=>true,select:(index,keyboard)=>{if(keyboard)void nav.run(()=>browse(index));else void browse(index);},step:()=>{},cachedTitle:(_,i)=>'Song '+i,title:async(_,i)=>'Song '+i});
bars.update('synthetic',10,4);
const shortcuts=new MusicPlaybackShortcuts({enabled:()=>true,active:()=>true,playing:()=>true,allowTarget:t=>!!t.closest('#playlist-song-bars'),toggle:()=>{},navigate:d=>{void nav.run(()=>browse(s.selected+d));},seek:v=>s.seeks.push(v),boost:on=>{s.speed=on?2:1;}});
document.addEventListener('keydown',e=>{if(shortcuts.keydown(e))return;const dir=keyboardMusicDirection(e.key);if(dir?.axis==='lane'){e.preventDefault();s.playlist+=dir.direction;}});document.addEventListener('keyup',e=>shortcuts.keyup(e));window.addEventListener('blur',()=>shortcuts.cancel());
window.focusBar=()=>document.querySelector('[data-song-bar="'+s.selected+'"]')?.focus();
window.focusBar();window.ready=true;
</script>`);
let server,browser;
try {
 server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,timeout:15000});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.resolvedUrls.local[0]+fixture);await page.waitForFunction(()=>window.ready);
 await page.keyboard.press('End');assert.deepEqual(await page.evaluate(()=>[state.selected,state.playing]),[9,4]);
 await page.evaluate(()=>state.sync=true);await page.keyboard.press('Home');assert.deepEqual(await page.evaluate(()=>[state.selected,state.playing]),[0,0]);
 await page.keyboard.press('ArrowDown');assert.deepEqual(await page.evaluate(()=>[state.selected,state.playing,state.playlist]),[0,0,1]);
 await page.evaluate(()=>state.sync=false);await page.keyboard.press('ArrowUp');assert.deepEqual(await page.evaluate(()=>[state.selected,state.playing,state.playlist]),[0,0,0]);
 await page.keyboard.press('ArrowLeft');await page.waitForTimeout(80);await page.keyboard.press('ArrowLeft');await page.waitForTimeout(350);
 assert.deepEqual(await page.evaluate(()=>[state.selected,state.playing,...state.seeks]),[0,0,-15]);
 await page.keyboard.down('ArrowRight');await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>state.speed),2);await page.keyboard.up('ArrowRight');assert.equal(await page.evaluate(()=>state.speed),1);
 await page.keyboard.press('ArrowRight');await page.waitForTimeout(350);assert.deepEqual(await page.evaluate(()=>[state.selected,state.playing]),[1,0]);
 await page.evaluate(()=>{state.sync=true;focusBar();});await page.keyboard.press('ArrowRight');await page.waitForTimeout(350);assert.deepEqual(await page.evaluate(()=>[state.selected,state.playing]),[2,2]);
 await page.locator('#edit').focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>state.selected),2);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,HomeEnd:true,arrowSyncToggle:true,doubleSeek:true,holdSpeed:true,inputProtected:true,webgl:false}));
} finally {await browser?.close();await server?.close();await fs.rm(fixture,{force:true});}
