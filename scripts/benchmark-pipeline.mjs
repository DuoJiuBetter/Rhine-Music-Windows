import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fixtureLibrary } from './windows-fixture.mjs';

// Run against an already restored dedicated test instance. Keeping the
// scheduler awake isolates pipeline changes from intentional idle throttling.
const browser = await chromium.connectOverCDP(process.env.RHINE_CDP || 'http://127.0.0.1:9227');
const page = browser.contexts()[0].pages()[0];
const origin = new URL(page.url()).origin;
const session = await page.context().newCDPSession(page);
const report = { note: 'Awake stationary comparison, same 1920×1080 drawing buffer and original effects. Shift input only keeps the scheduler awake.', runs: [] };
try {
  await page.route('**/api/library', route => route.fulfill({ json: fixtureLibrary() }));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('rhine-music-preferences', JSON.stringify({ bgm: false, sound: false, volume: 0, quality: 'original', theme: 'night',
      renderQuality: { scale: 100, pixelRatio: 1, antialias: 'off', shadows: 2048, aoSamples: 32, aoResolution: 1, depthOfField: 100, transmission: 1, anisotropy: 16 } }));
  });
  for (const mode of ['reference', 'optimized']) {
    await page.goto(`${origin}/?desktop=1&scene=archive&lab=0&render=${mode}`);
    await session.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await page.waitForFunction(() => window.rhineMusic?.stats()?.loaded && !document.querySelector('#music-loading'), { timeout: 60000 });
    await page.waitForTimeout(3000);
    for (let i = 0; i < 24; i++) { await page.keyboard.press('Shift'); await page.waitForTimeout(1000); }
    const result = await page.evaluate(() => ({ quality: JSON.parse(document.querySelector('#three-scene').dataset.renderQuality),
      frame: JSON.parse(document.querySelector('#three-scene').dataset.frameTiming), stats: window.rhineMusic.stats() }));
    assert.equal(result.quality.width, 1920); assert.equal(result.quality.height, 1080);
    report.runs.push({ mode, ...result });
    console.log(mode, JSON.stringify({ frame: result.frame, gpu: result.stats.gpuTiming }));
  }
} finally {
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/benchmark-awake.json', JSON.stringify(report, null, 2));
  await browser.close();
}
