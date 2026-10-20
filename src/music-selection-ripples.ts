import { smooth } from './motion.ts';

interface Cell { row: number; lane: number }
interface Ripple extends Cell { time: number; retiringAt?: number; appearingAt?: number }
export interface MusicRipple extends Cell { time: number; gain: number }

/** Real input cadence coalesces the decorative wave; selection never waits. */
export class MusicSelectionRipples {
  readonly quietSeconds = .18;
  readonly fadeSeconds = .24;
  readonly lifetime = 3.2;
  private entries: Ripple[] = [];
  private queued: (Cell & { requestedAt: number }) | null = null;
  private requested = 0;
  private emitted = 0;
  private coalesced = 0;
  private peakActive = 0;

  get hasPending() { return this.queued !== null; }

  request(cell: Cell, now: number) {
    if (![cell.row, cell.lane, now].every(Number.isFinite)) return;
    if (this.queued) this.coalesced++;
    this.queued = { ...cell, requestedAt: now };
    this.requested++;
    // Keep the displayed wave moving while the final destination coalesces.
    // Fading it here creates a dead interval before its replacement can rise.
  }

  private gain(ripple: Ripple, now: number) {
    const tail = 1 - smooth((now - ripple.time - 2.7) / .5);
    const retirement = ripple.retiringAt === undefined ? 1 : 1 - smooth((now - ripple.retiringAt) / this.fadeSeconds);
    const appearance = ripple.appearingAt === undefined ? 1 : smooth((now - ripple.appearingAt) / this.fadeSeconds);
    return tail * retirement * appearance;
  }

  update(now: number, eligible = true): MusicRipple[] {
    if (!eligible) {
      this.queued = null;
      for (const ripple of this.entries) ripple.retiringAt ??= now;
    }
    this.entries = this.entries.filter(ripple => now - ripple.time < this.lifetime &&
      (ripple.retiringAt === undefined || now - ripple.retiringAt < this.fadeSeconds));
    // A backgrounded/stalled window must not replay an obsolete gesture later.
    if (this.queued && now - this.queued.requestedAt > 1) this.queued = null;
    if (eligible && this.queued && this.entries.length < 2 && now - this.queued.requestedAt >= this.quietSeconds - 1e-9) {
      const previous = this.entries[0];
      // Complementary quintic weights crossfade instead of adding two waves
      // at full strength. Keep a live phase so a second click cannot restart
      // the replacement at zero motion. The initial click keeps its old rise.
      const phase = previous ? Math.min(.46, Math.max(0, now - previous.time)) : 0;
      if (previous) previous.retiringAt = now;
      this.entries.push({ row: this.queued.row, lane: this.queued.lane, time: now - phase,
        ...(previous ? { appearingAt: now } : {}) });
      this.queued = null;
      this.emitted++;
    }
    this.peakActive = Math.max(this.peakActive, this.entries.length);
    return this.entries.map(ripple => ({ row: ripple.row, lane: ripple.lane, time: ripple.time, gain: this.gain(ripple, now) }));
  }

  rebase(shift: Cell) {
    for (const ripple of this.entries) { ripple.row -= shift.row; ripple.lane -= shift.lane; }
    if (this.queued) { this.queued.row -= shift.row; this.queued.lane -= shift.lane; }
  }

  reset() {
    this.entries = []; this.queued = null;
    this.requested = this.emitted = this.coalesced = this.peakActive = 0;
  }

  snapshot() {
    return { policy: 'coalesce-input-phase-crossfade', quietMs: this.quietSeconds * 1000,
      fadeMs: this.fadeSeconds * 1000, active: this.entries.length, peakActive: this.peakActive,
      requested: this.requested, emitted: this.emitted, coalesced: this.coalesced,
      pending: this.queued ? { row: this.queued.row, lane: this.queued.lane } : null };
  }
}
