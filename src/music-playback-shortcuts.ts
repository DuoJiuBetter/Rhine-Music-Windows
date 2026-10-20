import { defaultKeybindings, shortcutKey, type MusicKeybindings } from './music-keybindings.ts';
type Actions = {
  enabled: () => boolean;
  spaceEnabled?: () => boolean;
  bindings?: () => MusicKeybindings;
  allowTarget?: (target: HTMLElement) => boolean;
  active: () => boolean;
  playing: () => boolean;
  toggle: () => void;
  navigate: (direction: number) => void;
  navigatePlaylist?: (direction: number) => void;
  seek: (seconds: number) => void;
  boost: (enabled: boolean) => void;
};

/** Resolve tap / double tap / hold before dispatching conflicting arrow actions. */
export class MusicPlaybackShortcuts {
  private down?: { key: string; double: boolean; boosted: boolean; long: boolean; seek?: number; hold: boolean; navigate?: () => void };
  private tap?: { key: string; at: number; navigate?: () => void };
  private holdTimer?: ReturnType<typeof setTimeout>;
  private tapTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private actions: Actions;
  constructor(actions: Actions) { this.actions = actions; }

  keydown(event: KeyboardEvent): boolean {
    if (this.disposed || event.isComposing || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
    const target = event.target as HTMLElement | null;
    // Space belongs to playback, including when a model/open button has focus.
    // Editable fields still need ordinary text spaces and native editing keys.
    if (target?.closest?.('textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]), [contenteditable]:not([contenteditable="false"]), [data-visualizer-color-picker], [data-volume-slider]')) return false;
    if (event.code === 'Space' || event.key === ' ') {
      if (!(this.actions.spaceEnabled ?? this.actions.enabled)()) return false;
      event.preventDefault();
      event.stopImmediatePropagation?.();
      if (!event.repeat) this.actions.toggle();
      return true;
    }
    if (!this.actions.enabled()) return false;
    // Bindings belong to the app, including settings and recently clicked
    // buttons. Only text/editing surfaces above keep their native keys.
    const key = shortcutKey(event.key);
    if (!key) return false;
    const bindings = this.actions.bindings?.() ?? defaultKeybindings;
    const navigate = key === bindings.songPrevious ? () => this.actions.navigate(-1)
      : key === bindings.songNext ? () => this.actions.navigate(1)
      : key === bindings.playlistPrevious && this.actions.navigatePlaylist ? () => this.actions.navigatePlaylist!(-1)
      : key === bindings.playlistNext && this.actions.navigatePlaylist ? () => this.actions.navigatePlaylist!(1) : undefined;
    const active = this.actions.active();
    const seek = active ? key === bindings.seekBackward ? -15 : key === bindings.seekForward ? 15 : undefined : undefined;
    const hold = active && (key === bindings.boostPrimary || key === bindings.boostSecondary);
    if (!navigate && seek === undefined && !hold) return false;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    if (event.repeat || this.down?.key === key) return true;
    if (this.down) this.cancel();
    if (seek === undefined && !hold) { this.flushTap(); navigate?.(); return true; }
    const double = seek !== undefined && this.tap?.key === key && performance.now() - this.tap.at <= 300;
    if (this.tap && !double) this.flushTap();
    clearTimeout(this.tapTimer); this.tapTimer = undefined; this.tap = undefined;
    this.down = { key, double, boosted: false, long: false, seek, hold, navigate };
    if (hold) this.holdTimer = setTimeout(() => {
      if (!this.down || this.down.key !== key) return;
      this.down.long = true;
      if (this.actions.enabled() && this.actions.playing()) { this.down.boosted = true; this.actions.boost(true); }
    }, 450);
    return true;
  }

  keyup(event: KeyboardEvent): void {
    if (!this.down || shortcutKey(event.key) !== this.down.key) return;
    event.preventDefault(); clearTimeout(this.holdTimer); this.holdTimer = undefined;
    const held = this.down; this.down = undefined;
    if (held.long) { if (held.boosted) this.actions.boost(false); return; }
    if (!this.actions.enabled()) return;
    if (held.double && held.seek !== undefined) this.actions.seek(held.seek);
    else if (held.seek !== undefined) {
      this.tap = { key: held.key, at: performance.now(), navigate: held.navigate };
      this.tapTimer = setTimeout(() => this.flushTap(), 300);
    } else held.navigate?.();
  }

  private flushTap(): void {
    clearTimeout(this.tapTimer); this.tapTimer = undefined;
    const tap = this.tap; this.tap = undefined;
    if (tap && this.actions.enabled()) tap.navigate?.();
  }

  cancel(): void {
    clearTimeout(this.holdTimer); clearTimeout(this.tapTimer);
    this.holdTimer = this.tapTimer = undefined; this.tap = undefined;
    if (this.down?.boosted) this.actions.boost(false);
    this.down = undefined;
  }
  dispose(): void { this.cancel(); this.disposed = true; }
}
