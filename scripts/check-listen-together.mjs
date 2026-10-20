import test from 'node:test';
import assert from 'node:assert/strict';
import { NeteaseTogether } from './netease-together.mjs';
import { togetherInvite, togetherPlayback, togetherChatMessage, togetherChatPayload } from './together-protocol.mjs';
import { neteasePlaylistSongs } from './netease-online.mjs';
import { PlaylistManagement } from './playlist-management.mjs';
import { BodianProtocol } from './bodian-protocol.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMusicServer } from './music-server.mjs';
const roomId = '1234567890abcdef1234567890abcdef';
function fixture() {
  let room, queue = [], command;
  const calls = [], auth = { epoch: 1, profile: { userId: '123', nickname: 'Synthetic' }, ready: Promise.resolve() };
  const chat = { connected: false, messages: [], connects: 0,
    dispose() { this.connected = false; this.messages = []; },
    async connect(value) { this.connects++; this.connected = true; assert.equal(value.credentials.token, 'private-nim-token'); },
    async send(text) { this.messages.push({ id: '1', nickname: 'Synthetic', text, time: Date.now() }); },
  };
  const api = { auth, accountScope: async () => ({ uid: '123', epoch: auth.epoch }),
    checkScope(epoch) { if (epoch !== auth.epoch) throw Object.assign(new Error('Changed'), { status: 409 }); },
    realtimeCredentials: async () => ({ accId: '123', token: 'private-nim-token' }),
    async request(method, params, epoch) {
      api.checkScope(epoch); calls.push({ method, params });
      if (method === 'togetherStatus') return { code: 200, data: { inRoom: !!room, roomInfo: room } };
      if (method === 'togetherCreate' || method === 'togetherJoin') room = { roomId, chatRoomId: '456', roomUsers: [{ userId: 123, nickname: '<Synthetic>' }] };
      if (method === 'togetherPlaylist') return { code: 200, data: { playlist: { displayList: { result: queue }, version: [{ userId: '123', version: 1 }] }, playCommand: command } };
      if (method === 'togetherQueue') queue = params.displayList.split(',');
      if (method === 'togetherCommand') command = { ...params, serverSeq: 3 };
      if (method === 'togetherEnd') room = undefined;
      if (method === 'songDetail') return { code: 200, songs: [{ id: Number(params.ids), name: 'Song', ar: [{ name: 'Artist' }], al: { name: 'Album' }, dt: 120000 }] };
      if (method === 'accountProfile') return { code: 200, profile: { userId: 123, nickname: 'Synthetic' } };
      return { code: 200 };
    },
  };
  const service = new NeteaseTogether(api, { chat });
  return { api, auth, chat, calls, service, action: body => service.action({ session: String(auth.epoch), ...body }) };
}
test('invitations restrict protocol, official host and required identifiers', () => {
  assert.deepEqual(togetherInvite(`https://st.music.163.com/listen-together/share/?roomId=${roomId}&inviterId=123`), { roomId, inviterId: '123' });
  for (const url of ['http://127.0.0.1/', 'https://st.music.163.com.attacker.example/listen-together/share/', 'https://st.music.163.com/listen-together/share/?roomId=bad']) assert.throws(() => togetherInvite(url), { status: 400 });
});

