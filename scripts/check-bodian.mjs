import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { BodianProtocol, validBodianCredential } from './bodian-protocol.mjs';
import { BodianCatalog } from './bodian-catalog.mjs';
import { PlatformAuth } from './platform-auth.mjs';
import { platformMediaUrl } from './platform-media.mjs';

// Synthetic transport and accounts only. No real network, credentials or DPAPI.
const credential = { uid: '123', token: 'synthetic_token_123', deviceId: 'a'.repeat(32), nickname: 'Synthetic' };
const song = id => ({ id, name: `Song ${id}`, artist: 'Artist', album: 'Album', albumId: 45, duration: 120, freeSign: 'synthetic-sign' });
function catalog(transport) {
  const auth = { ready: Promise.resolve(), epoch: 1, credential, invalidateCredential: async function (value, epoch) { if (this.credential === value && this.epoch === epoch) { this.credential = undefined; this.epoch++; } } };
  return { auth, api: new BodianCatalog({ auth, transport }) };
}

test('Bodian GET playback retains exact JSON body and bounded trusted transport', async () => {
  let captured;
  const protocol = new BodianProtocol((url, options, ready) => {
    const request = new EventEmitter(); request.destroy = () => {};
    request.end = body => {
      captured = { url, options, body };
      queueMicrotask(() => { const response = new PassThrough(); response.statusCode = 200; response.headers = {}; ready(response); response.end(JSON.stringify({ code: 200, data: { status: 1 } })); });
    };
    return request;
  });
  await protocol.api('/api/play/music/v2/checkRight', { musicId: 7, freeSign: '' }, { credential, timed: true, payload: { musicId: 7, freeSign: '' } });
  assert.equal(captured.options.method, 'GET');
  assert.equal(captured.body, '{"musicId":7,"freeSign":""}');
  assert.equal(captured.options.headers['Content-Length'], Buffer.byteLength(captured.body));
  assert.equal(captured.options.headers.devid, credential.deviceId);
  assert.match(captured.url.searchParams.get('sign'), /^[a-f0-9]{32}$/);
  await assert.rejects(protocol.json('https://attacker.example/'), { status: 400 });
  assert.equal(protocol.active, 0);
});

test('Bodian QR exchanges only authType 10 and rejects mismatched confirmed identities', async () => {
  const protocol = new BodianProtocol(() => { throw new Error('No network'); });
  protocol.api = async (path, _params, options) => {
    if (path.endsWith('qrCodeStatus')) return { status: 3, uid: 123 };
    assert.deepEqual(options.payload, { authType: 10, qrCode: 'synthetic-qr' });
    return { id: 123, token: credential.token, userInfo: { nickname: 'Synthetic' } };
  };
  const challenge = { key: 'synthetic-qr', deviceId: credential.deviceId };
  const result = await protocol.poll(challenge);
  assert.equal(result.state, 'authorized'); assert.ok(validBodianCredential(result.credential));
  protocol.api = async path => path.endsWith('qrCodeStatus') ? { status: 3, uid: 456 } : { id: 123, token: credential.token, userInfo: {} };
  await assert.rejects(protocol.poll(challenge), { loginExpired: true });
});

test('Bodian private playlist pages keep raw mixed cursors and unavailable song positions', async () => {
  const collectedPages = [];
  const { api, auth } = catalog({ api: async (path, params, options) => {
    assert.equal(options.credential, credential);
    if (path.endsWith('userCreate')) return { playLists: [{ id: 8, name: 'Created', musicCount: 52 }] };
    if (path.endsWith('/fond')) return { id: 9, name: 'Liked', musicCount: 1 };
    if (path.endsWith('/collect/4/list')) {
      collectedPages.push(params.pn);
      return { total: 51, playLists: params.pn === 1 ? Array.from({ length: 50 }, (_, n) => ({ id: 100 + n, sourceType: 6 })) : [{ id: 700, sourceType: 4, name: 'Collected', musicCount: 1 }] };
    }
    assert.equal(path, '/api/service/playlist/8/musicList');
    assert.equal(params.pn, 2); assert.equal(params.source, 5);
    return { total: 52, list: [song(51), {}] };
  } });
  const first = await api.playlists();
  assert.equal(first.hasMore, true); assert.equal(first.playlists.length, 2);
  assert.ok(first.playlists.every(item => !item.id.startsWith('6-')));
  const next = await api.playlists(100); assert.deepEqual(collectedPages, [1, 2]);
  assert.equal(next.playlists[0].id, '4-700');
  const tracks = await api.playlistTracks('5-8', 50);
  assert.equal(tracks.tracks[0].id, 'bodian-51'); assert.equal(tracks.tracks[1], null);
  await assert.rejects(api.playlistTracks('5-404'), { status: 403 });
  auth.epoch++; await assert.rejects(api.playlistTracks('5-8', 50), { status: 403 });
});

