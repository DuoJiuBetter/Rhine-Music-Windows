/** Bound work on high-refresh screens. Idle retains the authored breathing
 * motion at 30 fps; any input or transition immediately restores 60 fps.
 * Absolute timestamps are passed through, so animation duration is unchanged. */
export const FRAME_LIMITS = [30, 60, 90, 120, 144, 165, 240, 0] as const;
export type FrameLimit = typeof FRAME_LIMITS[number];
export function normalizeFrameLimit(value: unknown): FrameLimit {
  return FRAME_LIMITS.includes(value as FrameLimit) ? value as FrameLimit : 60;
}
export class RenderScheduler {
  private previous: number | undefined;
  private activeUntil = 0;
  wake(now: number) { this.activeUntil = Math.max(this.activeUntil, now + 5000); }
  reset() { this.previous = undefined; }
  shouldRender(now: number, transitioning: boolean, enabled: boolean, limit?: FrameLimit) {
    if (!enabled || limit === 0) { this.previous = now; return true; }
    // Explicit user choice also applies while idle; legacy callers keep 30/60.
    const interval = 1000 / (limit ?? (transitioning || now < this.activeUntil ? 60 : 30));
    if (this.previous !== undefined && now - this.previous < interval - .1) return false;
    // Preserve fractional remainder so a 144 Hz display does not fall to 48 fps.
    const gap = this.previous === undefined ? interval : now - this.previous;
    this.previous = now - Math.min(Math.max(0, gap - interval), interval);
    return true;
  }
}
