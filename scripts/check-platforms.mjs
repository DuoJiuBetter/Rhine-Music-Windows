import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformAuth } from './platform-auth.mjs';
import { PlatformCatalog, platformTrack } from './platform-catalog.mjs';
import { PlatformLoginProtocols, qqCredential, validPlatformCredential } from './platform-login-protocols.mjs';
import { platformMediaUrl, PlatformCoverStore } from './platform-media.mjs';

// Synthetic protocols only. No real account, DPAPI process, audio or network.
test('platform transport preserves nonretryable HTTP errors without exposing response bodies', async () => {
  for (const status of [401, 403, 404, 429]) {
    const protocol = new PlatformLoginProtocols('qq', async () => new Response('synthetic-private-body', { status }));
    await assert.rejects(protocol.request('https://u.y.qq.com/cgi-bin/musicu.fcg'), error => error.status === status && !error.message.includes('synthetic-private-body'));
  }
  const protocol = new PlatformLoginProtocols('qq', async () => { throw new TypeError('synthetic-private-details'); });
  await assert.rejects(protocol.request('https://u.y.qq.com/cgi-bin/musicu.fcg'), error => error.status === 502 && !error.message.includes('登录') && !error.message.includes('synthetic-private-details'));
});

const credential = { musicid: '123', musickey: 'synthetic_key_123', loginType: 2 };
const image = 'data:image/png;base64,iVBORw0KGgo=';
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
const qqSong = index => ({ mid: `000Song${String(index).padStart(4, '0')}`, title: `Song ${index}`, interval: 120, singer: [{ name: 'Artist' }], album: { mid: '000Album0001', title: 'Album' } });
function catalog(provider, transport) {
  const auth = { ready: Promise.resolve(), epoch: 1, credential };
  return { auth, api: new PlatformCatalog({ provider, auth, transport }) };
}

test('cancel during persisted login cannot authorize or restore a cancelled account', async () => {
  const saving = deferred(), release = deferred(); let disk;
  const auth = new PlatformAuth({ provider: 'qq', store: {
    load: async () => ({}), save: async value => { disk = value; saving.resolve(); await release.promise; }, clear: async () => { disk = undefined; },
  }, transport: { start: async () => ({ key: 'private_qrsig', image }), poll: async () => ({ state: 'authorized', credential, profile: { userId: '123', nickname: 'Synthetic' } }) } });
  const challenge = await auth.start();
  assert.equal(JSON.stringify(challenge).includes('private_qrsig'), false);
  const polling = auth.poll(challenge.id); await saving.promise;
  auth.cancel(challenge.id); release.resolve();
  assert.equal((await polling).state, 'expired');
  assert.equal(auth.snapshot().loggedIn, false); assert.equal(disk, undefined);
});

test('platform session exposes only public profile and rejects an expired authorization', async () => {
  let now = 1000; const scanned = deferred(); let writes = 0;
  const auth = new PlatformAuth({ provider: 'qq', now: () => now,
    store: { load: async () => ({}), save: async () => writes++, clear: async () => {} },
    transport: { start: async () => ({ image }), poll: () => scanned.promise },
  });
  const challenge = await auth.start(); const task = auth.poll(challenge.id);
  now += 121000; scanned.resolve({ state: 'authorized', credential, profile: { userId: '123', nickname: 'Synthetic' } });
  assert.equal((await task).state, 'expired'); assert.equal(writes, 0);
  assert.equal(JSON.stringify(auth.snapshot()).includes('synthetic_key'), false);
});

