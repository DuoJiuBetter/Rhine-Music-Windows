import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NeteaseOnline, neteaseMediaUrl, sdkCall } from './netease-online.mjs';
import { createMusicServer } from './music-server.mjs';
import { onlineDiagnostic } from './online-diagnostics.mjs';
const require = createRequire(import.meta.url);
const { eapiReqDecrypt } = require('NeteaseCloudMusicApi/util/crypto.js');
const song = { id: 123, name: '中文歌曲 <测试>', ar: [{ name: '歌手' }], al: { id: 45, name: '专辑', picUrl: 'https://p1.music.126.net/cover.jpg' }, dt: 240000, fee: 1 };

test('large NetEase playlists request only a few embedded tracks while retaining every track ID', async () => {
  const previousFetch = globalThis.fetch;
  const trackIds = Array.from({ length: 943 }, (_, index) => ({ id: index + 1 }));
  let requested;
  globalThis.fetch = async (_url, init) => {
    const encrypted = new URLSearchParams(init.body).get('params');
    const decoded = eapiReqDecrypt(encrypted);
    requested = decoded.data;
    assert.equal(decoded.url, '/api/v6/playlist/detail');
    const tracks = Array.from({ length: requested.n }, (_, index) => ({ id: index + 1, description: 'x'.repeat(3000) }));
    return Response.json({ code: 200, playlist: { trackIds, tracks } });
  };
  try {
    const result = await sdkCall('playlistDetail', { id: '2851221535', s: 0, cookie: {} });
    assert.equal(requested.n, 10);
    assert.equal(requested.s, 0);
    assert.equal(result.body.playlist.trackIds.length, 943);
    assert.equal(result.body.playlist.tracks.length, 10);

    const api = new NeteaseOnline({
      call: (method, params) => method === 'playlistDetail' ? sdkCall(method, params)
        : Promise.resolve({ body: { code: 200, songs: params.ids.split(',').map(id => ({ ...song, id: Number(id) })) } }),
      sessionStore: { load: async () => ({}), clear: async () => {}, save: async () => {} },
    });
    await api.auth.ready;
    api.auth.cookie = { MUSIC_U: 'synthetic-session' };
    api.auth.profile = { userId: '123' };
    api.playlistEpoch = api.auth.epoch;
    api.ownedPlaylists = new Map([['2851221535', { id: '2851221535' }]]);
    api.playlistCache = new Map();
    const first = await api.playlistTracks('2851221535');
    const last = await api.playlistTracks('2851221535', 900);
    assert.equal(first.total, 943);
    assert.equal(first.tracks.length, 50);
    assert.equal(last.tracks.length, 43);
    assert.equal(last.tracks.at(-1)?.id, 'netease-943');
    assert.ok(first.tracks.every(Boolean) && last.tracks.every(Boolean));
  } finally { globalThis.fetch = previousFetch; }
});

test('playlist response budget is adjustable but remains bounded', async () => {
  const previousFetch = globalThis.fetch, previousLimit = process.env.RHINE_NETEASE_PLAYLIST_RESPONSE_LIMIT_MIB;
  globalThis.fetch = async () => Response.json({ code: 200, playlist: { trackIds: [], padding: 'x'.repeat(3 * 1024 * 1024) } });
  try {
    process.env.RHINE_NETEASE_PLAYLIST_RESPONSE_LIMIT_MIB = '2';
    await assert.rejects(sdkCall('playlistDetail', { id: '123', cookie: {} }), failure => {
      assert.match(failure.message, /歌单曲目过多/);
      assert.equal(onlineDiagnostic(failure)?.code, 'NETEASE_RESPONSE_TOO_LARGE');
      return true;
    });
    process.env.RHINE_NETEASE_PLAYLIST_RESPONSE_LIMIT_MIB = '4';
    assert.equal((await sdkCall('playlistDetail', { id: '123', cookie: {} })).body.code, 200);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousLimit === undefined) delete process.env.RHINE_NETEASE_PLAYLIST_RESPONSE_LIMIT_MIB;
    else process.env.RHINE_NETEASE_PLAYLIST_RESPONSE_LIMIT_MIB = previousLimit;
  }
});

test('NetEase search preserves IDs, song metadata, pagination, and bounded cache', async () => {
  let calls = 0, now = 0;
  const api = new NeteaseOnline({ now: () => now, call: async (method, params) => {
    calls++; assert.equal(method, 'search'); assert.equal(params.limit, 20); assert.equal(params.type, 1);
    return { body: { code: 200, result: { songCount: 42, songs: [song, { id: '../bad', name: 'bad' }] } } };
  } });
  const first = await api.search(' 中文 ');
  assert.equal(first.query, '中文'); assert.equal(first.total, 42); assert.equal(first.hasMore, true);
  assert.equal(first.tracks.length, 1); assert.equal(first.tracks[0].id, 'netease-123');
  assert.equal(first.tracks[0].duration, 240); assert.equal(first.tracks[0].onlineSource.albumTitle, '专辑');
  assert.equal(first.tracks[0].localDecodable, false);
  assert.equal(new URL(first.tracks[0].onlineSource.coverUrl).searchParams.get('param'), '100y100');
  assert.deepEqual(await api.search('中文'), first); assert.equal(calls, 1);
  await api.search('中文', 20); assert.equal(calls, 2);
  now = 300001; await api.search('中文'); assert.equal(calls, 3);
  await assert.rejects(api.search(''), { status: 400 });
  await assert.rejects(api.search('x'.repeat(101)), { status: 400 });
  await assert.rejects(api.search('x', -1), { status: 400 });
  await assert.rejects(api.search('x', 1), { status: 400 });
});

