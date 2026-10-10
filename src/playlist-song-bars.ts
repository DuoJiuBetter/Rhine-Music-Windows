import { musicWheelDelta, MusicWheelSteps } from './music-wheel-navigation';

type SongBarsOptions = {
  enabled: () => boolean;
  select: (song: number) => void;
  step: (direction: number) => void;
  title: (playlistId: string, song: number) => Promise<string>;
  cachedTitle?: (playlistId: string, song: number) => string | undefined;
  prefetch?: (playlistId: string, first: number, last: number) => void;
};
const BAR_POOL_SIZE = 32;
const OVERSCAN = 4;

/** Every song has a distinct position; only the visible bars own DOM nodes. */
export function setupPlaylistSongBars(host: HTMLElement, options: SongBarsOptions) {
  const events = new AbortController(), wheel = new MusicWheelSteps();
  const viewport = document.createElement('div');
  viewport.className = 'playlist-song-bars-viewport'; viewport.tabIndex = -1;
  const track = document.createElement('div');
  track.className = 'playlist-song-bars-track'; viewport.appendChild(track);
  const label = document.createElement('span');
  label.className = 'playlist-song-bars-label'; label.hidden = true;
  host.replaceChildren(viewport, label); host.setAttribute('role', 'group');
  let playlistId = '', total = 0, selected = -1, hovered = -1, focused = -1, step = 11;
  let pool: HTMLButtonElement[] = [], bars = new Map<number, HTMLButtonElement>(), labelEpoch = 0;
  let titleTimer: ReturnType<typeof setTimeout> | undefined;
  let pointer: { x: number; y: number } | undefined;
  const labelSong = () => hovered >= 0 ? hovered : focused >= 0 ? focused : selected;
  function placeLabel(song: number) {
    const x = (song + .5) * step - viewport.scrollLeft;
    label.hidden = host.hidden || song < 0 || song >= total || x < 0 || x > viewport.clientWidth;
    if (!label.hidden) label.style.left = `${x}px`;
  }
  function showTitle() {
    clearTimeout(titleTimer);
    const epoch = ++labelEpoch, id = playlistId, song = labelSong();
    if (song < 0 || song >= total || host.hidden) { label.hidden = true; return; }
    const cached = options.cachedTitle?.(id, song);
    if (cached) {
      label.textContent = cached; label.title = cached;
      bars.get(song)?.setAttribute('aria-label', `第 ${song + 1} 首，${cached}`);
      placeLabel(song); return;
    }
    // Keep the stable song number while a cold request completes. Cached
    // metadata never flashes a loading label or waits for the hover debounce.
    label.textContent = `第 ${song + 1} 首`; label.removeAttribute('title'); placeLabel(song);
    titleTimer = setTimeout(() => {
      void options.title(id, song).then(title => {
        if (epoch !== labelEpoch || id !== playlistId || host.hidden) return;
        label.textContent = title; label.title = title;
        bars.get(song)?.setAttribute('aria-label', `第 ${song + 1} 首，${title}`); placeLabel(song);
      }).catch(() => {
        if (epoch !== labelEpoch || id !== playlistId || host.hidden) return;
        label.textContent = `第 ${song + 1} 首 · 歌名暂时不可用`; placeLabel(song);
      });
    }, hovered >= 0 ? 120 : 0);
  }
  function renderBars() {
    const start = Math.max(0, Math.min(Math.max(0, total - pool.length), Math.floor(viewport.scrollLeft / step) - OVERSCAN));
    const next = new Map<number, HTMLButtonElement>();
    const available = pool.filter(bar => {
      const song = Number(bar.dataset.songBar);
      return bar.dataset.songBar === undefined || song < start || song >= start + pool.length;
    });
    let lostFocus = false;
    for (let song = start; song < start + pool.length; song++) {
      const bar = bars.get(song) || available.shift()!;
      if (bar.dataset.songBar !== String(song)) {
        if (bar === document.activeElement) lostFocus = true;
        bar.dataset.songBar = String(song); bar.setAttribute('aria-label', `第 ${song + 1} 首歌曲`);
      }
      bar.style.left = `${song * step}px`; bar.classList.toggle('active', song === selected);
      bar.setAttribute('aria-current', String(song === selected)); bar.tabIndex = song === selected ? 0 : -1;
      next.set(song, bar);
    }
    bars = next;
    if (playlistId && pool.length) options.prefetch?.(playlistId, start, start + pool.length - 1);
    if (lostFocus) { focused = -1; (bars.get(selected) || viewport).focus({ preventScroll: true }); }
  }
  function centerOn(song: number) {
    if (host.hidden || song < 0) return;
    viewport.scrollLeft = Math.max(0, Math.min(Math.max(0, total * step - viewport.clientWidth),
      (song + .5) * step - viewport.clientWidth / 2)); renderBars();
  }
  function songAt(target: EventTarget | null) {
    const button = target instanceof Element ? target.closest<HTMLButtonElement>('[data-song-bar]') : null;
    return button && viewport.contains(button) ? Number(button.dataset.songBar) : -1;
  }
  function refreshHover() {
    if (pointer) {
      const song = songAt(document.elementFromPoint(pointer.x, pointer.y));
      if (song !== hovered) { hovered = song; showTitle(); }
    }
    placeLabel(labelSong());
  }
  viewport.addEventListener('pointerover', event => {
    pointer = { x: event.clientX, y: event.clientY };
    const song = songAt(event.target); if (song !== hovered) { hovered = song; showTitle(); }
  }, { signal: events.signal });
  viewport.addEventListener('pointermove', event => { pointer = { x: event.clientX, y: event.clientY }; refreshHover(); }, { signal: events.signal });
  viewport.addEventListener('pointerleave', () => { pointer = undefined; hovered = -1; showTitle(); }, { signal: events.signal });
  viewport.addEventListener('focusin', event => { focused = songAt(event.target); showTitle(); }, { signal: events.signal });
  viewport.addEventListener('focusout', () => { focused = -1; showTitle(); }, { signal: events.signal });
  viewport.addEventListener('click', event => {
    const song = songAt(event.target); if (song < 0 || !options.enabled()) return;
    event.stopPropagation(); options.select(song);
  }, { signal: events.signal });
  host.addEventListener('wheel', event => {
    if (!options.enabled() || total < 2) { wheel.reset(); return; }
    const delta = musicWheelDelta(event, viewport.clientHeight); if (!delta) { wheel.reset(); return; }
    event.preventDefault(); event.stopPropagation(); hovered = focused = -1;
    const direction = wheel.consume(delta, performance.now()); if (direction) options.step(direction);
  }, { passive: false, signal: events.signal });
  host.addEventListener('pointerdown', () => wheel.reset(), { signal: events.signal });
  viewport.addEventListener('keydown', event => {
    if (!options.enabled()) return;
    const song = songAt(event.target); if (song < 0) return;
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault(); event.stopPropagation(); wheel.reset();
    const next = direction ? (song + direction + total) % total : event.key === 'Home' ? 0 : total - 1;
    options.select(next); centerOn(next); bars.get(next)?.focus({ preventScroll: true });
  }, { signal: events.signal });
  const onResize = () => {
    step = Number.parseFloat(getComputedStyle(host).getPropertyValue('--song-bar-step')) || 11;
    track.style.width = `${total * step}px`; centerOn(selected); refreshHover();
  };
  // Recenter after the hidden browse surface becomes visible, too.
  const resize = new ResizeObserver(onResize); resize.observe(viewport);
  window.addEventListener('resize', onResize, { signal: events.signal });
  window.addEventListener('blur', () => wheel.reset(), { signal: events.signal });
  viewport.addEventListener('scroll', () => { renderBars(); refreshHover(); }, { signal: events.signal });
  return {
    update(id: string, count: number, song: number, reduced: boolean) {
      host.hidden = !id; host.dataset.reduced = String(reduced);
      const nextTotal = id && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
      const changed = id !== playlistId || nextTotal !== total;
      if (changed) {
        playlistId = id; total = nextTotal; hovered = focused = -1; pointer = undefined; wheel.reset();
        const size = Math.min(BAR_POOL_SIZE, total);
        while (pool.length > size) pool.pop()!.remove();
        while (pool.length < size) {
          const bar = document.createElement('button');
          bar.type = 'button'; bar.className = 'playlist-song-bar'; bar.tabIndex = -1;
          track.appendChild(bar); pool.push(bar);
        }
        for (const bar of pool) delete bar.dataset.songBar;
        bars.clear(); selected = -1;
        host.setAttribute('aria-label', `选择歌单歌曲，共 ${total} 首`); host.dataset.totalSongs = String(total);
        step = Number.parseFloat(getComputedStyle(host).getPropertyValue('--song-bar-step')) || 11;
        track.style.width = `${total * step}px`;
      }
      const next = total ? Math.min(total - 1, Math.max(0, song)) : -1;
      if (next !== selected || changed) { selected = next; centerOn(selected); showTitle(); }
      else if (!host.hidden) {
        const cached = options.cachedTitle?.(playlistId, labelSong());
        if (cached && label.textContent !== cached) showTitle();
      }
    },
    destroy() { clearTimeout(titleTimer); labelEpoch++; resize.disconnect(); events.abort(); wheel.reset(); },
  };
}
