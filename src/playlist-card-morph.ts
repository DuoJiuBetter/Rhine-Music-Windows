import { followMusicMotionSpeed } from './music-motion-ui';

/** FLIP belongs to an inner wrapper; projected 3D anchors keep tracking freely. */
export class PlaylistCardMorph {
  private shape?: Animation;
  private content?: Animation;
  private revision = 0;

  constructor(private root: HTMLElement) {}

  run(layout: () => void, content: HTMLElement, expanded: boolean, reduced: boolean) {
    // Read the current *visual* rect before cancelling an interrupted morph.
    const before = reduced ? undefined : this.root.getBoundingClientRect();
    this.dispose();
    layout();
    if (!before || !before.width || !before.height) return;
    const after = this.root.getBoundingClientRect();
    if (!after.width || !after.height) return;
    const revision = this.revision;
    this.root.dataset.morphing = 'true';
    const animation = this.shape = followMusicMotionSpeed(this.root.animate([
      { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width}, ${before.height / after.height})` },
      { transform: 'translate(0px, 0px) scale(1, 1)' },
    ], { duration: expanded ? 460 : 360, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' }));
    this.reveal(content, reduced, expanded ? 100 : 35);
    void animation.finished.then(() => {
      if (revision !== this.revision) return;
      animation.cancel(); this.shape = undefined;
      delete this.root.dataset.morphing;
    }).catch(() => {});
  }

  reveal(content: HTMLElement, reduced: boolean, delay = 0) {
    this.content?.cancel(); this.content = undefined;
    if (reduced) return;
    const animation = this.content = followMusicMotionSpeed(content.animate([
      { opacity: 0, transform: 'translateY(7px)' },
      { opacity: 1, transform: 'translateY(0px)' },
    ], { duration: 220, delay, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' }));
    void animation.finished.then(() => {
      if (this.content !== animation) return;
      animation.cancel(); this.content = undefined;
    }).catch(() => {});
  }

  finish() { this.shape?.finish(); this.content?.finish(); }
  dispose() {
    this.revision++;
    this.shape?.cancel(); this.content?.cancel();
    this.shape = this.content = undefined;
    delete this.root.dataset.morphing;
  }
}
