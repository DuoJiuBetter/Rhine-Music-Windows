/** Compare to the last actually requested shadow, so sub-texel movement accumulates
 * rather than being lost. Color motion is independent of shadow update cadence. */
export class ShadowUpdateBudget {
  private previous = new Float32Array(0);
  private invalid = true;
  updates = 0;
  skipped = 0;
  throttled = 0;
  private lastUpdate = -Infinity;
  private reason = "initial";
  invalidate() {
    this.invalid = true;
  }
  shouldUpdate(
    state: readonly number[] | Float32Array,
    active: boolean,
    tolerance: number,
    nowSeconds = Infinity,
    activeHz = 30,
  ) {
    let changed =
      this.invalid || active || state.length !== this.previous.length;
    if (!changed)
      for (let i = 0; i < state.length; i++) {
        if (
          !Number.isFinite(state[i]) ||
          Math.abs(state[i] - this.previous[i]) > tolerance
        ) {
          changed = true;
          break;
        }
      }
    if (changed) {
      // Explicit quality/light/reset invalidation bypasses the cadence limit.
      const interval = active ? 1 / Math.max(1,activeHz) : 1 / 8;
      if (!this.invalid &&
        Number.isFinite(nowSeconds) && nowSeconds - this.lastUpdate < interval) {
        this.throttled++; this.skipped++; this.reason = "cadence";
        return false;
      }
      if (this.previous.length !== state.length)
        this.previous = new Float32Array(state.length);
      this.previous.set(state);
      this.invalid = false;
      this.lastUpdate = nowSeconds;
      this.reason = active ? "motion" : "dirty";
      this.updates++;
    } else { this.skipped++; this.reason = "reused"; }
    return changed;
  }
  snapshot() {
    return { updates: this.updates, skipped: this.skipped, throttled: this.throttled,
      activeHz: 30, idleHz: 8, lastReason: this.reason };
  }
}
