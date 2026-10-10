import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automaticQuality, initialQualityMode } from '../src/automatic-quality.ts';
import { initialDesktopQuality, normalizeQuality, qualityPresets, renderDimensions } from '../src/render-quality.ts';

const device = { renderer: '', unmasked: true, cores: 12, memoryGB: 8, nativePixels: 2560 * 1440 };
test('actual MX550, UHD and masked/software devices choose conservative independent budgets', () => {
  for (const [renderer, preset] of [
    ['ANGLE (NVIDIA, NVIDIA GeForce MX550 (0x000025A6) Direct3D11)', 'discrete'],
    ['ANGLE (Intel, Intel(R) UHD Graphics (0x000046A3) Direct3D11)', 'balanced'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11)', 'discretePlus'],
    ['ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11)', 'discretePlus'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)', 'balanced'],
    ['ANGLE (Google, Vulkan SwiftShader Device)', 'performance'],
    ['WebKit WebGL', 'balanced'],
  ]) {
    const result = automaticQuality({ ...device, renderer });
    assert.equal(result.preset, preset, renderer);
    assert.equal(result.quality.arrayBudget, 1, 'full visible glass keeps occlusion/culling');
    const dimensions = renderDimensions(result.quality, 2560, 1440, 1, 1.5, 16384);
    assert.ok(dimensions.width * dimensions.height <= result.quality.pixelBudget);
  }
  assert.equal(automaticQuality({ ...device, renderer: 'NVIDIA RTX 5090', unmasked: false }).preset, 'balanced');
  assert.equal(automaticQuality({ ...device, renderer: 'Intel UHD', memoryGB: 2 }).preset, 'performance');
  assert.equal(automaticQuality({ ...device, renderer: 'NVIDIA GeForce RTX 3060', cores: 2 }).preset, 'discrete');
});

test('saved manual/custom preferences survive and old exact desktop defaults opt into automatic quality', () => {
  assert.equal(initialQualityMode(undefined, qualityPresets.balanced, true), 'auto');
  assert.equal(initialQualityMode('manual', qualityPresets.balanced, true), 'manual');
  assert.equal(initialQualityMode(undefined, qualityPresets.high, true), 'manual');
  assert.equal(initialQualityMode(undefined, { ...qualityPresets.balanced, scale: 95 }, true), 'manual');
  assert.equal(initialQualityMode(undefined, qualityPresets.original, false), 'manual');
  const { pixelBudget: _budget, ...old } = qualityPresets.balanced;
  assert.deepEqual(initialDesktopQuality({ quality: 'balanced', renderQuality: old, qualityPipelineVersion: 5 }, true).quality, qualityPresets.balanced);
  assert.equal(normalizeQuality({ ...old, arrayBudget: 0 }).pixelBudget, 8_294_400);
  assert.equal(normalizeQuality({ ...qualityPresets.discrete, pixelBudget: Number.NaN }).pixelBudget, 1_440_000);
  const { arrayBudget: _array, ...legacy } = old;
  assert.equal(initialDesktopQuality({ quality: 'balanced', renderQuality: legacy, qualityPipelineVersion: 2 }, true).quality.pixelBudget, 1_440_000);
});
