import test from 'node:test';
import assert from 'node:assert/strict';
import { NeteaseOnline } from './netease-online.mjs';
import { NeteasePlaylists } from '../src/netease-playlists.ts';
import { setPlaylistAlbums, setMusicAlbums, records, fileLocation, fileAtSlot } from '../src/data.ts';
import { fileAtCell, selectionCell, visibleCell, LOOP_COLUMNS, MUSIC_LOOP_ROWS } from '../src/archive-loop.ts';
const song = id => ({ id, name: `歌曲 ${id}`, ar: [{ name: '歌手' }], al: { id: 55, name: '专辑', picUrl: 'https://p1.music.126.net/test.jpg' }, dt: 120000 });

test('changing platform cancels old playlist pages and uses the newly selected account routes', async () => {
  const previousFetch = globalThis.fetch; let release, started;
  const pending = new Promise(resolve => started = resolve), requests = [];
  globalThis.fetch = async input => {
    const path = new URL(input, 'http://127.0.0.1').pathname; requests.push(path);
    if (path === '/api/online/netease/playlists') { started(); return new Promise(resolve => release = () => resolve(Response.json({ playlists: [{ id: '99', name: 'Old', trackCount: 0 }], hasMore: false }))); }
    if (path === '/api/online/qq/playlists') return Response.json({ playlists: [{ id: '7-42', name: 'QQ account', trackCount: 1 }], hasMore: false });
    return Response.json({ total: 1, tracks: [{ id: 'qq-000Song0001', title: 'QQ song' }] });
  };
  const library = new NeteasePlaylists(() => {});
  try {
    const old = library.load(); await pending;
    library.setProvider('qq'); await library.load(); release(); await old;
    assert.deepEqual(library.playlists.map(item => item.name), ['QQ account']);
    assert.equal(library.track(0, 0).id, 'qq-000Song0001');
    assert.ok(requests.includes('/api/online/qq/playlists/7-42/tracks'));
    library.setProvider('netease'); assert.equal(library.track(0, 0), undefined);
  } finally { library.dispose(); globalThis.fetch = previousFetch; }
});
test('title prefetch warms visible and adjacent pages without reading an entire large playlist', async () => {
  const previousFetch = globalThis.fetch, requests = []; let active = 0, peak = 0;
  globalThis.fetch = async input => {
    const url = new URL(input, 'http://127.0.0.1');
    if (url.pathname.endsWith('/playlists')) return Response.json({ playlists: [{ id: '42', name: 'Synthetic', trackCount: 20000 }], hasMore: false });
    const offset = Number(url.searchParams.get('offset')); requests.push(offset);
    active++; peak = Math.max(peak, active); await Promise.resolve(); active--;
    return Response.json({ total: 20000, tracks: Array.from({ length: 50 }, (_, index) => ({ id: String(offset + index), title: `Title ${offset + index}` })) });
  };
  const library = new NeteasePlaylists(() => {});
  try {
    await library.load(); requests.length = 0;
    library.prefetchTitles(0, 51, 82);
    for (let i = 0; i < 100 && !library.track(0, 100); i++) await Promise.resolve();
    assert.equal(library.track(0, 60)?.title, 'Title 60');
    assert.equal(library.track(0, 100)?.title, 'Title 100');
    assert.deepEqual(requests, [50, 100]); assert.ok(peak <= 2);
    library.prefetchTitles(0, 51, 82); await Promise.resolve();
    assert.deepEqual(requests, [50, 100], 'same visible pages deduplicate');
    library.dispose(); assert.equal(library.track(0, 60), undefined, 'account disposal clears prefetched names');
  } finally { library.dispose(); globalThis.fetch = previousFetch; }
});
async function loggedApi(call) {
  const api = new NeteaseOnline({ call, sessionStore: { load: async () => ({}), clear: async () => {}, save: async () => {} } });
  await api.auth.ready; api.auth.cookie = { MUSIC_U: 'synthetic-secret' }; api.auth.profile = { userId: '123', nickname: '测试账号' }; return api;
}
test('account playlists enforce membership and retain ordered, nullable, paged songs', async () => {
  const calls = [];
  const api = await loggedApi(async (method, params) => {
    calls.push(method); assert.equal(params.cookie.MUSIC_U, 'synthetic-secret');
    if (method === 'playlists') { assert.equal(params.uid, '123'); return { body: { code: 200, more: false, playlist: [{ id: 99, name: '<歌单>', trackCount: 55, creator: { userId: 123 }, coverImgUrl: 'http://127.0.0.1/private' }] } }; }
    if (method === 'playlistDetail') return { body: { code: 200, playlist: { trackIds: Array.from({ length: 55 }, (_, index) => ({ id: index + 1 })) } } };
    if (method === 'songDetail') return { body: { code: 200, songs: params.ids.split(',').reverse().filter(id => id !== '2').map(id => song(Number(id))) } };
    throw new Error(method);
  });
  await assert.rejects(api.playlistTracks('99'), { status: 403 });
  const list = await api.playlists(); assert.equal(list.playlists[0].owned, true); assert.equal(list.playlists[0].coverUrl, undefined);
  const first = await api.playlistTracks('99'); assert.equal(first.tracks.length, 50); assert.equal(first.total, 55);
  assert.equal(first.tracks[0].id, 'netease-1'); assert.equal(first.tracks[1], null); assert.equal(first.tracks[2].id, 'netease-3');
  assert.equal(first.hasMore, true); assert.ok(!JSON.stringify(first).includes('synthetic-secret'));
  assert.deepEqual(await api.playlistTracks('99'), first); assert.equal(calls.filter(call => call === 'playlistDetail').length, 1);
  const next = await api.playlistTracks('99', 50); assert.equal(next.tracks.length, 5); assert.equal(next.hasMore, false); assert.equal(next.tracks[0].id, 'netease-51');
  await assert.rejects(api.playlistTracks('100'), { status: 403 }); await assert.rejects(api.playlistTracks('99', 1), { status: 400 });
  await api.auth.logout(); await assert.rejects(api.playlists(), { status: 401 });
});
test('logout rejects an in-flight private playlist response', async () => {
  let release;
  const api = await loggedApi(() => new Promise(resolve => release = resolve));
  const pending = api.playlists(); while (!release) await new Promise(resolve => setImmediate(resolve));
  await api.auth.logout(); release({ body: { code: 200, playlist: [{ id: 99 }] } });
  await assert.rejects(pending, { status: 409 });
});
test('playlists and their unequal song counts repeat continuously in both directions', () => {
  const albums = [120, 3, 0, 80].flatMap((count, row) => Array.from({ length: Math.max(1, count) }, (_, col) => ({
    id: `playlist-${row}-${col}`, title: `Song ${col}`, artist: '测试', genreId: '', rawGenres: [], folder: '', tracks: [], producers: [], offline: false,
    playlistCell: { playlistId: String(row), playlistName: `歌单 ${row}`, playlistIndex: row, songIndex: col, total: count },
  })));
  setPlaylistAlbums(albums, ['A', 'B', 'Empty', 'D']);
  for (let index = 0; index < records.length; index++) {
    const next = fileLocation(index); const meta = records[index].album.playlistCell;
    assert.equal(next.row, meta.songIndex + 12); assert.equal(next.lane, meta.playlistIndex + 2);
    assert.equal(fileAtCell(next), index); assert.equal(fileAtSlot(next.slot), index);
    assert.equal(fileAtCell(selectionCell(index, { lane: 90, row: 32 })), index);
    const displayed = Array.from({ length: LOOP_COLUMNS * MUSIC_LOOP_ROWS }, (_, i) => fileAtCell(visibleCell(i, next, MUSIC_LOOP_ROWS))).filter(i => i >= 0);
    assert.equal(displayed.length, LOOP_COLUMNS * MUSIC_LOOP_ROWS); assert.ok(displayed.includes(index));
    assert.ok(new Set(displayed).size < displayed.length);
  }
  assert.equal(records[fileAtCell({ lane: 3, row: 15 })].id, 'playlist-1-0');
  assert.equal(records[fileAtCell({ lane: 2, row: 11 })].id, 'playlist-0-119');
  assert.equal(records[fileAtCell({ lane: 6, row: 132 })].id, 'playlist-0-0');
  assert.equal(fileAtCell({ lane: 2.5, row: 12 }), -1);
  const first = records.findIndex(record => record.id === 'playlist-0-0');
  const songSeam = selectionCell(first, { lane: 2, row: 131 }, { axis:'row', direction:1 });
  assert.deepEqual(songSeam, { lane:2, row:132 }); assert.equal(fileAtCell(songSeam), first);
  const playlistSeam = selectionCell(first, { lane:5, row:12 }, { axis:'lane', direction:1 });
  assert.deepEqual(playlistSeam, { lane:6, row:12 }); assert.equal(fileAtCell(playlistSeam), first);
  setMusicAlbums([]); assert.equal(records.length, 0);
});

