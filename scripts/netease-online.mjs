import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Agent } from 'undici';
// Only NetEase API requests use this pool; do not change global DNS or other providers.
const neteaseDispatcher = new Agent({ connect: { family: 4, autoSelectFamily: false } });
import { NeteaseAuth } from './netease-auth.mjs';
import { diagnoseOnlineFailure, onlineDiagnostic, withOnlineDiagnostic } from './online-diagnostics.mjs';
import { traceOnlineRequest, onlineTransport } from './online-transport-trace.mjs';
const require = createRequire(import.meta.url);
const PAGE_SIZE = 20;
const MIB = 1024 * 1024;
const PLAYLIST_EMBEDDED_TRACKS = 10;
const playlistResponseLimit = () => {
  const configured = Number(process.env.RHINE_NETEASE_PLAYLIST_RESPONSE_LIMIT_MIB);
  return Number.isInteger(configured) && configured >= 2 && configured <= 16 ? configured * MIB : 8 * MIB;
};
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240) : '';
const error = (message, status = 502, cause) => Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { status });
export function songId(value) {
  if (!/^[1-9]\d{0,15}$/.test(String(value))) throw error('无效的网易云歌曲 ID', 400);
  return String(value);
}
export function neteaseMediaUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return undefined;
    if (!['music.126.net', 'music.163.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return undefined;
    url.protocol = 'https:';
    return url.href;
  } catch { return undefined; }
}
function neteaseCoverUrl(value) {
  const source = neteaseMediaUrl(value);
  if (!source) return undefined;
  const url = new URL(source);
  // The SDK documents ?param=widthyheight for NetEase cover thumbnails.
  url.searchParams.set('param', '100y100'); return url.href;
}
export function neteaseTrack(song) {
  if (!/^[1-9]\d{0,15}$/.test(String(song?.id)) || !clean(song.name)) return undefined;
  const id = String(song.id), album = song.al || song.album || {}, names = song.ar || song.artists || [];
  return { id: `netease-${id}`, albumId: `netease-album-${album.id || id}`, title: clean(song.name),
    artist: (Array.isArray(names) ? names : []).map(item => clean(item.name)).filter(Boolean).join(' / ') || '未知歌手',
    duration: Math.max(0, Number(song.dt || song.duration) / 1000 || 0), format: '在线音频',
    browserPlayable: true, localDecodable: false, audioUrl: '', relativePath: '',
    onlineSource: { provider: 'netease', id, albumTitle: clean(album.name), coverUrl: neteaseCoverUrl(album.picUrl),
      pageUrl: `https://music.163.com/#/song?id=${id}`, fee: Number(song.fee) || 0,
      albumId: /^[1-9]\d{0,15}$/.test(String(album.id)) ? String(album.id) : undefined,
      publishTime: Number(song.publishTime) > 0 && Number(song.publishTime) < 8640000000000000 ? Number(song.publishTime) : undefined,
      aliases: Array.isArray(song.alia) ? song.alia.slice(0, 10).map(clean).filter(Boolean) : [] } };
}

