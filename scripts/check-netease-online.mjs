import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NeteaseOnline, neteaseMediaUrl } from './netease-online.mjs';
import { createMusicServer } from './music-server.mjs';
const song = { id: 123, name: '中文歌曲 <测试>', ar: [{ name: '歌手' }], al: { id: 45, name: '专辑', picUrl: 'https://p1.music.126.net/cover.jpg' }, dt: 240000, fee: 1 };

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
