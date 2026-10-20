import { randomInt } from 'node:crypto';
import { PlatformLoginProtocols } from './platform-login-protocols.mjs';
import { platformCover, platformMediaUrl } from './platform-media.mjs';

const names = { qq: 'QQ 音乐', bodian: '波点音乐' };
const failure = (message, status = 502) => Object.assign(new Error(message), { status });
const clean = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240) : '';
const count = value => Math.min(100000, Math.max(0, Math.floor(Number(value) || 0)));
export function platformSongId(provider, id) {
  const value = String(id);
  if (provider !== 'qq' || !/^[A-Za-z0-9]{8,32}$/.test(value)) throw failure('无效的平台歌曲 ID。', 400);
  return value;
}
export function platformTrack(provider, item) {
  if (provider !== 'qq') return undefined;
  const song = item?.songInfo || item?.songinfo || item;
  const id = song?.mid || song?.songmid, album = song?.album || {};
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{8,32}$/.test(id) || !clean(song.title || song.name || song.songname)) return undefined;
  const albumMid = album.mid || song.albummid;
  const mediaId = song.file?.media_mid || song.strMediaMid;
  const singers = song.singer || [];
  return { id: `qq-${id}`, albumId: `qq-album-${albumMid || album.id || id}`, title: clean(song.title || song.name || song.songname),
    artist: (Array.isArray(singers) ? singers : []).map(person => clean(person.name)).filter(Boolean).join(' / ') || '未知歌手',
    duration: Math.max(0, Number(song.interval) || 0), format: '在线音频', browserPlayable: true, audioUrl: '', relativePath: '', localDecodable: false,
    onlineSource: { provider, id, albumTitle: clean(album.title || album.name || song.albumname), albumId: String(albumMid || ''),
      ...(typeof mediaId === 'string' && /^[A-Za-z0-9]{8,32}$/.test(mediaId) ? { mediaId } : {}),
      coverUrl: typeof albumMid === 'string' && /^[A-Za-z0-9]{8,32}$/.test(albumMid) ? platformCover('qq', `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`) : undefined,
      pageUrl: `https://y.qq.com/n/ryqq/songDetail/${id}`, fee: song.pay?.pay_play ? 1 : 0 } };
}

