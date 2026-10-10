import { overviewLabelPlacement, visibleOverviewLabels, type OverviewColumn } from "./music-overview";
import { SurfaceTransition } from "./ui-transitions";
import { escapeHtml as esc } from './html';
import type { MusicTrack } from './music-types';

interface LabelSurface {
  anchor: HTMLDivElement;
  card: HTMLDivElement;
  label: HTMLButtonElement;
  enter: HTMLButtonElement;
  transition: SurfaceTransition;
  visible: boolean;
  playlist: boolean;
  details: HTMLDivElement;
  header: HTMLDivElement;
  toggle: HTMLButtonElement;
  drawer: HTMLDivElement;
  hovered: boolean;
  touchEntry: boolean;
  column?: OverviewColumn;
}

/** Projected anchors never animate: the card inside owns its visible lifetime. */
export class MusicOverviewUI {
  private labels = new Map<number, LabelSurface>();
  private chrome: SurfaceTransition[];
  private active = false;
  private chromeShown = false;
  private revision = 0;
  private expandedLane: number | null = null;
  private hoveredLane: number | null = null;
  private viewport = { width: 1280, height: 720 };
  private reduced = false;

  constructor(private surface: HTMLElement, private container: HTMLElement,
    private returnFocus: () => void,
    private playlistWindow: (lane: number, first: number) => void = () => {}) {
    this.chrome = Array.from(surface.querySelectorAll<HTMLElement>(
      ".overview-heading, .overview-controls, .overview-return",
    )).map((element) => {
      element.hidden = true;
      return new SurfaceTransition(element, element, 460, 240, "up",
        "cubic-bezier(0.4, 0, 0.2, 1)");
    });
  }

  setActive(active: boolean, reduced: boolean) {
    if (this.active === active && (active || this.surface.hidden)) return;
    const revision = ++this.revision;
    this.active = active;
    this.reduced = reduced;
    this.collapse();
    this.surface.inert = !active;
    this.surface.setAttribute("aria-hidden", String(!active));
    if (active) {
      this.surface.hidden = false;
      if (reduced) this.showChrome(true);
      return;
    }
    this.chromeShown = false;
    if (this.surface.contains(document.activeElement)) this.returnFocus();
    for (const [lane, label] of this.labels) this.hideLabel(lane, label, reduced);
    this.chrome.forEach((motion, index) => motion.hide(reduced, () => {
      if (index === this.chrome.length - 1 && revision === this.revision && !this.active)
        this.surface.hidden = true;
    }));
  }

  private showChrome(reduced: boolean) {
    if (this.chromeShown) return;
    this.chromeShown = true;
    this.chrome.forEach((motion) => motion.show(reduced));
    this.returnFocus();
  }

  expand(lane: number) {
    if (!this.active || !this.labels.get(lane)?.visible) return;
    const item = this.labels.get(lane)!;
    if (this.expandedLane !== lane && item.playlist) item.details.innerHTML = '';
    this.expandedLane = lane;
    this.syncExpansion();
  }

  togglePlaylist(lane: number) {
    if (!this.active || !this.labels.get(lane)?.visible || !this.labels.get(lane)?.playlist) return false;
    if (this.expandedLane === lane) { this.collapse(); return false; }
    this.expand(lane);
    return true;
  }

  collapse() {
    this.expandedLane = null;
    this.syncExpansion();
  }

  canEnter(lane: number) {
    return this.active && this.expandedLane === lane && !!this.labels.get(lane)?.visible;
  }
  setPlaylistContent(lane: number, page: { name: string; total: number; offset: number; tracks: (MusicTrack | null | undefined)[]; loading?: boolean; error?: string }) {
    const item = this.labels.get(lane); if (!item?.playlist || !this.canEnter(lane)) return;
    let list = item.details.querySelector<HTMLDivElement>('.overview-playlist-tracks');
    if (!list) {
      item.details.innerHTML = `<div class="overview-playlist-content"><div class="overview-playlist-tracks" role="group" tabindex="0" aria-label="${esc(page.name)}"><div class="overview-playlist-window"></div></div><p class="overview-list-error" role="status"></p></div>`;
      list = item.details.querySelector<HTMLDivElement>('.overview-playlist-tracks')!;
      const scroll = list;
      list.addEventListener('scroll', () => {
        const first = Math.max(0, Math.floor(scroll.scrollTop / 56) - 4);
        if (scroll.dataset.first === String(first) || !this.canEnter(lane)) return;
        scroll.dataset.first = String(first); this.playlistWindow(lane, first);
      }, { passive: true });
    }
    list.dataset.first = String(page.offset);
    const count = Math.min(page.tracks.length, Math.max(0, page.total - page.offset));
    const window = list.querySelector<HTMLDivElement>('.overview-playlist-window')!;
    window.style.height = `${page.total * 56}px`;
    const focusedSong = window.contains(document.activeElement)
      ? (document.activeElement as HTMLElement | null)?.dataset.songIndex : undefined;
    window.innerHTML = Array.from({ length: count }, (_, index) => {
      const song = page.tracks[index], position = page.offset + index;
      return `<button type="button" style="top:${position * 56}px" data-action="overview-play-song" data-list-lane="${lane}" data-song-index="${position}" ${!song ? 'disabled' : ''}><span>${String(position + 1).padStart(2, '0')}</span><span><strong>${esc(song?.title || (page.loading ? '正在读取…' : '歌曲不可用'))}</strong><small>${esc(song?.artist || '')}</small></span></button>`;
    }).join('') || (page.total === 0 ? '<p>这个歌单还没有歌曲。</p>' : '');
    if (focusedSong !== undefined && /^\d+$/.test(focusedSong)) window.querySelector<HTMLButtonElement>(`[data-song-index="${focusedSong}"]`)?.focus({ preventScroll: true });
    item.details.querySelector<HTMLElement>('.overview-list-error')!.textContent = page.error || '';
  }

