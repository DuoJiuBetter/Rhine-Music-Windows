import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PlaylistManagement } from './playlist-management.mjs';
import { NeteaseOnline } from './netease-online.mjs';
import { PlatformCatalog } from './platform-catalog.mjs';
import { PlatformLoginProtocols } from './platform-login-protocols.mjs';
import { createMusicServer } from './music-server.mjs';

async function fixture(custom) {
  const calls = [];
  const api = new NeteaseOnline({ sessionStore: { load: async () => ({}), save: async () => {}, clear: async () => {} }, call: async (method, params) => {
    calls.push({ method, params });
    const value = await custom?.(method, params); if (value) return value;
    return { body: { code: 200, ...(method === 'playlists' ? { playlist: [{ id: 99, name: 'Own', creator: { userId: 123 }, trackCount: 2 }, { id: 88, creator: { userId: 456 } }, { id: 77, creator: { userId: 123 }, specialType: 5 }] } : method === 'playlistDetail' ? { playlist: { creator: { userId: 123 }, trackIds: [{ id: 1 }, { id: 2 }] } } : {}) } };
  } });
  await api.auth.ready; api.auth.cookie = { MUSIC_U: 'synthetic-only-secret' }; api.auth.profile = { userId: '123' };
  await api.playlists();
  const manager = new PlaylistManagement('netease', api);
  const session = (await manager.capabilities()).session;
  return { api, manager, calls, session, write: body => manager.mutate({ session, ...body }) };
}
test('NetEase create, quoted rename, add deduplication, remove and delete use verified operations', async () => {
  const { api, calls, write } = await fixture();
  await write({ action: 'create', name: 'A "quoted" 名称' });
  await write({ action: 'rename', playlistId: '99', name: 'B "安全"' });
  api.playlistCache.set('99:ids', { value: ['old'] });
  await write({ action: 'add', playlistId: '99', trackIds: ['1', '3', '3'] });
  assert.equal(calls.find(item => item.method === 'playlistAdd').params.ids, '3');
  assert.equal(api.playlistCache.size, 0);
  await write({ action: 'remove', playlistId: '99', trackIds: ['2'] });
  await write({ action: 'delete', playlistId: '99' });
  assert.equal(calls.find(item => item.method === 'playlistRename').params.name, 'B "安全"');
  assert.deepEqual(calls.filter(item => /^playlist(Create|Rename|Add|Remove|Delete)$/.test(item.method)).map(item => item.method), ['playlistCreate','playlistRename','playlistAdd','playlistRemove','playlistDelete']);
});
test('reject foreign, unknown, system playlists, malformed batches and stale account sessions before writing', async () => {
  const { calls, write, api } = await fixture();
  for (const playlistId of ['88', '100']) await assert.rejects(write({ action: 'delete', playlistId }), { status: 403 });
  await assert.rejects(write({ action: 'delete', playlistId: '77' }), { status: 403 });
  for (const trackIds of [[], ['qq-123'], [1], Array(51).fill('1')]) await assert.rejects(write({ action: 'add', playlistId: '99', trackIds }), { status: 400 });
  for (const name of ['', 'a'.repeat(41), 'bad\nname']) await assert.rejects(write({ action: 'create', name }), { status: 400 });
  api.auth.epoch++; await assert.rejects(write({ action: 'create', name: 'old account' }), { status: 409 });
  assert.equal(calls.some(item => /^playlist(Create|Rename|Add|Delete)$/.test(item.method)), false);
});
test('fresh ownership is checked, duplicate add is a no-op and never gets retried', async () => {
  const a = await fixture(method => method === 'playlistDetail' ? { body: { code: 200, playlist: { creator: { userId: 999 }, trackIds: [] } } } : undefined);
  await assert.rejects(a.write({ action: 'add', playlistId: '99', trackIds: ['3'] }), { status: 403 });
  const b = await fixture();
  assert.equal((await b.write({ action: 'add', playlistId: '99', trackIds: ['1'] })).unchanged, true);
  assert.equal(b.calls.filter(item => item.method === 'playlistAdd').length, 0);
  const c = await fixture(method => { if (method === 'playlistCreate') throw Object.assign(new Error('network failed'), { status: 502 }); });
  await assert.rejects(c.write({ action: 'create', name: 'Test' }));
  assert.equal(c.calls.filter(item => item.method === 'playlistCreate').length, 1);
});
test('account switch while awaiting ownership cannot submit to the next account', async () => {
  let release;
  const a = await fixture(method => method === 'playlistDetail' ? new Promise(resolve => release = resolve) : undefined);
  const pending = a.write({ action: 'delete', playlistId: '99' });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  a.api.auth.epoch++; release({ body: { code: 200, playlist: { creator: { userId: 123 } } } });
  await assert.rejects(pending, { status: 409 });
  assert.equal(a.calls.some(item => item.method === 'playlistDelete'), false);
});
test('concurrent writes are rejected; a failure releases the write reservation', async () => {
  let release;
  const a = await fixture(method => method === 'playlistCreate' ? new Promise(resolve => release = resolve) : undefined);
  const pending = a.write({ action: 'create', name: 'One' });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(a.write({ action: 'create', name: 'Two' }), { status: 409 });
  release({ body: { code: 200 } }); await pending;
  assert.equal(a.manager.busy, false);
});
test('QQ writes use the official Web RPC and numeric song identity, protected liked list', async () => {
  const calls = [], auth = { ready: Promise.resolve(), epoch: 1, credential: { musicid: '123', musickey: 'synthetic' } };
  const api = new PlatformCatalog({ provider: 'qq', auth, transport: { qqRpc: async (module, method, params) => {
    calls.push({ module, method, params });
    return method === 'get_song_detail_yqq' ? { track_info: { mid: params.song_mid, id: 123456, type: 0 } } : {};
  } } });
  api.scope();
  for (const [id, owned, dirid] of [['7-42', true, '7'], ['201-0', true, '201'], ['0-88', false, '0']]) api.owned.set(id, { value: { id, owned }, dirid, tid: '42' });
  const manager = new PlaylistManagement('qq', api), session = (await manager.capabilities()).session;
  await manager.mutate({ session, action: 'create', name: 'QQ 新歌单' });
  await manager.mutate({ session, action: 'add', playlistId: '7-42', trackIds: ['000Song001'] });
  await manager.mutate({ session, action: 'remove', playlistId: '7-42', trackIds: ['000Song001'] });
  const add = calls.find(item => item.method === 'AddSonglist');
  assert.deepEqual(add, { module: 'music.musicasset.PlaylistDetailWrite', method: 'AddSonglist', params: { dirId: 7, v_songInfo: [{ songType: 0, songId: 123456 }] } });
  await assert.rejects(manager.mutate({ session, action: 'delete', playlistId: '201-0' }), { status: 403 });
  await assert.rejects(manager.mutate({ session, action: 'add', playlistId: '0-88', trackIds: ['000Song001'] }), { status: 403 });
  await assert.rejects(manager.mutate({ session, action: 'rename', playlistId: '7-42', name: 'Unknown params' }), { status: 501 });
});
test('unverified Bodian writes have explicit capabilities and never call a guessed endpoint', async () => {
  const api = { auth: { ready: Promise.resolve(), epoch: 1 }, scope() {} };
  const manager = new PlaylistManagement('bodian', api);
  const caps = await manager.capabilities(); assert.equal(caps.add, true); assert.equal(caps.create, false);
  await assert.rejects(manager.mutate({ session: caps.session, action: 'create', name: 'No guesses' }), { status: 501 });
});
test('QQ write transport requires explicit success, accepts empty acknowledgements and never retries', async () => {
  let result = { code: 0, req: { code: 0 } }, count = 0;
  const protocol = new PlatformLoginProtocols('qq', async (_url, options) => {
    count++; const body = JSON.parse(options.body);
    assert.equal(body.req.module, 'music.musicasset.PlaylistDetailWrite');
    return Response.json(result);
  });
  const credential = { musicid: '123', musickey: 'synthetic_key_123', loginType: 2 };
  assert.deepEqual(await protocol.qqRpc('music.musicasset.PlaylistDetailWrite', 'AddSonglist', {}, credential), {});
  result = { code: 0, req: { data: {} } };
  await assert.rejects(protocol.qqRpc('music.musicasset.PlaylistDetailWrite', 'AddSonglist', {}, credential), /明确的成功/);
  result = { code: 0, req: { code: 1000 } };
  await assert.rejects(protocol.qqRpc('music.musicasset.PlaylistDetailWrite', 'AddSonglist', {}, credential), /1000/);
  assert.equal(count, 3);
});
test('local HTTP cloud writes preserve origin, content-type, method and account boundaries', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rhine-playlist-write-'));
  const a = await fixture();
  const { server } = await createMusicServer({ dataDir: root, autoScan: false, online: a.api, platformAuth: {}, catalogs: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`, url = origin + '/api/online/netease/playlist-management';
  const caps = await (await fetch(url)).json(); assert.equal(caps.rename, true);
  const body = JSON.stringify({ session: caps.session, action: 'create', name: 'HTTP test' });
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' }, body })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })).status, 415);
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 405);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body });
  assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  assert.equal(JSON.stringify(caps).includes('synthetic-only-secret'), false);
  await a.api.auth.logout(); assert.equal((await fetch(url)).status, 401);
});
