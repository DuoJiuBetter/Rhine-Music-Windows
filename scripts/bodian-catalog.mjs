import { PlatformCatalog } from './platform-catalog.mjs';
import { BodianProtocol, bodianId } from './bodian-protocol.mjs';
import { platformCover, platformMediaUrl } from './platform-media.mjs';

const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const clean = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240) : '';
const count = value => Math.min(100000, Math.max(0, Math.floor(Number(value) || 0)));
// An absent/null/blank total is unknown, not a reported zero.
function reportedTotal(value) {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))) return undefined;
  const total = Number(value);
  return Number.isSafeInteger(total) && total >= 0 ? count(total) : undefined;
}
function playlistItems(data, source) {
  if (Array.isArray(data?.playLists)) return data.playLists;
  // Observed empty payloads are {} and []; Python's reference also treats an
  // absent list as empty. Keep this narrow: unknown nonempty data stays an error.
  if (Array.isArray(data) && data.length === 0) return [];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const keys = Object.keys(data);
    if (keys.length === 0) return [];
    const emptyTotal = reportedTotal(data.total);
    const emptyList = !Object.hasOwn(data, 'playLists') || data.playLists === null;
    const emptyMetadata = keys.every(key => ['playLists', 'total', 'pn', 'rn'].includes(key));
    if (emptyList && emptyMetadata && (emptyTotal === 0 || data.total == null)) return [];
  }
  const fields = data && typeof data === 'object' && !Array.isArray(data)
    ? Object.keys(data).filter(key => /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(key) && !/token|cookie|secret|credential|auth|uid|user/i.test(key)).slice(0, 6)
      .map(key => `${key}:${data[key] === null ? 'null' : Array.isArray(data[key]) ? 'array' : typeof data[key]}`).join(', ')
    : Array.isArray(data) ? 'array' : typeof data;
  throw fail(`波点音乐${source}列表格式无法识别${fields ? `（字段类型：${fields}）` : ''}，请更新适配或稍后重试。`);
}
export function bodianTrack(song) {
  if (!song || !bodianId(song.id) || !clean(song.name || song.songName)) return undefined;
  const id = String(song.id);
  return { id: `bodian-${id}`, albumId: `bodian-album-${bodianId(song.albumId) ? song.albumId : id}`, title: clean(song.name || song.songName),
    artist: clean(song.artist) || '未知歌手', duration: Math.max(0, Number(song.duration) || 0), format: '在线音频', browserPlayable: true,
    audioUrl: '', relativePath: '', localDecodable: false,
    onlineSource: { provider: 'bodian', id, albumId: bodianId(song.albumId) ? String(song.albumId) : '', albumTitle: clean(song.album),
      coverUrl: platformCover('bodian', song.albumPic || song.albumPic120),
      pageUrl: 'https://bodian.kuwo.cn/', fee: Number(song.payInfo?.isVip) ? 1 : 0 } };
}