  private syncExpansion() {
    for (const [lane, item] of this.labels) {
      const expanded = lane === this.expandedLane && item.visible;
      // Keep focus on the name if a navigation input folds its entry button.
      if (!expanded && document.activeElement === item.enter) item.label.focus({ preventScroll: true });
      const playlistExpanded = item.playlist && expanded;
      // Keep the original header mounted. Clipping owns the drawer's motion,
      // while inert removes its controls immediately on close, before the fade.
      if (!playlistExpanded && item.details.contains(document.activeElement))
        item.toggle.focus({ preventScroll: true });
      const keyboard = item.header.contains(document.activeElement) &&
        !!document.activeElement?.matches(':focus-visible');
      const extended = this.active && item.visible && (item.hovered || item.touchEntry || keyboard);
      item.card.dataset.expanded = String(expanded);
      item.card.dataset.extended = String(extended);
      item.anchor.dataset.playlistExpanded = String(playlistExpanded);
      item.anchor.dataset.extended = String(extended);
      item.anchor.dataset.reduced = String(this.reduced);
      item.label.hidden = false;
      item.drawer.hidden = !item.playlist;
      item.details.inert = !playlistExpanded;
      item.details.setAttribute('aria-hidden', String(!playlistExpanded));
      item.toggle.disabled = !this.active || !item.visible || !item.playlist;
      item.toggle.setAttribute('aria-expanded', String(playlistExpanded));
      item.toggle.setAttribute('aria-label', `${playlistExpanded ? '收起' : '展开'}歌单：${item.column?.name || ''}`);
      item.label.setAttribute("aria-expanded", String(expanded));
      item.enter.disabled = item.playlist || !expanded;
      item.enter.tabIndex = !item.playlist && expanded ? 0 : -1;
      item.enter.setAttribute("aria-hidden", String(item.playlist || !expanded));
    }
  }