test('prepared playlist views reuse unchanged songs and release account data on disposal', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input, 'http://127.0.0.1');
    if (url.pathname.endsWith('/playlists')) return Response.json({ playlists: [{ id: '1', name: '缓存验证', trackCount: 120, owned: true }], hasMore: false });
    const offset = Number(url.searchParams.get('offset'));
    return Response.json({ total: 120, tracks: Array.from({ length: Math.min(50, 120 - offset) }, (_, index) => ({
      id: `song-${offset + index}`, title: `S${offset + index}`, artist: '合成测试', albumId: 'test',
      onlineSource: { provider: 'netease', id: String(offset + index + 1), albumTitle: '缓存验证专辑' },
    })) });
  };
  const library = new NeteasePlaylists(() => {});
  try {
    await library.load(); const first = library.albums();
    assert.equal(first.length, 50);
    assert.equal(library.albums(), first, 'unchanged revisions do not rebuild the view');
    await library.ensure(0, 0); assert.equal(library.albums(), first, 'a cache hit keeps the prepared view');
    await library.ensure(0, 70); const extended = library.albums();
    assert.notEqual(extended, first); assert.equal(extended.length, 100);
    assert.equal(extended[0], first[0], 'new pages preserve prepared objects for unchanged songs');
    library.dispose(); assert.equal(library.albums().length, 0);
  } finally { library.dispose(); globalThis.fetch = previousFetch; }
});

