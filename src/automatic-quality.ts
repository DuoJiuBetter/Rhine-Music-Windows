import { matchingPreset, normalizeQuality, qualityPresets, type RenderQuality, type QualityPreset } from './render-quality.ts';

export type QualityMode = 'auto' | 'manual';
type Device = { renderer: string; unmasked: boolean; cores?: number; memoryGB?: number; nativePixels: number };

/** A conservative capability heuristic, not a benchmark or installed-GPU guess.
 * Always use the adapter that actually owns the WebGL context. */
export function automaticQuality(device: Device) {
  const name = device.renderer.toLowerCase();
  let preset: QualityPreset = 'balanced', tier = 'unknown';
  if (/swiftshader|software|basic render|\bwarp\b|llvmpipe/.test(name)) {
    preset = 'performance'; tier = 'software';
  } else if (device.unmasked) {
    if (/geforce.*\bmx\d+|geforce.*\bgt\s?\d+|geforce.*gtx\s?(?:[4-9]\d{2}|10[35]0|16[35]0)|quadro/.test(name)) {
      preset = 'discrete'; tier = 'entry-discrete';
    } else if (/geforce|\brtx\b|radeon.*(?:\brx\b|pro)|intel.*\barc\s+[ab]\d{3}/.test(name)) {
      preset = 'discretePlus'; tier = 'discrete';
    } else if (/intel|uhd|iris|radeon.*(?:graphics|vega)|apple/.test(name)) {
      tier = 'integrated';
    }
  }
  const constrained = (device.cores !== undefined && device.cores > 0 && device.cores < 4) ||
    (device.memoryGB !== undefined && device.memoryGB > 0 && device.memoryGB < 4);
  if (constrained && preset === 'discretePlus') preset = 'discrete';
  if (constrained && tier !== 'entry-discrete' && tier !== 'discrete') preset = 'performance';
  const quality = normalizeQuality(qualityPresets[preset]);
  // An unusually large output on a small/unknown GPU must not inflate the 3D
  // budget. Physical glass, SMAA and the independent clear-cover pass remain.
  if (device.nativePixels > 8_294_400 && preset === 'balanced') quality.scale = 85;
  return { preset, tier, constrained, nativePixels: Math.round(device.nativePixels), quality };
}

export function initialQualityMode(saved: unknown, quality: RenderQuality, desktop: boolean): QualityMode {
  if (saved === 'manual' || saved === 'auto') return saved;
  // Older previews lack an auto/manual marker. Upgrade their exact desktop
  // default, preserving explicit original/high/custom quality choices.
  return desktop && matchingPreset(quality) === 'balanced' ? 'auto' : 'manual';
}
