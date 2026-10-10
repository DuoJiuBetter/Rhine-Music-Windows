/** Bound work on high-refresh screens. Idle retains the authored breathing
 * motion at 30 fps; any input or transition immediately restores 60 fps.
 * Absolute timestamps are passed through, so animation duration is unchanged. */
export class RenderScheduler {
  private previous: number | undefined;
  private activeUntil = 0;
  wake(now: number) { this.activeUntil = Math.max(this.activeUntil, now + 5000); }
  reset() { this.previous = undefined; }
  shouldRender(now: number, transitioning: boolean, enabled: boolean) {
    if (!enabled) { this.previous = now; return true; }
    const interval = 1000 / (transitioning || now < this.activeUntil ? 60 : 30);
    if (this.previous !== undefined && now - this.previous < interval - .75) return false;
    // Preserve fractional remainder so a 144 Hz display does not fall to 48 fps.
    const gap = this.previous === undefined ? interval : now - this.previous;
    this.previous = now - Math.min(Math.max(0, gap - interval), interval / 2);
    return true;
  }
}