test('visible playlist strips prefetch across song-page boundaries with two requests at most', async () => {
  const previousFetch = globalThis.fetch, requests = []; let active = 0, peak = 0;
  globalThis.fetch = async input => {
    const url = new URL(input, 'http://127.0.0.1');
    if (url.pathname.endsWith('/playlists')) return Response.json({ playlists: Array.from({ length: 20 }, (_, row) => ({ id: String(row + 1), name: `P${row}`, trackCount: 120, owned: true })), hasMore: false });
    const id = url.pathname.split('/').at(-2), offset = Number(url.searchParams.get('offset'));
    active++; peak = Math.max(peak, active); requests.push({ id, offset });
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return Response.json({ total: 120, tracks: Array.from({ length: Math.min(50, 120 - offset) }, (_, i) => ({ id: `song-${id}-${offset + i}`, title: `S${offset + i}`, artist: '合成测试', albumId: 'test', onlineSource: { provider: 'netease', id: String(offset + i + 1), albumTitle: '测试专辑' } })) });
  };
  const library = new NeteasePlaylists(() => {});
  try {
    await library.load(); requests.length = 0;
    await library.window(10, 50);
    assert.deepEqual([...new Set(requests.map(item => Number(item.id)))].sort((a,b) => a-b), [7,8,9,10,11,12,13,14,15]);
    for (let id = 7; id <= 15; id++) {
      assert.deepEqual(requests.filter(item => item.id === String(id)).map(item => item.offset).sort((a,b) => a-b), [0,50]);
      assert.ok(library.track(id - 1, 26)); assert.ok(library.track(id - 1, 74));
    }
    requests.length = 0; await library.window(10, 100);
    assert.equal(requests.length, 9); assert.ok(requests.every(item => item.offset === 100));
    assert.ok(library.track(10, 119)); assert.ok(peak <= 2); assert.equal(peak, 2);
    requests.length = 0; await library.window(0, 0);
    assert.ok(requests.some(item => item.id === '20' && item.offset === 100), 'first playlist preloads the last playlist and its tail songs across both seams');
  } finally { library.dispose(); globalThis.fetch = previousFetch; }
});
