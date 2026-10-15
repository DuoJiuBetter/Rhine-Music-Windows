import type { RenderQuality } from "./render-quality";

/** One quality reduction. Steps are ordered by how little the viewer notices
 * them, so an over-budget device gives up the least visible work first. */
export type AdaptiveStep = {
  id: string;
  label: string;
  next: (quality: RenderQuality) => RenderQuality | null;
};

const lower = (value: number, order: readonly number[]) => {
  const index = order.indexOf(value);
  return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
};

export const adaptiveSteps: readonly AdaptiveStep[] = [
  {
    id: "shadows",
    label: "阴影贴图",
    next: (q) => {
      const shadows = lower(q.shadows, [4096, 2048, 1024, 0]);
      return shadows === null ? null : { ...q, shadows };
    },
  },
  {
    id: "aoSamples",
    label: "遮蔽采样",
    next: (q) => {
      const aoSamples = lower(q.aoSamples, [64, 32, 16, 8, 0]);
      return aoSamples === null ? null : { ...q, aoSamples };
    },
  },
  {
    id: "aoResolution",
    label: "遮蔽分辨率",
    next: (q) => {
      const aoResolution = lower(q.aoResolution, [1, 0.75, 0.5]);
      return aoResolution === null ? null : { ...q, aoResolution };
    },
  },
  {
    id: "transmission",
    label: "透射倍率",
    next: (q) => {
      const transmission = lower(q.transmission, [1, 0.75, 0.5, 0.25]);
      return transmission === null ? null : { ...q, transmission };
    },
  },
  {
    id: "depthOfFieldResolution",
    label: "景深分辨率",
    next: (q) => {
      const depthOfFieldResolution = lower(q.depthOfFieldResolution, [1, 0.75, 0.5]);
      return depthOfFieldResolution === null ? null : { ...q, depthOfFieldResolution };
    },
  },
  {
    id: "anisotropy",
    label: "各向异性",
    next: (q) => {
      const anisotropy = lower(q.anisotropy, [16, 8, 4, 2, 1]);
      return anisotropy === null ? null : { ...q, anisotropy };
    },
  },
  {
    id: "depthOfField",
    label: "景深",
    next: (q) => (q.depthOfField > 0 ? { ...q, depthOfField: 0 } : null),
  },
  {
    id: "scale",
    label: "渲染倍率",
    next: (q) => (q.scale > 70 ? { ...q, scale: Math.max(70, q.scale - 10) } : null),
  },
];

export type AdaptiveSample = {
  /** Measured GPU frame time when the timer query extension is available. */
  gpuP95?: number | null;
  /** Frame-to-frame P95; used only when GPU timing is unavailable. */
  frameP95?: number | null;
  now: number;
};

export type AdaptiveSnapshot = {
  enabled: boolean;
  step: number;
  applying: string[];
  applyingLabels: string[];
  changes: number;
  reason: string;
  targetMs: number;
  samples: number;
  lastChangeAt: number | null;
  quality: RenderQuality | null;
};

/** Closed loop around measured frame time, replacing "trust the GPU name".
 *
 * The automatic preset stays the ceiling: the loop only ever subtracts from it,
 * never adds, and it is rebuilt from that preset on every change so a device can
 * always return to exactly the authored profile. Nothing here reads preferences
 * or the clock, so a session that never struggles never changes a single value.
 *
 * Evaluations arrive once per diagnostics refresh (~1.5 s), which is also the
 * hysteresis window: two consecutive over-budget windows degrade one step, four
 * comfortable windows give one back. */
export class AdaptiveQuality {
  private base?: RenderQuality;
  private current?: RenderQuality;
  private applied: number[] = [];
  private counts: number[] = adaptiveSteps.map(() => 0);
  private overload = 0;
  private headroom = 0;
  private sampleCount = 0;
  private changeCount = 0;
  private lastChangeAt: number | null = null;
  private reason = "idle";
  enabled = true;
  readonly targetMs = 16.7;
  private readonly loadMs = 18;
  private readonly frameLoadMs = 20;
  private readonly recoverMs = 11;
  private readonly frameRecoverMs = 17;
  private readonly degradeAfter = 2;
  private readonly recoverAfter = 4;

