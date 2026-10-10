/** Rendering controls are independent of lighting, materials and animation. */
export type RenderQuality = {
  scale: number;
  pixelRatio: number;
  antialias: "off" | "smaa";
  shadows: number;
  aoSamples: number;
  aoResolution: number;
  depthOfField: number;
  depthOfFieldResolution: number;
  transmission: number;
  anisotropy: number;
  arrayBudget: number;
  pixelBudget: number;
};

export const qualityPresets = {
  balanced: {
    scale: 100,
    pixelRatio: 1,
    antialias: "smaa",
    shadows: 1024,
    aoSamples: 8,
    aoResolution: 0.5,
    depthOfField: 100,
    depthOfFieldResolution: 0.5,
    transmission: 0.25,
    anisotropy: 8,
    arrayBudget: 1,
    pixelBudget: 1_440_000,
  },
  performance: {
    scale: 80,
    pixelRatio: 1,
    antialias: "off",
    shadows: 1024,
    aoSamples: 0,
    aoResolution: 0.5,
    depthOfField: 0,
    depthOfFieldResolution: 0.5,
    transmission: 0.5,
    anisotropy: 4,
    arrayBudget: 1,
    pixelBudget: 1_440_000,
  },
  discrete: {
    scale: 100, pixelRatio: 1.5, antialias: "smaa", shadows: 1024,
    aoSamples: 8, aoResolution: 0.5, depthOfField: 100,
    depthOfFieldResolution: 0.5, transmission: 0.5, anisotropy: 8,
    arrayBudget: 1, pixelBudget: 2_073_600,
  },
  discretePlus: {
    scale: 100, pixelRatio: 2, antialias: "smaa", shadows: 2048,
    aoSamples: 16, aoResolution: 0.5, depthOfField: 100,
    depthOfFieldResolution: 0.5, transmission: 0.75, anisotropy: 16,
    arrayBudget: 1, pixelBudget: 3_686_400,
  },
  original: {
    scale: 100,
    pixelRatio: 1.5,
    antialias: "off",
    shadows: 2048,
    aoSamples: 32,
    aoResolution: 1,
    depthOfField: 100,
    depthOfFieldResolution: 1,
    transmission: 1,
    anisotropy: 16,
    arrayBudget: 0,
    pixelBudget: 8_294_400,
  },
  high: {
    scale: 125,
    pixelRatio: 2,
    antialias: "smaa",
    shadows: 4096,
    aoSamples: 32,
    aoResolution: 1,
    depthOfField: 100,
    depthOfFieldResolution: 1,
    transmission: 1,
    anisotropy: 16,
    arrayBudget: 0,
    pixelBudget: 8_294_400,
  },
  ultra: {
    scale: 150,
    pixelRatio: 2,
    antialias: "smaa",
    shadows: 4096,
    aoSamples: 64,
    aoResolution: 1,
    depthOfField: 100,
    depthOfFieldResolution: 1,
    transmission: 1,
    anisotropy: 16,
    arrayBudget: 0,
    pixelBudget: 8_294_400,
  },
} as const satisfies Record<string, RenderQuality>;
export type QualityPreset = keyof typeof qualityPresets;
export const presetLabels: Record<QualityPreset, string> = {
  balanced: "核显适配",
  discrete: "独显适配 · MX",
  discretePlus: "独显适配 · 增强",
  performance: "性能",
  original: "原始",
  high: "高",
  ultra: "极高",
};

const member = <T>(value: unknown, choices: readonly T[], fallback: T): T =>
  choices.includes(value as T) ? (value as T) : fallback;
const range = (
  value: unknown,
  min: number,
  max: number,
  step: number,
  fallback: number,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value / step) * step))
    : fallback;

