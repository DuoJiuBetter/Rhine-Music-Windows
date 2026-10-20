import type { MusicTrack, OnlineSearchResults } from "./music-types";
import { escapeHtml as esc } from "./html";
import "./online-music-search.css";
import { NeteaseLogin } from './netease-login';
import { musicPlatforms } from './music-platform';
import { fetchOnline } from './online-debug';
import { songActionButton, songActionIcons } from './music-song-actions';

export class OnlineMusicSearch {
  get modelSource() { return { tracks: this.results?.tracks ?? [], name: this.query, provider: this.login.provider }; }
  private controller?: AbortController;
  private generation = 0;
  private results?: OnlineSearchResults;
  private query = "";
  private offset = 0;
  private container?: HTMLElement;
  private playback: { id?: string; playing: boolean; loading: boolean } = { playing: false, loading: false };
  constructor(private play: (track: MusicTrack, queue: MusicTrack[]) => void, private login = new NeteaseLogin(), private addToPlaylist?: (track: MusicTrack) => void, private playNext?: (track: MusicTrack) => void) {}
  setLogin(login: NeteaseLogin) {
    if (this.login === login) return;
    this.dispose(); this.login = login; this.results = undefined; this.query = ''; this.offset = 0;
  }
  clear() {
    this.controller?.abort(); this.generation++; this.results = undefined; this.query = ''; this.offset = 0;
    if (this.container?.isConnected) {
      this.container.removeAttribute('aria-busy');
      this.container.querySelector<HTMLElement>('.online-search-status')!.textContent = '';
      this.container.querySelector<HTMLInputElement>('#online-search')!.value = '';
      this.render();
    }
  }
  setPlayback(id: string | undefined, playing: boolean, loading: boolean, force = false) {
    if (!force && this.playback.id === id && this.playback.playing === playing && this.playback.loading === loading) return;
    this.playback = { id, playing, loading };
    this.container?.querySelectorAll<HTMLButtonElement>('[data-online-track]').forEach(button => {
      const active = button.dataset.onlineTrack === id;
      button.setAttribute('aria-pressed', String(active && playing));
      const kind = active && loading ? 'loading' : active && playing ? 'pause' : 'play';
      const icon = button.querySelector<HTMLElement>('i');
      if (icon) { icon.innerHTML = songActionIcons[kind]; icon.dataset.songActionIcon = kind; }
      const track = this.results?.tracks.find(track => track.id === button.dataset.onlineTrack);
      if (track) button.setAttribute('aria-label', `${active && playing ? '暂停' : '播放'} ${track.title}，${track.artist}`);
    });
  }
  dispose() { this.controller?.abort(); this.login.dispose(); this.generation++; this.container = undefined; }
  mount(container: HTMLElement) {
    this.dispose(); this.container = container;
    container.innerHTML = `<form class="online-search-form"><input id="online-search" class="album-search" type="search" maxlength="100" value="${esc(this.query)}" placeholder="搜索${musicPlatforms[this.login.provider]}歌曲、歌手或专辑…" aria-label="搜索${musicPlatforms[this.login.provider]}" required><button class="primary-button" type="submit">搜索 ↗</button></form><p class="online-search-status" role="status" aria-live="polite"></p><div class="online-search-results"></div><div class="online-search-pages"></div>`;
    container.insertAdjacentHTML('afterbegin', '<section class="netease-login"></section>');
    this.login.mount(container.querySelector<HTMLElement>('.netease-login')!);
    container.querySelector("form")!.addEventListener("submit", event => {
      event.preventDefault(); const keyword = container.querySelector<HTMLInputElement>("input")!.value.trim();
      if (keyword) void this.search(keyword, 0);
    });
    container.addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!button) return;
      if (button.dataset.onlinePage !== undefined) void this.search(this.query, Number(button.dataset.onlinePage));
      if (button.dataset.onlineRetry !== undefined) void this.search(this.query, this.offset);
      if (button.dataset.onlineAdd) {
        const track = this.results?.tracks.find(track => track.id === button.dataset.onlineAdd);
        if (track) this.addToPlaylist?.(track);
      }
      if (button.dataset.onlineNext) {
        const track = this.results?.tracks.find(track => track.id === button.dataset.onlineNext);
        if (track) this.playNext?.(track);
      }
      const playId = button.dataset.onlineTrack || button.dataset.onlineSelect;
      if (playId) {
        const track = this.results?.tracks.find(track => track.id === playId);
        if (track && this.results) this.play(track, this.results.tracks);
      }
    });
    this.render();
  }
  private render() {
    const container = this.container;
    if (!container?.isConnected) return;
    const results = container.querySelector<HTMLElement>(".online-search-results")!;
    const pages = container.querySelector<HTMLElement>(".online-search-pages")!;
    const status = container.querySelector<HTMLElement>(".online-search-status")!;
    if (!this.results) { results.innerHTML = '<div class="no-results"></div>'; pages.innerHTML = ""; return; }
    const value = this.results;
    status.textContent = `找到 ${value.total} 首歌曲 · 第 ${value.offset / value.limit + 1} 页`;
    results.innerHTML = value.tracks.length ? value.tracks.map(track => {
      const source = track.onlineSource!;
      const cover = source.coverUrl ? `<img src="${esc(source.coverUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span aria-hidden="true">♪</span>';
      return `<div class="online-song"><div class="online-song-row"><button type="button" class="album-result" data-online-select="${esc(track.id)}" aria-label="选择并播放 ${esc(track.title)}"><span class="result-cover">${cover}</span><span class="result-copy"><strong>${esc(track.title)}</strong><small>${esc(track.artist)} · ${esc(source.albumTitle)}</small></span><em>${source.fee === 1 || source.fee === 4 ? "付费/试听" : "在线"}</em></button><div class="row-song-actions" role="group" aria-label="${esc(track.title)}的操作">${songActionButton('play', `播放 ${track.title}，${track.artist}`, { 'data-online-track': track.id })}${this.playNext ? songActionButton('next', `下一首播放 ${track.title}`, { 'data-online-next': track.id }) : ''}${this.addToPlaylist ? songActionButton('add', `将 ${track.title} 添加到歌单`, { 'data-online-add': track.id }) : ''}</div></div></div>`;
    }).join("") : '<div class="no-results">没有找到歌曲。</div>';
    pages.innerHTML = `${value.offset ? `<button data-online-page="${value.offset - value.limit}">← 上一页</button>` : ""}${value.hasMore && value.offset < 1000 ? `<button data-online-page="${value.offset + value.limit}">下一页 →</button>` : ""}`;
    this.setPlayback(this.playback.id, this.playback.playing, this.playback.loading, true);
  }
  private async search(query: string, offset: number) {
    this.controller?.abort(); const controller = this.controller = new AbortController();
    const generation = ++this.generation; this.query = query; this.offset = offset;
    const container = this.container; if (!container) return;
    const status = container.querySelector<HTMLElement>(".online-search-status")!;
    status.textContent = `正在搜索${musicPlatforms[this.login.provider]}…`; container.setAttribute("aria-busy", "true");
    container.querySelectorAll<HTMLButtonElement>("[data-online-page], [data-online-track], [data-online-select], [data-online-next], [data-online-add]").forEach(button => button.disabled = true);
    try {
      const response = await fetchOnline(this.login.provider, 'search', `/api/online/${this.login.provider}/search?q=${encodeURIComponent(query)}&offset=${offset}`, { signal: controller.signal });
      const value = await response.json() as OnlineSearchResults & { error?: string };
      if (controller.signal.aborted || generation !== this.generation || !container.isConnected) return;
      if (!response.ok) throw new Error(value.error || `${musicPlatforms[this.login.provider]}搜索暂时不可用。`);
      if (value.provider !== this.login.provider) throw new Error('搜索平台已变化，请重新搜索。');
      this.results = value; this.render();
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation || !container.isConnected) return;
      this.results = undefined;
      status.textContent = error instanceof Error ? error.message : "搜索失败，请检查网络后重试。";
      container.querySelector(".online-search-results")!.innerHTML = '<div class="no-results"><button class="text-button" data-online-retry>重新搜索 ↻</button></div>';
      container.querySelector(".online-search-pages")!.innerHTML = "";
    } finally {
      if (generation === this.generation && container.isConnected) container.removeAttribute("aria-busy");
    }
  }
}
