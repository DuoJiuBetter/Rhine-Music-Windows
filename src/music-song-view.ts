import { musicPlatforms } from './music-platform';
import { fetchOnline } from './online-debug';
import type { MusicAlbum, MusicTrack, OnlineSongInfo } from './music-types';
import type { MusicPlayerState } from './music-player';
import { escapeHtml as esc } from './html';
import { parseLyrics, lyricIndex, untimedLyrics, type LyricLine } from './music-lyrics';
import { SongTextReveal } from './song-text-reveal';
import { MusicLyricScroll } from './music-lyric-scroll';

const clock = (value: number) => {
  const seconds = Math.floor(Number.isFinite(value) ? Math.max(0, value) : 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const play = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>';
const pause = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14m6-14v14"/></svg>';
const previousArrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg>';
const nextArrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';

export const orderIcons = {
  sequential: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10V9A3.5 3.5 0 0 1 7 5.5h12.5M17 3l2.5 2.5L17 8M20.5 14v1a3.5 3.5 0 0 1-3.5 3.5H4.5M7 16l-2.5 2.5L7 21"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 6-6s4-6 6-6h3m-4-4 4 4-4 4"/></svg>',
  'repeat-one': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10V9A3.5 3.5 0 0 1 7 5.5h12.5M17 3l2.5 2.5L17 8M20.5 14v1a3.5 3.5 0 0 1-3.5 3.5H4.5M7 16l-2.5 2.5L7 21"/><path class="repeat-one-digit" d="m10.6 10.4 1.8-1v5.2m-1.8 0h3.2"/></svg>',
};

export const songViewTabsMarkup = (together = false) => `<nav class="song-view-tabs" role="tablist" aria-label="歌曲内容"><button type="button" role="tab" id="song-tab-info" data-song-view-tab="info" aria-controls="song-info" aria-selected="false" tabindex="-1">歌曲详情</button><button type="button" role="tab" id="song-tab-lyrics" data-song-view-tab="lyrics" aria-controls="song-lyric-view" aria-selected="true" tabindex="0">歌词列表</button>${together ? '<button type="button" role="tab" id="song-tab-together" data-song-view-tab="together" aria-controls="song-together-view" aria-selected="false" tabindex="-1">一起听</button>' : ''}</nav>`;

type CachedSong = { info?: OnlineSongInfo; error?: string; at: number; lyricAt: number; lines: LyricLine[] };

/** DOM and lyric timing only. Audio, queue ownership and seeking stay with MusicPlayer. */
export class MusicSongView {
  private cache = new Map<string, CachedSong>();
  private pending = new Map<string, AbortController>();
  private epoch = 0;
  private disposed = false;
  private detailTrack?: MusicTrack;
  private state?: MusicPlayerState;
  private detailActive = false;
  private paintedInfo?: CachedSong;
  private paintedRoot?: HTMLElement;
  private lyricKey = '';
  private lyricNode?: HTMLElement;
  private lyricEvents?: AbortController;
  private manualLyricsUntil = 0;
  private lyricScroll?: MusicLyricScroll;
  private visible = false;
  private drag?: { input: HTMLInputElement; trackId: string };
  private reveal = new SongTextReveal();
  private lastReduced = false;
  private tab: "info" | "lyrics" | "together" = "lyrics";
  private viewEvents?: AbortController;

  constructor(private mini: HTMLElement, private seek: (seconds: number) => void, private reduced: () => boolean = () => false, private onTab?: (tab: string) => void) {}

  markup(album: MusicAlbum) {
    const track = album.tracks[0];
    if (!track) return '';
    const togetherEnabled = track.onlineSource?.provider === 'netease' && import.meta.env.VITE_PUBLIC_RELEASE !== '1';
    return `<section id="song-view" data-song="${esc(track.id)}" data-lyrics-active="true">
      ${songViewTabsMarkup(togetherEnabled)}
      <div class="song-view-heading"><button type="button" data-action="song-toggle-stop" id="song-toggle-stop">${play}<span data-song-reveal>开始播放</span></button><div class="song-step-buttons"><button type="button" data-action="playing-prev" aria-label="上一首">${previousArrow}<span data-song-reveal>上一首</span></button><button type="button" data-action="playing-next" aria-label="下一首"><span data-song-reveal>下一首</span>${nextArrow}</button></div></div>
      <section id="song-info" role="tabpanel" aria-labelledby="song-tab-info" hidden>${track.onlineSource ? '<button type="button" class="text-button" data-action="song-add-playlist">＋ 添加到歌单</button>' : ''}<dl id="song-facts"></dl><p id="song-description" data-song-reveal></p><p id="song-metadata-error" data-song-reveal role="status"></p></section>
      <section id="song-lyric-view" role="tabpanel" aria-labelledby="song-tab-lyrics"><div class="lyric-window"><div id="song-lyrics" role="region" aria-label="同步歌词" tabindex="0"></div></div>
        <div class="lyric-transport">
          <div class="lyric-order-row"><button type="button" class="lyric-playback-mode" data-action="cycle-playback-mode" aria-label="顺序播放" title="顺序播放">${orderIcons.sequential}</button>${track.onlineSource ? '<button type="button" class="song-add-playlist" data-action="song-add-playlist" aria-label="添加到歌单"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg></button>' : ''}</div>
          <input class="playback-seek" type="range" min="0" max="1" value="0" step="0.1" aria-label="歌曲播放进度" disabled><div class="song-time"><span data-elapsed data-song-reveal>0:00</span><span data-duration data-song-reveal>${clock(track.duration)}</span></div>
        </div></section>${togetherEnabled ? '<section id="song-together-view" role="tabpanel" aria-labelledby="song-tab-together" hidden></section>' : ''}<p id="song-view-error" data-song-reveal role="status"></p></section>`;
  }

  mount(album: MusicAlbum, state: MusicPlayerState, detailActive: boolean) {
    this.reveal.reset();
    this.viewEvents?.abort(); this.viewEvents = new AbortController(); if (this.tab !== "together") this.tab = "lyrics";
    const tabs = document.querySelector<HTMLElement>("#song-view .song-view-tabs");
    tabs?.addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-song-view-tab]");
      if (!button) return; event.stopPropagation(); this.selectTab(button.dataset.songViewTab as "info" | "lyrics" | "together");
    }, { signal: this.viewEvents.signal });
    tabs?.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const values = [...tabs.querySelectorAll<HTMLButtonElement>('[data-song-view-tab]')].map(item => item.dataset.songViewTab!) as ("info" | "lyrics" | "together")[];
      const index = values.indexOf(this.tab); this.selectTab(values[event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + values.length) % values.length]);
      tabs.querySelector<HTMLButtonElement>(`[data-song-view-tab="${this.tab}"]`)?.focus();
    }, { signal: this.viewEvents.signal });
    this.lyricScroll?.dispose(); this.lyricScroll = undefined;
    this.lyricEvents?.abort(); this.lyricNode = undefined;
    this.detailTrack = album.tracks[0]; this.paintedInfo = undefined; this.lyricKey = '';
    this.update(state, detailActive);
  }

  selectTab(tab: "info" | "lyrics" | "together") {
    if (this.disposed || tab === this.tab) return;
    this.tab = tab; this.lyricKey = '';
    if (this.state) this.update(this.state, this.detailActive);
  }

  setVisible(visible: boolean) {
    if (visible && !this.visible) this.lyricKey = '';
    this.visible = visible;
    if (!visible) { this.lyricScroll?.stop(); this.onTab?.("hidden"); }
    this.reveal.setVisible(visible);
  }

  update(state: MusicPlayerState, detailActive: boolean) {
    if (this.disposed) return;
    const enteringDetail = detailActive && !this.detailActive;
    if (enteringDetail) this.tab = "lyrics";
    if (this.detailActive !== detailActive) this.lyricKey = '';
    if (this.drag && this.drag.trackId !== state.currentTrack?.id) this.drag = undefined;
    this.state = state; this.detailActive = detailActive;
    const active = !!state.currentTrack && !['idle', 'error'].includes(state.transport);
    const root = document.querySelector<HTMLElement>('#song-view');
    const detailTrack = this.detailTrack;
    if (root && detailTrack && detailTrack.id === root.dataset.song) {
      const selectedActive = active && state.currentTrack?.id === detailTrack.id &&
        (!detailTrack.queueEntry || state.currentTrack?.queueEntry?.id === detailTrack.queueEntry.id);
      const info = detailTrack.onlineSource ? this.cache.get(`${detailTrack.onlineSource.provider}:${detailTrack.onlineSource.id}`) : undefined;
      let revealChanged = root !== this.paintedRoot || info !== this.paintedInfo;
      if (revealChanged) { this.paintInfo(root, detailTrack, info); this.paintedInfo = info; this.paintedRoot = root; }
      const button = root.querySelector<HTMLButtonElement>('#song-toggle-stop')!;
      const pausable = selectedActive && (state.playing || state.loading);
      const label = pausable ? '暂停播放' : selectedActive ? '继续播放' : '开始播放';
      if (button.dataset.label !== label) { button.innerHTML = `${pausable ? pause : play}<span data-song-reveal>${label}</span>`; button.dataset.label = label; revealChanged = true; }
      button.setAttribute('aria-label', label);
      const order = root.querySelector<HTMLButtonElement>('.lyric-playback-mode')!;
      const orderMode = state.playbackMode;
      if (order.dataset.mode !== orderMode) {
        const orderLabel = {sequential: '顺序播放', shuffle: '随机播放', 'repeat-one': '单曲循环'}[orderMode];
        order.dataset.mode = orderMode; order.innerHTML = orderIcons[orderMode];
        order.setAttribute('aria-label', orderLabel); order.title = orderLabel;
      }
      if (this.tab === "together" && !root.querySelector('#song-together-view')) this.tab = "lyrics";
      const showLyrics = this.tab === "lyrics";
      const viewChanged = root.dataset.songTab !== this.tab;
      if (viewChanged) revealChanged = true;
      root.querySelector<HTMLElement>('#song-info')!.hidden = this.tab !== 'info';
      root.querySelector<HTMLElement>('#song-lyric-view')!.hidden = !showLyrics;
      const together = root.querySelector<HTMLElement>('#song-together-view'); if (together) together.hidden = this.tab !== 'together';
      if (viewChanged) { root.dataset.songTab = this.tab; this.onTab?.(this.tab); }
      if (root.dataset.lyricsActive !== String(showLyrics)) root.dataset.lyricsActive = String(showLyrics);
      for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-song-view-tab]')) {
        const selected = tab.dataset.songViewTab === this.tab;
        tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      }
      if (!showLyrics || !detailActive) this.lyricScroll?.stop();
      const error = root.querySelector<HTMLElement>('#song-view-error')!, errorText = state.currentTrack?.id === detailTrack.id ? state.error || state.transitionWarning || '' : '';
      if (error.textContent !== errorText) { error.textContent = errorText; revealChanged = true; }
      const lyricContent = root.querySelector<HTMLElement>('#song-lyrics')!.dataset.content;
      if (showLyrics && detailActive && !root.closest('[hidden]')) this.paintLyrics(root.querySelector('#song-lyrics')!, info, selectedActive ? state.currentTime : 0, detailTrack);
      if (revealChanged || enteringDetail || lyricContent !== root.querySelector<HTMLElement>('#song-lyrics')!.dataset.content || this.lastReduced !== this.reduced()) {
        this.lastReduced = this.reduced(); this.reveal.refresh(root, this.lastReduced, enteringDetail || viewChanged);
      }
      if (detailTrack.onlineSource) this.ensure(detailTrack);
    }
    this.mini.hidden = !active || detailActive;
    this.mini.dataset.song = state.currentTrack?.id || '';
    if (active && state.currentTrack) {
      const track = state.currentTrack, cached = track.onlineSource ? this.cache.get(`${track.onlineSource.provider}:${track.onlineSource.id}`) : undefined;
      const index = cached ? lyricIndex(cached.lines, state.currentTime) : -1;
      const line = index >= 0 ? cached!.lines[index].text : cached?.info?.lyrics.instrumental ? '纯音乐' : '';
      const node = this.mini.querySelector<HTMLElement>('[data-mini-lyric]')!;
      if (node.textContent !== line) node.textContent = line;
      if (track.onlineSource) this.ensure(track);
    }
    for (const input of document.querySelectorAll<HTMLInputElement>('.playback-seek')) {
      const owner = input.closest<HTMLElement>('[data-song]');
      const matching = active && owner?.dataset.song === state.currentTrack?.id;
      input.disabled = !matching || state.loading || !Number.isFinite(state.duration) || state.duration <= 0;
      const selectedDuration = owner?.id === "song-view" ? this.detailTrack?.duration ?? 0 : 0;
      input.max = String(matching ? Math.max(1, state.duration || state.currentTrack?.duration || 1) : Math.max(1, selectedDuration));
      if (!this.drag || this.drag.input !== input || this.drag.trackId !== state.currentTrack?.id) input.value = String(matching ? state.currentTime : 0);
      this.paintSeek(input);
      const group = input.parentElement!;
      const elapsed = group.querySelector<HTMLElement>('[data-elapsed]'), duration = group.querySelector<HTMLElement>('[data-duration]');
      if (elapsed) elapsed.textContent = clock(Number(input.value));
      if (duration) duration.textContent = clock(matching ? state.duration || state.currentTrack!.duration : selectedDuration);
    }
  }

  private paintSeek(input: HTMLInputElement) {
    const position = Math.max(0, Math.min(Number(input.max), Number(input.value)));
    input.style.setProperty('--progress', `${100 * position / Number(input.max)}%`);
    input.setAttribute('aria-valuetext', `${clock(position)} / ${clock(Number(input.max))}`);
  }
  previewSeek(input: HTMLInputElement) {
    const id = input.closest<HTMLElement>('[data-song]')?.dataset.song;
    if (!input.disabled && id && id === this.state?.currentTrack?.id) { this.drag = { input, trackId: id }; this.paintSeek(input); }
  }
  commitSeek(input: HTMLInputElement) {
    const id = input.closest<HTMLElement>('[data-song]')?.dataset.song;
    if (!input.disabled && id === this.state?.currentTrack?.id && (!this.drag || this.drag.trackId === id)) {
      const position = Math.min(this.state!.duration, Math.max(0, Number(input.value)));
      this.drag = undefined;
      if (Number.isFinite(position)) this.seek(position);
    } else this.drag = undefined;
  }
  cancelSeek() { this.drag = undefined; if (this.state) this.update(this.state, this.detailActive); }

  private paintInfo(root: HTMLElement, track: MusicTrack, cached?: CachedSong) {
    const info = cached?.info, source = track.onlineSource;
    const fields = [
      ['歌曲', info?.track.title || track.title], ['歌手', info?.track.artist || track.artist],
      ['专辑', info?.album.title || source?.albumTitle || '未提供'],
      ['发行日期', info?.album.published || (source?.publishTime ? new Date(source.publishTime).toISOString().slice(0, 10) : '未提供')],
      ['唱片公司', info?.album.company || '未提供'], ['时长', clock(info?.track.duration || track.duration)],
      ['来源', source ? musicPlatforms[source.provider] : "本地音乐"],
    ];
    root.querySelector('#song-facts')!.innerHTML = fields.map(([label, value]) => `<div><dt><span data-song-reveal>${esc(label)}</span></dt><dd><span data-song-reveal>${esc(value)}</span></dd></div>`).join('');
    root.querySelector('#song-description')!.textContent = info?.album.description || '';
    const error = root.querySelector<HTMLElement>('#song-metadata-error')!;
    error.textContent = cached?.error || info?.metadataError || '';
  }
  private paintLyrics(node: HTMLElement, cached: CachedSong | undefined, time: number, track: MusicTrack) {
    if (this.lyricNode !== node) {
      this.lyricScroll?.dispose();
      this.lyricEvents?.abort(); this.lyricEvents = new AbortController(); this.lyricNode = node;
      this.manualLyricsUntil = 0; this.lyricKey = '';
      this.lyricScroll = new MusicLyricScroll(node, this.reduced, () => { this.manualLyricsUntil = Date.now() + 8000; });
      node.addEventListener('click', event => {
        const line = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-lyric-time]');
        const state = this.state;
        if (!line || !node.contains(line) || state?.currentTrack?.id !== track.id || state.loading || ['idle', 'error'].includes(state.transport) || !(state.duration > 0)) return;
        const seconds = Number(line.dataset.lyricTime);
        if (!Number.isFinite(seconds)) return;
        this.manualLyricsUntil = 0; this.lyricKey = ''; this.seek(Math.min(state.duration, Math.max(0, seconds)));
      }, { signal: this.lyricEvents.signal });
    }
    const index = cached ? lyricIndex(cached.lines, time) : -1;
    const content = `${track.id}:${cached?.lyricAt || 0}`, key = `${content}:${index}`;
    const resume = this.manualLyricsUntil > 0 && Date.now() >= this.manualLyricsUntil;
    if (resume) this.manualLyricsUntil = 0;
    if (key === this.lyricKey && !resume && node.dataset.content === content) return;
    this.lyricKey = key;
    if (cached?.lines.length) {
      const newContent = node.dataset.content !== content;
      node.classList.remove('lyrics-untimed');
      // A bounded (parser limit: 4,000 lines) lyric document is built once per song.
      // Playback changes two classes; it never replaces the scrolling document.
      if (node.dataset.content !== content) {
        this.lyricScroll?.stop(); node.scrollTop = 0;
        node.innerHTML = cached.lines.map((line, position) => `<button type="button" class="lyric-line" data-lyric-index="${position}" data-lyric-time="${line.time}"><span data-song-reveal="entry">${esc(line.text)}</span>${line.translation ? `<small data-song-reveal="entry">${esc(line.translation)}</small>` : ''}</button>`).join('');
        node.dataset.content = content; this.manualLyricsUntil = 0;
      }
      const previous = node.querySelector<HTMLElement>('.current');
      const current = index < 0 ? null : node.children[index] as HTMLElement;
      if (previous !== current) {
        previous?.classList.remove('current'); previous?.removeAttribute('aria-current');
        current?.classList.add('current'); current?.setAttribute('aria-current', 'true');
      }
      if (current && !this.manualLyricsUntil) this.lyricScroll?.follow(current, newContent);
      return;
    }
    const lyric = cached?.info?.lyrics;
    const text = lyric?.instrumental ? '纯音乐' : lyric?.error || cached?.error ||
      (lyric?.original ? untimedLyrics(lyric.original) || '暂无歌词' : cached ? '暂无歌词' : track.onlineSource ? '正在读取歌词…' : '暂无歌词');
    if (node.dataset.content !== content) {
      this.lyricScroll?.stop(); node.scrollTop = 0;
      node.innerHTML = text.split(/\r?\n/).slice(0, 4000).map(line => `<p data-song-reveal="entry">${esc(line) || ' '}</p>`).join('');
      node.dataset.content = content;
    }
    node.classList.toggle('lyrics-untimed', true);
  }
  private ensure(track: MusicTrack) {
    const source = track.onlineSource; if (!source || this.disposed) return;
    const id = `${source.provider}:${source.id}`;
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.at < (cached.error || cached.info?.lyrics.error || cached.info?.metadataError ? 30000 : 300000)) return;
    if (this.pending.has(id)) return;
    const wanted = new Set([this.detailTrack, this.state?.currentTrack].filter(item => item?.onlineSource).map(item => `${item!.onlineSource!.provider}:${item!.onlineSource!.id}`));
    for (const [other, controller] of this.pending) if (!wanted.has(other)) { controller.abort(); this.pending.delete(other); }
    if (this.pending.size >= 2) return;
    const epoch = this.epoch, controller = new AbortController(); this.pending.set(id, controller);
    void (async () => {
      try {
        const response = await fetchOnline(source.provider, 'songInfo', `/api/online/${source.provider}/songs/${encodeURIComponent(source.id)}/info`, { signal: controller.signal });
        const info = await response.json();
        if (!response.ok) throw new Error(info.error || '歌曲资料暂时不可用。');
        if (epoch !== this.epoch || controller.signal.aborted || this.disposed) return;
        const previous = this.cache.get(id), lyrics = info.lyrics, prior = previous?.info?.lyrics;
        const sameLyrics = prior && prior.original === lyrics.original && prior.translated === lyrics.translated && prior.instrumental === lyrics.instrumental && prior.error === lyrics.error;
        const now = Date.now();
        // A metadata TTL refresh must not rebuild the same lyric document or
        // replay its entry masks while the user is listening / scrolling.
        this.cache.delete(id); this.cache.set(id, { info, at: now, lyricAt: sameLyrics ? previous!.lyricAt : now,
          lines: sameLyrics ? previous!.lines : lyrics.instrumental ? [] : parseLyrics(lyrics.original, lyrics.translated) });
      } catch (error) {
        if (epoch !== this.epoch || controller.signal.aborted || this.disposed) return;
        const message = (error as Error).message, previous = this.cache.get(id), now = Date.now();
        this.cache.set(id, { error: message, at: now, lyricAt: previous?.error === message ? previous.lyricAt : now, lines: [] });
      } finally {
        if (this.pending.get(id) === controller) this.pending.delete(id);
        while (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value!);
        if (epoch === this.epoch && !this.disposed && this.state) this.update(this.state, this.detailActive);
      }
    })();
  }
  /** Read existing lyrics for a non-playing settings preview; never starts a request. */
  lyricPreview() {
    const track = this.state?.currentTrack ?? this.detailTrack;
    const source = track?.onlineSource;
    const cached = source ? this.cache.get(`${source.provider}:${source.id}`) : undefined;
    const lines = cached?.lines ?? [];
    return { title: track?.title ?? '歌词示例', artist: track?.artist ?? '',
      lines, current: Math.max(0, lyricIndex(lines, this.state?.currentTime ?? 0)),
      time: this.state?.currentTime ?? 0, duration: this.state?.duration ?? 180 };
  }

  invalidate() {
    this.viewEvents?.abort(); this.viewEvents = undefined;
    this.reveal.reset();
    this.lyricScroll?.dispose(); this.lyricScroll = undefined;
    this.epoch++; for (const controller of this.pending.values()) controller.abort();
    this.pending.clear(); this.cache.clear(); this.lyricKey = ''; this.paintedInfo = undefined; this.detailTrack = undefined;
    this.lyricEvents?.abort(); this.lyricEvents = undefined; this.lyricNode = undefined; this.manualLyricsUntil = 0;
  }
  dispose() { this.disposed = true; this.invalidate(); }
}