  /** The authored ceiling this loop subtracts from, as a stable key. */
  get baseKey(): string {
    return this.base ? JSON.stringify(this.base) : "";
  }

  /** Start from the automatic preset. Called on boot and whenever the preset or
   * the auto/manual choice changes, so the loop never drifts across settings. */
  reset(base: RenderQuality) {
    this.base = { ...base };
    this.current = { ...base };
    this.applied = [];
    this.counts = adaptiveSteps.map(() => 0);
    this.overload = 0;
    this.headroom = 0;
    this.reason = "reset";
  }

  sample({ gpuP95, frameP95, now }: AdaptiveSample): RenderQuality | null {
    if (!this.enabled || !this.base || !this.current) return null;
    this.sampleCount++;
    const gpu = Number.isFinite(gpuP95) ? (gpuP95 as number) : null;
    const frame = Number.isFinite(frameP95) ? (frameP95 as number) : null;
    const loaded =
      (gpu !== null && gpu > this.loadMs) ||
      (gpu === null && frame !== null && frame > this.frameLoadMs);
    const relaxed =
      (gpu === null || gpu < this.recoverMs) &&
      (frame === null || frame < this.frameRecoverMs);
    if (loaded) {
      this.overload++;
      this.headroom = 0;
      this.reason = "over-budget";
    } else if (relaxed) {
      this.headroom++;
      this.overload = 0;
      this.reason = "headroom";
    } else {
      this.overload = 0;
      this.headroom = 0;
      this.reason = "borderline";
    }
    if (this.overload >= this.degradeAfter) {
      const index = this.nextStep();
      if (index === null) {
        this.overload = 0;
        this.reason = "floor";
        return null;
      }
      this.applied.push(index);
      this.counts[index]++;
      this.rebuild();
      this.changed(now, `degrade:${adaptiveSteps[index].id}`);
      return this.current;
    }
    if (this.headroom >= this.recoverAfter && this.applied.length) {
      const index = this.applied.pop()!;
      this.counts[index]--;
      this.rebuild();
      this.changed(now, "recover");
      return this.current;
    }
    return null;
  }

  snapshot(): AdaptiveSnapshot {
    return {
      enabled: this.enabled,
      step: this.applied.length,
      applying: this.applied.map((index) => adaptiveSteps[index].id),
      applyingLabels: this.applied.map((index) => adaptiveSteps[index].label),
      changes: this.changeCount,
      reason: this.reason,
      targetMs: this.targetMs,
      samples: this.sampleCount,
      lastChangeAt: this.lastChangeAt,
      quality: this.current ? { ...this.current } : null,
    };
  }

  private changed(now: number, reason: string) {
    this.changeCount++;
    this.lastChangeAt = now;
    this.reason = reason;
    this.overload = 0;
    this.headroom = 0;
  }

  /** One level of every knob before a second level of any: the cheapest visible
   * change is always taken first, so a barely over-budget device never loses the
   * shadow map entirely while its occlusion sampling is still at full strength. */
  private nextStep() {
    let best: number | null = null;
    for (let index = 0; index < adaptiveSteps.length; index++) {
      if (adaptiveSteps[index].next(this.current!) === null) continue;
      if (best === null || this.counts[index] < this.counts[best]) best = index;
    }
    return best;
  }

  /** Always rebuilt from the preset, so upgrading restores the authored values. */
  private rebuild() {
    this.current = this.applied.reduce<RenderQuality>(
      (quality, index) => adaptiveSteps[index].next(quality) ?? quality,
      { ...this.base! },
    );
  }
}
