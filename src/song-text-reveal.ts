import { DocumentDecryption } from './document-decryption';

/** One observer and one animation clock per view. Only intersecting text gets
 * measured DOM masks; lyrics outside the scroll viewport wait without frames. */
export class SongTextReveal {
  private observer?: IntersectionObserver;
  private waiting = new Set<HTMLElement>();
  private active = new Map<HTMLElement, DocumentDecryption>();
  private text = new WeakMap<HTMLElement, string>();
  private reduced = false;
  private visible = false;
  private generation = 0;
  private raf?: number;

  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) {
      this.observer?.disconnect();
      for (const [target, mask] of this.active) {
        mask.dispose();
        if (target.isConnected && target.dataset.songReveal !== 'entry') { target.classList.add('song-mask-pending'); this.waiting.add(target); }
      }
      this.active.clear();
      if (this.raf !== undefined) cancelAnimationFrame(this.raf);
      this.raf = undefined;
    } else if (!this.reduced) for (const target of this.waiting) this.observer?.observe(target);
  }

  refresh(root: HTMLElement, reduced: boolean, restart = false) {
    if (restart || reduced !== this.reduced) this.reset();
    this.reduced = reduced;
    for (const target of this.waiting) if (!root.contains(target) || !target.isConnected) {
      this.observer?.unobserve(target); this.waiting.delete(target);
    }
    for (const [target, mask] of this.active) if (!root.contains(target) || !target.isConnected) {
      mask.dispose(); this.active.delete(target);
    }
    if (!reduced && !this.observer) {
      const generation = this.generation;
      this.observer = new IntersectionObserver(entries => {
        if (!this.visible || generation !== this.generation) return;
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          if (!entry.isIntersecting) {
            const mask = this.active.get(target);
            if (mask) { mask.dispose(); this.active.delete(target); }
            if (target.dataset.songReveal === 'entry') {
              // Lyrics reveal only on page entry. Scrolling or automatic line
              // changes must not expose new pending masks later in playback.
              target.classList.remove('song-mask-pending'); this.waiting.delete(target); this.observer?.unobserve(target);
            } else if (mask) this.queue(target);
            continue;
          }
          if (!this.waiting.has(target) || !target.isConnected) continue;
          const mask = new DocumentDecryption('', .25, true);
          mask.reset(target, false);
          target.classList.remove('song-mask-pending');
          this.active.set(target, mask);
          this.waiting.delete(target);
        }
        this.schedule();
      }, { threshold: 0.01 });
    }
    for (const target of root.querySelectorAll<HTMLElement>('[data-song-reveal]')) {
      const content = target.textContent || '';
      if (!restart && this.text.get(target) === content) continue;
      this.text.set(target, content);
      this.active.get(target)?.dispose(); this.active.delete(target);
      target.classList.remove('song-mask-pending');
      this.observer?.unobserve(target); this.waiting.delete(target);
      if (content.trim() && !reduced) this.queue(target);
    }
  }

  private queue(target: HTMLElement) {
    target.classList.add('song-mask-pending'); this.waiting.add(target);
    this.observer?.unobserve(target);
    if (this.visible) this.observer?.observe(target);
  }

  private schedule() {
    if (this.raf !== undefined || !this.visible || !this.active.size) return;
    this.raf = requestAnimationFrame(ms => {
      this.raf = undefined;
      for (const [target, mask] of this.active) {
        if (!target.isConnected) { mask.dispose(); this.active.delete(target); continue; }
        mask.update(ms / 1000, undefined, this.reduced);
        if (mask.complete) { mask.dispose(); this.active.delete(target); this.observer?.unobserve(target); }
      }
      this.schedule();
    });
  }

  reset() {
    this.generation++;
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    this.raf = undefined;
    this.observer?.disconnect(); this.observer = undefined;
    for (const mask of this.active.values()) mask.dispose();
    this.active.clear();
    for (const target of this.waiting) target.classList.remove('song-mask-pending');
    this.waiting.clear(); this.text = new WeakMap();
  }
}
