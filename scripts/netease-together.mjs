import { TogetherNim } from './together-nim.mjs';
import { togetherInvite, togetherPlayback, togetherChatPayload } from './together-protocol.mjs';
import { neteaseTrack, neteaseMediaUrl } from './netease-online.mjs';
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const numeric = value => typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value);
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) : '';
export class NeteaseTogether {
  constructor(api, { chat = new TogetherNim(), now = Date.now } = {}) {
    this.api = api; this.chat = chat; this.now = now; this.busy = false; this.sequence = 0; this.tracks = new Map();
  }
  async scope() {
    let scope; try { scope = await this.api.accountScope(); } catch (error) { this.reset(); throw error; }
    if (this.epoch !== scope.epoch) { this.reset(); this.epoch = scope.epoch; }
    return scope;
  }
  reset() { clearTimeout(this.heartbeatTimer); this.chat.dispose(); this.room = undefined; this.active = false; this.playback = undefined; this.queueError = undefined; this.tracks.clear(); this.queueIds = []; this.epoch = undefined; }
  async call(method, params = {}, epoch = this.epoch) {
    this.api.checkScope(epoch);
    const result = await this.api.request(method, params, epoch);
    this.api.checkScope(epoch); return result;
  }
  async status(fresh = false) {
    const { epoch } = await this.scope();
    if (this.statusPending?.epoch === epoch) {
      if (!fresh) return this.statusPending.promise;
      await this.statusPending.promise; this.api.checkScope(epoch);
    }
    const promise = this.read(epoch).finally(() => { if (this.statusPending?.promise === promise) this.statusPending = undefined; });
    this.statusPending = { epoch, promise }; return promise;
  }
  async read(epoch) {
    const body = await this.call('togetherStatus', {}, epoch), data = body.data || body;
    if (typeof data.inRoom !== 'boolean') throw fail('网易云一起听状态格式发生变化。', 502);
    if (!data.inRoom) { this.reset(); this.epoch = epoch; return this.snapshot(); }
    const info = data.roomInfo || body.roomInfo;
    if (!info || typeof info.roomId !== 'string') throw fail('网易云没有返回有效房间信息。', 502);
    if (this.room?.id !== info.roomId) { this.chat.dispose(); this.tracks.clear(); this.sequence = 0; this.playback = undefined; }
    this.room = { id: info.roomId, chatRoomId: String(info.chatRoomId || ''),
      users: (Array.isArray(info.roomUsers) ? info.roomUsers : []).slice(0, 20).map(item => ({
        userId: String(item.userId || ''), nickname: clean(item.nickname) || '一起听成员', avatar: neteaseMediaUrl(item.avatarUrl),
      })),
      // Only actual numeric platform values are presented; never infer location.
      durationMs: Number.isFinite(data.listenTogetherTime) ? Math.max(0, data.listenTogetherTime) : undefined,
    };
    try {
      const playlist = (await this.call('togetherPlaylist', { roomId: this.room.id }, epoch)).data || {};
      this.queueIds = (Array.isArray(playlist.playlist?.displayList?.result) ? playlist.playlist.displayList.result : []).slice(0, 5000).map(String).filter(numeric);
      this.versions = Array.isArray(playlist.playlist?.version) ? playlist.playlist.version : [];
      this.playback = togetherPlayback(playlist.playCommand) || this.playback;
      this.queueError = undefined;
    } catch (error) { this.api.checkScope(epoch); this.queueError = error.message; }
    return this.snapshot();
  }
  snapshot() {
    const realtime = this.chat.playback;
    const playback = realtime && (!this.playback || (realtime.serverSeq ?? -1) >= (this.playback.serverSeq ?? -1)) ? realtime : this.playback;
    return { session: String(this.epoch), inRoom: !!this.room, active: this.active, room: this.room,
      playback, queueIds: this.queueIds || [], queueError: this.queueError,
      chat: { connected: this.chat.connected, messages: this.chat.messages, error: this.chat.error, historyError: this.chat.historyError } };
  }
  async activate() {
    if (!this.room) throw fail('请先创建或加入一起听。');
    const epoch = this.epoch, room = this.room;
    if (!/^\d{1,16}$/.test(room.chatRoomId) || !Number.isSafeInteger(Number(room.chatRoomId)) || Number(room.chatRoomId) <= 0) throw fail('网易云尚未返回有效的聊天室标识，请刷新状态。', 502);
    this.active = true; this.heartbeat();
    const credentials = await this.api.realtimeCredentials(epoch);
    this.api.checkScope(epoch);
    if (this.room?.id !== room.id) throw fail('一起听房间已改变。');
    const raw = await this.call('accountProfile', {}, epoch), profile = raw.profile || {};
    this.api.checkScope(epoch);
    if (this.room?.id !== room.id) throw fail('一起听房间已改变。');
    await this.chat.connect({ roomId: room.id, chatRoomId: room.chatRoomId, credentials,
      profile: { userId: this.api.auth.profile.userId, nickname: clean(profile.nickname) || this.api.auth.profile.nickname, avatar: neteaseMediaUrl(profile.avatarUrl) } });
    this.api.checkScope(epoch);
  }
  heartbeat() {
    clearTimeout(this.heartbeatTimer);
    const epoch = this.epoch;
    this.heartbeatTimer = setTimeout(async () => {
      try {
        this.api.checkScope(epoch);
        if (!this.active || !this.room) return;
        const state = this.snapshot().playback;
        if (state?.songId) await this.call('togetherHeartbeat', { roomId: this.room.id, songId: state.songId,
          playStatus: state.status === 'PLAY', progress: Math.floor(state.progressMs + (state.status === 'PLAY' ? Math.max(0, this.now() - state.observedAt) : 0)) }, epoch);
        if (this.active) this.heartbeat();
      } catch { if (this.api.auth.epoch !== epoch) this.reset(); else { this.active = false; this.chat.dispose(); } }
    }, 10000); this.heartbeatTimer.unref?.();
  }
  async resolveTrack(id) {
    if (!numeric(id) || !this.room || !this.queueIds.includes(id) && this.snapshot().playback?.songId !== id) throw fail('这首歌曲不在当前一起听房间中。', 403);
    if (this.tracks.has(id)) return this.tracks.get(id);
    const epoch = this.epoch, room = this.room;
    const body = await this.call('songDetail', { ids: id }, epoch);
    if (this.room?.id !== room.id) throw fail('房间已改变。');
    const track = neteaseTrack(body.songs?.find(item => String(item.id) === id));
    if (!track) throw fail('无法读取这首歌曲。', 404);
    this.tracks.set(id, track); while (this.tracks.size > 100) this.tracks.delete(this.tracks.keys().next().value);
    return track;
  }
  async action(body) {
    const { uid, epoch } = await this.scope();
    if (body.session !== String(epoch)) throw fail('账号已改变，请重新打开一起听。');
    if (this.busy) throw fail('一起听操作正在处理中。');
    if (!['create', 'join', 'leave', 'activate', 'message', 'command', 'queue', 'track'].includes(body.action)) throw fail('无效的一起听操作。', 400);
    this.busy = true;
    try {
      await this.status(); this.api.checkScope(epoch);
      if (body.action === 'create') {
        if (!this.room) await this.call('togetherCreate', {}, epoch);
        await this.status(true);
        if (!this.room) throw fail('创建结果尚未确认，请刷新状态，避免重复创建。', 502);
      } else if (body.action === 'join') {
        const invite = togetherInvite(body.invite);
        if (this.room && this.room.id !== invite.roomId) throw fail('请先退出当前一起听房间。');
        if (!this.room) await this.call('togetherJoin', invite, epoch);
        await this.status(true);
        if (this.room?.id !== invite.roomId) throw fail('加入结果尚未确认，请刷新状态。', 502);
      } else if (body.action === 'leave') {
        if (this.room) {
          if (body.roomId !== this.room.id) throw fail('房间已改变，请重新确认退出。');
          await this.call('togetherEnd', { roomId: this.room.id }, epoch); await this.status(true);
          if (this.room) throw fail('网易云尚未确认退出，请刷新状态。', 502);
        }
        return this.snapshot();
      } else if (!this.room || body.roomId !== this.room.id) throw fail('一起听房间已改变，请刷新。');
      if (['create', 'join', 'activate'].includes(body.action)) {
        try { await this.activate(); } catch (error) { this.api.checkScope(epoch); this.chat.error = error.message; }
      }
      if (body.action === 'track') return { track: await this.resolveTrack(body.songId) };
      if (body.action === 'message') {
        togetherChatPayload(body.text, this.room.id);
        await this.chat.send(body.text.trim()); this.api.checkScope(epoch);
      }
      if (body.action === 'queue') {
        if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 5000 || body.ids.some(id => !numeric(id))) throw fail('一起听队列须为 1 至 5000 首网易云歌曲。', 400);
        const ids = [...new Set(body.ids)], version = Number(this.versions?.find(item => String(item.userId) === uid)?.version || 0) + 1;
        await this.call('togetherQueue', { roomId: this.room.id, commandType: 'REPLACE', userId: uid, version, displayList: ids.join(','), randomList: ids.join(',') }, epoch);
        await this.status(true);
        if (this.queueIds.join(',') !== ids.join(',')) throw fail('网易云尚未确认共享队列，请刷新后核对。', 502);
      }
      if (body.action === 'command') {
        if (!numeric(body.songId) || !this.queueIds.includes(body.songId) || !['PLAY', 'PAUSE', 'GOTO'].includes(body.command) || !Number.isFinite(body.progressMs) || body.progressMs < 0 || body.progressMs > 86400000) throw fail('无效的播放同步请求。', 400);
        const sequence = ++this.sequence, issuedAt = this.now();
        await this.call('togetherCommand', { roomId: this.room.id, commandType: body.command, progress: Math.floor(body.progressMs), playStatus: body.playing ? 'PLAY' : 'PAUSE',
          formerSongId: this.snapshot().playback?.songId || '-1', targetSongId: body.songId, clientSeq: sequence }, epoch);
        await this.status(true);
        const state = this.snapshot().playback;
        const expectedProgress = body.progressMs + (body.playing ? Math.max(0, this.now() - issuedAt) : 0);
        if (state?.songId !== body.songId || state.status !== (body.playing ? 'PLAY' : 'PAUSE') || Math.abs(state.progressMs - expectedProgress) > 2000) throw fail('播放同步请求已提交，尚未确认，请刷新状态。', 502);
      }
      return this.snapshot();
    } finally { this.busy = false; }
  }
  dispose() { this.reset(); }
}
