const ACTIVE = Object.freeze({ phase: "input" as const, prepareJobs: 2, prepareMs: 1, uploadTiles: 2, uploadMs: .75, transfers: 1, uploadIntervalMs: 0 });
const QUIET = Object.freeze({ phase: "quiet" as const, prepareJobs: 6, prepareMs: 2, uploadTiles: 4, uploadMs: 1.5, transfers: 1, uploadIntervalMs: 0 });

const BURST = Object.freeze({ phase: "burst" as const, prepareJobs: 1, prepareMs: .5, uploadTiles: 1, uploadMs: .5, transfers: 1, uploadIntervalMs: 80 });

/** Input cadence controls resource work; animation lifetime controls rendering. */
export class CoverWorkBudget {
  private lastInput = -Infinity;
  private lastWheel = -Infinity;
  private wheelRun = 0;
  private lastSelection = -Infinity;
  private selectionRun = 0;
  readonly quietMs: number;
  constructor(quietMs = 180) { this.quietMs = quietMs; }
  interact(now: number) { if (Number.isFinite(now)) this.lastInput = Math.max(this.lastInput, now); }
  wheel(now: number) {
    if (!Number.isFinite(now) || now < this.lastWheel) return;
    this.wheelRun = now - this.lastWheel <= 100 ? this.wheelRun + 1 : 1;
    this.lastWheel = now; this.interact(now);
  }
  selection(now: number) {
    if (!Number.isFinite(now) || now < this.lastSelection) return;
    this.selectionRun = now - this.lastSelection < this.quietMs ? this.selectionRun + 1 : 1;
    this.lastSelection = now; this.interact(now);
  }
  plan(now: number, dragging = false) {
    if ((this.wheelRun >= 3 && now - this.lastWheel < this.quietMs) ||
      (this.selectionRun >= 3 && now - this.lastSelection < this.quietMs)) return BURST;
    return dragging || now - this.lastInput < this.quietMs ? ACTIVE : QUIET;
  }
  snapshot(now: number, dragging = false) {
    return { ...this.plan(now, dragging), quietMs: this.quietMs,
      inputAgeMs: Number.isFinite(this.lastInput) ? Math.max(0, Math.round(now - this.lastInput)) : null };
  }
}