test('Bodian preview remains a preview and never requests an ungranted full audio URL', async () => {
  const { api } = catalog({ api: async path => {
    assert.equal(path, '/api/play/music/v2/checkRight');
    return { status: 3, audition: { https: 'https://audio.sycdn.kuwo.cn/synthetic-preview.mp3' } };
  } });
  // Production reads establish the account scope before populating tracks.
  api.scope(); api.remember([song(7)]);
  const result = await api.prepare('7');
  assert.ok(result.trial); assert.ok(result.audioUrl.includes('preview'));
  assert.equal(platformMediaUrl('bodian', 'https://kuwo.cn.attacker.example/audio'), undefined);
  assert.equal(platformMediaUrl('bodian', 'https://127.0.0.1/audio'), undefined);
});

test('Bodian empty playlist sources do not hide the other source or liked music', async () => {
  for (const empty of [{}, [], { playLists: null }, { total: 0 }, { playLists: null, total: null }]) {
    for (const source of ['created', 'collected']) {
      const { api } = catalog({ api: async path => {
        if (path.endsWith('userCreate')) return source === 'created' ? empty : { playLists: [{ id: 8, name: 'Created', musicCount: 3 }] };
        if (path.endsWith('/collect/4/list')) return source === 'collected' ? empty : { playLists: [{ id: 7, sourceType: 4, name: 'Collected', musicCount: 2 }] };
        assert.ok(path.endsWith('/fond')); return { id: 9, musicCount: 1 };
      } });
      const result = await api.playlists();
      assert.equal(result.playlists.length, 2, `Empty ${source}: ${JSON.stringify(empty)}`);
      assert.ok(result.playlists.some(item => item.id === '5-9'));
      assert.ok(result.playlists.some(item => item.id === (source === 'created' ? '4-7' : '5-8')));
      assert.equal(result.hasMore, false);
    }
  }
});

test('Bodian malformed collections stay errors and expose field types without private values', async () => {
  for (const malformed of [{ playLists: 'invalid' }, { total: 2 }, { unexpected: true }, [{ id: 7 }]]) {
    const { api } = catalog({ api: async path => {
      if (path.endsWith('userCreate')) return malformed;
      if (path.endsWith('/collect/4/list')) return {};
      return { id: 9 };
    } });
    await assert.rejects(api.playlists(), error => error.status === 502 && error.message.includes('自建歌单'));
  }
  const { api } = catalog({ api: async path => path.endsWith('/collect/4/list')
    ? { playLists: 'private-list-value', token: 'private-token', nickname: 'private-nickname' }
    : path.endsWith('userCreate') ? {} : { id: 9 } });
  await assert.rejects(api.playlists(), error => error.message.includes('收藏歌单') && error.message.includes('playLists:string') && !error.message.includes('private-'));
});

test('Bodian null totals retain collection cursors and known song counts', async () => {
  const { api } = catalog({ api: async path => {
    if (path.endsWith('userCreate')) return { playLists: [{ id: 8, musicCount: 51 }] };
    if (path.endsWith('/collect/4/list')) return { total: null, playLists: Array.from({ length: 50 }, (_, id) => ({ id: id + 100, sourceType: 6 })) };
    if (path.endsWith('/fond')) return { id: 9, musicCount: 1 };
    if (path.endsWith('/musicList')) return { total: null, list: [song(7)] };
    assert.ok(path.endsWith('/music/list')); return { total: null, resultList: Array.from({ length: 20 }, (_, id) => song(id + 1)) };
  } });
  assert.equal((await api.playlists()).hasMore, true, 'Null is unknown; a full mixed collection page continues');
  assert.equal((await api.playlistTracks('5-8')).total, 51, 'Unknown total must not empty the 3D row');
  const search = await api.search('Synthetic'); assert.equal(search.hasMore, true); assert.equal(search.tracks.length, 20);
});

test('Bodian account invalidation cannot remove a newer session and snapshots omit secrets', async () => {
  let saved;
  const auth = new PlatformAuth({ provider: 'bodian', store: { load: async () => ({ credential }), save: async value => { saved = value; }, clear: async () => { saved = undefined; } },
    transport: { profile: async () => ({ userId: '123', nickname: 'Synthetic' }) } });
  await auth.status();
  assert.equal(auth.snapshot().loggedIn, true);
  assert.ok(!JSON.stringify(auth.snapshot()).includes(credential.token));
  const oldEpoch = auth.epoch; auth.epoch++; saved = { credential };
  await auth.invalidateCredential(credential, oldEpoch); assert.ok(saved);
  await auth.invalidateCredential(credential, auth.epoch); assert.equal(saved, undefined);
  assert.equal(auth.snapshot().loggedIn, false);
});