export class PlatformCatalog {
  constructor({ provider, auth, transport = new PlatformLoginProtocols(provider), now = Date.now }) {
    if (!['qq', 'bodian'].includes(provider)) throw new Error('Unsupported catalog provider');
    this.provider = provider; this.auth = auth; this.transport = transport; transport.limit = 4; this.now = now;
    this.cache = new Map(); this.pending = new Map(); this.tracks = new Map(); this.owned = new Map(); this.waiting = []; this.active = 0;
  }
  scope() {
    if (this.epoch !== this.auth.epoch) { this.epoch = this.auth.epoch; this.cache.clear(); this.tracks.clear(); this.owned.clear(); }
    if (!this.auth.credential) throw failure(`请先登录${names[this.provider]}。`, 401);
    return this.epoch;
  }
  check(epoch) { if (epoch !== this.auth.epoch || !this.auth.credential) throw failure('平台账号已切换，请重新读取。', 409); }
  async run(task, priority = false) {
    if (this.active >= 4) {
      if (this.waiting.length >= 16) throw failure('平台请求繁忙，请稍后重试。', 429);
      await new Promise((resolve, reject) => {
        const entry = { start: () => { clearTimeout(timer); resolve(); } };
        const timer = setTimeout(() => { const index = this.waiting.indexOf(entry); if (index >= 0) this.waiting.splice(index, 1); reject(failure('平台请求等待超时。', 429)); }, 12000);
        priority ? this.waiting.unshift(entry) : this.waiting.push(entry);
      });
    } else this.active++;
    try { return await task(); } finally { const next = this.waiting.shift(); next ? next.start() : this.active--; }
  }
  rpc(module, method, param, priority = false) {
    const epoch = this.scope(), credential = this.auth.credential;
    return this.run(async () => { this.check(epoch); const value = await this.transport.qqRpc(module, method, param, credential); this.check(epoch); return value; }, priority);
  }
  qqHttp(path, params) {
    const epoch = this.scope(), credential = this.auth.credential;
    return this.run(async () => { this.check(epoch); const value = await this.transport.qqHttp(path, params, credential); this.check(epoch); return value; });
  }
  async memo(key, task) {
    await this.auth.ready; const epoch = this.scope(), qualified = `${epoch}:${this.playlistWriteRevision || 0}:${key}`;
    const cached = this.cache.get(qualified);
    if (cached && this.now() - cached.at < (cached.value.lyrics?.error || cached.value.metadataError ? 30000 : 300000)) return cached.value;
    if (this.pending.has(qualified)) return this.pending.get(qualified);
    if (this.pending.size >= 16) throw failure('平台请求繁忙，请稍后重试。', 429);
    const revision = this.playlistWriteRevision || 0;
    const operation = (async () => { const value = await task(); this.check(epoch); if (revision === (this.playlistWriteRevision || 0)) this.cache.set(qualified, { at: this.now(), value }); while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value); return value; })().finally(() => this.pending.delete(qualified));
    this.pending.set(qualified, operation); return operation;
  }
  remember(items, preserve = false) {
    return items.map(item => {
      const track = platformTrack(this.provider, item);
      if (track) {
        const previous = this.tracks.get(track.onlineSource.id);
        if (this.provider === 'qq' && !track.onlineSource.mediaId && previous?.onlineSource.mediaId) track.onlineSource.mediaId = previous.onlineSource.mediaId;
        this.tracks.delete(track.onlineSource.id); this.tracks.set(track.onlineSource.id, track); while (this.tracks.size > 6000) this.tracks.delete(this.tracks.keys().next().value);
      }
      return track || null;
    }).filter(item => preserve || item);
  }
  search(query, offset = 0) {
    if (typeof query !== 'string' || !query.trim() || query.length > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1000 || offset % 20) throw failure('搜索词或分页无效。', 400);
    return this.memo(`search:${query}:${offset}`, async () => {
      const data = await this.rpc('music.search.SearchCgiService', 'DoSearchForQQMusicDesktop', { query: query.trim(), page_num: offset / 20 + 1, num_per_page: 20, search_type: 0 });
      const songs = data.body?.song?.list;
      const total = count(data.meta?.sum ?? data.body?.song?.sum);
      if (!Array.isArray(songs)) throw failure(`${names[this.provider]}搜索结果格式发生变化。`);
      const tracks = this.remember(songs.slice(0, 20));
      return { provider: this.provider, query: query.trim(), offset, limit: 20, total, hasMore: offset + 20 < total, tracks };
    });
  }
  playlists(offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 5000 || offset % 100) throw failure('歌单分页无效。', 400);
    return this.memo(`playlists:${offset}`, async () => {
      return this.qqPlaylists(offset);
    });
  }
  async qqPlaylists(offset) {
    const uin = this.auth.credential.strMusicid || this.auth.credential.musicid;
    // Two independently paged sources, 50 each. Never fetch 100 each and then
    // truncate their combined result: that would silently skip collected lists.
    const begin = offset / 2;
    const results = await Promise.allSettled([
      this.qqHttp('/rsc/fcgi-bin/fcg_user_created_diss', { hostUin: '0', hostuin: uin, sin: String(begin), size: '50' }),
      this.qqHttp('/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', { ct: '20', cid: '205360956', userid: uin, reqtype: '3', sin: String(begin), ein: String(begin + 49) }),
    ]);
    // An unavailable source is an error, never an apparently empty account.
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const created = results[0].value, collected = results[1].value;
    if (!Array.isArray(created.disslist) || !Array.isArray(collected.cdlist)) throw failure('QQ 音乐歌单列表格式发生变化。');
    const playlists = [], seen = new Set();
    for (const [items, owned] of [[created.disslist, true], [collected.cdlist, false]]) {
      for (const item of items.slice(0, 50)) {
        if (!item || typeof item !== 'object') continue;
        const dirid = String(item.dirid ?? '0');
        const tid = dirid === '201' ? '0' : String(item.tid || item.dissid || item.diss_id || item.id || '0');
        if (!/^\d{1,16}$/.test(dirid) || !/^\d{1,16}$/.test(tid) || tid === '0' && dirid !== '201') continue;
        const identity = tid === '0' ? 'liked' : tid;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const id = `${dirid}-${tid}`;
        const value = { id, name: clean(item.diss_name || item.name || item.title) || '未命名歌单',
          trackCount: count(item.song_cnt ?? item.songnum ?? item.total_song_num ?? item.song_count),
          coverUrl: platformCover('qq', item.diss_cover || item.logo || item.picurl || item.cover_url || item.cover), owned };
        this.owned.set(id, { value, tid, dirid }); playlists.push(value);
      }
    }
    const more = (data, items) => {
      const reported = Number(data.total ?? data.totaldiss ?? data.totalnum ?? data.total_num);
      return Number.isFinite(reported) ? begin + 50 < reported : items.length >= 50;
    };
    return { provider: 'qq', playlists, offset, limit: 100, hasMore: more(created, created.disslist) || more(collected, collected.cdlist) };
  }
  playlistTracks(id, offset = 0) {
    if (!/^[\d-]{1,40}$/.test(id) || !Number.isInteger(offset) || offset < 0 || offset >= 100000 || offset % 50) throw failure('歌单歌曲分页无效。', 400);
    return this.memo(`tracks:${id}:${offset}`, async () => {
      const playlist = this.owned.get(id);
      if (!playlist) throw failure('这个歌单不在当前账号的歌单列表中。', 403);
      // CgiGetDiss identifies the current account through its authenticated
      // request. Liked songs use disstid 0 / dirid 201; encrypt_uin is not a
      // prerequisite. A separate profile lookup could block valid sessions.
      const data = await this.rpc('music.srfDissInfo.DissInfo', 'CgiGetDiss', { disstid: Number(playlist.tid), dirid: Number(playlist.dirid), tag: true, song_begin: offset, song_num: 50, userinfo: true, orderlist: true, onlysonglist: false });
      const songs = data.songlist || data.songList;
      if (!Array.isArray(songs)) throw failure(`${names[this.provider]}歌单歌曲格式发生变化。`);
      const total = count(data.total_song_num ?? data.songnum ?? data.dirinfo?.songnum ?? playlist.value.trackCount);
      playlist.value.trackCount = total;
      return { provider: this.provider, playlistId: id, offset, limit: 50, total, hasMore: offset + 50 < total, tracks: this.remember(songs.slice(0, 50), true) };
    });
  }
  async prepare(value) {
    await this.auth.ready; const epoch = this.scope(), id = platformSongId(this.provider, value);
    const audioUrl = platformMediaUrl('qq', await this.qqAudioUrl(id, epoch));
    if (!audioUrl) throw failure('QQ 音乐本次未返回可用播放地址，不能据此判断会员状态。请在官方客户端确认这首歌是否开放试听，或重新登录后重试。', 403);
    return { audioUrl, format: '在线音频' };
  }
  async qqAudioUrl(id, epoch) {
    const credential = this.auth.credential;
    const param = { guid: String(randomInt(10000000, 100000000)), uin: credential.strMusicid || credential.musicid, loginflag: 1, platform: '20' };
    const request = filenames => {
      this.check(epoch);
      return this.rpc('vkey.GetVkeyServer', 'CgiGetVkey', { ...param, songmid: Array(filenames?.length || 1).fill(id), songtype: Array(filenames?.length || 1).fill(0), ...(filenames ? { filename: filenames } : {}) }, true);
    };
    const select = data => {
      if (!Array.isArray(data.midurlinfo)) throw failure('QQ 音乐播放地址响应格式发生变化。');
      const bases = (Array.isArray(data.sip) ? data.sip.slice(0, 8) : []).filter(base => typeof base === 'string' && platformMediaUrl('qq', base));
      if (!bases.length) bases.push('https://isure.stream.qqmusic.qq.com/');
      for (const song of data.midurlinfo.slice(0, 8)) {
        // Never substitute another song or trust an arbitrary media host.
        if (song?.songmid !== id || typeof song.purl !== 'string' || !song.purl || song.purl.length > 8192) continue;
        for (const base of bases) {
          try { const url = platformMediaUrl('qq', new URL(song.purl, base).href); if (url) return url; } catch {}
        }
      }
    };
    // The official Web player omits filename, allowing QQ to choose an
    // available resource. Keep any playable response, including a preview;
    // an empty purl alone does not establish the user's membership status.
    const automatic = select(await request());
    if (automatic) return automatic;
    let mediaId = this.tracks.get(id)?.onlineSource.mediaId;
    if (!mediaId) {
      const detail = await this.memo(`playback-detail:${id}`, () => { this.check(epoch); return this.rpc('music.pf_song_detail_svr', 'get_song_detail_yqq', { song_mid: id }, true); });
      this.check(epoch);
      if ((detail.track_info?.mid || detail.track_info?.songmid) !== id) throw failure('QQ 音乐没有返回对应歌曲资料。', 404);
      mediaId = this.remember([detail.track_info])[0]?.onlineSource.mediaId;
    }
    // One bounded compatibility request for standard MP3/AAC. media_mid is
    // a file identifier and can differ from songmid. No invented media URL.
    const fileId = mediaId || id;
    return select(await request([`M500${fileId}.mp3`, `C400${fileId}.m4a`]));
  }
  songInfo(value) {
    const id = platformSongId(this.provider, value);
    return this.memo(`info:${id}`, async () => {
      let track = this.tracks.get(id), published, company, description, lyrics = { original: '', translated: '', instrumental: false, unavailable: false };
      const detail = await this.rpc('music.pf_song_detail_svr', 'get_song_detail_yqq', { song_mid: id });
      track = this.remember([detail.track_info])[0];
      if (!track) throw failure('QQ 音乐没有返回对应歌曲资料。', 404);
      try {
        const raw = await this.rpc('music.musichallSong.PlayLyricInfo', 'GetPlayLyricInfo', { songMid: id });
        const decode = value => typeof value === 'string' ? (value.includes('[') ? value : Buffer.from(value.slice(0, 280000), 'base64').toString('utf8')).slice(0, 200000) : '';
        lyrics.original = decode(raw.lyric); lyrics.translated = decode(raw.trans);
      } catch (error) { lyrics.error = error.message; }
      const info = detail.info || {};
      const field = key => clean(info[key]?.content?.map(item => item.value).join(' / '));
      published = field('pub_time'); company = field('company'); description = field('desc');
      lyrics.unavailable = !lyrics.original && !lyrics.error;
      return { track, album: { title: track.onlineSource.albumTitle, artist: track.artist, published, company, description }, lyrics };
    });
  }
}
