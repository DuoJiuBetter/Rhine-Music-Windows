import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{ name: 'playlist-fixture', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url !== '/playlist-fixture') return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<html><body style="margin:0"><main id="stage" class="music-app" data-theme="night" style="min-height:100vh"><button id="open">整理歌单</button><div id="search"></div></main><script type="module">
      import '/src/music.css'; import {PlaylistManager} from '/src/playlist-manager.ts'; import {OnlineMusicSearch} from '/src/online-music-search.ts';
      window.changes=0;window.messages=[];window.plays=0;
      window.manager=new PlaylistManager(document.querySelector('#stage'),async()=>{window.changes++},message=>window.messages.push(message));
      window.search=new OnlineMusicSearch(()=>window.plays++,undefined,track=>window.manager.open(track.onlineSource.provider,{track}));window.search.mount(document.querySelector('#search'));
      document.querySelector('#open').onclick=()=>window.manager.open('netease');window.ready=true;
    </script></body></html>`);
  });
} }] });
await server.listen(); const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const errors = [], writes = []; page.on('pageerror', error => errors.push(error.message));
  const track = id => ({ id: `netease-${id}`, title: `合成歌曲 ${id}`, artist: '测试歌手', onlineSource: { provider: 'netease', id: String(id), albumTitle: '测试专辑', pageUrl: `https://music.163.com/#/song?id=${id}` } });
  let lists = [{ id: '99', name: '深夜电台', owned: true, trackCount: 1200 }, { id: '88', name: '收藏的歌单', owned: false, trackCount: 20 }, { id: '77', name: '我喜欢的音乐', owned: true, specialType: 5, trackCount: 0 }], fail = false;
  await page.route('**/api/online/netease/**', async route => {
    const request = route.request(), url = new URL(request.url()); let value;
    if (url.pathname.endsWith('/auth/status')) value = { loggedIn: true, profile: { userId: '123', nickname: '合成用户' } };
    else if (url.pathname.endsWith('/playlist-management')) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); writes.push(body);
        if (fail) return route.fulfill({ status: 502, json: { error: '模拟网络中断' } });
        if (body.action === 'create') lists.push({ id: '66', name: body.name, owned: true, trackCount: 0 });
        if (body.action === 'rename') lists.find(item => item.id === body.playlistId).name = body.name;
        if (body.action === 'delete') lists = lists.filter(item => item.id !== body.playlistId);
        if (body.action === 'remove') lists.find(item => item.id === body.playlistId).trackCount -= body.trackIds.length;
        value = { ok: true, message: '已保存到网易云音乐。' };
      } else value = { provider: 'netease', session: '1', create: true, rename: true, delete: true, add: true, remove: true };
    } else if (url.pathname.endsWith('/playlists')) value = { playlists: lists, hasMore: false };
    else if (url.pathname.includes('/tracks')) { const offset = Number(url.searchParams.get('offset')); value = { total: 1200, tracks: Array.from({ length: 50 }, (_, i) => track(offset + i + 1)) }; }
    else if (url.pathname.endsWith('/search')) value = { provider: 'netease', tracks: [track(3)], total: 1, offset: 0, limit: 20, hasMore: false };
    else return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ json: value });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/playlist-fixture`);
  await page.waitForFunction(() => window.ready);
  await page.locator('#online-search').fill('测试'); await page.locator('.online-search-form button').click();
  await page.locator('[data-online-add]').click();
  await page.locator('[data-choose="99"]').waitFor();
  assert.equal(await page.locator('[data-choose="88"]').count(), 0, 'picker contains only owned playlists');
  assert.equal(await page.evaluate(() => window.plays), 0, 'add must not play a song');
  await fs.mkdir('artifacts/playlist-management-ui', { recursive: true });
  await page.screenshot({ path: 'artifacts/playlist-management-ui/add-night.png' });
  await page.locator('[data-choose="99"]').click();
  await page.waitForFunction(() => window.changes === 1);
  await page.waitForFunction(() => !document.querySelector('dialog').hasAttribute('aria-busy'));
  assert.deepEqual(writes[0].trackIds, ['3']);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog').count(), 0);
  await page.locator('#open').click(); await page.locator('[data-choose="99"]').click();
  await page.locator('[data-pick="1"]').waitFor();
  assert.ok(await page.locator('.playlist-edit-track').count() <= 20, 'large lists virtualize their rows');
  await page.locator('[data-form="rename"] input').fill('重命名 "测试"');
  await page.locator('[data-form="rename"] button').click();
  await page.waitForFunction(() => window.changes === 2);
  await page.getByRole('heading', { name: '重命名 "测试"', exact: true }).waitFor();
  await page.locator('[data-pick="1"]').check(); await page.locator('[data-remove]').click();
  assert.equal(writes.length, 2, 'removal needs in-app confirmation');
  await page.locator('[data-confirm="remove"]').click();
  await page.waitForFunction(() => window.changes === 3);
  await page.waitForFunction(() => !document.querySelector('dialog').hasAttribute('aria-busy'));
  await page.locator('.playlist-edit-tracks').evaluate(node => { node.scrollTop = 520 * 52; node.dispatchEvent(new Event('scroll')); });
  await page.locator('[data-pick="521"]').waitFor();
  assert.ok(await page.locator('.playlist-edit-track').count() <= 20);
  await page.screenshot({ path: 'artifacts/playlist-management-ui/edit-night.png' });
  await page.evaluate(() => document.querySelector('#stage').dataset.theme = 'day');
  await page.screenshot({ path: 'artifacts/playlist-management-ui/edit-day.png' });
  await page.locator('[data-back]').click(); await page.locator('[data-choose="88"]').click();
  assert.equal(await page.locator('[data-remove],[data-delete],[data-form="rename"]').count(), 0, 'collected playlists have no writes');
  await page.locator('[data-back]').click(); await page.locator('[data-choose="77"]').click();
  assert.equal(await page.locator('[data-delete],[data-form="rename"]').count(), 0, 'liked playlist cannot be renamed or deleted');
  await page.locator('[data-back]').click();
  await page.locator('[data-form="create"] input').fill('全新歌单'); await page.locator('[data-form="create"] button').click();
  await page.locator('[data-choose="66"]').waitFor(); await page.locator('[data-choose="66"]').click();
  await page.locator('[data-delete]').click(); await page.locator('[data-cancel-confirm]').click(); assert.equal(writes.length, 4);
  await page.locator('[data-delete]').click(); await page.locator('[data-confirm="delete"]').click();
  await page.waitForFunction(() => window.changes === 5); await page.locator('[data-choose="99"]').waitFor();
  assert.equal(await page.locator('[data-choose="66"]').count(), 0);
  fail = true; await page.locator('[data-form="create"] input').fill('失败不能重试'); await page.locator('[data-form="create"] button').click();
  await page.getByRole('status').filter({ hasText: '模拟网络中断' }).waitFor();
  assert.equal(writes.length, 6); assert.equal(await page.evaluate(() => window.changes), 5);
  assert.equal(await page.locator('[data-close]').isEnabled(), true);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { const open = window.manager.open('netease'); window.manager.dispose(); await open; });
  assert.equal(await page.locator('dialog').count(), 0, 'disposal cancels in-flight reads');
  assert.deepEqual(errors, []);
  console.log('Playlist UI passed: search picker, cloud writes, confirmation, 1200-song virtualization, protected lists, both themes, failure and disposal.');
} finally { await browser.close(); await server.close(); }