  private bindDrawer(lane: number, item: LabelSurface) {
    const hover = (value: boolean) => {
      item.hovered = value;
      if (value) this.hoveredLane = lane;
      else if (this.hoveredLane === lane) this.hoveredLane = null;
      this.syncExpansion();
    };
    item.header.addEventListener('pointerenter', (event) => {
      if (item.playlist && event.pointerType !== 'touch') { item.touchEntry = false; hover(true); }
    });
    // Hybrid Windows devices may report hover:hover even for a touch tap.
    item.label.addEventListener('pointerdown', (event) => {
      if (!item.playlist || event.pointerType !== 'touch') return;
      item.touchEntry = true; this.syncExpansion();
    });
    item.header.addEventListener('pointerleave', () => hover(false));
    item.card.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return;
      item.touchEntry = false;
      hover(false);
      if (this.expandedLane === lane && item.playlist) this.collapse();
    });
    item.drawer.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return;
      item.touchEntry = false;
      if (this.expandedLane === lane && item.playlist) this.collapse();
    });
    item.header.addEventListener('focusin', () => this.syncExpansion());
    item.header.addEventListener('focusout', () => queueMicrotask(() => {
      if (this.labels.get(lane) !== item || !item.visible) return;
      if (!item.card.contains(document.activeElement)) item.touchEntry = false;
      this.syncExpansion();
    }));
    item.card.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !item.playlist || this.expandedLane !== lane) return;
      event.preventDefault(); event.stopPropagation();
      this.collapse(); item.label.focus({ preventScroll: true }); this.syncExpansion();
    });
  }

  update(columns: OverviewColumn[], width: number, height: number, progress: number,
    reduced: boolean, columnName: string) {
    if (this.surface.hidden) return;
    this.viewport = { width, height };
    this.reduced = reduced;
    if (this.active && progress > .12) this.showChrome(reduced);
    const ready = this.active && progress > .75;
    this.surface.dataset.ready = String(ready);
    const retained = new Set(Array.from(this.labels).filter(([, item]) => item.visible).map(([lane]) => lane));
    const visible = ready ? visibleOverviewLabels(columns, width, height, retained, this.expandedLane ?? this.hoveredLane) : [];
    const wanted = new Set(visible.map((column) => column.lane));
    // Also project labels during their exit; fading never pins one in mid-air.
    for (const column of columns) {
      const item = this.labels.get(column.lane);
      if (item) this.place(item, column);
    }
    for (const [lane, item] of this.labels) if (!wanted.has(lane) && item.visible)
      this.hideLabel(lane, item, reduced);
    for (const column of visible) {
      let item = this.labels.get(column.lane);
      if (!item) {
        const anchor = document.createElement("div");
        anchor.className = "overview-anchor";
        anchor.innerHTML = '<div class="overview-card-morph"><div class="overview-column"><div class="overview-column-header"><button type="button" class="overview-column-label"><strong></strong><small></small></button><span class="overview-enter-slot"><button type="button" class="overview-enter">进入 <span aria-hidden="true">→</span></button></span><span class="overview-playlist-toggle-slot"><button type="button" class="overview-playlist-toggle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></span></div><div class="overview-playlist-drawer" hidden><div class="overview-playlist-detail"></div></div></div></div>';
        const card = anchor.querySelector<HTMLDivElement>(".overview-column")!;
        card.hidden = true;
        const label = anchor.querySelector<HTMLButtonElement>(".overview-column-label")!;
        const enter = anchor.querySelector<HTMLButtonElement>(".overview-enter")!;
        enter.dataset.overviewEnterLane = String(column.lane);
        enter.id = `overview-enter-${column.lane}`;
        label.setAttribute("aria-controls", enter.id);
        const details = anchor.querySelector<HTMLDivElement>('.overview-playlist-detail')!;
        details.tabIndex = -1;
        details.id = `overview-playlist-${column.lane}`;
        const toggle = anchor.querySelector<HTMLButtonElement>('.overview-playlist-toggle')!;
        toggle.dataset.overviewPlaylistToggle = String(column.lane);
        toggle.setAttribute('aria-controls', details.id);
        item = { anchor, card, label, enter, details, toggle, hovered: false, touchEntry: false,
          header: anchor.querySelector<HTMLDivElement>('.overview-column-header')!,
          drawer: anchor.querySelector<HTMLDivElement>('.overview-playlist-drawer')!,
          playlist: Boolean(column.playlist), visible: false,
          transition: new SurfaceTransition(card, card, 460, 240, "up",
            "cubic-bezier(0.4, 0, 0.2, 1)") };
        this.labels.set(column.lane, item);
        this.bindDrawer(column.lane, item);
        this.container.append(anchor);
      }
      item.playlist = Boolean(column.playlist);
      this.place(item, column);
      item.card.dataset.playlist = String(item.playlist);
      item.anchor.dataset.playlist = String(item.playlist);
      if (item.playlist) delete item.label.dataset.overviewLane;
      else item.label.dataset.overviewLane = String(column.lane);
      item.label.setAttribute('aria-controls', item.playlist ? item.details.id : item.enter.id);
      item.label.title = column.name;
      item.label.setAttribute("aria-label", item.playlist ? `歌单：${column.name}` : `展开${columnName}入口：${column.name}`);
      const name = item.label.querySelector("strong")!, count = item.label.querySelector("small")!;
      const caption = `${String(column.position ?? column.lane + 1).padStart(2, "0")} / ${column.count} ${column.playlist ? '首歌曲' : '张专辑'}`;
      if (name.textContent !== column.name) name.textContent = column.name;
      if (count.textContent !== caption) count.textContent = caption;
      item.enter.setAttribute("aria-label", `进入${column.name}的标准视图`);
      item.card.setAttribute("aria-current", String(column.selected));
      item.label.disabled = !ready;
      if (!item.visible) {
        item.visible = true;
        item.anchor.inert = false;
        item.transition.show(reduced);
      }
    }
    this.syncExpansion();
  }

  private place(item: LabelSurface, column: OverviewColumn) {
    item.column = column;
    // Reserve the open footprint before hovering. Opening never moves the
    // pointer's target; the same coordinates are used by collision planning.
    const { x, y } = overviewLabelPlacement(column, this.viewport.width, this.viewport.height);
    item.anchor.style.left = `${x.toFixed(2)}px`;
    item.anchor.style.top = `${y.toFixed(2)}px`;
    // Physical edge visibility and UI fades have separate owners. An outgoing
    // card stays attached and reaches zero opacity before its pool slot recycles.
    item.anchor.style.opacity = String(column.extent ?? 1);
  }

  private hideLabel(lane: number, item: LabelSurface, reduced: boolean) {
    item.visible = false;
    item.hovered = false;
    item.touchEntry = false;
    item.anchor.inert = true;
    if (this.expandedLane === lane) this.expandedLane = null;
    if (this.hoveredLane === lane) this.hoveredLane = null;
    if (item.anchor.contains(document.activeElement)) this.returnFocus();
    item.transition.hide(reduced, () => {
      if (item.visible) return;
      item.transition.dispose();
      item.anchor.remove();
      this.labels.delete(lane);
    });
  }

  finish() {
    this.chrome.forEach((motion) => motion.finish());
    for (const item of this.labels.values()) item.transition.finish();
  }

  dispose() {
    this.revision++;
    this.chrome.forEach((motion) => motion.dispose());
    for (const item of this.labels.values()) item.transition.dispose();
    this.labels.clear();
  }
}