// Reuse the pinned SDK's endpoint modules and protocol implementation. Only these
// modules load on demand; its Express server and unrelated endpoints never start.
let sdk;
export function neteasePlaylistSongs(query, request, op) {
  return request('/api/playlist/manipulate/tracks', { op, pid: query.pid || query.id,
    trackIds: JSON.stringify(query.ids.split(',')), imme: 'true',
  }, require('NeteaseCloudMusicApi/util/option.js')(query));
}
export async function sdkCall(method, params, signal) {
  sdk ??= { search: require('NeteaseCloudMusicApi/module/cloudsearch.js'),
    playback: require('NeteaseCloudMusicApi/module/song_url_v1.js'),
    qrKey: require('NeteaseCloudMusicApi/module/login_qr_key.js'),
    qrCreate: require('NeteaseCloudMusicApi/module/login_qr_create.js'),
    qrCheck: require('NeteaseCloudMusicApi/module/login_qr_check.js'),
    status: require('NeteaseCloudMusicApi/module/login_status.js'),
    accountProfile: require('NeteaseCloudMusicApi/module/user_account.js'),
    playlists: require('NeteaseCloudMusicApi/module/user_playlist.js'),
    playlistDetail: require('NeteaseCloudMusicApi/module/playlist_detail.js'),
    playlistCreate: require('NeteaseCloudMusicApi/module/playlist_create.js'),
    playlistRename: require('NeteaseCloudMusicApi/module/playlist_name_update.js'),
    playlistDelete: require('NeteaseCloudMusicApi/module/playlist_delete.js'),
    // playlist_track_add/delete are video endpoints. Songs use playlist_tracks;
    // retain its verified payload without retrying a non-idempotent write.
    playlistRemove: (query, request) => neteasePlaylistSongs(query, request, 'del'),
    playlistAdd: (query, request) => neteasePlaylistSongs(query, request, 'add'),
    togetherStatus: require('NeteaseCloudMusicApi/module/listentogether_status.js'),
    togetherCreate: require('NeteaseCloudMusicApi/module/listentogether_room_create.js'),
    togetherJoin: require('NeteaseCloudMusicApi/module/listentogether_accept.js'),
    togetherEnd: require('NeteaseCloudMusicApi/module/listentogether_end.js'),
    togetherHeartbeat: require('NeteaseCloudMusicApi/module/listentogether_heatbeat.js'),
    togetherPlaylist: require('NeteaseCloudMusicApi/module/listentogether_sync_playlist_get.js'),
    togetherQueue: require('NeteaseCloudMusicApi/module/listentogether_sync_list_command.js'),
    togetherCommand: require('NeteaseCloudMusicApi/module/listentogether_play_command.js'),
    songDetail: require('NeteaseCloudMusicApi/module/song_detail.js'),
    album: require('NeteaseCloudMusicApi/module/album.js'),
    lyric: require('NeteaseCloudMusicApi/module/lyric.js'),
    crypto: require('NeteaseCloudMusicApi/util/crypto.js') };
  const cookie = params.cookie || {};
  return sdk[method]({ ...params, cookie }, async (uri, data, options) => {
    // trackIds are complete regardless of n; avoid the SDK's 100000 embedded
    // song details when reading or checking playlist ownership before a write.
    if (method === 'playlistDetail') data = { ...data, n: PLAYLIST_EMBEDDED_TRACKS, s: params.s ?? 8 };
    const header = { os: 'pc', appver: '3.1.17.204416', deviceId: params.deviceId || randomUUID(), versioncode: '140',
      resolution: '1920x1080', __csrf: cookie.__csrf || '', channel: 'netease', requestId: `${Date.now()}_0000`,
      ...(cookie.MUSIC_U ? { MUSIC_U: cookie.MUSIC_U } : {}), ...(cookie.MUSIC_A ? { MUSIC_A: cookie.MUSIC_A } : {}) };
    const weapi = options?.crypto === 'weapi';
    const payload = weapi ? sdk.crypto.weapi({ ...data, csrf_token: header.__csrf }) : sdk.crypto.eapi(uri, { ...data, e_r: false, header });
    const response = await fetch(weapi ? `https://music.163.com/weapi/${uri.slice(5)}` : `https://interface.music.163.com/eapi/${uri.slice(5)}`, {
      method: 'POST', signal, redirect: 'error', dispatcher: neteaseDispatcher,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 NeteaseMusicDesktop/3.1.17.204416',
        'Cookie': Object.entries(header).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('; ') },
      body: new URLSearchParams(payload).toString(),
    });
    if (!response.ok) throw withOnlineDiagnostic(error(response.status === 429 ? '网易云请求过于频繁，请稍后重试。' : response.status === 401 ? '网易云未授权本次请求，请检查登录状态。' : response.status === 403 ? '网易云拒绝了本次请求。' : '网易云暂时无法连接，请稍后重试。', response.status >= 400 && response.status < 500 ? response.status : 502), { operation: method, stage: 'http', code: `HTTP_${response.status}`, upstreamStatus: response.status });
    const chunks = []; let size = 0;
    const responseLimit = method === 'playlistDetail' ? playlistResponseLimit() : 2 * MIB;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > responseLimit) { await response.body.cancel().catch(() => {}); throw withOnlineDiagnostic(error(method === 'playlistDetail' ? '该歌单曲目过多，返回的列表超过读取上限。' : '网易云返回的数据过大。'), { operation: method, stage: 'response', code: 'RESPONSE_TOO_LARGE', upstreamStatus: response.status }); }
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (cause) { throw withOnlineDiagnostic(error('网易云返回了无法读取的数据。', 502, cause), { operation: method, stage: 'response', code: 'RESPONSE_INVALID_JSON', upstreamStatus: response.status }); }
    return { status: response.status, body, cookie: response.headers.getSetCookie() };
  });
}

