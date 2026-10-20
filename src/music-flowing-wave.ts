export const FLOWING_FFT_SIZE = 4096;

/** Analysis-only profile. Never changes the gain or audible output route. */
export function configureSpectrumAnalyser(analyser: AnalyserNode, responsive: boolean) {
  analyser.fftSize = responsive ? FLOWING_FFT_SIZE : 1024;
  analyser.minDecibels = responsive ? -90 : -100;
  analyser.maxDecibels = responsive ? -10 : -30;
  analyser.smoothingTimeConstant = responsive ? .25 : .7;
}

// Byte frequency samples encode dB, not linear amplitude. The responsive
// analyser's wider range avoids clipping strong musical bins to identical 255s.
const amplitudes = Float32Array.from({ length: 256 }, (_, i) => i === 0 ? 0 : 10 ** ((-90 + i * 80 / 255) / 20));

/** Same frequency positions and endpoint easing for every drawing style. */
export function flowingLevelAt(levels: Float32Array, position: number) {
  if(!levels.length || !Number.isFinite(position))return 0;
  const point=Math.max(0,Math.min(1,position))*(levels.length+1)-1;
  const left=Math.floor(point),u=point-left;
  const a=left<0||left>=levels.length?0:levels[left];
  const b=left+1<0||left+1>=levels.length?0:levels[left+1];
  return a+(b-a)*u*u*(3-2*u);
}

/** Thirty-two independent musical peaks, with bounded, time-based motion. */
export class FlowingWave {
  readonly levels = new Float32Array(32);
  private readonly energy = new Float32Array(32);
  private readonly velocity = new Float32Array(32);
  private reference = .035;

  reset() { this.levels.fill(0); this.energy.fill(0); this.velocity.fill(0); this.reference = .035; }

  update(input: Uint8Array | undefined, sampleRate: number, elapsed: number) {
    const dt = Number.isFinite(elapsed) ? Math.max(0, Math.min(.15, elapsed)) : 0;
    this.energy.fill(0);
    if (input && input.length > 1 && Number.isFinite(sampleRate) && sampleRate > 0) {
      const binHz = sampleRate / (input.length * 2);
      const first = Math.min(input.length - 1, Math.max(1, 60 / binHz));
      const last = Math.min(input.length, Math.max(first + 1, 12000 / binHz));
      for (let i = 0; i < this.energy.length; i++) {
        const start = first * (last / first) ** (i / this.energy.length);
        const end = first * (last / first) ** ((i + 1) / this.energy.length);
        let sum = 0;
        // Integrate fractional bin coverage instead of rounding multiple low
        // bands onto identical whole-bin ranges and producing a flat shelf.
        for (let j = Math.floor(start); j < Math.ceil(end); j++) {
          const weight = Math.max(0, Math.min(end, j + 1) - Math.max(start, j));
          sum += amplitudes[input[Math.min(input.length - 1, j)]] ** 2 * weight;
        }
        this.energy[i] = Math.sqrt(sum / (end - start));
      }
    }
    // Fast headroom protection, slow release: don't turn every quiet instant
    // into a full-height peak, or flatten every strong frequency at the ceiling.
    const peak = Math.max(.035, ...this.energy);
    this.reference = peak > this.reference ? peak : Math.max(peak, this.reference * Math.exp(-dt / 1.5));
    const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
    for (let i = 0; i < this.levels.length; i++) {
      const target = .84 * Math.min(1, this.energy[i] / this.reference) ** .7;
      let position = this.levels[i], speed = this.velocity[i];
      for (let step = 0; step < steps; step++) {
        speed += ((target - position) * 300 - speed * 22) * h;
        position += speed * h;
        if (position < 0) { position = 0; speed = Math.max(0, speed); }
        if (position > .995) { position = .995; speed = Math.min(0, speed); }
      }
      if (target === 0 && position < .001 && Math.abs(speed) < .01) { position = 0; speed = 0; }
      this.levels[i] = position; this.velocity[i] = speed;
    }
  }
}
