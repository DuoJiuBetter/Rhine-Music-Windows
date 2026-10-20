import './music-queue-view.css';
import { escapeHtml as esc } from './html';
import { queueEntryKey, type PlaybackOrigin } from './playback-queue';
import type { MusicPlayerState } from './music-player';
import type { MusicTrack } from './music-types';

export class MusicQueueView {
  private root: HTMLElement;
  private events = new AbortController();
  private signature = '';
  private expanded = false;
  private limit = 100;
  private resize: ResizeObserver;
  constructor(host: HTMLElement, actions: {
    back: () => void; locate: () => void; source: () => void;
    play: (key: string) => void; remove: (key: string) => void; move: (key: string, direction: number) => void;
  }) {
    this.root = document.createElement('section'); this.root.className = 'queue-view-tools'; this.root.hidden = true;
    this.root.setAttribute('aria-label', '当前播放队列');
    this.root.innerHTML = `<div class="queue-view-toolbar"><button type="button" data-queue-action="back">← 返回浏览</button><span>播放队列 <small data-queue-count></small></span><button type="button" data-queue-action="source">查看来源</button><button type="button" data-queue-action="locate">定位当前</button><button type="button" data-queue-action="list" aria-expanded="false">列表 ☷</button></div><div class="queue-drawer" hidden><p class="queue-mode-note"></p><ol aria-label="队列歌曲"></ol><button type="button" data-queue-action="more" hidden>显示更多</button><p class="queue-empty" hidden>队列为空，播放歌曲或添加下一首后会显示在这里。</p></div>`;
    host.append(this.root);
    const fit = () => {
      this.root.dataset.compact = String(host.clientWidth <= 900 || host.clientHeight <= 650);
      this.root.style.setProperty('--queue-height', `${host.clientHeight}px`);
    };
    this.resize = new ResizeObserver(fit); this.resize.observe(host); fit();
    this.root.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
      const key = button.dataset.queueKey;
      switch (button.dataset.queueAction) {
        case 'back': actions.back(); break;
        case 'source': actions.source(); break;
        case 'locate': actions.locate(); break;
        case 'list': this.expanded = !this.expanded; this.syncDrawer(); break;
        case 'more': this.limit += 100; this.signature = ''; if (this.latest) this.update(...this.latest); break;
        case 'play': if (key) actions.play(key); break;
        case 'remove': if (key) actions.remove(key); break;
        case 'up': if (key) actions.move(key, -1); break;
        case 'down': if (key) actions.move(key, 1); break;
      }
    }, { signal: this.events.signal });
  }
  private latest?: [MusicPlayerState, boolean, PlaybackOrigin | undefined];
  update(state: MusicPlayerState, visible: boolean, origin?: PlaybackOrigin) {
    this.latest = [state, visible, origin]; this.root.hidden = !visible;
    const currentKey = queueEntryKey(state.currentTrack);
    const signature = JSON.stringify([state.queue.map(track => [queueEntryKey(track), track.title, track.artist]), currentKey, state.playing, state.playbackMode, origin?.name, this.limit]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.root.querySelector('[data-queue-count]')!.textContent = `${origin?.type === 'playlist' ? '已载入 ' : ''}${state.queue.length} 首`;
    this.root.querySelector<HTMLButtonElement>('[data-queue-action="locate"]')!.disabled = !state.currentTrack;
    const mode = state.playbackMode === 'shuffle' ? '随机播放 · 手动安排的歌曲优先，其余歌曲随机选择' : state.playbackMode === 'repeat-one' ? '单曲循环 · 临时插播结束后恢复当前循环歌曲' : '顺序播放 · 按当前播放列表继续';
    this.root.querySelector('.queue-mode-note')!.textContent = mode + (origin?.type === 'playlist' ? ' · 原歌单按需续载' : '');
    const list = this.root.querySelector('ol')!, scroll = this.root.querySelector('.queue-drawer')!.scrollTop;
    const active = document.activeElement as HTMLButtonElement | null;
    const focus = active?.closest('.queue-drawer') ? [active.dataset.queueKey, active.dataset.queueAction] : undefined;
    list.innerHTML = state.queue.slice(0, this.limit).map((track, index) => this.row(track, index, state)).join('');
    this.root.querySelector<HTMLElement>('.queue-empty')!.hidden = state.queue.length > 0;
    this.root.querySelector<HTMLElement>('[data-queue-action="more"]')!.hidden = state.queue.length <= this.limit;
    this.root.querySelector('.queue-drawer')!.scrollTop = scroll;
    if (focus) [...list.querySelectorAll<HTMLButtonElement>('button')].find(button => button.dataset.queueKey === focus[0] && button.dataset.queueAction === focus[1])?.focus({ preventScroll: true });
    this.syncDrawer();
  }
  private row(track: MusicTrack, index: number, state: MusicPlayerState) {
    const key = queueEntryKey(track), current = key === queueEntryKey(state.currentTrack), future = index > state.currentIndex;
    const button = (action: string, label: string, icon: string, disabled = false) => `<button type="button" data-queue-action="${action}" data-queue-key="${esc(key)}" aria-label="${label} ${esc(track.title)}" ${disabled ? 'disabled' : ''}>${icon}</button>`;
    return `<li data-queue-entry="${esc(key)}" ${current ? 'aria-current="true"' : ''}><button type="button" data-queue-action="play" data-queue-key="${esc(key)}" class="queue-track"><span class="queue-row-number">${current ? state.playing ? '▶' : 'Ⅱ' : index + 1}</span><span><strong>${esc(track.title)}</strong><small>${esc(track.artist)} · ${track.queueEntry?.replacement ? '搜索替换' : track.queueEntry ? '临时插播' : '原播放来源'}</small></span></button><div class="queue-row-actions">${button('up','上移','↑',!future || index <= state.currentIndex + 1)}${button('down','下移','↓',!future || index === state.queue.length - 1)}${button('remove','移出队列','×',current)}</div></li>`;
  }
  private syncDrawer() {
    this.root.querySelector<HTMLElement>('.queue-drawer')!.hidden = !this.expanded;
    this.root.querySelector('[data-queue-action="list"]')!.setAttribute('aria-expanded', String(this.expanded));
  }
  dispose() { this.events.abort(); this.resize.disconnect(); this.root.remove(); this.latest = undefined; }
}