/** Reuse account epochs, bounded caches, deduplication and the four-slot scheduler. */
export class BodianCatalog extends PlatformCatalog {
  constructor({ auth, transport = new BodianProtocol(), now }) { super({ provider: 'bodian', auth, transport, now }); this.signs = new Map(); }
  scope() { const epoch = super.scope(); if (this.signEpoch !== epoch) { this.signEpoch = epoch; this.signs.clear(); } return epoch; }
  async call(path, params = {}, options = {}, priority = false) {
    const epoch = this.scope(), credential = this.auth.credential;
    return this.run(async () => {
      this.check(epoch);
      try { const data = await this.transport.api(path, params, { ...options, credential }); this.check(epoch); return data; }
      catch (error) { if (error.status === 401) await this.auth.invalidateCredential(credential, epoch); throw error; }
    }, priority);
  }
  remember(items, preserve = false) {
    return items.map(song => {
      const track = bodianTrack(song);
      if (track) {
        const id = track.onlineSource.id;
        this.tracks.delete(id); this.tracks.set(id, track);
        const sign = song.freeSign || song.fsig;
        if (typeof sign === 'string' && sign.length <= 4096) { this.signs.delete(id); this.signs.set(id, sign); }
        while (this.tracks.size > 6000) { const first = this.tracks.keys().next().value; this.tracks.delete(first); this.signs.delete(first); }
      }
      return track || null;
    }).filter(value => preserve || value);
  }
  search(query, offset = 0) {
    if (typeof query !== 'string' || !query.trim() || query.length > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1000 || offset % 20) throw fail('搜索词或分页无效。', 400);
    return this.memo(`search:${query}:${offset}`, async () => {
      const data = await this.call('/api/search/music/list', { keyword: query.trim(), correct: 1, pn: offset / 20, rn: 20 });
      if (!Array.isArray(data.resultList)) throw fail('波点音乐搜索结果格式发生变化。');
      const total = reportedTotal(data.total) ?? offset + data.resultList.length + (data.resultList.length >= 20 ? 1 : 0);
      return { provider: 'bodian', query: query.trim(), offset, limit: 20, total, hasMore: offset + 20 < total, tracks: this.remember(data.resultList.slice(0, 20)) };
    });
  }
  playlists(offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 5000 || offset % 100) throw fail('歌单分页无效。', 400);
    return this.memo(`playlists:${offset}`, async () => {
      const uid = this.auth.credential.uid;
      const [created, collected, fond] = await Promise.all([
        this.memo('created', () => this.call('/api/service/playlist/userCreate', { userId: uid })),
        this.call('/api/service/collect/4/list', { userId: uid, fromUid: uid, pn: offset / 100 + 1, rn: 50 }),
        offset === 0 ? this.call('/api/service/playlist/fond', { userId: uid }) : Promise.resolve(null),
      ]);
      const createdItems = playlistItems(created, '自建歌单');
      const collectedItems = playlistItems(collected, '收藏歌单');
      const begin = offset / 2, playlists = [], seen = new Set();
      const add = (item, owned, defaultSource) => {
        if (!item || !bodianId(item.id)) return;
        const source = Number(item.sourceType ?? defaultSource);
        if (![4, 5].includes(source)) return; // Mixed collections also contain sourceType=6 albums.
        const id = `${source}-${item.id}`;
        if (seen.has(id)) return; seen.add(id);
        const value = { id, name: clean(item.name) || (item === fond ? '我喜欢的音乐' : '未命名歌单'), trackCount: count(item.musicCount), coverUrl: platformCover('bodian', item.pic), owned };
        this.owned.set(id, { value, source, playlistId: String(item.id) }); playlists.push(value);
      };
      if (fond) add(fond, true, 5);
      createdItems.slice(begin, begin + 50).forEach(item => add(item, true, 5));
      collectedItems.slice(0, 50).forEach(item => add(item, false, 4));
      // Continue by raw server page size, even when every mixed item was an album.
      const total = reportedTotal(collected.total);
      const more = total !== undefined ? begin + 50 < total : collectedItems.length >= 50;
      return { provider: 'bodian', playlists, offset, limit: 100, hasMore: begin + 50 < createdItems.length || more };
    });
  }
  playlistTracks(id, offset = 0) {
    if (!/^[45]-[1-9]\d{0,15}$/.test(id) || !Number.isInteger(offset) || offset < 0 || offset >= 100000 || offset % 50) throw fail('歌单歌曲分页无效。', 400);
    return this.memo(`tracks:${id}:${offset}`, async () => {
      const playlist = this.owned.get(id);
      if (!playlist) throw fail('这个歌单不在当前账号的歌单列表中。', 403);
      const data = await this.call(`/api/service/playlist/${playlist.playlistId}/musicList`, { source: playlist.source, pn: offset / 50 + 1, rn: 50 });
      const songs = data.list || data.musicList;
      if (!Array.isArray(songs)) throw fail('波点音乐歌单歌曲格式发生变化。');
      const total = reportedTotal(data.total) ?? playlist.value.trackCount;
      playlist.value.trackCount = total;
      return { provider: 'bodian', playlistId: id, offset, limit: 50, total, hasMore: offset + 50 < total, tracks: this.remember(songs.slice(0, 50), true) };
    });
  }
  async detail(id) {
    const data = await this.call('/api/service/music/info', { musicId: id });
    const song = data.musicInfo || data;
    if (String(song.id) !== id || !this.remember([song])[0]) throw fail('波点音乐没有返回对应歌曲资料。', 404);
    return song;
  }
  songInfo(value) {
    if (!bodianId(value)) throw fail('无效的波点歌曲 ID。', 400);
    const id = String(value);
    return this.memo(`info:${id}`, async () => {
      let song, metadataError;
      try { song = await this.detail(id); }
      catch (error) { if (error.status === 401 || error.status === 409 || !this.tracks.has(id)) throw error; metadataError = error.message; }
      const track = this.tracks.get(id);
      const epoch = this.scope(), credential = this.auth.credential;
      const lyrics = { original: '', translated: '', instrumental: false, unavailable: false };
      try { lyrics.original = await this.run(() => { this.check(epoch); return this.transport.lyrics(track, credential); }); this.check(epoch); }
      catch (error) { if (error.status === 401) { await this.auth.invalidateCredential(credential, epoch); throw error; } lyrics.error = error.message; }
      lyrics.unavailable = !lyrics.original && !lyrics.error;
      return { track, album: { title: track.onlineSource.albumTitle, artist: track.artist, published: clean(song?.releaseDate) }, lyrics, metadataError };
    });
  }
  async prepare(value) {
    await this.auth.ready;
    if (!bodianId(value)) throw fail('无效的波点歌曲 ID。', 400);
    const id = String(value), epoch = this.scope();
    if (!this.tracks.has(id)) await this.memo(`detail:${id}`, () => this.detail(id));
    this.check(epoch);
    let freeSign = this.signs.get(id) || '';
    try { freeSign = decodeURIComponent(freeSign); } catch { throw fail('波点歌曲授权参数无效。'); }
    const musicId = Number(id);
    if (!Number.isSafeInteger(musicId)) throw fail('波点歌曲 ID 超出支持范围。', 400);
    const right = await this.call('/api/play/music/v2/checkRight', { musicId: id, freeSign }, { timed: true, payload: { musicId, freeSign } }, true);
    let source, trial;
    if (Number(right.status) === 3) {
      const audition = right.audition || {};
      source = audition.https || audition.car_url_https || audition.url || audition.car_url;
      trial = { start: 0, end: 0 }; // Returned media controls its real duration.
    } else if ([1, 4].includes(Number(right.status))) {
      const values = { devId: this.auth.credential.deviceId, musicId: id, format: 'mp3', br: '128kmp3', freeSign };
      const data = await this.call('/api/play/music/v2/audioUrl', values, { timed: true, payload: { ...values, musicId } }, true);
      source = data.audioHttpsUrl || data.audioUrl;
    } else throw fail('波点音乐未授予这首歌曲的播放权限。', 403);
    this.check(epoch);
    const audioUrl = platformMediaUrl('bodian', source);
    if (!audioUrl) throw fail(trial ? '波点音乐本次未返回可用试听地址。' : '波点音乐本次未返回可用播放地址。', 403);
    return { audioUrl, format: '在线音频', ...(trial ? { trial } : {}) };
  }
}