test('QQ own playlists preserve page order, unavailable positions and account isolation', async () => {
  let requests = 0;
  const { api, auth } = catalog('qq', { qqRpc: async (module, method, param, current) => {
    assert.equal(current, credential); requests++;
    assert.equal(module, 'music.srfDissInfo.DissInfo'); assert.equal(param.song_num, 50);
    return { total_song_num: 52, songlist: Array.from({ length: param.song_begin ? 2 : 50 }, (_, index) => index === 1 ? {} : qqSong(param.song_begin + index)) };
  }, qqHttp: async (path, params, current) => {
    assert.equal(current, credential); requests++;
    return path.includes('created_diss') ? { disslist: [{ dirid: 7, tid: 42, diss_name: '<Mine>', song_cnt: 52 }], total: 1 } : { cdlist: [], total: 0 };
  } });
  await assert.rejects(api.playlistTracks('7-42'), { status: 403 });
  const lists = await api.playlists(); assert.equal(lists.playlists[0].name, '未命名歌单');
  // HTML-like text is stripped by the normalization boundary.
  assert.equal(lists.playlists[0].id, '7-42');
  const page = await api.playlistTracks('7-42', 50);
  assert.equal(page.tracks[0].title, 'Song 50'); assert.equal(page.tracks[1], null); assert.equal(page.total, 52);
  const before = requests; await api.playlistTracks('7-42', 50); assert.equal(requests, before);
  auth.epoch++; await assert.rejects(api.playlistTracks('7-42', 50), { status: 403 });
  await api.playlists(); auth.credential = undefined; auth.epoch++;
  await assert.rejects(api.playlists(), { status: 401 });
});

test('QQ liked songs use the authenticated session without requiring a profile identifier', async () => {
  const { api } = catalog('qq', { qqHttp: async path => {
    if (path.includes('created_diss')) return { disslist: [{ dirid: 201, tid: 12345, diss_name: 'Liked', song_cnt: 1 }] };
    assert.ok(path.includes('/fav/'), 'No profile-homepage prerequisite'); return { cdlist: [] };
  }, qqRpc: async (module, method, param, current) => {
    assert.equal(current, credential); assert.equal(module, 'music.srfDissInfo.DissInfo'); assert.equal(method, 'CgiGetDiss');
    assert.equal(param.disstid, 0); assert.equal(param.dirid, 201); assert.equal(param.enc_host_uin, undefined);
    return { songlist: [qqSong(1)], dirinfo: { songnum: 1 } };
  } });
  const lists = await api.playlists(); assert.equal(lists.playlists[0].id, '201-0');
  const songs = await api.playlistTracks('201-0'); assert.equal(songs.total, 1); assert.equal(songs.tracks[0].title, 'Song 1');
});

test('QQ Web playback lets the platform choose the resource and keeps returned clips', async () => {
  let calls = 0;
  const { api } = catalog('qq', { qqRpc: async (module, method, param, current) => {
    calls++; assert.equal(current, credential); assert.equal(module, 'vkey.GetVkeyServer'); assert.equal(method, 'CgiGetVkey');
    assert.equal(param.filename, undefined); assert.equal(param.uin, '123'); assert.equal(param.loginflag, 1); assert.equal(param.platform, '20');
    assert.match(param.guid, /^\d{8}$/); assert.deepEqual(param.songmid, ['000Song0001']); assert.deepEqual(param.songtype, [0]);
    return { sip: ['https://localhost/', 'https://isure.stream.qqmusic.qq.com/'], midurlinfo: [{ songmid: '000Song0001', purl: 'synthetic-preview.m4a?vkey=test' }] };
  } });
  assert.equal((await api.prepare('000Song0001')).audioUrl, 'https://isure.stream.qqmusic.qq.com/synthetic-preview.m4a?vkey=test');
  assert.equal(calls, 1);
});

test('QQ empty automatic resource falls back once using actual media ID and standard MP3/AAC', async () => {
  const calls = [];
  const { api } = catalog('qq', { qqRpc: async (module, method, param) => {
    calls.push(method);
    if (method === 'get_song_detail_yqq') return { track_info: { ...qqSong(1), file: { media_mid: '000Media0002' } } };
    if (!param.filename) return { midurlinfo: [{ songmid: '000Song0001', purl: '' }] };
    assert.deepEqual(param.filename, ['M500000Media0002.mp3', 'C400000Media0002.m4a']);
    assert.deepEqual(param.songmid, ['000Song0001', '000Song0001']); assert.deepEqual(param.songtype, [0, 0]);
    return { sip: ['https://isure.stream.qqmusic.qq.com/'], midurlinfo: [{ songmid: '000Song0001', purl: '' }, { songmid: '000Song0001', purl: 'standard.m4a?vkey=test' }] };
  } });
  assert.match((await api.prepare('000Song0001')).audioUrl, /standard\.m4a/);
  assert.deepEqual(calls, ['CgiGetVkey', 'get_song_detail_yqq', 'CgiGetVkey']);
  api.remember([qqSong(1)]); assert.equal(api.tracks.get('000Song0001').onlineSource.mediaId, '000Media0002');
  calls.length = 0; await api.prepare('000Song0001'); assert.deepEqual(calls, ['CgiGetVkey', 'CgiGetVkey']);
});