export class NeteaseOnline {
  constructor({ call = sdkCall, now = Date.now, timeoutMs = 10000, dataDir, sessionStore } = {}) {
    this.call = call; this.now = now; this.timeoutMs = timeoutMs;
    this.cache = new Map(); this.inFlight = new Map(); this.active = 0; this.waiting = [];
    this.auth = new NeteaseAuth({ call: (method, params) => this.rawRequest(method, params), dataDir, sessionStore, now,
      changed: () => { this.cache.clear(); this.inFlight.clear(); this.songInfoCache?.clear(); this.songInfoPending?.clear(); this.playlistCache?.clear(); this.ownedPlaylists?.clear(); this.playlistEpoch = undefined; } });
  }
  async rawRequest(method, params, expectedEpoch) {
    if (this.active >= 4) {
      if (this.waiting.length >= 16) throw error('在线请求正在处理中，请稍后重试。', 429);
      await new Promise((resolve, reject) => {
        const entry = { start: () => { clearTimeout(timer); resolve(); } };
        const timer = setTimeout(() => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(error('网易云请求等待超时。', 429));
        }, this.timeoutMs);
        // Playback must not fail just because cover-title or lyric metadata is
        // using all four slots. Transfer the next reservation to playback first.
        if (method === 'playback') this.waiting.unshift(entry); else this.waiting.push(entry);
      });
    } else this.active++;
    try {
      if (expectedEpoch !== undefined) this.checkScope(expectedEpoch);
      const result = await traceOnlineRequest('netease', method, () => this.call(method, params, AbortSignal.timeout(this.timeoutMs)), { timeoutMs: this.timeoutMs });
      return result;
    } catch (failure) {
      const original = failure instanceof Error ? failure : Object.assign(new Error('Online request failed'), { status: Number.isInteger(failure?.status) ? failure.status : undefined });
      diagnoseOnlineFailure(original, 'netease', method);
      if (original.status) throw original;
      // Keep the original safe diagnostic while preserving existing user text/status.
      const wrapped = error(original.name === 'TimeoutError' || original.name === 'AbortError' ? '网易云请求超时，请检查网络后重试。' : '无法连接网易云，请检查网络后重试。');
      const diagnostic = onlineDiagnostic(original);
      throw withOnlineDiagnostic(wrapped, { ...diagnostic, code: diagnostic.code.replace(/^NETEASE_/, '') });
    } finally {
      const next = this.waiting.shift();
      if (next) next.start(); else this.active--;
    }
  }
  async request(method, params, expectedEpoch) {
    await this.auth.ready;
    if (expectedEpoch !== undefined) this.checkScope(expectedEpoch);
    const result = await this.rawRequest(method, { ...params, cookie: this.auth.cookie, deviceId: this.auth.deviceId }, expectedEpoch);
    if (result?.body?.code !== 200) {
      const rawCode = result?.body?.code;
      const code = typeof rawCode === 'number' && Number.isInteger(rawCode) || typeof rawCode === 'string' && /^-?\d{1,6}$/.test(rawCode) ? rawCode : 'MISSING_CODE';
      throw withOnlineDiagnostic(error(rawCode === 301 ? '网易云需要登录后才能进行此操作。' : '网易云服务暂时不可用，请稍后重试。', rawCode === 301 ? 401 : 502), { operation: method, stage: 'business', code: `BUSINESS_${code}`, businessCode: rawCode, upstreamStatus: result?.status, transport: onlineTransport(result) });
    }
    return result.body;
  }
  async search(query, offset = 0) {
    const keyword = clean(query);
    if (!keyword || keyword.length > 100) throw error('请输入 1 至 100 个字符的搜索词。', 400);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000 || offset % PAGE_SIZE) throw error('无效的搜索分页。', 400);
    await this.auth.ready;
    const key = `${this.auth.epoch}\0${keyword}\0${offset}`;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < 300000) return cached.value;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const operation = (async () => {
      const body = await this.request('search', { keywords: keyword, type: 1, limit: PAGE_SIZE, offset });
      if (!body.result || (body.result.songs !== undefined && !Array.isArray(body.result.songs))) throw error('网易云搜索结果格式发生变化，请稍后重试。');
      const tracks = (body.result.songs || []).slice(0, PAGE_SIZE).flatMap(song => {
        const track = neteaseTrack(song); return track ? [track] : [];
      });
      const total = Math.max(0, Number(body.result.songCount) || 0);
      const value = { provider: 'netease', query: keyword, offset, limit: PAGE_SIZE, total, hasMore: offset + PAGE_SIZE < total, tracks };
      this.cache.delete(key); this.cache.set(key, { at: this.now(), value });
      while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
      return value;
    })().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation); return operation;
  }
  async prepare(value) {
    const id = songId(value);
    const body = await this.request('playback', { id, level: 'standard' });
    if (!Array.isArray(body.data)) throw error('网易云音源返回格式发生变化，请稍后重试。');
    const item = body.data.find(item => String(item.id) === id);
    const url = neteaseMediaUrl(item?.url);
    if (!url) throw withOnlineDiagnostic(error('网易云未提供这首歌的播放地址，可能需要登录、会员或所在地区的播放权限。', 403), { operation: 'playback', stage: 'permission', code: 'PLAYBACK_NO_URL', businessCode: item?.code });
    const trial = item.freeTrialInfo && Number.isFinite(item.freeTrialInfo.start) && Number.isFinite(item.freeTrialInfo.end)
      ? { start: item.freeTrialInfo.start, end: item.freeTrialInfo.end } : undefined;
    return { audioUrl: url, trial, bitrate: Number(item.br) || undefined,
      format: clean(item.type).toUpperCase() || '在线音频' };
  }
  async songInfo(value) {
    const id = songId(value);
    await this.auth.ready;
    const epoch = this.auth.epoch, key = `${epoch}:${id}`;
    this.songInfoCache ??= new Map(); this.songInfoPending ??= new Map();
    const cached = this.songInfoCache.get(key);
    if (cached && this.now() - cached.at < 300000) return cached.value;
    if (this.songInfoPending.has(key)) return this.songInfoPending.get(key);
    if (this.songInfoPending.size >= 8) throw error('歌曲资料请求正在处理中。', 429);
    const operation = (async () => {
      const body = await this.request('songDetail', { ids: id });
      const song = body.songs?.find(item => String(item.id) === id), track = neteaseTrack(song);
      if (!track) throw error('网易云没有返回这首歌的资料。', 404);
      const [albumResult, lyricResult] = await Promise.allSettled([
        track.onlineSource.albumId ? this.request('album', { id: track.onlineSource.albumId }) : Promise.resolve({}),
        this.request('lyric', { id }),
      ]);
      if (epoch !== this.auth.epoch) throw error('登录状态已改变。', 409);
      const album = albumResult.status === 'fulfilled' ? albumResult.value.album || {} : {};
      const lyric = lyricResult.status === 'fulfilled' ? lyricResult.value : {};
      const published = Number(album.publishTime || song.publishTime);
      const lyricText = value => typeof value === 'string' ? value.slice(0, 200000).replace(/\0/g, '') : '';
      const result = { track, album: {
        title: clean(album.name) || track.onlineSource.albumTitle,
        artist: clean(album.artist?.name) || track.artist,
        published: published > 0 && Number.isFinite(published) && published < 8640000000000000 ? new Date(published).toISOString().slice(0, 10) : undefined,
        company: clean(album.company), description: typeof album.description === 'string' ? album.description.slice(0, 12000).replace(/\0/g, '') : undefined,
      }, lyrics: { original: lyricText(lyric.lrc?.lyric), translated: lyricText(lyric.tlyric?.lyric),
        instrumental: lyric.nolyric === true, unavailable: lyric.uncollected === true,
        error: lyricResult.status === 'rejected' ? lyricResult.reason.message : undefined },
        metadataError: albumResult.status === 'rejected' ? albumResult.reason.message : undefined };
      // Partial network failures remain retryable rather than a five-minute empty lyric cache.
      if (!result.lyrics.error && !result.metadataError) {
        this.songInfoCache.delete(key); this.songInfoCache.set(key, { at: this.now(), value: result });
        while (this.songInfoCache.size > 32) this.songInfoCache.delete(this.songInfoCache.keys().next().value);
      }
      return result;
    })().finally(() => { if (this.songInfoPending.get(key) === operation) this.songInfoPending.delete(key); });
    this.songInfoPending.set(key, operation); return operation;
  }
  async accountScope() {
    await this.auth.ready;
    if (!this.auth.cookie.MUSIC_U) throw error('请先登录网易云，再读取自己的歌单。', 401);
    if (!this.auth.profile?.userId) await this.auth.status();
    const uid = this.auth.profile?.userId;
    if (!uid || !/^[1-9]\d{0,15}$/.test(uid)) throw error('无法读取当前账号，请刷新登录状态。', 401);
    if (this.playlistEpoch !== this.auth.epoch) { this.playlistEpoch = this.auth.epoch; this.ownedPlaylists = new Map(); this.playlistCache = new Map(); }
    return { uid, epoch: this.auth.epoch };
  }
  async realtimeCredentials(epoch) {
    this.checkScope(epoch);
    const cookie = Object.entries(this.auth.cookie).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('; ');
    const response = await fetch('https://interface3.music.163.com/api/middle/im/token/get?bizName=music_listenTogether', {
      dispatcher: neteaseDispatcher, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        Cookie: `${cookie}; os=osx; osver=15.5; appver=3.1.10.5100; channel=netease; versioncode=140` },
    });
    this.checkScope(epoch);
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw error(`网易云聊天授权失败（HTTP ${response.status}）。`); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.byteLength; if (size > 524288) throw error('网易云聊天授权响应过大。'); chunks.push(chunk); }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error('网易云聊天授权响应格式异常。'); }
    if (body.code !== 200 || typeof body.data?.accId !== 'string' || typeof body.data?.token !== 'string' || body.data.token.length > 8192) throw error(`网易云聊天授权未成功（${Number(body.code) || 0}）。`);
    this.checkScope(epoch); return { accId: body.data.accId, token: body.data.token };
  }
  checkScope(epoch) { if (epoch !== this.auth.epoch || !this.auth.cookie.MUSIC_U) throw error('登录状态已改变，请重新读取歌单。', 409); }
  async playlists(offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 5000 || offset % 100) throw error('无效的歌单分页。', 400);
    const { uid, epoch } = await this.accountScope();
    const body = await this.request('playlists', { uid, limit: 100, offset }); this.checkScope(epoch);
    if (!Array.isArray(body.playlist)) throw error('网易云歌单返回格式发生变化。');
    const playlists = body.playlist.slice(0, 100).flatMap(item => {
      if (!/^[1-9]\d{0,15}$/.test(String(item?.id))) return [];
      const value = { id: String(item.id), name: clean(item.name) || '未命名歌单',
        trackCount: Math.min(100000, Math.max(0, Math.floor(Number(item.trackCount) || 0))),
        coverUrl: neteaseCoverUrl(item.coverImgUrl), owned: String(item.creator?.userId) === uid,
        specialType: Number(item.specialType) || 0 };
      this.ownedPlaylists.set(value.id, value); return [value];
    });
    return { provider: 'netease', playlists, offset, limit: 100, hasMore: body.more === true };
  }
  async playlistTracks(value, offset = 0) {
    const revision = this.playlistWriteRevision || 0;
    const id = songId(value);
    if (!Number.isInteger(offset) || offset < 0 || offset >= 100000 || offset % 50) throw error('无效的歌单歌曲分页。', 400);
    const { epoch } = await this.accountScope();
    if (!this.ownedPlaylists.has(id)) throw error('这个歌单不在当前账号的歌单列表中，请刷新歌单。', 403);
    const key = `${id}:${offset}`, cached = this.playlistCache.get(key);
    if (cached && this.now() - cached.at < 300000) { this.playlistCache.delete(key); this.playlistCache.set(key, cached); return cached.value; }
    const detailKey = `${id}:ids`, stored = this.playlistCache.get(detailKey);
    let ids;
    if (stored && this.now() - stored.at < 300000) ids = stored.value;
    else {
      const body = await this.request('playlistDetail', { id, s: 0 }); this.checkScope(epoch);
      if (!Array.isArray(body.playlist?.trackIds)) throw error('网易云歌单歌曲列表格式发生变化。');
      ids = body.playlist.trackIds.slice(0, 100000).map(item => /^[1-9]\d{0,15}$/.test(String(item?.id)) ? String(item.id) : null);
      if (revision === (this.playlistWriteRevision || 0)) this.playlistCache.set(detailKey, { at: this.now(), value: ids });
      const details = [...this.playlistCache.keys()].filter(key => key.endsWith(':ids'));
      while (details.length > 8) this.playlistCache.delete(details.shift());
    }
    const pageIds = ids.slice(offset, offset + 50), valid = pageIds.filter(Boolean);
    const body = valid.length ? await this.request('songDetail', { ids: [...new Set(valid)].join(',') }) : { songs: [] };
    this.checkScope(epoch);
    if (!Array.isArray(body.songs)) throw error('网易云歌曲详情格式发生变化。');
    const songs = new Map(body.songs.flatMap(song => { const track = neteaseTrack(song); return track ? [[track.onlineSource.id, track]] : []; }));
    const result = { provider: 'netease', playlistId: id, offset, limit: 50, total: ids.length,
      hasMore: offset + 50 < ids.length, tracks: pageIds.map(id => songs.get(id) || null) };
    if (revision === (this.playlistWriteRevision || 0)) this.playlistCache.set(key, { at: this.now(), value: result });
    while (this.playlistCache.size > 128) this.playlistCache.delete(this.playlistCache.keys().next().value);
    return result;
  }
}