test('NetEase coalesces identical in-flight searches and releases failed requests', async () => {
  let calls = 0, release;
  const api = new NeteaseOnline({ call: async () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const a = api.search('test'), b = api.search('test');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release({ body: { code: 200, result: { songCount: 0 } } });
  assert.deepEqual(await a, await b); assert.equal(calls, 1); assert.equal(api.inFlight.size, 0);
  const failed = new NeteaseOnline({ call: async () => { throw new Error('private upstream details'); } });
  await assert.rejects(failed.search('test'), { message: '无法连接网易云，请检查网络后重试。' });
  assert.equal(failed.active, 0); assert.equal(failed.inFlight.size, 0);
});

test('NetEase playback distinguishes trial, unavailable, and unsafe URLs', async () => {
  let value = { id: 123, url: 'http://m7.music.126.net/audio.mp3', br: 128000, type: 'mp3', freeTrialInfo: { start: 0, end: 30 } };
  const api = new NeteaseOnline({ call: async (method, params) => {
    assert.equal(method, 'playback'); assert.equal(params.level, 'standard'); assert.equal(params.id, '123');
    return { body: { code: 200, data: [value] } };
  } });
  const trial = await api.prepare('123'); assert.equal(trial.audioUrl, 'https://m7.music.126.net/audio.mp3');
  assert.deepEqual(trial.trial, { start: 0, end: 30 });
  value = { ...value, url: null }; await assert.rejects(api.prepare('123'), { status: 403 });
  value.url = 'http://127.0.0.1/private'; await assert.rejects(api.prepare('123'), { status: 403 });
  await assert.rejects(api.prepare('../123'), { status: 400 });
  for (const url of ['https://music.126.net.evil.test/x', 'https://user:pass@m7.music.126.net/x', 'https://m7.music.126.net:444/x', 'file:///x']) assert.equal(neteaseMediaUrl(url), undefined);
});

test('NetEase explicit login-required response is HTTP 401 for playback recovery', async () => {
  const api = new NeteaseOnline({ call: async () => ({ body: { code: 301 } }) });
  await assert.rejects(api.prepare('123'), { status: 401, message: '网易云需要登录后才能进行此操作。' });
});

test('NetEase timeout and changed result shapes produce actionable errors', async () => {
  const timeout = new NeteaseOnline({ call: async () => { throw new DOMException('timeout', 'TimeoutError'); } });
  await assert.rejects(timeout.search('x'), { message: '网易云请求超时，请检查网络后重试。' });
  const changed = new NeteaseOnline({ call: async () => ({ body: { code: 200, result: { songs: {} } } }) });
  await assert.rejects(changed.search('x'), /搜索结果格式发生变化/);
});

test('owned server exposes NetEase search/prepare with the existing origin boundaries', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rhine-online-'));
  const online = new NeteaseOnline({ call: async method => ({ body: method === 'search'
    ? { code: 200, result: { songCount: 1, songs: [song] } }
    : { code: 200, data: [{ id: 123, url: 'https://m7.music.126.net/x.mp3' }] } }) });
  const { server, decoder, output } = await createMusicServer({ dataDir: root, autoScan: false, online });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { decoder.dispose(); output.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const result = await (await fetch(`${origin}/api/online/netease/search?q=${encodeURIComponent('中文')}`)).json();
  assert.equal(result.tracks[0].id, 'netease-123');
  assert.equal((await fetch(`${origin}/api/online/netease/search?q=x`, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  const prepared = await fetch(`${origin}/api/online/netease/prepare/123`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(prepared.status, 200); assert.equal((await prepared.json()).audioUrl, 'https://m7.music.126.net/x.mp3');
  assert.equal((await fetch(`${origin}/api/online/netease/search?q=x&offset=1`)).status, 400);
  assert.equal((await (await fetch(`${origin}/api/online/netease/auth/status`)).json()).loggedIn, false);
  assert.equal((await fetch(`${origin}/api/online/netease/playlists`)).status, 401);
  assert.equal((await fetch(`${origin}/api/online/netease/playlists/99/tracks`)).status, 401);
  assert.equal((await fetch(`${origin}/api/online/netease/playlists`, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  for (const action of ['start', 'poll', 'cancel', 'logout']) {
    assert.equal((await fetch(`${origin}/api/online/netease/auth/${action}`, { method: 'POST', headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${origin}/api/online/netease/auth/${action}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  }
});
