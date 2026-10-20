import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = process.cwd();
const profileName = process.env.RHINE_CHECK_PLAYLIST_GRID === '1' ? `playlists-window-${process.pid}` : 'window';
const child = spawn(process.env.RHINE_DESKTOP_EXE || `${root}/src-tauri/target/release/rhine-music-windows.exe`, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9227', WEBVIEW2_USER_DATA_FOLDER: `${root}/artifacts/${profileName}-profile`, RHINE_DESKTOP_DATA_DIR: `${root}/artifacts/${profileName}-data` } });
console.log('Owned test PID', child.pid);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let target;
for (let i = 0; i < 60; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9227/json/list')).json()).find(target => target.type === 'page'); } catch {}
  if (target) break;
  if (child.exitCode !== null) throw new Error(`Desktop exited: ${child.exitCode}`);
  await sleep(500);
}
assert.ok(target, 'CDP page created');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let next = 0; const pending = new Map();
socket.addEventListener('close', () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Owned desktop CDP connection closed')); } pending.clear(); });
socket.addEventListener('message', event => { const data = JSON.parse(event.data); const entry = pending.get(data.id); if (entry) { pending.delete(data.id); clearTimeout(entry.timer); data.error ? entry.reject(data.error) : entry.resolve(data.result); } });
const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
const state = () => evaluate(`window.__TAURI__.core.invoke('desktop_window_state')`);
const action = value => evaluate(`window.__TAURI__.core.invoke('desktop_window_action', {action:${JSON.stringify(value)}})`);
const report = { pid: child.pid, checks: [], snapshots: [] };
await fs.mkdir(`${root}/artifacts/desktop-ui`, { recursive: true });
try {
  assert.equal(child.exitCode, null, 'test must own the running desktop process');
  for (let i = 0; i < 60; i++) { if (await evaluate(`!!window.__TAURI__ && !!document.querySelector('.desktop-drag')`)) break; await sleep(500); }
  assert.equal(await evaluate(`!!document.querySelector('.desktop-drag[data-tauri-drag-region]')`), true);
  await action('restore'); await sleep(600);
  assert.equal((await state()).fullscreen, false);
  const checkMaximize = async label => {
    const value = await state(); assert.equal(value.fullscreen, false); assert.equal(value.maximized, true);
    const bounds = await evaluate(`({x:screenX,y:screenY,width:outerWidth,height:outerHeight,workArea:{x:screen.availLeft,y:screen.availTop,width:screen.availWidth,height:screen.availHeight},dpr:devicePixelRatio})`);
    for (const key of ['x','y','width','height']) assert.ok(Math.abs(bounds[key] - bounds.workArea[key]) <= 16, JSON.stringify(bounds));
    report.snapshots.push({ label, ...value, ...bounds }); console.log(label, JSON.stringify(bounds));
  };
  await evaluate(`document.querySelector('.desktop-drag').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,detail:2}))`); await sleep(900); await checkMaximize('Native top double-click');
  report.checks.push('Native top double-click maximizes');
  await evaluate(`document.querySelector('[data-window="maximize"]').click()`); await sleep(700); assert.equal((await state()).maximized, false);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F11',bubbles:true}))`); await sleep(800); assert.equal((await state()).fullscreen,true);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F11',bubbles:true}))`); await sleep(700); assert.equal((await state()).fullscreen,false);
  report.checks.push('F11 toggles native fullscreen separately from work-area maximize');
  await action('maximize-window'); await sleep(800); await checkMaximize('Explicit work-area maximum');
  await action('enter-fullscreen'); await sleep(800); assert.equal((await state()).fullscreen,true);
  await action('leave-fullscreen'); await sleep(700); assert.equal((await state()).fullscreen,false);
  await action('restore'); await sleep(600); await action('fullscreen'); await sleep(800); assert.equal((await state()).fullscreen,true);
  await action('fullscreen'); await sleep(700); await action('maximize-window'); await sleep(700); await checkMaximize('Restored work-area maximum');
  report.checks.push('Explicit fullscreen/leave/restore actions are distinct from maximum');
  const screenshot = await command('Page.captureScreenshot'); await fs.writeFile(`${root}/artifacts/desktop-ui/maximized-window.png`, Buffer.from(screenshot.data, 'base64'));
  if (process.env.RHINE_CHECK_PLAYLIST_GRID === '1') {
    // Test-only CDP fixture: never part of the application or a real account session.
    for (let i = 0; i < 90; i++) { if (await evaluate(`!!window.rhineMusic && !document.querySelector('#music-loading')`)) break; await sleep(500); }
    await evaluate(`document.querySelector('[data-action="settings"]').click();const volume=document.querySelector('#volume');volume.value='0';volume.dispatchEvent(new Event('input',{bubbles:true}));for(const id of ['bgm-setting','sound-setting']){const field=document.querySelector('#'+id);field.checked=false;field.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('[data-action="close-panel"]').click();`);
    await evaluate(`(() => {
      localStorage.setItem('rhine-music-preferences', JSON.stringify({theme:'day',volume:0,sound:false,bgm:false,quality:'original',reduced:false,arrayMode:'filled'}));
      const nativeFetch = window.fetch.bind(window);
      const wav = new Uint8Array(44 + 8000 * 120 * 2), view = new DataView(wav.buffer), encoder = new TextEncoder();
      wav.set(encoder.encode('RIFF'),0);view.setUint32(4,wav.length-8,true);wav.set(encoder.encode('WAVEfmt '),8);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);wav.set(encoder.encode('data'),36);view.setUint32(40,wav.length-44,true);
      const syntheticAudio = URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));
      const playlists = [{id:'901',name:'合成测试 · 长歌单',trackCount:120,owned:true},{id:'902',name:'合成测试 · 短歌单',trackCount:3,owned:false},{id:'903',name:'合成测试 · 空歌单',trackCount:0,owned:true}, ...Array.from({length:5},(_,i)=>({id:String(904+i),name:'合成测试 · 歌单 '+(i+4),trackCount:12,owned:true}))];
      const covers = ['square','portrait','landscape'].map(name => new URL('/demo-covers/'+name+'.png', location.origin).href);
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
        const json = body => Promise.resolve(new Response(JSON.stringify(body), {headers:{'Content-Type':'application/json'}}));
        if (url.pathname === '/api/online/netease/auth/status') return json({loggedIn:true,profile:{nickname:'合成歌单验证',userId:'123'}});
        if (url.pathname === '/api/online/netease/playlists') return json({playlists,hasMore:false});
        if (url.pathname.startsWith('/api/online/netease/prepare/')) return json({audioUrl:syntheticAudio});
        const match = url.pathname.match(/^\\/api\\/online\\/netease\\/playlists\\/(\\d+)\\/tracks$/);
        if (match) {
          const playlist = playlists.find(item => item.id === match[1]);
          const cover = covers[playlists.indexOf(playlist) % covers.length];
          const offset = Number(url.searchParams.get('offset') || 0), total = playlist.trackCount;
          const tracks = Array.from({length:Math.max(0,Math.min(50,total-offset))},(_,index)=>({id:'netease-'+playlist.id+'-'+(offset+index),albumId:'synthetic-album',title:'合成歌曲 '+(offset+index+1),artist:'测试歌手',duration:120,format:'在线音频',browserPlayable:true,audioUrl:'',relativePath:'',onlineSource:{provider:'netease',id:String(1000+offset+index),albumTitle:'合成专辑',coverUrl:cover,fee:0,pageUrl:'https://music.163.com/'}}));
          return json({playlistId:playlist.id,offset,total,tracks,hasMore:offset+50<total});
        }
        return nativeFetch(input, init);
      };
    })();`);
    assert.equal(await evaluate(`fetch.toString().includes('nativeFetch')`), true);
    await evaluate(`document.querySelector('[data-action="search"]').click();document.querySelector('[data-search-source="netease"]').click()`);
    const waitCell = async predicate => {
      for (let i = 0; i < 90; i++) { if (await evaluate(`!!window.rhineMusic && (${predicate})`)) return; await sleep(500); }
      console.error('Synthetic grid state', await evaluate(`({selected:window.rhineMusic?.selectedAlbum,stats:window.rhineMusic?.stats(),loading:document.querySelector('#music-loading')?.textContent,login:document.querySelector('#netease-login-button')?.textContent,status:document.querySelector('#library-status')?.textContent})`));
      const failed = await command('Page.captureScreenshot'); await fs.writeFile(`${root}/artifacts/desktop-ui/playlist-grid-failed.png`, Buffer.from(failed.data, 'base64'));
      throw new Error('Synthetic playlist grid did not reach expected cell');
    };
    await waitCell(`window.rhineMusic.selectedAlbum?.playlistCell?.playlistId === '901' && window.rhineMusic.selectedAlbum.tracks.length === 1 && window.rhineMusic.stats().covers.cachedImages > 0`);
    await evaluate(`document.querySelector('[data-action="close-panel"]').click()`);
    await waitCell(`!document.querySelector('.music-panel')`);
    assert.equal(await evaluate(`window.rhineMusic.player.volume`), 0);
    const key = async value => evaluate(`document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(value)},bubbles:true}))`);
    await key('ArrowDown'); await waitCell(`window.rhineMusic.selectedAlbum?.playlistCell?.songIndex === 1`);
    const firstSong = await evaluate(`window.rhineMusic.stats().selectedCell`);
    assert.equal(firstSong.lane, 2); assert.equal(firstSong.row, 13);
    await key('ArrowRight'); await waitCell(`window.rhineMusic.selectedAlbum?.playlistCell?.playlistId === '902'`);
    const cell = await evaluate(`window.rhineMusic.stats().selectedCell`);
    assert.equal(cell.row, 13); assert.equal(cell.lane, 3);
    await key('ArrowRight'); await waitCell(`window.rhineMusic.selectedAlbum?.playlistCell?.playlistId === '903'`);
    assert.equal(await evaluate(`window.rhineMusic.selectedAlbum.tracks.length`), 0);
    await key('ArrowLeft'); await key('ArrowLeft'); await waitCell(`window.rhineMusic.selectedAlbum?.playlistCell?.playlistId === '901'`);
    await key('ArrowUp'); await waitCell(`window.rhineMusic.selectedAlbum?.playlistCell?.songIndex === 119`);
    const last = await evaluate(`window.rhineMusic.stats().selectedCell`);
    await key('ArrowDown'); await waitCell(`window.rhineMusic.selectedAlbum?.playlistCell?.songIndex === 0`);
    assert.equal(await evaluate(`window.rhineMusic.stats().selectedCell.row`), last.row + 1);
    await sleep(1000);
    const shot = await command('Page.captureScreenshot'); await fs.writeFile(`${root}/artifacts/desktop-ui/playlist-grid-corrected-original.png`, Buffer.from(shot.data, 'base64'));
    report.snapshots.push({label:'Synthetic account playlist grid, original quality',cell,stats:await evaluate(`window.rhineMusic.stats()`)});
    report.checks.push('Synthetic account playlists are parallel strips and songs continue in depth in native WebView2, with covers and empty playlists; original quality, muted');
    await waitCell(`window.rhineMusic.stats().musicArchiveReady && window.rhineMusic.stats().selectionPhase === 'settled'`);
    const center = await evaluate(`window.rhineMusic.stats().projectedCoverTop`);
    const mouse = (type,x,y) => command('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});
    await mouse('mousePressed',center[0],center[1]); await mouse('mouseReleased',center[0],center[1]);
    await waitCell(`window.rhineMusic.presentation.phase === 'detail' && window.rhineMusic.player.playing && !!document.querySelector('#song-seek')`);
    assert.match(await evaluate(`document.querySelector('.music-back').textContent`), /返回歌单/);
    assert.equal(await evaluate(`!!document.querySelector('#album-detail-content .music-tabs')`), false);
    await evaluate(`document.querySelector('#song-play').click()`); await waitCell(`!window.rhineMusic.player.playing`);
    const slider = await evaluate(`(()=>{const r=document.querySelector('#song-seek').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
    await mouse('mousePressed',slider.x+2,slider.y+slider.h/2);
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:slider.x+slider.w/2,y:slider.y+slider.h/2,button:'left',buttons:1});
    await mouse('mouseReleased',slider.x+slider.w/2,slider.y+slider.h/2);
    await waitCell(`window.rhineMusic.player.currentTime > 50 && window.rhineMusic.player.currentTime < 70`);
    assert.equal(await evaluate(`window.rhineMusic.player.playing`), false);
    await evaluate(`document.querySelector('#song-play').click()`); await waitCell(`window.rhineMusic.player.playing`);
    await evaluate(`document.querySelector('[data-action="settings"]').click();document.querySelector('[data-theme="night"]').click();document.querySelector('[data-action="close-panel"]').click()`);
    await waitCell(`!document.querySelector('.music-panel')`); await sleep(1000);
    const detailShot = await command('Page.captureScreenshot'); await fs.writeFile(`${root}/artifacts/desktop-ui/playlist-song-transport-original.png`,Buffer.from(detailShot.data,'base64'));
    await evaluate(`document.querySelector('#song-stop').click()`); await waitCell(`window.rhineMusic.player.transport === 'idle'`);
    assert.equal(await evaluate(`document.querySelector('#song-seek').disabled`),true);
    report.checks.push('Native raised-model click opens details and muted synthetic playback; progress drag, pause/resume, stop and playlist return label passed');
  }
  if (process.env.RHINE_CHECK_SHELL === '1') {
    await evaluate(`localStorage.setItem('rhine-music-preferences',JSON.stringify({theme:'day',volume:0,sound:false,bgm:false,quality:'original',reduced:false,arrayMode:'filled'}))`);
    await command('Page.reload');
    for (let i = 0; i < 90; i++) { if (await evaluate(`!!window.rhineMusic && !document.querySelector('#music-loading') && window.rhineMusic.stats()?.triangles > 0`)) break; await sleep(500); }
    const empty = await evaluate(`({stats:window.rhineMusic?.stats(),intro:!!document.querySelector('#music-empty'),library:!!document.querySelector('.music-header [data-action="library"]'),theme:!!document.querySelector('.music-header [data-theme]')})`);
    assert.equal(empty.intro, false); assert.equal(empty.library, false); assert.equal(empty.theme, false);
    assert.equal(empty.stats.blankArchive, true); assert.equal(empty.stats.modelVisible, true); assert.equal(empty.stats.arrayVisible, true); assert.equal(empty.stats.albumCovers, false);
    assert.ok(empty.stats.triangles > 0); assert.equal(await evaluate(`window.rhineMusic.player.volume`), 0);
    const saveShot = async name => { const shot = await command('Page.captureScreenshot'); await fs.writeFile(`${root}/artifacts/desktop-ui/${name}.png`, Buffer.from(shot.data, 'base64')); };
    await saveShot('empty-archive-original-day');
    await evaluate(`document.querySelector('#netease-login-button').click()`);
    for (let i = 0; i < 30; i++) { if (await evaluate(`!!document.querySelector('.dedicated-login .netease-qr img')`)) break; await sleep(500); }
    assert.equal(await evaluate(`!!document.querySelector('.dedicated-login .netease-qr img[src^="data:image/png"]')`), true);
    await saveShot('header-login');
    await evaluate(`document.querySelector('[data-action="close-panel"]').click()`); await sleep(500);
    await evaluate(`document.querySelector('[data-action="settings"]').click();document.querySelector('[data-action="library"]').click()`);
    assert.equal(await evaluate(`!!document.querySelector('#music-roots') && !!document.querySelector('.desktop-folder-button')`), true);
    await evaluate(`document.querySelector('#panel-body [data-action="settings"]').click();document.querySelector('[data-theme="night"]').click()`);
    assert.equal(await evaluate(`document.querySelector('.music-app').dataset.theme`), 'night');
    await evaluate(`document.querySelector('[data-action="close-panel"]').click()`); await sleep(700);
    await saveShot('empty-archive-original-night');
    report.checks.push('Original-quality empty glass array, direct header live QR, library and themes in settings passed in portable WebView2 (muted)');
  }
  if (process.env.RHINE_CHECK_NETEASE_LIVE === '1') {
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`!!window.rhineMusic && !!document.querySelector('[data-action="settings"]')`)) break;
      await sleep(500);
    }
    await evaluate(`document.querySelector('[data-action="settings"]').click();const volume=document.querySelector('#volume');volume.value='0';volume.dispatchEvent(new Event('input',{bubbles:true}));for(const id of ['bgm-setting','sound-setting']){const field=document.querySelector('#'+id);field.checked=false;field.dispatchEvent(new Event('change',{bubbles:true}));}`);
    assert.equal(await evaluate(`window.rhineMusic.player.volume`), 0);
    await evaluate(`document.querySelector('[data-action="close-panel"]').click()`); await sleep(500);
    await evaluate(`document.querySelector('[data-action="search"]').click();document.querySelector('[data-search-source="netease"]').click();document.querySelector('#online-search').value='陈奕迅';document.querySelector('.online-search-form').requestSubmit();`);
    await evaluate(`document.querySelector('[data-netease-auth="start"]').click()`);
    for (let i = 0; i < 30; i++) { if (await evaluate(`!!document.querySelector('.netease-qr img')`)) break; await sleep(500); }
    assert.equal(await evaluate(`!!document.querySelector('.netease-qr img[src^="data:image/png"]')`), true);
    await sleep(2200);
    assert.match(await evaluate(`document.querySelector('.netease-auth-status').textContent`), /等待扫码/);
    await evaluate(`document.querySelector('[data-netease-auth="cancel"]').click()`);
    report.checks.push('Live NetEase QR renders, polls waiting state and cancels in WebView2');
    for (let i = 0; i < 40; i++) { if (await evaluate(`!!document.querySelector('[data-online-track]')`)) break; await sleep(500); }
    assert.ok(await evaluate(`document.querySelectorAll('[data-online-track]').length`) > 0);
    await evaluate(`document.querySelector('[data-online-track]').click()`);
    for (let i = 0; i < 40; i++) { if (await evaluate(`window.rhineMusic.player.currentTime > .5 || !!window.rhineMusic.player.error`)) break; await sleep(500); }
    const playback = await evaluate(`({title:window.rhineMusic.player.currentTrack?.title,source:window.rhineMusic.player.currentTrack?.onlineSource?.provider,volume:window.rhineMusic.player.volume,playing:window.rhineMusic.player.playing,time:window.rhineMusic.player.currentTime,duration:window.rhineMusic.player.duration,error:window.rhineMusic.player.error,notice:window.rhineMusic.player.transitionWarning})`);
    assert.equal(playback.error, null); assert.equal(playback.playing, true); assert.ok(playback.time > .5); assert.equal(playback.volume, 0);
    report.snapshots.push({ label: 'Live anonymous NetEase playback (muted)', ...playback });
    report.checks.push('Live NetEase search and anonymous audio stream advance in portable WebView2');
    const onlineScreenshot = await command('Page.captureScreenshot'); await fs.writeFile(`${root}/artifacts/desktop-ui/netease-search.png`, Buffer.from(onlineScreenshot.data, 'base64'));
    assert.equal(await evaluate(`document.querySelector('[data-online-track]').getAttribute('aria-pressed')`), 'true');
    await evaluate(`document.querySelector('[data-online-track]').click()`); await sleep(500);
    assert.equal(await evaluate(`window.rhineMusic.player.playing`), false);
    await evaluate(`document.querySelector('[data-online-track]').click()`); await sleep(500);
    assert.equal(await evaluate(`window.rhineMusic.player.playing`), true);
    report.checks.push('Online result reflects playback and toggles pause/resume');
    await evaluate(`document.querySelector('#play-pause').click()`);
    for (let i = 0; i < 40; i++) { if (await evaluate(`window.rhineMusic.stats().covers.cachedImages > 0 && !!window.rhineMusic.selectedAlbum?.playback`)) break; await sleep(500); }
    assert.ok(await evaluate(`window.rhineMusic.stats().covers.cachedImages`) > 0);
    assert.equal(await evaluate(`window.rhineMusic.selectedAlbum.playback.trackId === window.rhineMusic.player.currentTrack.id`), true);
    await evaluate(`document.querySelector('[data-action="close-panel"]').click()`); await sleep(700);
    const albumScreenshot = await command('Page.captureScreenshot'); await fs.writeFile(`${root}/artifacts/desktop-ui/netease-playback-albums.png`, Buffer.from(albumScreenshot.data, 'base64'));
    report.checks.push('Real NetEase covers decode into the current playback album in WebView2');
    console.log('Live NetEase', JSON.stringify(playback));
  }
  report.status = 'passed';
} finally {
  await fs.writeFile(`${root}/artifacts/desktop-ui/window-report.json`, JSON.stringify(report, null, 2));
  try { await action('close'); } catch {}
  socket.close();
}
console.log('Window behavior checks passed');
