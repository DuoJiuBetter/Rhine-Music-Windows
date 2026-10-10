import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackAlbums } from '../src/playback-albums.ts';
import { setPlaybackAlbums, setMusicAlbums, records, fileLocation } from '../src/data.ts';
import { MUSIC_LOOP_ROWS, LOOP_COLUMNS, fileAtCell, selectionCell, visibleCell } from '../src/archive-loop.ts';
const tracks = count => Array.from({ length: count }, (_, index) => ({ id: `netease-${index}`, albumId: `album-${Math.floor(index / 3)}`, title: `歌曲 ${index}`, artist: '测试歌手', duration: 120,
  format: '在线音频', browserPlayable: true, audioUrl: '', relativePath: '', onlineSource: { provider: 'netease', id: String(index), albumTitle: `专辑 ${Math.floor(index / 3)}`, coverUrl: 'https://p1.music.126.net/test.jpg?param=100y100', pageUrl: 'https://music.163.com/', fee: 0 } }));
test('each queued song retains an independent album card and bounded 3D thumbnail', () => {
  const queue = tracks(100), albums = playbackAlbums(queue, []);
  assert.equal(albums.length, 100); assert.equal(new Set(albums.map(album => album.id)).size, 100);
  assert.equal(albums[0].title, albums[1].title); assert.notEqual(albums[0].id, albums[1].id);
  assert.equal(new URL(albums[0].coverUrl).searchParams.get('param'), '512y512');
  assert.equal(queue[0].onlineSource.coverUrl.includes('100y100'), true, 'search thumbnails stay small');
});
test('production pool maps finite previous/next rows without fake songs or duplicated cards', () => {
  for (const count of [1, 3, 20, 49, 100, 600]) {
    setPlaybackAlbums(playbackAlbums(tracks(count), []), MUSIC_LOOP_ROWS);
    let cell = fileLocation(0);
    for (let index = 0; index < count; index++) {
      const next = selectionCell(index, cell);
      assert.equal(fileAtCell(next), index);
      if (index) assert.equal(next.row - cell.row, 1, 'crossing a 48-row block keeps the original vertical motion');
      assert.equal(fileAtCell({ lane: next.lane, row: next.row - 1 }), index === 0 ? -1 : index - 1);
      assert.equal(fileAtCell({ lane: next.lane, row: next.row + 1 }), index === count - 1 ? -1 : index + 1);
      const displayed = Array.from({ length: LOOP_COLUMNS * MUSIC_LOOP_ROWS }, (_, i) => fileAtCell(visibleCell(i, next, MUSIC_LOOP_ROWS))).filter(index => index >= 0);
      assert.equal(new Set(displayed).size, displayed.length);
      assert.ok(displayed.includes(index)); assert.ok(displayed.every(index => index < count));
      cell = next;
    }
    for (let index = count - 1; index >= 0; index--) { cell = selectionCell(index, cell); assert.equal(fileAtCell(cell), index); }
  }
  setMusicAlbums([{ id: 'local', title: '本地专辑', artist: '歌手', genreId: 'local', rawGenres: [], folder: '', tracks: [], producers: [], offline: false }], [{ id: 'local', name: '本地' }]);
  assert.equal(fileAtCell({ lane: 0, row: 12 }), 0); assert.equal(records[0].album.playback, undefined);
});
