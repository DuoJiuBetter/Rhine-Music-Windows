import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NeteaseOnline } from './netease-online.mjs';
import { NeteaseSessionStore } from './netease-session.mjs';
const memory = () => ({ value: {}, async load() { return this.value; }, async save(value) { this.value = { ...value }; }, async clear() { this.value = {}; } });
const response = (method, code = 803) => method === 'qrKey' ? { body: { code: 200, data: { code: 200, unikey: 'test-key-12345678' } } }
  : method === 'qrCreate' ? { body: { code: 200, data: { qrimg: 'data:image/png;base64,dGVzdA==' } } }
  : method === 'qrCheck' ? { body: { code }, cookie: ['MUSIC_U=synthetic-test-secret; Path=/; HttpOnly', '__csrf=synthetic-csrf; Path=/'] }
  : { body: { data: { code: 200, account: { id: 123 }, profile: { userId: 123, nickname: '测试用户' } } } };

test('QR login transitions, private credentials, authenticated playback, restore and logout', async () => {
  let code = 801, playbackCookie;
  const store = memory();
  const online = new NeteaseOnline({ sessionStore: store, call: async (method, params) => {
    if (method === 'playback') { playbackCookie = params.cookie; return { body: { code: 200, data: [{ id: 123, url: 'https://m7.music.126.net/test.mp3' }] } }; }
    return response(method, code);
  } });
  assert.equal((await online.auth.status()).loggedIn, false);
  const qr = await online.auth.start(); assert.equal((await online.auth.poll(qr.id)).state, 'waiting');
  code = 802; assert.equal((await online.auth.poll(qr.id)).state, 'scanned');
  code = 803; const account = await online.auth.poll(qr.id);
  assert.equal(account.state, 'authorized'); assert.equal(account.profile.nickname, '测试用户');
  assert.equal(JSON.stringify(account).includes('synthetic-test-secret'), false);
  assert.equal(JSON.stringify(qr).includes('test-key-12345678'), false);
  assert.equal(store.value.MUSIC_U, 'synthetic-test-secret'); assert.equal(store.value.Path, undefined);
  await online.prepare('123'); assert.equal(playbackCookie.MUSIC_U, 'synthetic-test-secret');
  const restored = new NeteaseOnline({ sessionStore: store, call: async method => response(method) });
  assert.equal((await restored.auth.status()).loggedIn, true);
  await online.auth.logout(); assert.deepEqual(store.value, {}); assert.equal(online.auth.snapshot().loggedIn, false);
});

test('expired, replaced and cancelled QR challenges cannot restore an account', async () => {
  let now = 0, release;
  const store = memory();
  const online = new NeteaseOnline({ sessionStore: store, now: () => now, call: async method => {
    if (method === 'qrCheck') return new Promise(resolve => release = resolve);
    return response(method);
  } });
  let qr = await online.auth.start(); now = 120001;
  assert.equal((await online.auth.poll(qr.id)).state, 'expired');
  qr = await online.auth.start(); const pending = online.auth.poll(qr.id);
  await online.auth.logout(); release(response('qrCheck'));
  assert.equal((await pending).state, 'expired'); assert.deepEqual(store.value, {});
  const first = await online.auth.start(); const second = await online.auth.start();
  assert.equal((await online.auth.poll(first.id)).state, 'expired');
  online.auth.cancel(second.id); assert.equal((await online.auth.poll(second.id)).state, 'expired');
});

test('logout during encrypted save wins and clears its disk write', async () => {
  let release, started;
  const store = memory(); store.save = async function(value) { started = true; await new Promise(resolve => release = resolve); this.value = value; };
  const online = new NeteaseOnline({ sessionStore: store, call: async method => response(method) });
  const qr = await online.auth.start(); const polling = online.auth.poll(qr.id);
  while (!started) await new Promise(resolve => setImmediate(resolve));
  const logout = online.auth.logout(); await new Promise(resolve => setImmediate(resolve)); release();
  await Promise.all([polling, logout]); assert.equal(online.auth.snapshot().loggedIn, false); assert.deepEqual(store.value, {});
});

test('Windows DPAPI persists only encrypted synthetic credentials', { skip: process.platform !== 'win32' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rhine-auth-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new NeteaseSessionStore(directory), cookie = { MUSIC_U: 'synthetic-dpapi-test-secret', __csrf: 'synthetic-only' };
  await store.save(cookie); const disk = await fs.readFile(store.file);
  assert.equal(disk.includes(Buffer.from(cookie.MUSIC_U)), false);
  assert.deepEqual(await store.load(), cookie); await store.clear(); assert.deepEqual(await store.load(), {});
});
