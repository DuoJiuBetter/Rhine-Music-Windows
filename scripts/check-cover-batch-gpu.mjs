import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const testPage = 'artifacts/benchmark/cover-batch-gpu-check.html';
await fs.mkdir('artifacts/benchmark', { recursive: true });
await fs.writeFile(testPage, `<!doctype html><meta charset="utf-8"><script type="module">
import * as THREE from 'three';
import { CoverAtlas } from '/src/cover-atlas.ts';
window.runCoverBatchCheck = () => {
  const atlas = new CoverAtlas(4, 4096, 1);
  const canvas = atlas.atlasCanvas;
  const context = canvas.getContext('2d');
  const top = ['#f00000', '#00f000', '#0000f0', '#f0f000'];
  const bottom = ['#600000', '#006000', '#000060', '#606000'];
  for (let i = 0; i < 4; i++) {
    context.fillStyle = top[i]; context.fillRect(i * 256, 0, 256, 128);
    context.fillStyle = bottom[i]; context.fillRect(i * 256, 128, 256, 128);
    atlas.dirtySlots.add(i);
  }
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(1024, 256);
  const count = atlas.flushUploads(renderer, 4);
  const calls = atlas.getStats().uploadCalls;
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: atlas.atlas, toneMapped: false })));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const target = new THREE.WebGLRenderTarget(1024, 256);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const samples = [];
  for (const y of [64, 192]) for (let i = 0; i < 4; i++) {
    const pixel = new Uint8Array(4);
    renderer.readRenderTargetPixels(target, i * 256 + 128, y, 1, 1, pixel);
    samples.push([...pixel]);
  }
  const error = renderer.getContext().getError();
  target.dispose(); atlas.dispose(); renderer.dispose(); renderer.domElement.remove();
  return { count, calls, samples, error };
};
</script>`);

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.RHINE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
try {
  const results = [];
  for (const batch of [0, 1]) {
    const page = await browser.newPage();
    await page.goto(`${origin}${testPage}?coverBatch=${batch}`);
    await page.waitForFunction(() => typeof window.runCoverBatchCheck === 'function');
    results.push(await page.evaluate(() => window.runCoverBatchCheck()));
    await page.close();
  }
  assert.equal(results[0].count, 4);
  assert.equal(results[1].count, 4);
  assert.equal(results[0].calls, 4);
  assert.equal(results[1].calls, 1);
  assert.equal(results[0].error, 0);
  assert.equal(results[1].error, 0);
  assert.deepEqual(results[1].samples, results[0].samples,
    'batched and individual transfers produce identical GPU pixels in every tile and row');
  console.log('Cover strip GPU pixels match four individual uploads (eight asymmetric samples).');
} finally {
  await browser.close();
  await server.close();
  await fs.rm(testPage, { force: true });
}
