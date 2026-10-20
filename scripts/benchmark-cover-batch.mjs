import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { startFixture } from './windows-fixture.mjs';

const fixture = await startFixture('dist', 128);
const cases = (process.env.RHINE_BATCH_CASES || '0,1,1,0').split(',');
const inputs = Number(process.env.RHINE_BATCH_INPUTS || 80);
const arrayBudget = Number(process.env.RHINE_BATCH_ARRAY_BUDGET || 1);
const browser = await chromium.launch({
  executablePath: process.env.RHINE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--enable-gpu-benchmarking'],
});
const runs = [];
try {
  for (const batch of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
    await context.addInitScript((budget) => {
      localStorage.clear();
      localStorage.setItem('rhine-music-preferences', JSON.stringify({
        bgm: false, sound: false, volume: 0, quality: 'original', theme: 'night',
        renderQuality: { scale: 100, pixelRatio: 1.5, antialias: 'off', shadows: 1024,
          arrayBudget: budget, aoSamples: 16, aoResolution: .5, depthOfField: 100,
          transmission: .5, anisotropy: 8 },
      }));
    }, arrayBudget);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${fixture.url}?scene=archive&lab=0&scheduler=1&render=optimized&coverBatch=${batch}`);
    await page.waitForFunction(() => window.rhineMusic?.stats()?.loaded && !document.querySelector('#music-loading'),
      null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const read = () => page.evaluate(() => {
      const host = document.querySelector('#three-scene');
      const gl = host.querySelector('canvas').getContext('webgl2');
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      const scene = window.rhineMusic.stats();
      return {
        gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        glError: gl.getError(),
        quality: JSON.parse(host.dataset.renderQuality || '{}'),
        frame: JSON.parse(host.dataset.frameTiming || '{}'),
        covers: scene.covers,
        gpuTiming: scene.gpuTiming,
      };
    });
    const initial = await read();
    for (let i = 0; i < inputs; i++) {
      await page.keyboard.press(i % 4 === 0 ? 'ArrowRight' : 'ArrowDown');
      await page.waitForTimeout(100);
    }
    const final = await read();
    const run = {
      batch, errors, gpu: final.gpu, glError: final.glError, quality: final.quality,
      frame: final.frame, gpuTiming: final.gpuTiming,
      uploads: final.covers.uploadedTiles - initial.covers.uploadedTiles,
      calls: final.covers.uploadCalls - initial.covers.uploadCalls,
      batchedTiles: final.covers.batchedTiles - initial.covers.batchedTiles,
      dirtyTiles: final.covers.dirtyTiles,
    };
    runs.push(run);
    console.log(JSON.stringify(run, null, 2));
    await context.close();
  }
} finally {
  await browser.close();
  await fixture.close();
  await fs.mkdir('artifacts/benchmark', { recursive: true });
  await fs.writeFile('artifacts/benchmark/cover-batch.json', JSON.stringify({
    at: new Date().toISOString(), inputs, arrayBudget, cases,
    note: 'Synthetic 128-album Edge/ANGLE test on current GPU; no account or private library.', runs,
  }, null, 2));
}
if (runs.some(run => run.errors.length || run.glError)) process.exitCode = 1;
