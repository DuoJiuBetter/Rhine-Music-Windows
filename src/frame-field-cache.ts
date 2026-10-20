/** Fixed storage for integer-lane, half-row samples. Values are valid only in
 * this frame/epoch. Distant or non-grid coordinates use the original function. */
export class FrameFieldCache {
  private readonly values = new Float64Array(16 * 256);
  private readonly stamps = new Uint32Array(16 * 256);
  private epoch = 0;
  private laneOrigin = 0;
  private rowOrigin = 0;
  private evaluations = 0;
  private hits = 0;
  begin(laneOrigin: number, rowOrigin: number) {
    this.laneOrigin = laneOrigin; this.rowOrigin = rowOrigin;
    this.evaluations = this.hits = 0; this.invalidate();
  }
  invalidate() {
    this.epoch = (this.epoch + 1) >>> 0;
    if (!this.epoch) { this.stamps.fill(0); this.epoch = 1; }
  }
  read(row: number, lane: number, evaluate: (row: number, lane: number) => number) {
    const x = lane - this.laneOrigin, y = (row - this.rowOrigin) * 2;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 16 || y < 0 || y >= 256) {
      this.evaluations++; return evaluate(row, lane);
    }
    const index = x * 256 + y;
    if (this.stamps[index] === this.epoch) { this.hits++; return this.values[index]; }
    this.evaluations++; const value = evaluate(row, lane);
    this.values[index] = value; this.stamps[index] = this.epoch; return value;
  }
  stats() { return {evaluations: this.evaluations, hits: this.hits, bytes: this.values.byteLength + this.stamps.byteLength}; }
}
