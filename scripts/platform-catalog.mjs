import { randomUUID, randomInt, createHash } from 'node:crypto';
import { PlatformLoginProtocols } from './platform-login-protocols.mjs';
import { platformCover, platformMediaUrl } from './platform-media.mjs';

const names = { qq: 'QQ 音乐', kugou: '酷狗音乐', bodian: '波点音乐' };
const failure = (message, status = 502) => Object.assign(new Error(message), { status });
const clean = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240) : '';
const count = value => Math.min(100000, Math.max(0, Math.floor(Number(value) || 0)));
const md5 = value => createHash('md5').update(value).digest('hex');
export function platformSongId(provider, id) {
  const value = String(id);
  if (!(provider === 'qq' ? /^[A-Za-z0-9]{8,32}$/ : /^[a-fA-F0-9]{32}$/).test(value)) throw failure('无效的平台歌曲 ID。', 400);
  return provider === 'kugou' ? value.toLowerCase() : value;
}
export function platformTrack(provider, item) {
  if (provider === 'qq') {
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
  const song = item?.base || item?.fileinfo || item;
  const hash = song?.hash || song?.Hash || song?.FileHash || item?.filehash;
  if (typeof hash !== 'string' || !/^[A-Fa-f0-9]{32}$/.test(hash)) return undefined;
  const filename = clean(song.filename || song.FileName || song.name), parts = filename.split(' - ');
  const title = clean(song.songname || song.SongName || song.song_name || (parts.length > 1 ? parts.slice(1).join(' - ') : filename));
  if (!title) return undefined;
  const album = item.albuminfo || song.albuminfo || {}, authors = item.authors || song.authors;
  const artist = clean(song.singername || song.SingerName || song.author_name) || (Array.isArray(authors) ? authors.map(author => clean(author.author_name || author.name)).filter(Boolean).join(' / ') : '') || (parts.length > 1 ? parts[0] : '未知歌手');
  const id = hash.toLowerCase(), albumId = String(song.album_id || song.AlbumID || album.album_id || album.id || '');
  return { id: `kugou-${id}`, albumId: `kugou-album-${albumId || id}`, title, artist,
    duration: Math.max(0, Number(song.timelen) / 1000 || Number(song.Duration || song.duration || song.time_length) || 0),
    format: '在线音频', browserPlayable: true, audioUrl: '', relativePath: '', localDecodable: false,
    onlineSource: { provider, id, albumId, albumTitle: clean(song.album_name || song.AlbumName || album.album_name || album.name),
      coverUrl: platformCover('kugou', song.sizable_cover || song.Image || song.img || album.sizable_cover || album.cover || item.cover),
      pageUrl: `https://www.kugou.com/song/#hash=${id}`, fee: Number(song.privilege || song.Privilege) > 0 ? 1 : 0 } };
}

export class PlatformCatalog {
  constructor({ provider, auth, transport = new PlatformLoginProtocols(provider), now = Date.now }) {
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
  kg(path, params, options = {}, priority = false) {
    const epoch = this.scope(), credential = this.auth.credential;
    return this.run(async () => { this.check(epoch); const value = await this.transport.kugou(path, params, { ...options, credential, android: true }); this.check(epoch); return value; }, priority);
  }
  async memo(key, task) {
    await this.auth.ready; const epoch = this.scope(), qualified = `${epoch}:${key}`;
    const cached = this.cache.get(qualified);
    if (cached && this.now() - cached.at < (cached.value.lyrics?.error || cached.value.metadataError ? 30000 : 300000)) return cached.value;
    if (this.pending.has(qualified)) return this.pending.get(qualified);
    if (this.pending.size >= 16) throw failure('平台请求繁忙，请稍后重试。', 429);
    const operation = (async () => { const value = await task(); this.check(epoch); this.cache.set(qualified, { at: this.now(), value }); while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value); return value; })().finally(() => this.pending.delete(qualified));
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
      let songs, total;
      if (this.provider === 'qq') {
        const data = await this.rpc('music.search.SearchCgiService', 'DoSearchForQQMusicDesktop', { query: query.trim(), page_num: offset / 20 + 1, num_per_page: 20, search_type: 0 });
        songs = data.body?.song?.list; total = data.meta?.sum ?? data.body?.song?.sum;
      } else {
        const data = await this.kg('/v2/search/song', { keyword: query.trim(), page: offset / 20 + 1, pagesize: 20, platform: 'AndroidFilter', iscorrection: 1, privilegefilter: 0, area_code: 1, dopicfull: 1 }, { router: 'complexsearch.kugou.com' });
        songs = data?.lists; total = data?.total;
      }
      if (!Array.isArray(songs)) throw failure(`${names[this.provider]}搜索结果格式发生变化。`);
      const tracks = this.remember(songs.slice(0, 20)); total = count(total);
      return { provider: this.provider, query: query.trim(), offset, limit: 20, total, hasMore: offset + 20 < total, tracks };
    });
  }
  playlists(offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 5000 || offset % 100) throw failure('歌单分页无效。', 400);
    return this.memo(`playlists:${offset}`, async () => {
      let list, total;
      if (this.provider === 'qq') {
        return this.qqPlaylists(offset);
      } else {
        const { userid, token } = this.auth.credential;
        const data = await this.kg('/v7/get_all_list', { plat: 1, userid: Number(userid), token }, { router: 'cloudlist.service.kugou.com', body: { userid, token, total_ver: 979, type: 2, page: offset / 100 + 1, pagesize: 100 } });
        list = data?.list; total = data?.total || data?.total_count;
        if (!Array.isArray(list)) throw failure('酷狗音乐歌单列表格式发生变化。');
        total = Number.isFinite(Number(total)) ? Number(total) : offset + list.length + (list.length === 100 ? 1 : 0);
      }
      const playlists = list.slice(0, 100).flatMap(item => {
        const qq = this.provider === 'qq';
        const tid = String(item.tid || item.dissid || '0'), dirid = String(item.dirid ?? '0');
        const listid = String(item.listid ?? item.list_id ?? '');
        const id = qq ? `${dirid}-${tid}` : listid || String(item.global_collection_id || '');
        if (!/^[\d-]{1,40}$/.test(id) || !/^\d{1,16}$/.test(qq ? dirid : id)) return [];
        const value = { id, name: clean(item.name || item.title || item.special_name) || '未命名歌单', trackCount: count(item.song_cnt ?? item.song_count ?? item.count),
          coverUrl: platformCover(this.provider, item.cover_url || item.cover || item.imgurl || item.special_cover), owned: qq ? String(item.creator?.uin || item.uin || this.auth.credential.musicid) === this.auth.credential.musicid : !item.is_collect };
        this.owned.set(id, { value, tid, dirid, listid, type: Number(item.type) || 0, globalId: String(item.global_collection_id || '') }); return [value];
      });
      return { provider: this.provider, playlists, offset, limit: 100, hasMore: offset + 100 < total };
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
      let songs, total;
      if (this.provider === 'qq') {
        // CgiGetDiss identifies the current account through its authenticated
        // request. Liked songs use disstid 0 / dirid 201; encrypt_uin is not a
        // prerequisite. A separate profile lookup could block valid sessions.
        const data = await this.rpc('music.srfDissInfo.DissInfo', 'CgiGetDiss', { disstid: Number(playlist.tid), dirid: Number(playlist.dirid), tag: true, song_begin: offset, song_num: 50, userinfo: true, orderlist: true, onlysonglist: false });
        songs = data.songlist || data.songList; total = data.total_song_num ?? data.songnum ?? data.dirinfo?.songnum ?? playlist.value.trackCount;
      } else if (playlist.listid) {
        const { userid, token } = this.auth.credential;
        const data = await this.kg('/v4/get_list_all_file_v3', {}, { router: 'cloudlist.service.kugou.com', body: { listid: Number(playlist.listid), userid, type: playlist.type, page: offset / 50 + 1, pagesize: 50, area_code: 1, allplatform: 1, show_cover: 1, token } });
        songs = data?.info || data?.list || data?.songs; total = data?.total ?? data?.count ?? playlist.value.trackCount;
      } else {
        const data = await this.kg('/pubsongs/v2/get_other_list_file_nofilt', { area_code: 1, begin_idx: offset, plat: 1, type: 1, mode: 1, personal_switch: 1, extend_fields: 'abtags,hot_cmt,popularization', pagesize: 50, global_collection_id: playlist.globalId });
        songs = data?.songs; total = data?.total ?? data?.count ?? playlist.value.trackCount;
      }
      if (!Array.isArray(songs)) throw failure(`${names[this.provider]}歌单歌曲格式发生变化。`);
      total = count(total); playlist.value.trackCount = total;
      return { provider: this.provider, playlistId: id, offset, limit: 50, total, hasMore: offset + 50 < total, tracks: this.remember(songs.slice(0, 50), true) };
    });
  }
  async prepare(value) {
    await this.auth.ready; const epoch = this.scope(), id = platformSongId(this.provider, value);
    let url, bitrate;
    if (this.provider === 'qq') {
      url = await this.qqAudioUrl(id, epoch);
    } else {
      const track = this.tracks.get(id), source = track?.onlineSource;
      const data = await this.kg('/v5/url', { album_id: Number(source?.albumId) || 0, area_code: 1, hash: id, ssa_flag: 'is_fromtrack', version: 11430, page_id: 151369488, quality: 128, album_audio_id: 0, behavior: 'play', pid: 2, cmd: 26, pidversion: 3001, IsFreePart: 0, ppage_id: '463467626,350369493,788954147', cdnBackup: 1, module: '', clientver: 11430 }, { router: 'trackercdn.kugou.com', keyHash: id, full: true, dfid: randomUUID().replaceAll('-', '').slice(0, 24) }, true);
      const result = data.data || data; url = Array.isArray(result.url) ? result.url[0] : result.url; bitrate = Number(result.bitRate || result.bitrate) || undefined;
    }
    const audioUrl = platformMediaUrl(this.provider, url);
    if (!audioUrl) throw failure(this.provider === 'qq'
      ? 'QQ 音乐本次未返回可用播放地址，不能据此判断会员状态。请在官方客户端确认这首歌是否开放试听，或重新登录后重试。'
      : `${names[this.provider]}未提供播放地址，可能需要会员、购买或所在地区的播放权限。`, 403);
    return { audioUrl, bitrate, format: '在线音频' };
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
      let metadataError;
      if (this.provider === 'qq') {
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
      } else {
        if (!track) throw failure('歌曲资料缓存已过期，请重新选择这首歌。', 404);
        const source = track.onlineSource;
        const [albumResult, lyricResult] = await Promise.allSettled([
          source.albumId ? this.kg('/kmr/v2/albums', {}, { router: 'openapi.kugou.com', headers: { 'kg-tid': '255' }, body: { data: [{ album_id: source.albumId }], is_buy: 0, fields: 'album_id,album_name,publish_date,sizable_cover,intro,authors,author_name' } }) : Promise.resolve({}),
          (async () => {
            const result = await this.kg('/v1/search', { album_audio_id: 0, appid: 1005, clientver: 20489, duration: Math.round(track.duration * 1000), hash: id, keyword: `${track.artist} - ${track.title}`, lrctxt: 1, man: 'no' }, { base: 'https://lyrics.kugou.com', clearDefault: true, full: true });
            const candidate = result.candidates?.[0];
            if (!candidate) return '';
            if (!/^\d{1,20}$/.test(String(candidate.id)) || !/^[A-Za-z0-9_-]{1,256}$/.test(candidate.accesskey)) throw failure('酷狗歌词格式发生变化。');
            const lyric = await this.kg('/download', { ver: 1, client: 'android', id: candidate.id, accesskey: candidate.accesskey, fmt: 'lrc', charset: 'utf8' }, { base: 'https://lyrics.kugou.com', full: true });
            return typeof lyric.content === 'string' ? Buffer.from(lyric.content.slice(0, 280000), 'base64').toString('utf8').slice(0, 200000) : '';
          })(),
        ]);
        if (albumResult.status === 'fulfilled') { const album = Array.isArray(albumResult.value) ? albumResult.value[0] : albumResult.value?.[source.albumId] || albumResult.value; published = clean(album?.publish_date); description = clean(album?.intro); }
        else metadataError = albumResult.reason.message;
        if (lyricResult.status === 'fulfilled') lyrics.original = lyricResult.value; else lyrics.error = lyricResult.reason.message;
      }
      lyrics.unavailable = !lyrics.original && !lyrics.error;
      return { track, album: { title: track.onlineSource.albumTitle, artist: track.artist, published, company, description }, lyrics, metadataError };
    });
  }
}
