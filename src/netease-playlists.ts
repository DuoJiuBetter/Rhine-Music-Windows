import type { MusicAlbum, MusicTrack, NeteasePlaylist } from './music-types';
import { playbackAlbums } from './playback-albums.ts';
import { MUSIC_LOOP_ROWS, wrap } from './archive-loop.ts';
import { musicPlatforms, type MusicProvider } from './music-platform.ts';
import { fetchOnline } from './online-debug.ts';
export class NeteasePlaylists {
  playlists: NeteasePlaylist[] = [];
  loading = false;
  error = '';
  revision = 0;
  private generation = 0;
  private controller = new AbortController();
  private pages = new Map<string, (MusicTrack | null)[]>();
  private albumsRevision = -1;
  private albumsView: MusicAlbum[] = [];
  private albumCache = new Map<string, { track: MusicTrack | null; album: MusicAlbum }>();
  private pending = new Map<string, Promise<void>>();
  private jobs: { key: string; start: () => void }[] = [];
  private active = 0;
  private windowEpoch = 0;
  private titlePrefetchEpoch = 0;
  private titlePrefetchKey = '';
  private changed: () => void;
  provider: MusicProvider = 'netease';
  constructor(changed: () => void) { this.changed = changed; }
  setProvider(provider: MusicProvider) { if (provider !== this.provider) { this.dispose(); this.provider = provider; } }
  private async request<T>(url: string): Promise<T> {
    const response = await fetchOnline(this.provider, url.includes('/tracks?') ? 'playlistTracks' : 'playlists', url, { signal: this.controller.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `${musicPlatforms[this.provider]}歌单暂时不可用。`);
    return body;
  }
  dispose() {
    this.generation++; this.windowEpoch++; this.titlePrefetchEpoch++; this.titlePrefetchKey = ''; this.controller.abort(); this.controller = new AbortController();
    // Queued jobs still run their cancellation checks and settle callers.
    this.pages.clear(); this.pending.clear(); this.playlists = []; this.loading = false; this.error = ''; this.revision++;
    this.albumsRevision = -1; this.albumsView = []; this.albumCache.clear();
  }
  async load() {
    this.dispose(); const generation = this.generation;
    this.loading = true; this.changed();
    try {
      const playlists: NeteasePlaylist[] = [];
      for (let offset = 0; offset <= 5000; offset += 100) {
        const page = await this.request<{ playlists: NeteasePlaylist[]; hasMore: boolean }>(`/api/online/${this.provider}/playlists?offset=${offset}`);
        if (generation !== this.generation) return;
        playlists.push(...page.playlists);
        if (!page.hasMore) break;
        if (offset === 5000) this.error = '当前显示前 5100 个歌单。';
      }
      this.playlists = [...new Map(playlists.map(item => [item.id, item])).values()]; this.revision++;
      this.changed();
      if (this.playlists.length) await this.ensure(0, 0);
    } catch (failure) { if (generation === this.generation && !this.controller.signal.aborted) this.error = (failure as Error).message; }
    finally { if (generation === this.generation) { this.loading = false; this.changed(); } }
  }
  private run(task: () => Promise<void>, key: string, priority: boolean) {
    return new Promise<void>((resolve, reject) => {
      const start = () => {
        this.active++;
        void task().then(resolve, reject).finally(() => { this.active--; this.jobs.shift()?.start(); });
      };
      if (this.active < 2) start(); else if (priority) this.jobs.unshift({ key, start }); else this.jobs.push({ key, start });
    });
  }
  async ensure(row: number, song: number, priority = false) {
    const playlist = this.playlists[row]; if (!playlist || !playlist.trackCount) return;
    const offset = Math.floor(Math.max(0, Math.min(playlist.trackCount - 1, song)) / 50) * 50;
    const key = `${playlist.id}:${offset}`, cached = this.pages.get(key);
    if (cached) { this.pages.delete(key); this.pages.set(key, cached); return; }
    if (this.pending.has(key)) {
      if (priority) {
        const index = this.jobs.findIndex(job => job.key === key);
        if (index > 0) this.jobs.unshift(this.jobs.splice(index, 1)[0]);
      }
      return this.pending.get(key);
    }
    const generation = this.generation;
    const operation = this.run(async () => {
      if (generation !== this.generation) return;
      const page = await this.request<{ tracks: (MusicTrack | null)[]; total: number }>(`/api/online/${this.provider}/playlists/${playlist.id}/tracks?offset=${offset}`);
      if (generation !== this.generation) return;
      playlist.trackCount = page.total; this.pages.set(key, page.tracks);
      while (this.pages.size > 96) this.pages.delete(this.pages.keys().next().value!);
      this.error = ''; this.revision++; this.changed();
    }, key, priority).finally(() => { if (generation === this.generation) this.pending.delete(key); });
    this.pending.set(key, operation); return operation;
  }
  async window(row: number, song: number) {
    const generation = this.generation, windowEpoch = ++this.windowEpoch;
    if (!this.playlists.length) return;
    // Resolve the chosen song before speculative neighbouring playlists.
    try { await this.ensure(row, wrap(song, Math.max(1, this.playlists[row]?.trackCount || 0)), true); }
    catch (failure) { if (generation === this.generation) { this.error = (failure as Error).message; this.changed(); } return; }
    if (generation !== this.generation || windowEpoch !== this.windowEpoch) return;
    const nearby = [...new Set([0,-1,1,-2,2,-3,3,-4,4].map(offset => wrap(row + offset, this.playlists.length)))];
    let cursor = 0;
    const worker = async () => {
      while (cursor < nearby.length && generation === this.generation && windowEpoch === this.windowEpoch) {
        const playlist = nearby[cursor++], total = this.playlists[playlist].trackCount;
        // Keep one extra metadata page ahead/behind the selected shelf. Near
        // the loop seam, rank by circular distance so visible pages arrive
        // before speculative ones. Neighbouring shelves retain the old size.
        const radius = MUSIC_LOOP_ROWS / 2 + (playlist === row ? 50 : 0);
        const distances = new Map<number, number>();
        for (let delta = -radius; delta <= radius; delta++) {
          const offset = Math.floor(wrap(song + delta, Math.max(1, total)) / 50) * 50;
          distances.set(offset, Math.min(distances.get(offset) ?? Infinity, Math.abs(delta)));
        }
        const positions = [...distances.keys()].sort((a, b) => distances.get(a)! - distances.get(b)!);
        for (const position of positions) {
          if (generation !== this.generation || windowEpoch !== this.windowEpoch) return;
          await this.ensure(playlist, position);
        }
      }
    };
    const results = await Promise.allSettled([worker(), worker()]);
    if (generation !== this.generation) return;
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') { this.error = failed.reason.message; this.changed(); }
  }
  track(row: number, song: number) {
    const playlist = this.playlists[row]; if (!playlist) return undefined;
    return this.pages.get(`${playlist.id}:${Math.floor(song / 50) * 50}`)?.[song % 50];
  }
  position(row: number, trackId: string) {
    const id = this.playlists[row]?.id;
    if (!id) return undefined;
    for (const [key, tracks] of this.pages) {
      const [playlist, offset] = key.split(':');
      if (playlist !== id) continue;
      const index = tracks.findIndex(track => track?.id === trackId);
      if (index >= 0) return Number(offset) + index;
    }
    return undefined;
  }
  /** Warm the visible title bar plus one neighbouring page on either side.
   * One worker, two shared HTTP slots, page de-duplication and account epochs. */
  prefetchTitles(row: number, first: number, last: number) {
    const playlist = this.playlists[row]; if (!playlist?.trackCount) return;
    const start = Math.max(0, Math.floor(first / 50) * 50 - 50);
    const end = Math.min(playlist.trackCount - 1, Math.floor(last / 50) * 50 + 50);
    const key = `${playlist.id}:${start}:${end}`;
    if (this.titlePrefetchKey === key) return;
    this.titlePrefetchKey = key;
    const epoch = ++this.titlePrefetchEpoch, generation = this.generation;
    const positions = [Math.floor(Math.max(0, first) / 50) * 50];
    for (let offset = start; offset <= end; offset += 50) if (!positions.includes(offset)) positions.push(offset);
    void (async () => {
      try {
        for (const offset of positions) {
          if (generation !== this.generation || epoch !== this.titlePrefetchEpoch) return;
          // Rapid scrolling may replace a worker while its prior page is still
          // queued. Cap speculative admission; hover/selection can still ask
          // for their page with foreground priority.
          const pageKey = `${playlist.id}:${offset}`;
          if (this.pending.size >= 8 && !this.pending.has(pageKey) && !this.pages.has(pageKey)) {
            this.titlePrefetchKey = ''; return;
          }
          await this.ensure(row, offset, true);
        }
      } catch {
        // Hover can retry a failed page; a speculative failure never overwrites
        // the current playback status or becomes an unhandled rejection.
        if (generation === this.generation && epoch === this.titlePrefetchEpoch) this.titlePrefetchKey = '';
      }
    })();
  }
  /** Resolve against the full playlist, not the current three-page audio window. */
  async playbackStep(row: number, currentId: string, direction: number, mode: 'sequential' | 'shuffle', previous?: number) {
    const playlist = this.playlists[row], song = this.position(row, currentId);
    if (!playlist || song === undefined || !playlist.trackCount) return;
    let target = wrap(song + direction, playlist.trackCount);
    if (mode === 'shuffle') {
      if (direction < 0 && previous !== undefined && previous >= 0 && previous < playlist.trackCount) target = previous;
      else if (playlist.trackCount > 1) target = wrap(song + 1 + Math.floor(Math.random() * (playlist.trackCount - 1)), playlist.trackCount);
    }
    const generation = this.generation;
    const queue = await this.queue(row, target);
    if (generation !== this.generation) throw new DOMException('歌单已改变', 'AbortError');
    const track = this.track(row, target);
    if (!track) throw new Error('暂时无法读取这首歌曲，请稍后重试。');
    return { id: track.id, queue, position: target };
  }

  async queue(row: number, song: number) {
    const playlist = this.playlists[row]; if (!playlist) return [];
    const offset = Math.floor(song / 50) * 50;
    await Promise.all([Math.max(0, offset - 50), offset, offset + 50].filter((value, index, all) => value < playlist.trackCount && all.indexOf(value) === index).map(index => this.ensure(row, index)));
    return Array.from({ length: Math.min(playlist.trackCount, offset + 100) - Math.max(0, offset - 50) }, (_, index) => this.track(row, Math.max(0, offset - 50) + index)).filter((track): track is MusicTrack => !!track);
  }
  albums(): MusicAlbum[] {
    if (this.albumsRevision === this.revision) return this.albumsView;
    const grouped = new Map<string, { song: number; track: MusicTrack | null }[]>();
    for (const [key, tracks] of this.pages) {
      const [id, start] = key.split(':'), loaded = grouped.get(id) || [];
      const offset = Number(start);
      tracks.forEach((track, index) => loaded.push({ song: offset + index, track }));
      grouped.set(id, loaded);
    }
    const nextCache = new Map<string, { track: MusicTrack | null; album: MusicAlbum }>();
    this.albumsView = this.playlists.flatMap((playlist, row) => {
      const loaded = grouped.get(playlist.id) || [];
      if (!loaded.length) loaded.push({ song: 0, track: null });
      return loaded.sort((a, b) => a.song - b.song).map(({ song, track }) => {
        const id = `playlist-${this.provider}-${playlist.id}-${song}`, cached = this.albumCache.get(id);
        const cell = cached?.album.playlistCell;
        if (cached && cached.track === track && cell?.total === playlist.trackCount &&
          cell.playlistIndex === row && cell.playlistName === playlist.name) {
          nextCache.set(id, cached); return cached.album;
        }
        const album: MusicAlbum = track ? playbackAlbums([track], [])[0] : { id: '', title: playlist.name, artist: musicPlatforms[this.provider], genreId: '', rawGenres: [], folder: '', tracks: [], producers: [], offline: false };
        delete album.playback;
        const prepared = { ...album, id, title: track?.title || playlist.name,
          genreId: `playlist-${playlist.id}`, folder: `${musicPlatforms[this.provider]} · ${playlist.name}`,
          playlistCell: { playlistId: playlist.id, playlistName: playlist.name, playlistIndex: row, songIndex: song, total: playlist.trackCount } };
        nextCache.set(id, { track, album: prepared }); return prepared;
      });
    });
    // Evicted pages and old accounts never remain in the prepared view cache.
    this.albumCache = nextCache; this.albumsRevision = this.revision;
    return this.albumsView;
  }
}