test('QQ missing resources never substitute another song, accept a foreign host or assert membership', async () => {
  const { api } = catalog('qq', { qqRpc: async (module, method) => {
    if (method === 'get_song_detail_yqq') return { track_info: qqSong(1) };
    return { sip: ['https://isure.stream.qqmusic.qq.com/'], midurlinfo: [{ songmid: '000Song0002', purl: 'other.mp3' }, { songmid: '000Song0001', purl: 'https://localhost/private.mp3' }] };
  } });
  await assert.rejects(api.prepare('000Song0001'), error => error.status === 403 && /不能据此判断会员/.test(error.message) && !/可能需要会员/.test(error.message));
});

test('QQ playback preserves account epochs across detail lookup and stops old-account fallback', async () => {
  const detail = deferred(), started = deferred(); let requests = 0;
  const { api, auth } = catalog('qq', { qqRpc: async (module, method) => {
    requests++;
    if (method === 'get_song_detail_yqq') { started.resolve(); return detail.promise; }
    return { midurlinfo: [] };
  } });
  const request = api.prepare('000Song0001'); await started.promise; auth.epoch++;
  detail.resolve({ track_info: { ...qqSong(1), file: { media_mid: '000Media0002' } } });
  await assert.rejects(request, { status: 409 }); assert.equal(requests, 2); assert.equal(api.tracks.size, 0); assert.equal(api.cache.size, 0);
});

test('QQ playback protocol uses the official Web req_0 envelope and retains authenticated cookies', async () => {
  const protocols = new PlatformLoginProtocols('qq', async (url, init) => {
    const payload = JSON.parse(init.body);
    assert.equal(payload.req, undefined); assert.equal(payload.req_0.module, 'vkey.GetVkeyServer'); assert.equal(payload.req_0.method, 'CgiGetVkey');
    assert.deepEqual(payload.comm, { uin: '123', format: 'json', ct: 24, cv: 0 }); assert.match(init.headers.Cookie, /qqmusic_key=synthetic_key_123/);
    return Response.json({ code: 0, req_0: { code: 0, data: { midurlinfo: [] } } });
  });
  assert.deepEqual(await protocols.qqRpc('vkey.GetVkeyServer', 'CgiGetVkey', {}, credential), { midurlinfo: [] });
});

test('QQ web search uses module envelope, snake-case paging and authenticated cookies', async () => {
  const protocols = new PlatformLoginProtocols('qq', async (url, init) => {
    const payload = JSON.parse(init.body), key = 'music.search.SearchCgiService';
    assert.equal(payload.comm, undefined); assert.equal(payload.req, undefined);
    assert.deepEqual(payload[key].param, { query: 'Synthetic', page_num: 2, num_per_page: 20, search_type: 0 });
    assert.match(init.headers.Cookie, /qqmusic_uin=123/); assert.match(init.headers.Cookie, /qm_keyst=synthetic_key_123/);
    return Response.json({ code: 0, [key]: { code: 0, data: { body: { song: { list: [qqSong(1)] } }, meta: { sum: 40 } } } });
  });
  const { api } = catalog('qq', protocols);
  const result = await api.search('Synthetic', 20);
  assert.equal(result.tracks[0].title, 'Song 1'); assert.equal(result.total, 40);
});

