import type { MusicTrack } from './music-types';
import type { MusicPlayer, MusicPlayerState } from './music-player';
import { fetchOnline } from './online-debug';
import { escapeHtml as esc } from './html';
import './listen-together.css';
type TogetherState = {
  session: string; inRoom: boolean; active: boolean;
  room?: { id: string; users: { userId: string; nickname: string; avatar?: string }[]; durationMs?: number };
  playback?: { songId: string; status: 'PLAY' | 'PAUSE'; progressMs: number; observedAt: number; serverSeq?: number };
  queueIds: string[]; queueError?: string;
  chat: { connected: boolean; error?: string; historyError?: string; messages: { id: string; text: string; nickname: string; time: number }[] };
};
/** UI uses same-origin HTTP only. The server owns NIM credentials/connections. */
export class ListenTogether {
  private state?: TogetherState;
  private controller = new AbortController();
  private epoch = 0;
  private visible = false;
  private root?: HTMLElement;
  private events?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private publishing?: ReturnType<typeof setTimeout>;
  private pending = false;
  private writing = false;
  private dirty = false;
  private applying = false;
  private lastLocal?: { song: string; playing: boolean; time: number; observed: number; queue: string };
  private sentQueue = '';
  private tracks = new Map<string, MusicTrack>();
  private confirmation?: HTMLDialogElement;
  private lastCommand = '';
  private renderKey = '';
  constructor(private stage: HTMLElement, private player: MusicPlayer, private notify: (message: string) => void,
    private play: (track: MusicTrack, queue: MusicTrack[]) => Promise<void>) {}
  get active() { return !!this.state?.inRoom && !!this.state.active; }
  show(visible: boolean) {
    this.visible = visible;
    if (visible) { this.mount(); void this.refresh(true); }
    else if (!this.active) clearTimeout(this.timer);
  }
  private mount() {
    const root = this.stage.querySelector<HTMLElement>('#song-together-view'); if (!root || root === this.root) return;
    this.events?.abort(); this.events = new AbortController(); this.root = root;
    this.renderKey = '';
    root.innerHTML = '<div class="together-content"></div><p class="together-status" role="status" aria-live="polite"></p>';
    root.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!target) return;
      event.stopPropagation();
      if (target.dataset.together === 'create') void this.perform('create');
      if (target.dataset.together === 'refresh') void this.refresh(true);
      if (target.dataset.together === 'reconnect') void this.perform('activate');
      if (target.dataset.together === 'copy') void this.copyInvite().catch(error => this.status((error as Error).message));
      if (target.dataset.together === 'leave') this.confirmLeave();
    }, { signal: this.events.signal });
    root.addEventListener('submit', event => {
      event.preventDefault(); event.stopPropagation();
      const form = event.target as HTMLFormElement, values = new FormData(form);
      if (form.dataset.togetherForm === 'join') void this.perform('join', { invite: values.get('invite') });
      if (form.dataset.togetherForm === 'message') void this.perform('message', { text: values.get('text') });
    }, { signal: this.events.signal });
    for (const type of ['keydown', 'wheel', 'pointerdown']) root.addEventListener(type, event => event.stopPropagation(), { signal: this.events.signal });
    this.render();
  }
  private async request<T>(body?: object): Promise<T> {
    const response = await fetchOnline('netease', 'together', '/api/online/netease/together', {
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(35000)]),
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '一起听请求失败。');
    return value;
  }
  private status(message: string) { const node = this.root?.querySelector('.together-status'); if (node) node.textContent = message; }
  private schedule() {
    clearTimeout(this.timer);
    if (this.active || this.visible) this.timer = setTimeout(() => void this.refresh(), 2000);
  }
  private async refresh(activate = false) {
    if (this.pending || this.writing) { this.schedule(); return; }
    this.pending = true; const epoch = this.epoch;
    try {
      const value = await this.request<TogetherState>(); if (epoch !== this.epoch) return;
      this.adopt(value);
      if (activate && value.inRoom && (!value.active || !value.chat.connected)) {
        const activated = await this.request<TogetherState>({ action: 'activate', session: value.session, roomId: value.room!.id });
        if (epoch !== this.epoch) return; this.adopt(activated);
      }
      await this.follow(); if (epoch === this.epoch) this.status(value.queueError || '');
    } catch (error) { if (epoch === this.epoch) this.status((error as Error).message); }
    finally { if (epoch === this.epoch) { this.pending = false; this.render(); this.schedule(); } }
  }
  private adopt(value: TogetherState) {
    if (this.state?.room?.id !== value.room?.id) { this.tracks.clear(); this.lastCommand = ''; this.sentQueue = ''; this.lastLocal = undefined; }
    this.state = value; this.render();
  }
  private render() {
    if (!this.visible) return;
    this.mountIfNeeded(); const node = this.root?.querySelector<HTMLElement>('.together-content'); if (!node) return;
    const value = this.state;
    const key = JSON.stringify(value ? [value.inRoom, value.room, value.queueIds.length, value.playback?.status, value.chat, !value.inRoom && this.pending] : null);
    if (key === this.renderKey) return;
    this.renderKey = key;
    const draft = node.querySelector<HTMLInputElement>('input[name="text"]')?.value || '';
    const invite = node.querySelector<HTMLInputElement>('input[name="invite"]')?.value || '';
    const focused = node.contains(document.activeElement) ? (document.activeElement as HTMLInputElement).name : '';
    const selection = focused ? [(document.activeElement as HTMLInputElement).selectionStart, (document.activeElement as HTMLInputElement).selectionEnd] : [];
    const messageList = node.querySelector<HTMLElement>('.together-messages'), top = messageList?.scrollTop || 0;
    const atBottom = !messageList || messageList.scrollHeight - top - messageList.clientHeight < 32;
    if (!value) { node.innerHTML = '<p>正在读取网易云一起听…</p>'; return; }
    if (!value.inRoom) {
      node.innerHTML = `<div class="together-welcome"><h3>把耳机的另一半分享出去</h3><button type="button" class="primary-button" data-together="create" ${this.pending ? 'disabled' : ''}>创建房间并邀请</button><form data-together-form="join"><label>加入朋友的一起听<input name="invite" type="url" required maxlength="2000" placeholder="粘贴网易云一起听邀请链接" value="${esc(invite)}"></label><button type="submit">加入</button></form></div>`;
    } else {
      node.innerHTML = `<div class="together-room-heading"><div><strong>网易云一起听</strong><small>${value.room!.users.length} 位成员 · ${value.chat.connected ? '聊天已连接' : '聊天连接中'}</small></div><div><button type="button" data-together="copy">邀请朋友 ↗</button><button type="button" data-together="leave">退出一起听</button></div></div><div class="together-members">${value.room!.users.map(user => `<span>${user.avatar ? `<img src="${esc(user.avatar)}" referrerpolicy="no-referrer" alt="">` : ''}${esc(user.nickname)}</span>`).join('')}</div><p class="together-queue-summary">共享队列 · ${value.queueIds.length} 首${value.playback ? ` · ${value.playback.status === 'PLAY' ? '正在播放' : '已暂停'}` : ''}</p><section class="together-chat" aria-label="一起听聊天"><div class="together-messages" role="log" aria-label="聊天记录" aria-live="off">${value.chat.messages.map(message => `<article data-message="${esc(message.id)}"><small>${esc(message.nickname)} <time>${new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></small><p>${esc(message.text)}</p></article>`).join('') || '<p class="together-empty">和一起听的朋友聊聊吧</p>'}</div><form data-together-form="message"><input type="text" name="text" maxlength="500" required aria-label="聊天消息" placeholder="发送消息…" value="${esc(draft)}" ${!value.chat.connected ? 'disabled' : ''}><button type="submit" ${!value.chat.connected ? 'disabled' : ''}>发送</button></form></section>${value.chat.error || value.chat.historyError ? `<p class="together-connection-error">${esc(value.chat.error || value.chat.historyError || '')}<button type="button" data-together="reconnect">重新连接</button></p>` : ''}`;
      const list = node.querySelector<HTMLElement>('.together-messages')!; list.scrollTop = atBottom ? list.scrollHeight : top;
    }
    if (focused) { const input = node.querySelector<HTMLInputElement>(`input[name="${focused === 'text' ? 'text' : 'invite'}"]`); input?.focus({ preventScroll: true }); if (input?.type === 'text') input.setSelectionRange(selection[0] ?? input.value.length, selection[1] ?? input.value.length); }
  }
  private mountIfNeeded() { if (this.root !== this.stage.querySelector('#song-together-view')) this.mount(); }
  private async perform(action: string, options: object = {}) {
    if (this.pending || this.writing) { this.status('正在更新房间，请稍候再试。'); return; }
    if (!this.state) return;
    const epoch = this.epoch; this.pending = true; this.status('正在处理…');
    try {
      const value = await this.request<TogetherState>({ action, session: this.state.session, roomId: this.state.room?.id, ...options });
      if (epoch !== this.epoch) return;
      this.adopt(value);
      if (action === 'message') { const input = this.root?.querySelector<HTMLInputElement>('input[name="text"]'); if (input) input.value = ''; }
      if (action === 'create') await this.publish(this.player.state, true);
      if (action === 'create' || action === 'join') await this.follow();
      if (action === 'leave') { this.confirmation?.close(); this.confirmation?.remove(); this.confirmation = undefined; this.notify('已退出一起听。'); }
      this.status('');
    } catch (error) { if (epoch === this.epoch) this.status((error as Error).message); }
    finally { if (epoch === this.epoch) { this.pending = false; this.render(); this.schedule(); } }
  }
  private async copyInvite() {
    if (!this.state?.room) return;
    const epoch = this.epoch, roomId = this.state.room.id;
    const profile = await fetchOnline('netease', 'status', '/api/online/netease/auth/status', { signal: this.controller.signal }).then(response => response.json());
    if (epoch !== this.epoch || this.state?.room?.id !== roomId || !profile.profile?.userId) return;
    const url = new URL('https://st.music.163.com/listen-together/share/');
    url.searchParams.set('roomId', this.state.room.id); url.searchParams.set('inviterId', profile.profile.userId);
    if (this.state.playback) url.searchParams.set('songId', this.state.playback.songId);
    try { await navigator.clipboard.writeText(url.href); this.status('邀请链接已复制，可发给朋友。'); }
    catch { const input = document.createElement('input'); input.value = url.href; input.readOnly = true; this.root?.append(input); input.focus(); input.select(); this.status('请按 Ctrl+C 复制邀请链接。'); }
  }
  private confirmLeave() {
    if (this.confirmation?.isConnected) return;
    const dialog = this.confirmation = document.createElement('dialog'); dialog.className = 'together-exit-dialog';
    dialog.setAttribute('aria-labelledby', 'together-exit-title');
    dialog.innerHTML = '<h3 id="together-exit-title">退出一起听？</h3><p>将离开当前网易云一起听房间。普通音乐播放可以继续。</p><button type="button" data-cancel>继续一起听</button><button type="button" data-leave>退出一起听</button>';
    for (const type of ['click', 'keydown', 'wheel', 'pointerdown']) dialog.addEventListener(type, event => event.stopPropagation());
    dialog.querySelector('[data-cancel]')!.addEventListener('click', () => { dialog.close(); dialog.remove(); this.confirmation = undefined; });
    dialog.querySelector('[data-leave]')!.addEventListener('click', () => void this.perform('leave'));
    dialog.addEventListener('cancel', () => { dialog.remove(); this.confirmation = undefined; }); this.stage.append(dialog); dialog.showModal();
  }
  private async track(id: string) {
    if (this.tracks.has(id)) return this.tracks.get(id)!;
    const state = this.state!, epoch = this.epoch;
    const response = await this.request<{ track: MusicTrack }>({ action: 'track', session: state.session, roomId: state.room!.id, songId: id });
    if (epoch !== this.epoch || state.room!.id !== this.state?.room?.id) throw new DOMException('房间已改变', 'AbortError');
    this.tracks.set(id, response.track); while (this.tracks.size > 100) this.tracks.delete(this.tracks.keys().next().value!);
    return response.track;
  }
  async next(direction: number) {
    if (!this.active || !this.state?.queueIds.length) return;
    const ids = this.state.queueIds, current = this.player.state.currentTrack?.onlineSource?.id || this.state.playback?.songId;
    const index = ids.indexOf(current || ''), id = ids[(Math.max(0, index) + direction + ids.length) % ids.length];
    const track = await this.track(id); return { id: track.id, queue: this.roomQueue(track) };
  }
  private roomQueue(track: MusicTrack) {
    const known = new Map([...this.player.state.queue, ...this.tracks.values(), track].filter(item => item.onlineSource?.provider === 'netease').map(item => [item.onlineSource!.id, item]));
    const queue = (this.state?.queueIds || []).map(id => known.get(id)).filter((item): item is MusicTrack => !!item);
    if (!queue.some(item => item.id === track.id)) queue.push(track);
    return queue;
  }
  private async follow() {
    const value = this.state, playback = value?.playback;
    if (!this.active || !playback || this.applying) return;
    const key = `${value!.room!.id}:${playback.serverSeq ?? `${playback.songId}:${playback.status}:${Math.floor(playback.progressMs / 1000)}`}`;
    if (key === this.lastCommand) return;
    this.applying = true;
    const epoch = this.epoch;
    try {
      const track = await this.track(playback.songId); if (epoch !== this.epoch) return;
      if (this.player.state.currentTrack?.id !== track.id) await this.play(track, this.roomQueue(track));
      if (epoch !== this.epoch) return;
      const seconds = Math.max(0, playback.progressMs / 1000 + (playback.status === 'PLAY' ? Math.max(0, Date.now() - playback.observedAt) / 1000 : 0));
      if (Math.abs(this.player.state.currentTime - seconds) > 1.5) this.player.seek(seconds);
      if (this.player.state.playing !== (playback.status === 'PLAY') && !this.player.state.error) await this.player.toggle();
      this.lastCommand = key;
    } finally {
      if (epoch === this.epoch) {
        this.applying = false;
        const state = this.player.state, source = state.currentTrack?.onlineSource;
        this.lastLocal = source ? { song: source.id, playing: state.playing, time: state.currentTime, observed: performance.now(),
          queue: state.queue.filter(track => track.onlineSource?.provider === 'netease').map(track => track.onlineSource!.id).join(',') } : undefined;
      }
    }
  }
  observe(state: MusicPlayerState) {
    const source = state.currentTrack?.onlineSource;
    if (!this.active || !source || source.provider !== 'netease' || state.loading || state.transport === 'error' || this.applying) return;
    const now = performance.now(), queue = state.queue.filter(track => track.onlineSource?.provider === 'netease').map(track => track.onlineSource!.id).join(',');
    const previous = this.lastLocal;
    this.lastLocal = { song: source.id, playing: state.playing, time: state.currentTime, observed: now, queue };
    if (!previous) return;
    const expected = previous.time + (previous.playing ? (now - previous.observed) / 1000 : 0);
    if (previous.song === source.id && previous.playing === state.playing && Math.abs(expected - state.currentTime) < 2 && previous.queue === queue) return;
    this.dirty = true; this.schedulePublish();
  }
  private schedulePublish() {
    clearTimeout(this.publishing);
    this.publishing = setTimeout(() => {
      if (!this.active || !this.dirty) return;
      if (this.pending || this.writing || this.applying) { this.schedulePublish(); return; }
      this.dirty = false; this.writing = true; const epoch = this.epoch;
      void this.publish(this.player.state).catch(error => { if (epoch === this.epoch) this.status((error as Error).message); })
        .finally(() => { if (epoch === this.epoch) { this.writing = false; if (this.dirty) this.schedulePublish(); } });
    }, 160);
  }
  private async publish(state: MusicPlayerState, force = false) {
    const room = this.state?.room, session = this.state?.session, source = state.currentTrack?.onlineSource;
    if (!room || !source || source.provider !== 'netease') return;
    const epoch = this.epoch;
    const ids = [...new Set(state.queue.filter(track => track.onlineSource?.provider === 'netease').map(track => track.onlineSource!.id))].slice(0, 5000);
    if (!ids.includes(source.id)) { ids.unshift(source.id); ids.length = Math.min(ids.length, 5000); }
    // A guest may only have metadata for a small part of the shared queue.
    // Pausing/seeking must not replace the complete room queue with that subset.
    if (force || this.sentQueue !== ids.join(',') && ids.some(id => !this.state!.queueIds.includes(id))) {
      const value = await this.request<TogetherState>({ action: 'queue', session, roomId: room.id, ids });
      if (epoch !== this.epoch) return; this.state = value; this.sentQueue = ids.join(',');
    }
    const value = await this.request<TogetherState>({ action: 'command', session, roomId: room.id, songId: source.id, progressMs: Math.floor(state.currentTime * 1000), playing: state.playing,
      command: this.state?.playback?.songId !== source.id ? 'GOTO' : state.playing ? 'PLAY' : 'PAUSE' });
    if (epoch !== this.epoch) return; this.adopt(value); this.lastCommand = ''; await this.follow();
  }
  invalidate() {
    this.epoch++; this.controller.abort(); this.controller = new AbortController(); this.state = undefined;
    clearTimeout(this.timer); clearTimeout(this.publishing); this.pending = false; this.writing = false; this.dirty = false; this.applying = false;
    this.tracks.clear(); this.lastLocal = undefined; this.sentQueue = ''; this.lastCommand = '';
    this.renderKey = '';
    this.confirmation?.close(); this.confirmation?.remove(); this.confirmation = undefined;
    this.render();
  }
  dispose() { this.visible = false; this.invalidate(); this.events?.abort(); this.root = undefined; }
}