export function normalizeQuality(
  value: unknown,
  legacyHigh = true,
): RenderQuality {
  const base = qualityPresets.original;
  const v =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  // Older low quality retained full resolution, shadows and transmission.
  const fallback = legacyHigh
    ? base
    : { ...base, pixelRatio: 1, aoSamples: 0, depthOfField: 0 };
  return {
    scale: range(v.scale, 50, 200, 5, fallback.scale),
    pixelRatio: member(v.pixelRatio, [1, 1.5, 2, 3], fallback.pixelRatio),
    antialias: member(
      v.antialias,
      ["off", "smaa"] as const,
      fallback.antialias,
    ),
    shadows: member(v.shadows, [0, 1024, 2048, 4096], fallback.shadows),
    aoSamples: member(v.aoSamples, [0, 8, 16, 32, 64], fallback.aoSamples),
    aoResolution: member(v.aoResolution, [0.5, 0.75, 1], fallback.aoResolution),
    depthOfField: range(v.depthOfField, 0, 150, 5, fallback.depthOfField),
    depthOfFieldResolution: member(
      v.depthOfFieldResolution,
      [0.5, 0.75, 1],
      fallback.depthOfFieldResolution,
    ),
    transmission: member(
      v.transmission,
      [0.25, 0.5, 0.75, 1],
      fallback.transmission,
    ),
    anisotropy: member(v.anisotropy, [1, 2, 4, 8, 16], fallback.anisotropy),
    arrayBudget: member(v.arrayBudget, [0, 1], fallback.arrayBudget),
    pixelBudget: member(v.pixelBudget, [1_440_000, 2_073_600, 3_686_400, 8_294_400],
      v.arrayBudget === 1 ? 1_440_000 : fallback.pixelBudget),
  };
}

/** Opt in to the desktop GPU budget once, only for the exact old default.
 * Existing custom settings and a later explicit original choice are retained. */
export function initialDesktopQuality(
  preferences: {
    quality?: QualityPreset;
    renderQuality?: unknown;
    qualityPipelineVersion?: number;
  },
  desktop: boolean,
) {
  const preset =
    preferences.quality && Object.hasOwn(qualityPresets, preferences.quality)
      ? preferences.quality
      : desktop
        ? "balanced"
        : "original";
  const stored = preferences.renderQuality;
  const quality = normalizeQuality(stored || qualityPresets[preset]);
  // Perf2 did not store this control. Backfill from the selected preset once;
  // an explicit saved 0 remains the original rendering path.
  if (stored && typeof stored === "object" && !("arrayBudget" in stored))
    quality.arrayBudget = qualityPresets[preset].arrayBudget;
  if (stored && typeof stored === "object" && !("pixelBudget" in stored))
    quality.pixelBudget = quality.arrayBudget ? 1_440_000 : 8_294_400;
  const migrated =
    desktop &&
    (preferences.qualityPipelineVersion ?? 0) < 2 &&
    (!preferences.quality || preferences.quality === "original") &&
    matchingPreset(quality) === "original";
  // Upgrade the exact Perf2/3 desktop preset, never an explicit custom/original
  // choice. The new budget becomes active without asking users to reselect it.
  const oldBalanced = { ...qualityPresets.balanced, antialias: "off", pixelRatio: 1.5, aoSamples: 16, transmission: 0.5 };
  const refreshed = desktop && preset === "balanced" &&
    (preferences.qualityPipelineVersion ?? 0) < 4 &&
    Object.entries(oldBalanced).every(([field, value]) => quality[field as keyof RenderQuality] === value);
  const perf4 = { ...qualityPresets.balanced, antialias: "off" };
  const clarityUpgrade = desktop && preset === "balanced" &&
    (preferences.qualityPipelineVersion ?? 0) < 5 &&
    Object.entries(perf4).every(([field, value]) => quality[field as keyof RenderQuality] === value);
  return {
    quality: migrated || refreshed || clarityUpgrade ? normalizeQuality(qualityPresets.balanced) : quality,
    migrated: migrated || refreshed || clarityUpgrade,
  };
}

export function matchingPreset(
  quality: RenderQuality,
): QualityPreset | "custom" {
  return (
    (Object.keys(qualityPresets) as QualityPreset[]).find((key) =>
      Object.entries(qualityPresets[key]).every(
        ([field, value]) => quality[field as keyof RenderQuality] === value,
      ),
    ) ?? "custom"
  );
}

export function renderDimensions(
  quality: RenderQuality,
  width: number,
  height: number,
  stageScale: number,
  deviceRatio: number,
  maxTextureSize: number,
) {
  const requested =
    (Math.min(deviceRatio, quality.pixelRatio) * stageScale * quality.scale) /
    100;
  // The integrated path caps 3D pixels independently of the native-resolution UI.
  const pixelBudget = quality.pixelBudget ?? (quality.arrayBudget ? 1_440_000 : 8_294_400);
  const ratio = Math.min(
    requested,
    Math.sqrt(pixelBudget / Math.max(1, width * height)),
    maxTextureSize / Math.max(1, width, height),
  );
  return {
    ratio,
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
    limited: ratio < requested - 0.0001,
    pixelBudget,
  };
}
