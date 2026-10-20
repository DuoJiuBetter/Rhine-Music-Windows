// Cloud writes are deliberately separate from the read/cache paths. No retries:
// a lost response does not establish that the platform rejected a mutation.
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const numeric = value => typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value);
export const playlistCapabilities = provider => ({
  create: provider === 'netease' || provider === 'qq',
  rename: provider === 'netease',
  delete: provider === 'netease' || provider === 'qq',
  add: ['netease', 'qq', 'bodian'].includes(provider),
  remove: ['netease', 'qq', 'bodian'].includes(provider),
});
export class PlaylistManagement {
  constructor(provider, catalog) { this.provider = provider; this.catalog = catalog; this.busy = false; }
  async session() {
    const api = this.catalog;
    await api.auth.ready;
    if (this.provider === 'netease') await api.accountScope(); else api.scope();
    return String(api.auth.epoch);
  }
  async capabilities() {
    return { provider: this.provider, session: await this.session(), ...playlistCapabilities(this.provider),
      notice: this.provider === 'bodian' ? '波点支持向自己的歌单添加、移除歌曲，新建和改名请在官方客户端操作。' : undefined };
  }
  async mutate(body) {
    const session = await this.session(), api = this.catalog;
    if (body.session !== session) throw fail('账号已改变，请重新打开歌单整理。', 409);
    const action = body.action;
    if (!Object.hasOwn(playlistCapabilities(this.provider), action) || !playlistCapabilities(this.provider)[action]) throw fail('当前平台暂不支持此项歌单编辑，请在官方客户端操作。', 501);
    let name, ids, playlist;
    if (action === 'create' || action === 'rename') {
      name = typeof body.name === 'string' ? body.name.trim() : '';
      const max = this.provider === 'qq' ? 20 : 40;
      if (!name || [...name].length > max || /[\u0000-\u001f\u007f]/.test(name)) throw fail(`歌单名称须为 1 至 ${max} 个字符。`);
    }
    if (action !== 'create') {
      if (typeof body.playlistId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.playlistId)) throw fail('无效的歌单。');
      playlist = this.provider === 'netease' ? api.ownedPlaylists?.get(body.playlistId) : api.owned.get(body.playlistId)?.value;
      if (!playlist?.owned) throw fail('只能编辑当前账号自己创建的歌单，请刷新后重试。', 403);
      const entry = this.provider === 'qq' ? api.owned.get(body.playlistId) : undefined;
      // System playlists may accept songs but cannot be renamed or deleted.
      if ((action === 'delete' || action === 'rename') && (playlist.specialType === 5 || entry?.dirid === '201')) throw fail('“我喜欢的音乐”不能改名或删除。', 403);
    }
    if (action === 'add' || action === 'remove') {
      if (!Array.isArray(body.trackIds) || body.trackIds.length < 1 || body.trackIds.length > 50 || body.trackIds.some(id => this.provider !== 'qq' ? !numeric(id) || !Number.isSafeInteger(Number(id)) : typeof id !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(id))) throw fail('每次请选择 1 至 50 首当前平台的歌曲。');
      ids = [...new Set(body.trackIds)];
    }
    if (this.busy) throw fail('正在保存歌单，请等待完成。', 409);
    this.busy = true;
    const check = () => { if (String(api.auth.epoch) !== session) throw fail('账号已改变，请刷新歌单。', 409); };
    const invalidate = () => {
      api.playlistCache?.clear();
      // In-flight read requests must not repopulate an old playlist cache.
      api.playlistWriteRevision = (api.playlistWriteRevision || 0) + 1;
      if (this.provider !== 'netease') api.cache.clear();
    };
    try {
      if (this.provider === 'netease') {
        if (action !== 'create') {
          const detail = await api.request('playlistDetail', { id: playlist.id, s: 0 }, Number(session)); check();
          if (String(detail.playlist?.creator?.userId) !== String(api.auth.profile?.userId)) throw fail('平台确认当前账号不是这个歌单的创建者。', 403);
          if (['rename', 'delete'].includes(action) && detail.playlist.specialType === 5) throw fail('“我喜欢的音乐”不能改名或删除。', 403);
          const existing = new Set((detail.playlist.trackIds || []).map(item => String(item.id)));
          if (action === 'add') {
            ids = ids.filter(id => !existing.has(id));
            if (!ids.length) return { ok: true, unchanged: true, message: '歌曲已在这个歌单中。' };
          }
        }
        invalidate();
        await api.request({ create: 'playlistCreate', rename: 'playlistRename', delete: 'playlistDelete', add: 'playlistAdd', remove: 'playlistRemove' }[action],
          action === 'create' ? { name } : action === 'rename' ? { id: playlist.id, name } : action === 'delete' ? { id: playlist.id } : { id: playlist.id, pid: playlist.id, ids: ids.join(',') }, Number(session));
      } else if (this.provider === 'bodian') {
        const entry = api.owned.get(playlist.id);
        if (entry.source !== 5 || !numeric(entry.playlistId) || !Number.isSafeInteger(Number(entry.playlistId))) throw fail('波点歌单不支持编辑，请选择自己创建的歌单。', 403);
        check(); invalidate();
        await api.call(action === 'add' ? '/api/service/playlist/music' : '/api/service/playlist/music/delete', {}, {
          method: 'POST', timed: true, allowEmpty: true,
          payload: { playListId: Number(entry.playlistId), musicIdList: ids.map(Number) },
        });
      } else {
        const entry = playlist && api.owned.get(playlist.id);
        if (entry && (!Number.isSafeInteger(Number(entry.dirid)) || Number(entry.dirid) <= 0)) throw fail('QQ 音乐歌单没有有效的编辑标识，请刷新歌单。', 502);
        let param, module = 'music.musicasset.PlaylistBaseWrite', method;
        if (action === 'create') { method = 'AddPlaylist'; param = { dirName: name }; }
        else if (action === 'delete') { method = 'DelPlaylist'; param = { dirId: Number(entry.dirid) }; }
        else {
          // The current official QQ portal writes numeric song IDs and types,
          // rather than assuming songmid is also a song ID.
          const songs = [];
          for (const mid of ids) {
            check();
            const detail = await api.rpc('music.pf_song_detail_svr', 'get_song_detail_yqq', { song_mid: mid }); check();
            const song = detail.track_info;
            if (song?.mid !== mid || !Number.isSafeInteger(song.id) || song.id <= 0 || !Number.isInteger(song.type) || song.type < 0 || song.type > 100) throw fail('QQ 音乐没有返回可编辑的歌曲标识，请刷新重试。', 502);
            songs.push({ songType: song.type, songId: song.id });
          }
          module = 'music.musicasset.PlaylistDetailWrite'; method = action === 'add' ? 'AddSonglist' : 'DelSonglist';
          param = { dirId: Number(entry.dirid), v_songInfo: songs };
        }
        check(); invalidate(); await api.rpc(module, method, param);
      }
      check();
      return { ok: true, message: '已保存到' + ({ netease: '网易云音乐', qq: 'QQ 音乐', bodian: '波点音乐' })[this.provider] + '。' };
    } finally { invalidate(); this.busy = false; }
  }
}
