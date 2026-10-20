import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'together-fixture', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url !== '/together-fixture') return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<html><body><main class="music-app" data-theme="night" id="stage" style="position:relative;height:100vh"><article id="album-detail-content" style="width:650px;margin:40px auto"></article><div id="mini"></div><div id="search"></div></main><script type="module">
    import '/src/style.css';import '/src/music.css';import '/src/music-theme.css';import '/src/music-song-view.css';
    import {MusicSongView} from '/src/music-song-view.ts';import {ListenTogether} from '/src/listen-together.ts';import {OnlineMusicSearch} from '/src/online-music-search.ts';
    const track=id=>({id:'netease-'+id,title:'合成歌曲 '+id,artist:'测试歌手',duration:120,onlineSource:{provider:'netease',id}});
    window.player={state:{currentTrack:track('2'),queue:[track('1'),track('2'),track('3')],currentTime:12,duration:120,playing:false,transport:'paused'},
      seek(time){this.state.currentTime=time;window.seeks++},async toggle(){this.state.playing=!this.state.playing;window.toggles++}};
    window.seeks=0;window.toggles=0;window.plays=0;window.nextQueued=[];window.adds=[];
    window.together=new ListenTogether(document.querySelector('#stage'),player,()=>{},async(t,q)=>{window.plays++;player.state={...player.state,currentTrack:t,queue:q,playing:true}});
    document.querySelector('#mini').innerHTML='<span data-mini-lyric></span>';
    const view=window.view=new MusicSongView(document.querySelector('#mini'),()=>{},()=>true,tab=>together.show(tab==='together'));
    const album={id:'test',title:'测试',artist:'测试',tracks:[track('2')]};document.querySelector('#album-detail-content').innerHTML=view.markup(album);view.mount(album,player.state,true);view.setVisible(true);view.update(player.state,true);
    window.search=new OnlineMusicSearch(()=>{},undefined,t=>window.adds.push(t.id),t=>window.nextQueued.push(t.id));search.mount(document.querySelector('#search'));
    document.querySelector('#search').hidden=true;window.ready=true;
    </script></body></html>`);
  });
} }] });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } }), errors = [], writes = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  let value = { session: '1', inRoom: false, active: false, queueIds: [], chat: { connected: false, messages: [] } };
  const room = { id: 'synthetic12345678', users: [{ userId: '123', nickname: '<合成用户>' }] };
  const playback = { songId: '2', status: 'PAUSE', progressMs: 12000, observedAt: Date.now(), serverSeq: 1 };
  await page.route('**/api/online/netease/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/auth/status')) return route.fulfill({ json: { loggedIn: true, profile: { userId: '123' } } });
    if (url.pathname.endsWith('/search')) return route.fulfill({ json: { provider: 'netease', offset: 0, limit: 20, tracks: [{ id: 'netease-4', title: '搜索歌曲', artist: '歌手', onlineSource: { provider: 'netease', id: '4', albumTitle: '合成专辑', pageUrl: 'https://music.163.com/#/song?id=4' } }], total: 1, hasMore: false } });
    if (!url.pathname.endsWith('/together')) return route.fulfill({ json: {} });
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); writes.push(body);
      if (body.action === 'create') value = { ...value, inRoom: true, active: true, room, playback, queueIds: ['1','2','3'], chat: { connected: true, messages: [{ id: 'm1', text: '<img src=x onerror=alert(1)>', nickname: '朋友', time: Date.now() }] } };
      if (body.action === 'queue') value.queueIds = body.ids;
      if (body.action === 'command') value.playback = { ...playback, songId: body.songId, status: body.playing ? 'PLAY' : 'PAUSE', progressMs: body.progressMs, serverSeq: ++playback.serverSeq };
      if (body.action === 'track') return route.fulfill({ json: { track: { id: 'netease-'+body.songId, title: '合成歌曲', onlineSource: { provider: 'netease', id: body.songId } } } });
      if (body.action === 'message') value.chat.messages.push({ id: 'm2', text: body.text, nickname: '我', time: Date.now() });
      if (body.action === 'leave') value = { session:'1', inRoom:false, active:false, queueIds:[], chat:{connected:false,messages:[]} };
    }
    return route.fulfill({ json: value });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/together-fixture`);
  await page.waitForFunction(() => window.ready);
  assert.equal(await page.locator('.song-add-playlist').count(), 1);
  await page.locator('#song-tab-info').click(); await page.getByRole('button', { name: '＋ 添加到歌单' }).waitFor();
  await page.locator('#song-tab-together').click(); await page.locator('[data-together="create"]:enabled').waitFor();
  await page.locator('[data-together="create"]').click(); await page.locator('.together-chat input:enabled').waitFor();
  await page.waitForFunction(() => !window.together.pending);
  assert.equal(await page.locator('[data-together-form="message"] button').isEnabled(), true, 'chat is usable immediately after creating a paused room');
  assert.deepEqual(writes.find(item=>item.action==='queue').ids, ['1','2','3'], 'publishing preserves queue order');
  assert.equal(await page.locator('.together-messages img').count(), 0, 'chat HTML is escaped');
  await page.locator('input[name="text"]').fill('保留尚未发送的草稿');
  await page.waitForTimeout(2200);
  assert.equal(await page.locator('input[name="text"]').inputValue(), '保留尚未发送的草稿');
  assert.equal(writes.filter(item=>item.action==='command').length, 1, 'remote state never echoes');
  await page.evaluate(()=>{player.state={...player.state,playing:true};together.observe(player.state)});
  await page.waitForFunction(()=>window.together.state.playback.status==='PLAY');
  assert.equal(writes.filter(item=>item.action==='command').length, 2, 'first local resume is published');
  await page.locator('input[name="text"]').fill('合成消息'); await page.locator('[data-together-form="message"] button').click();
  await page.getByText('合成消息', { exact: true }).waitFor();
  await fs.mkdir('artifacts/together-ui', { recursive:true }); await page.screenshot({path:'artifacts/together-ui/night.png'});
  await page.evaluate(()=>document.querySelector('#stage').dataset.theme='day'); await page.screenshot({path:'artifacts/together-ui/day.png'});
  await page.locator('[data-together="leave"]').click(); assert.equal(writes.some(item=>item.action==='leave'),false);
  await page.locator('dialog [data-cancel]').click(); assert.equal(writes.some(item=>item.action==='leave'),false);
  await page.locator('[data-together="leave"]').click(); await page.locator('dialog [data-leave]').click();
  await page.locator('[data-together="create"]:enabled').waitFor(); assert.equal(await page.locator('dialog').count(),0);
  await page.evaluate(()=>{view.setVisible(false);document.querySelector('#album-detail-content').hidden=true;document.querySelector('#search').hidden=false;document.querySelector('#search').style.cssText='position:relative;z-index:50;width:650px;margin:40px auto';});
  await page.locator('#online-search').fill('test'); await page.locator('.online-search-form button').click();
  await page.locator('[data-online-next]').click(); assert.deepEqual(await page.evaluate(()=>window.nextQueued),['netease-4']);
  await page.locator('[data-online-add]').click(); assert.deepEqual(await page.evaluate(()=>window.adds),['netease-4']);
  await page.evaluate(()=>{together.dispose();view.dispose();search.dispose()});
  assert.deepEqual(errors, []);
  console.log('Together UI passed: 3 tabs, add entrances, queue ordering, no echo, first resume, draft preservation, escaped chat, exit confirmation, search next/add, themes.');
} finally { await browser.close(); await server.close(); }