test('QQ created and collected pagination preserves both streams and reports failed sources', async () => {
  const calls = [];
  const { api } = catalog('qq', { qqHttp: async (path, params) => {
    calls.push({ path, params });
    const begin = Number(params.sin);
    return path.includes('created_diss')
      ? { disslist: Array.from({ length: begin ? 1 : 50 }, (_, i) => ({ tid: 1000 + begin + i, dirid: 10 + begin + i, diss_name: 'Created' })), total: 51 }
      : { cdlist: Array.from({ length: begin ? 2 : 50 }, (_, i) => ({ dissid: 2000 + begin + i, diss_name: 'Collected' })), total: 52 };
  } });
  const first = await api.playlists(), second = await api.playlists(100);
  assert.equal(first.playlists.length, 100); assert.equal(first.hasMore, true);
  assert.equal(second.playlists.length, 3); assert.equal(second.hasMore, false);
  assert.equal(second.playlists[0].owned, true); assert.equal(second.playlists[1].owned, false);
  assert.equal(calls[2].params.sin, '50'); assert.equal(calls[3].params.ein, '99');
  const broken = catalog('qq', { qqHttp: async path => { if (path.includes('/fav/')) throw new Error('synthetic upstream failure'); return { disslist: [] }; } });
  await assert.rejects(broken.api.playlists(), /synthetic upstream failure/);
  assert.equal(broken.api.cache.size, 0);
});

test('QQ web profile requests keep long account IDs exact and do not leak upstream failures', async () => {
  const current = qqCredential({ musicid: '123', str_musicid: '12345678901234567890', encrypt_uin: 'synthetic_enc==', musickey: 'synthetic_key_123' }, 1);
  assert.equal(validPlatformCredential('qq', current), true);
  assert.equal(current.musicid, '123'); assert.equal(current.strMusicid, '12345678901234567890');
  let failed = false;
  const protocol = new PlatformLoginProtocols('qq', async (input, init) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'c.y.qq.com'); assert.equal(url.searchParams.get('loginUin'), current.strMusicid);
    assert.match(init.headers.Cookie, /wxuin=12345678901234567890/);
    assert.notEqual(url.searchParams.get('g_tk'), '5381');
    return Response.json(failed ? { code: 1000, message: 'secret upstream token', data: {} } : { code: 0, data: { disslist: [] } });
  });
  assert.deepEqual(await protocol.qqHttp('/rsc/fcgi-bin/fcg_user_created_diss', {}, current), { disslist: [] });
  failed = true;
  await assert.rejects(protocol.qqHttp('/rsc/fcgi-bin/fcg_user_created_diss', {}, current), error => /1000/.test(error.message) && !error.message.includes('secret'));
  await assert.rejects(protocol.qqHttp('/arbitrary', {}, current), { status: 400 });
});

test('response from an old account cannot repopulate its catalog cache', async () => {
  const pending = deferred(), started = deferred();
  const { api, auth } = catalog('qq', { qqRpc: () => { started.resolve(); return pending.promise; } });
  const request = api.search('Synthetic'); await started.promise; auth.epoch++;
  pending.resolve({ body: { song: { list: [qqSong(1)] } }, meta: { sum: 1 } });
  await assert.rejects(request, { status: 409 }); assert.equal(api.cache.size, 0);
});

test('cover proxy deduplicates and queues downloads with four active transfers', async () => {
  const jobs = [], releases = []; let active = 0, peak = 0;
  const covers = new PlatformCoverStore(async () => {
    active++; peak = Math.max(peak, active); const ready = deferred(); releases.push(ready);
    await ready.promise; active--; return new Response(Buffer.from([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
  });
  for (let i = 0; i < 8; i++) jobs.push(covers.get('qq', `https://y.gtimg.cn/${i}.png`));
  const duplicate = covers.get('qq', 'https://y.gtimg.cn/0.png');
  assert.equal(active, 4);
  for (let i = 0; i < 8; i++) { while (!releases[i]) await Promise.resolve(); releases[i].resolve(); }
  const results = await Promise.all(jobs); assert.equal(await duplicate, results[0]); assert.equal(peak, 4);
  await assert.rejects(covers.get('qq', 'http://127.0.0.1/private'), { status: 400 });
  assert.equal(platformMediaUrl('qq', 'https://y.gtimg.cn.evil.example/image', true), undefined);
  assert.equal(platformMediaUrl('unsupported', 'https://example.com/audio'), undefined);
  assert.equal(platformTrack('qq', { mid: '../bad', title: 'bad' }), undefined);
});
