import { damp } from './motion';
import { musicWheelDelta } from './music-wheel-navigation';

/** One short-lived clock for lyric follow and wheel input; no idle RAF loop. */
export class MusicLyricScroll {
  private frame?: number;
  private last?: number;
  private target = 0;
  private spring = { value: 0, velocity: 0 };
  private followed?: HTMLElement;
  private events = new AbortController();
  private resize: ResizeObserver;

  constructor(private node: HTMLElement, private reduced: () => boolean, private manual: () => void) {
    const signal = this.events.signal;
    node.addEventListener('wheel', event => {
      const delta = musicWheelDelta(event, node.clientHeight);
      if (!delta || !event.cancelable || node.scrollHeight <= node.clientHeight) return;
      event.preventDefault(); this.manual();
      if (this.followed) { this.stop(); this.target = node.scrollTop; }
      this.followed = undefined;
      const current = node.scrollTop;
      // Opposite gestures brake immediately; large bursts cannot queue many screens.
      const reversing = Math.sign(delta) !== Math.sign(this.target - current);
      if (reversing) { this.target = current; this.spring.velocity = 0; }
      const base = this.frame === undefined ? current : this.target;
      const reach = Math.min(640, node.clientHeight * .9);
      this.moveTo(Math.max(current - reach, Math.min(current + reach, base + delta)));
    }, { signal, passive: false });
    for (const event of ['pointerdown', 'touchstart', 'keydown']) {
      node.addEventListener(event, () => { this.manual(); this.followed = undefined; this.stop(); }, { signal, passive: true });
    }
    this.resize = new ResizeObserver(() => {
      this.setEdges();
      if (this.followed?.isConnected) this.follow(this.followed);
    });
    this.resize.observe(node); this.setEdges();
  }

  private setEdges() {
    this.node.style.setProperty('--lyric-edge-top', `${Math.round(this.node.clientHeight * .42)}px`);
    this.node.style.setProperty('--lyric-edge-bottom', `${Math.round(this.node.clientHeight * .58)}px`);
  }

  follow(line: HTMLElement, immediate = false) {
    this.followed = line;
    this.moveTo(line.offsetTop - this.node.clientHeight * .42 + line.offsetHeight / 2, immediate);
  }

  private moveTo(position: number, immediate = false) {
    this.target = Math.max(0, Math.min(this.node.scrollHeight - this.node.clientHeight, position));
    if (Math.sign(this.target - this.spring.value) !== Math.sign(this.spring.velocity)) this.spring.velocity = 0;
    if (immediate || this.reduced()) {
      this.stop(); this.node.scrollTop = this.target; return;
    }
    if (this.frame === undefined) {
      this.spring.value = this.node.scrollTop; this.spring.velocity = 0; this.last = undefined;
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    this.frame = undefined;
    if (!this.node.isConnected || !this.node.clientHeight || document.hidden) { this.stop(); return; }
    this.target = Math.max(0, Math.min(this.node.scrollHeight - this.node.clientHeight, this.target));
    if (this.reduced()) { this.node.scrollTop = this.target; this.stop(); return; }
    const dt = this.last === undefined ? 1 / 60 : Math.min(.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    damp(this.spring, this.target, 14, dt);
    this.node.scrollTop = this.spring.value;
    if (Math.abs(this.spring.value - this.target) < .35 && Math.abs(this.spring.velocity) < 3) {
      this.node.scrollTop = this.target; this.stop();
    } else this.frame = requestAnimationFrame(this.tick);
  };

  stop() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined; this.last = undefined; this.spring.velocity = 0;
  }
  dispose() { this.stop(); this.resize.disconnect(); this.events.abort(); this.followed = undefined; }
}
