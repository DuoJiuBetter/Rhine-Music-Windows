// Isolated diagnostic build only. Production bundles never import this module.
// GPU scopes are exclusive: suspend/resume parents instead of nesting WebGL queries.
// No finish(), readPixels(), flush(), or synchronous waits for query results.
export class RenderCostTiming {
  constructor(gl, {sampleEvery = 2, maxQueries = 64} = {}) {
    if (!Number.isInteger(sampleEvery) || sampleEvery < 1 || sampleEvery > 32
      || !Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 256)
      throw new Error('Invalid bounded diagnostic query configuration');
    this.gl = gl;
    this.sampleEvery = sampleEvery; this.maxQueries = maxQueries;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.active = false; this.pending = []; this.completed = [];
    this.cpuRows = new Map(); this.cpuStack = []; this.stack = [];
    this.sequence = 0; this.dropped = 0; this.disjoints = 0;
  }
  start() {
    if (this.frame) throw new Error('Cannot reset inside a rendered frame');
    this.clear(); this.cpuRows.clear(); this.completed = [];
    this.sequence = 0; this.dropped = 0; this.disjoints = 0;
    this.started = performance.now(); this.active = true;
  }
  stop() { this.active = false; this.stopped = performance.now(); }
  cpu(label, draw) {
    if (!this.active) return draw();
    const scope = {label, started: performance.now(), children: 0};
    this.cpuStack.push(scope);
    try { return draw(); }
    finally {
      const elapsed = performance.now() - scope.started;
      this.cpuStack.pop();
      if (this.cpuStack.length) this.cpuStack.at(-1).children += elapsed;
      const row = this.cpuRows.get(label) || [];
      if (row.length < 10000) row.push(Math.max(0, elapsed - scope.children));
      this.cpuRows.set(label, row);
    }
  }
  collect() {
    return this.cpu('queryCollection', () => this.collectRaw());
  }
  collectRaw() {
    if (!this.ext || this.gl.isContextLost()) return;
    if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      this.disjoints++; this.clear(); this.completed = []; return;
    }
    while (this.pending.length) {
      const frame = this.pending[0];
      if (!frame.queries.every(({query}) => this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE))) break;
      this.pending.shift();
      const values = {};
      for (const {query, label} of frame.queries) {
        const value = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) / 1e6;
        values[label] = (values[label] || 0) + value;
        this.gl.deleteQuery(query);
      }
      if (!frame.invalid && Object.values(values).every(value => Number.isFinite(value) && value >= 0))
        this.completed.push({id: frame.id, values});
      else this.dropped++;
    }
  }
  begin() {
    this.collect();
    if (!this.active) return;
    this.sequence++;
    if (!this.ext || this.gl.isContextLost() || this.sequence % this.sampleEvery) return;
    if (this.pending.length >= 16 || this.completed.length >= 600) { this.dropped++; return; }
    this.frame = {id: this.sequence, queries: [], invalid: false};
    this.stack = ['otherRender']; this.resume();
  }
  suspend() {
    if (!this.current) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.frame.queries.push(this.current); this.current = undefined;
  }
  resume() {
    if (!this.frame || this.frame.invalid) return;
    if (this.frame.queries.length >= this.maxQueries) { this.frame.invalid = true; return; }
    const query = this.gl.createQuery();
    if (!query) { this.frame.invalid = true; return; }
    this.current = {query, label: this.stack.at(-1)};
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
  }
  measure(label, draw) {
    return this.cpu(label, () => {
      if (!this.frame) return draw();
      this.suspend(); this.stack.push(label); this.resume();
      try { return draw(); }
      finally { this.suspend(); this.stack.pop(); this.resume(); }
    });
  }
  end() {
    if (!this.frame) return;
    this.suspend(); this.pending.push(this.frame); this.frame = undefined; this.stack = [];
  }
  snapshot() {
    this.collect();
    const summary = values => {
      const sorted = [...values].sort((a,b) => a-b);
      const sum = values.reduce((a,b) => a+b, 0);
      return {samples: values.length, totalMs: sum,
        meanMs: values.length ? sum / values.length : null,
        p95Ms: values.length ? sorted[Math.floor((sorted.length-1)*.95)] : null,
        maxMs: values.length ? sorted.at(-1) : null};
    };
    const total = this.completed.map(frame => Object.values(frame.values).reduce((a,b) => a+b, 0));
    const gpu = summary(total);
    const labels = [...new Set(this.completed.flatMap(frame => Object.keys(frame.values)))];
    const stages = Object.fromEntries(labels.map(label => {
      const row = summary(this.completed.map(frame => frame.values[label] || 0));
      return [label, {...row, sharePercent: gpu.totalMs ? row.totalMs / gpu.totalMs * 100 : null}];
    }));
    const cpuTotal = [...this.cpuRows.values()].flat().reduce((a,b) => a+b, 0);
    return {available: Boolean(this.ext), samples: gpu.samples, gpuP50: null, gpuP95: gpu.p95Ms,
      capture: {active: this.active, elapsedMs: (this.active ? performance.now() : this.stopped) - this.started,
        renderedFrames: this.sequence, sampledEvery: this.sampleEvery, pendingFrames: this.pending.length,
        droppedFrames: this.dropped, disjointEvents: this.disjoints,
        gpu, stages, cpu: Object.fromEntries([...this.cpuRows].map(([label, values]) => {
          const row = summary(values);
          return [label, {...row, meanMsPerRenderedFrame: this.sequence ? row.totalMs / this.sequence : null,
            sharePercentOfInstrumentedCpu: cpuTotal ? row.totalMs / cpuTotal * 100 : null}];
        })), frames: this.completed}};
  }
  clear() {
    for (const frame of this.pending) for (const {query} of frame.queries) this.gl.deleteQuery(query);
    this.pending = [];
  }
  dispose() { this.active = false; this.end(); this.clear(); }
}