test('Together HTTP mutations retain Host, Origin, JSON and method protections', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rhine-together-test-')), f = fixture();
  const { server } = await createMusicServer({ dataDir: root, autoScan: false, online: f.api, together: f.service, platformAuth: {}, catalogs: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`, url = origin + '/api/online/netease/together';
  const body = JSON.stringify({ action:'create', session:'1' });
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url, { method:'POST', headers:{Origin:'https://example.invalid','Content-Type':'application/json'},body })).status, 403);
  assert.equal((await fetch(url, { method:'POST', headers:{'Content-Type':'text/plain'},body })).status, 415);
  assert.equal((await fetch(url, { method:'DELETE' })).status, 405);
  assert.equal(f.calls.some(item=>item.method==='togetherCreate'), false);
  assert.equal((await fetch(url, { method:'POST', headers:{Origin:origin,'Content-Type':'application/json'},body })).status, 200);
  assert.equal(f.calls.filter(item=>item.method==='togetherCreate').length, 1);
});
test('room lifecycle, queue, playback, chat, track resolution and confirmed exit omit tokens', async t => {
  const f = fixture(); t.after(() => f.service.dispose());
  assert.equal((await f.service.status()).inRoom, false); assert.equal(f.chat.connects, 0);
  const created = await f.action({ action: 'create' }); assert.equal(created.chat.connected, true);
  assert.equal(JSON.stringify(created).includes('private-nim-token'), false);
  await f.action({ action: 'queue', roomId, ids: ['1', '2', '1'] }); assert.deepEqual((await f.service.status()).queueIds, ['1', '2']);
  await f.action({ action: 'command', roomId, songId: '2', command: 'GOTO', progressMs: 15000, playing: true });
  assert.equal(f.service.snapshot().playback.songId, '2');
  assert.equal((await f.action({ action: 'track', roomId, songId: '2' })).track.id, 'netease-2');
  await assert.rejects(f.action({ action: 'track', roomId, songId: '3' }), { status: 403 });
  await f.action({ action: 'message', roomId, text: 'hello <img>' }); assert.equal(f.chat.messages[0].text, 'hello <img>');
  await assert.rejects(f.action({ action: 'leave', roomId: 'different-room' }), { status: 409 });
  assert.equal((await f.action({ action: 'leave', roomId })).inRoom, false); assert.equal(f.chat.connected, false);
});
test('existing rooms, unknown songs, collected accounts and malformed messages are protected', async t => {
  const f = fixture(); t.after(() => f.service.dispose());
  await f.action({ action: 'create' }); await f.action({ action: 'create' });
  assert.equal(f.calls.filter(item => item.method === 'togetherCreate').length, 1);
  await assert.rejects(f.action({ action: 'join', invite: 'https://st.music.163.com/listen-together/share/?roomId=another12345678&inviterId=999' }), { status: 409 });
  assert.equal(f.calls.some(item => item.method === 'togetherJoin'), false);
  await assert.rejects(f.action({ action: 'queue', roomId, ids: ['qq-song'] }), { status: 400 });
  await assert.rejects(f.action({ action: 'message', roomId, text: ' ' }), { status: 400 });
});
test('account switch during credential lookup prevents a stale chat connection', async t => {
  const f = fixture(); t.after(() => f.service.dispose()); let release;
  f.api.realtimeCredentials = () => new Promise(resolve => release = resolve);
  const pending = f.action({ action: 'create' });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  f.auth.epoch++; release({ accId: '123', token: 'private-nim-token' });
  await assert.rejects(pending, { status: 409 }); assert.equal(f.chat.connects, 0);
});
test('lost replies and unconfirmed exit cannot report success or retry writes', async t => {
  const f = fixture(); t.after(() => f.service.dispose()); const original = f.api.request; let attempts = 0;
  f.api.request = async (method, ...args) => { if (method === 'togetherCreate') { attempts++; throw new Error('network lost'); } return original(method, ...args); };
  await assert.rejects(f.action({ action: 'create' }), /network lost/); assert.equal(attempts, 1);
  f.api.request = original; await f.action({ action: 'create' });
  f.api.request = async (method, ...args) => method === 'togetherEnd' ? { code: 200 } : original(method, ...args);
  await assert.rejects(f.action({ action: 'leave', roomId }), /尚未确认退出/); assert.equal(f.service.snapshot().inRoom, true);
});
test('bounded chat and playback parsing separates custom commands from visible text', () => {
  const raw = { msg_type_: 100, msg_attach_: JSON.stringify({ data: { playCommand: { targetSongId: '123', playStatus: 'PAUSE', progress: 5000, serverSeq: 10 } } }) };
  assert.equal(togetherPlayback(raw).songId, '123'); assert.equal(togetherChatMessage(raw), undefined); assert.equal(togetherPlayback('x'.repeat(70000)), undefined);
  assert.equal(togetherChatMessage({ msg_type_: 0, msg_attach_: 'Hello', from_nick_: 'Friend' }).text, 'Hello');
  for (const text of ['', 'x'.repeat(501)]) assert.throws(() => togetherChatPayload(text, roomId), { status: 400 });
  const payload = togetherChatPayload(' hello ', roomId); assert.equal(payload.msg_attach_, 'hello'); assert.equal(JSON.parse(payload.msg_setting_.ext_).clientExt.roomId, roomId);
});
test('NetEase song writes use song-manipulation rather than video APIs', async () => {
  for (const op of ['add', 'del']) await neteasePlaylistSongs({ id: '99', ids: '1,2' }, (uri, data) => {
    assert.equal(uri, '/api/playlist/manipulate/tracks'); assert.equal(data.op, op); assert.equal(data.pid, '99'); assert.equal(data.trackIds, '["1","2"]');
  }, op);
});
test('Bodian verified song-list POST accepts owned lists, protects collections and validates empty ACKs', async () => {
  const calls = [], api = { auth: { ready: Promise.resolve(), epoch: 1 }, scope() {}, cache: new Map(),
    owned: new Map([['5-42', { playlistId: '42', source: 5, value: { id: '5-42', owned: true } }], ['4-43', { playlistId: '43', source: 4, value: { id: '4-43', owned: false } }]]),
    async call(path, params, options) { calls.push({ path, params, options }); return {}; },
  };
  const manager = new PlaylistManagement('bodian', api), caps = await manager.capabilities(); assert.equal(caps.add, true); assert.equal(caps.create, false);
  for (const action of ['add', 'remove']) await manager.mutate({ session: '1', action, playlistId: '5-42', trackIds: ['7', '8'] });
  assert.deepEqual(calls.map(item => item.path), ['/api/service/playlist/music', '/api/service/playlist/music/delete']);
  assert.deepEqual(calls[0].options.payload, { playListId: 42, musicIdList: [7, 8] }); assert.equal(calls[0].options.method, 'POST');
  await assert.rejects(manager.mutate({ session: '1', action: 'add', playlistId: '4-43', trackIds: ['7'] }), { status: 403 });
  const protocol = new BodianProtocol(); protocol.json = async () => ({ code: 200, data: null });
  assert.deepEqual(await protocol.api('/api/service/playlist/music', {}, { method: 'POST', allowEmpty: true }), {});
  protocol.json = async () => ({ code: 401 }); await assert.rejects(protocol.api('/api/service/playlist/music', {}, { method: 'POST', allowEmpty: true }), { status: 401 });
});
