// Real keyboard events and settings editor; synthetic playback, no GPU or audio.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const directory='artifacts/shortcut-settings',file=directory+'/check.html';
await fs.mkdir(directory,{recursive:true});
await fs.writeFile(file,`<!doctype html><meta charset="utf-8"><style>body{margin:0;--ink:#242722;--surface:#efede7;--line:#aaa;--accent:#b65d23;--page-bg:#e5e3df;background:var(--page-bg);font:14px sans-serif}.settings-page{padding:24px}.settings-row{display:flex;align-items:center;justify-content:space-between;gap:24px}button{cursor:pointer}</style>
<main class="music-app"><section class="settings-page" id="editor"></section><button id="open">打开详情</button><input id="text"><div id="bars"><button>歌曲柱</button></div></main>
<script type="module">
import '/src/music-settings.css';
import {MusicPlaybackShortcuts} from '/src/music-playback-shortcuts.ts';
import {normalizeKeybindings,keybindingsMarkup,mountKeybindingEditor} from '/src/music-keybindings.ts';
window.state={bindings:normalizeKeybindings(JSON.parse(localStorage.getItem('bindings')||'null')),playing:true,speed:1,song:0,playlist:0,time:30,opened:0,toggles:0};const s=window.state,root=document.querySelector('#editor');
root.innerHTML=keybindingsMarkup(s.bindings)+'<label class="settings-row"><span>帧率上限</span><select id="fps"><option>60 FPS</option></select></label>';
const keys=new MusicPlaybackShortcuts({bindings:()=>s.bindings,enabled:()=>true,active:()=>true,playing:()=>s.playing,allowTarget:t=>!!t.closest('#bars'),toggle:()=>{s.playing=!s.playing;s.toggles++},navigate:d=>s.song+=d,navigatePlaylist:d=>s.playlist+=d,seek:v=>s.time+=v,boost:on=>s.speed=on?2:1});
mountKeybindingEditor(root,()=>s.bindings,next=>{keys.cancel();s.bindings=next;localStorage.setItem('bindings',JSON.stringify(next))});
document.addEventListener('keydown',e=>keys.keydown(e),{capture:true});document.addEventListener('keyup',e=>keys.keyup(e));window.addEventListener('blur',()=>keys.cancel());document.querySelector('#open').onclick=()=>s.opened++;
window.ready=true;
</script>`);
let server,browser;
try {
  server=await createServer({configFile:false,logLevel:'error',optimizeDeps:{entries:[file]},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/release/**','**/src-tauri/target/**']}}});await server.listen();
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--mute-audio']});
  const page=await browser.newPage({viewport:{width:1000,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]+file);await page.waitForFunction(()=>window.ready);
  await page.locator('#open').focus();await page.keyboard.press('Space');await page.keyboard.press('Space');
  assert.deepEqual(await page.evaluate(()=>[state.playing,state.opened,state.toggles]),[true,0,2]);
  await page.locator('#text').fill('a');await page.keyboard.press('Space');assert.equal(await page.locator('#text').inputValue(),'a ');
  await page.locator('[data-key-preset="swapped"]').click();await page.locator('#bars button').focus();
  await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>state.playlist),1);
  await page.keyboard.press('ArrowDown');await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>state.song),1);
  await page.keyboard.press('ArrowUp');await page.waitForTimeout(80);await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>state.time),15);
  await page.keyboard.down('ArrowDown');await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>state.speed),2);await page.keyboard.up('ArrowDown');assert.equal(await page.evaluate(()=>state.speed),1);
  const binding=page.locator('[data-key-binding="songNext"]');await binding.click();await page.keyboard.press('Space');assert.match(await page.locator('#shortcut-status').innerText(),/保留/);assert.equal(await page.evaluate(()=>state.toggles),2);
  await page.keyboard.press('ArrowUp');assert.match(await page.locator('#shortcut-status').innerText(),/重复/);assert.equal(await binding.innerText(),'请按键…');
  await page.keyboard.press('n');assert.equal(await binding.innerText(),'N');await page.locator('#bars button').focus();await page.keyboard.press('n');assert.equal(await page.evaluate(()=>state.song),2);
  await page.reload();await page.waitForFunction(()=>window.ready);assert.equal(await binding.innerText(),'N');
  await binding.click();await page.keyboard.press('Escape');assert.equal(await binding.innerText(),'N');
  await binding.click();await page.locator('#text').focus();assert.equal(await binding.innerText(),'N');
  for(const width of [540,840,1280,1920]){
    await page.setViewportSize({width,height:900});
    const boxes=await page.locator('.shortcut-binding, #fps').evaluateAll(nodes=>nodes.map(node=>({height:node.getBoundingClientRect().height,right:node.getBoundingClientRect().right})));
    assert.ok(boxes.every(box=>box.height===36&&box.right<=width),JSON.stringify({width,boxes}));
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,spaceDoesNotActivateFocusedButton:true,typingProtected:true,swappedAxes:true,seekAndHold:true,customBindingAndPersistence:true,reservedAndConflictingKeysRejected:true,controlHeight:36,viewports:[540,840,1280,1920],gpu:false}));
} finally {await browser?.close();await server?.close();await fs.rm(file,{force:true});}
