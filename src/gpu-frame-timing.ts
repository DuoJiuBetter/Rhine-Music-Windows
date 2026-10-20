/** Optional asynchronous GPU timing. No gl.finish, readPixels or forced flush.
 * Unsupported/disjoint measurements are reported as unavailable, never CPU time. */
export class GpuFrameTiming {
  private extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private current: WebGLQuery | null = null;
  private pending: { query: WebGLQuery; label: string }[] = [];
  private samples: number[] = [];
  private frame = 0;
  private profileFrame = false;
  private stageActive = false;
  private stages = new Map<string, number[]>();
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.extension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }
  begin() {
    const ext = this.extension;
    this.profileFrame = false;
    // Collection also calls into the graphics driver. Match it to the actual
    // sampling cadence instead of issuing a disjoint poll every rendered frame.
    if (++this.frame % 4 !== 0 || !this.collect()) return;
    if (this.pending.length >= 16) return;
    this.profileFrame = this.frame % 32 === 0;
    if (this.profileFrame || !ext) return;
    this.current = this.gl.createQuery();
    if (this.current) this.gl.beginQuery(ext.TIME_ELAPSED_EXT, this.current);
  }
  private collect() {
    if (this.current || this.stageActive) return true;
    const ext = this.extension;
    if (!ext || this.gl.isContextLost()) return false;
    if (this.gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      this.samples = []; this.stages.clear(); this.clearPending(); return false;
    }
    while (this.pending.length && this.gl.getQueryParameter(this.pending[0].query, this.gl.QUERY_RESULT_AVAILABLE)) {
      const { query, label } = this.pending.shift()!;
      const values = label === "frame" ? this.samples : this.stages.get(label) ?? [];
      values.push(this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) / 1e6);
      if (label !== "frame") this.stages.set(label, values);
      this.gl.deleteQuery(query);
      if (values.length > 120) values.shift();
    }
    return true;
  }
  end() {
    if (!this.current || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push({ query: this.current, label: "frame" }); this.current = null;
  }
  measure(label: string, draw: () => void) {
    if (!this.profileFrame || !this.extension || this.current || this.stageActive || this.gl.isContextLost() || this.pending.length >= 24) {
      draw(); return;
    }
    const query = this.gl.createQuery();
    if (!query) { draw(); return; }
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    this.stageActive = true;
    try { draw(); }
    finally {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.stageActive = false;
      this.pending.push({ query, label });
    }
  }
  snapshot() {
    // A user-requested diagnostic should see ready results/disjoint state
    // immediately even between the ordinary four-frame collection ticks.
    this.collect();
    const sorted = [...this.samples].sort((a, b) => a - b);
    return { available: Boolean(this.extension), samples: sorted.length,
      gpuP50: sorted.length ? +sorted[Math.floor((sorted.length - 1) * .5)].toFixed(2) : null,
      gpuP95: sorted.length ? +sorted[Math.floor((sorted.length - 1) * .95)].toFixed(2) : null,
      passes: Object.fromEntries([...this.stages].map(([label, values]) => {
        const ordered = [...values].sort((a, b) => a - b);
        return [label, { samples: ordered.length,
          gpuP50: +ordered[Math.floor((ordered.length - 1) * .5)].toFixed(2),
          gpuP95: +ordered[Math.floor((ordered.length - 1) * .95)].toFixed(2) }];
      })),
      passSampleEvery: 32 };
  }
  private clearPending() { for (const { query } of this.pending) this.gl.deleteQuery(query); this.pending = []; }
  dispose() { this.end(); this.clearPending(); }
}
