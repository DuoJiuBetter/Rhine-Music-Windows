import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// One tiny context, synthetic pictures, no full player scene or account access.
const testPage = 'artifacts/benchmark/cover-residency-gpu-check.html';
const reportPath = 'artifacts/benchmark/cover-residency-smoke.json';
let server, browser;
let closing;
const cleanup = () => closing ??= (async () => {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await fs.rm(testPage, { force: true });
})();
const watchdog = setTimeout(() => {
  console.error('Stopped: cover smoke check exceeded 45 seconds. No retry.');
  void cleanup().finally(() => process.exit(1));
}, 45000);
watchdog.unref();

try {
  await fs.mkdir('artifacts/benchmark', { recursive: true });
  await fs.writeFile(testPage, `<!doctype html><meta charset="utf-8"><script type="module">
import * as THREE from 'three';
import { CoverAtlas } from '/src/cover-atlas.ts';
window.runResidencyCheck = async () => {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(32, 32);
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const atlas = new CoverAtlas(32, renderer.capabilities.maxTextureSize, 1);
  atlas.setFrameBudget(true);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const dummy = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1);
  dummy.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: dummy, toneMapped: false });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const target = new THREE.WebGLRenderTarget(16, 16);
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const colors = [[240,48,48],[48,240,48],[48,48,240],[240,240,48],
    [240,48,240],[48,240,240],[192,128,64],[128,64,192]];
  const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
  try {
    // Warm the trivial sampling shader separately from cold atlas transfers.
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const records = colors.map((rgb, id) => {
      const source = document.createElement('canvas');
      source.width = source.height = 256;
      const ctx = source.getContext('2d');
      ctx.fillStyle = 'rgb(' + rgb.join(',') + ')'; ctx.fillRect(0,0,256,128);
      ctx.fillStyle = 'rgb(' + rgb.map(v => v / 2).join(',') + ')'; ctx.fillRect(0,128,256,128);
      return { id: 'synthetic-' + id, title: 'Synthetic ' + id,
        album: { coverUrl: source.toDataURL('image/png') } };
    });
    // Decode genuine synthetic PNGs, without network or private music data.
    let start = performance.now();
    atlas.prefetch(records);
    const decoded = await atlas.prepareVisible(2000);
    const decodeMs = performance.now() - start;
    if (!decoded.settled || decoded.cachedImages !== 8) throw new Error('Synthetic PNG decode incomplete');
    const plan = offset => Array.from({length:32}, (_, slot) => ({slot,record:records[(slot+offset)%8]}));
    start = performance.now();
    atlas.prepareFrame(plan(0), 32, 1000);
    const coldPreparationMs = performance.now() - start;
    const cold = [];
    let previous = await raf();
    for (let i=0;i<8;i++) {
      const stamp = await raf();
      start = performance.now();
      const count = atlas.flushUploads(renderer, 1,
        {prioritySlots: Array.from({length:32},(_,slot)=>slot), timeBudgetMs:1, maxTransfers:1});
      cold.push({count, cpuMs:performance.now()-start, frameIntervalMs:stamp-previous});
      previous = stamp;
    }
    const coldStats = atlas.getStats();
    material.map = atlas.array.material.map;
    material.needsUpdate = true;
    // Readback is correctness-only and excluded from the timed phases.
    const sampleSlots = () => {
      const tiles = atlas.array.geometry.attributes.coverTile;
      const ready = atlas.array.geometry.attributes.coverReady;
      const samples = [];
      for (let slot=0;slot<32;slot++) {
        const uv = geometry.attributes.uv;
        const x=tiles.getX(slot),y=tiles.getY(slot),w=tiles.getZ(slot),h=tiles.getW(slot);
        for (let vertex=0;vertex<4;vertex++) {
          uv.setXY(vertex,x+(vertex%2)*w,y+(vertex<2?1:0)*h);
        }
        uv.needsUpdate = true;
        renderer.render(scene,camera);
        const top = new Uint8Array(4), bottom = new Uint8Array(4);
        renderer.readRenderTargetPixels(target,8,12,1,1,top);
        renderer.readRenderTargetPixels(target,8,4,1,1,bottom);
        samples.push({slot,ready:ready.getX(slot),top:[...top],bottom:[...bottom]});
      }
      return samples;
    };
    const coldPixels = sampleSlots();
    const warm = [];
    previous = await raf();
    for (let offset=1;offset<=8;offset++) {
      const stamp = await raf();
      start = performance.now();
      atlas.prepareFrame(plan(offset),0,0);
      const count=atlas.flushUploads(renderer,1,
        {prioritySlots:Array.from({length:32},(_,slot)=>slot),timeBudgetMs:1,maxTransfers:1});
      warm.push({offset,count,cpuMs:performance.now()-start,frameIntervalMs:stamp-previous});
      previous=stamp;
    }
    // Validate a shifted arrangement as well, so a stale UV cannot pass.
    atlas.prepareFrame(plan(3),0,0);
    const warmStats=atlas.getStats();
    const warmPixels=sampleSlots();
    return {gpu, slots:32, uniqueImages:8, colors, decodeMs, coldPreparationMs,
      cold, warm, coldStats, warmStats, coldPixels, warmPixels, glError:gl.getError(),
      scope:'Small component check; no full-scene FPS or WebView2/Intel acceptance test.'};
  } finally {
    target.dispose(); geometry.dispose(); material.dispose(); dummy.dispose(); atlas.dispose();
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }
};
</script>`);
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.RHINE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, timeout: 15000,
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('crash', () => errors.push('Browser page crashed; no retry.'));
  await page.goto(server.resolvedUrls.local[0] + testPage, { timeout: 15000 });
  await page.waitForFunction(() => typeof window.runResidencyCheck === 'function');
  const result = await page.evaluate(() => window.runResidencyCheck());
  assert.deepEqual(errors, []);
  assert.equal(result.glError, 0);
  assert.equal(result.coldStats.uploadedTiles, 8);
  assert.equal(result.coldStats.uploadCalls, 8);
  assert.equal(result.coldStats.residentTiles, 8);
  assert.equal(result.warmStats.uploadCalls, result.coldStats.uploadCalls);
  assert.equal(result.warmStats.uploadedBytes, result.coldStats.uploadedBytes);
  assert.ok(result.warm.every(frame => frame.count === 0));
  for (const [pixels, offset] of [[result.coldPixels, 0], [result.warmPixels, 3]]) {
    for (const sample of pixels) {
      assert.equal(sample.ready, 1);
      const rgb = result.colors[(sample.slot + offset) % 8];
      for (let channel = 0; channel < 3; channel++) {
        assert.ok(Math.abs(sample.top[channel] - rgb[channel]) <= 3, 'Correct top pixels after UV remap');
        assert.ok(Math.abs(sample.bottom[channel] - rgb[channel] / 2) <= 3, 'Correct bottom pixels/orientation');
      }
      assert.equal(sample.top[3], 255);
      assert.equal(sample.bottom[3], 255);
    }
  }
  result.passed = true;
  result.checkedAt = new Date().toISOString();
  await fs.writeFile(reportPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({passed:true,gpu:result.gpu,atlasBytes:result.coldStats.atlasBytes,
    decodeMs:result.decodeMs,coldPreparationMs:result.coldPreparationMs,cold:result.cold,warm:result.warm,
    coldUploads:result.coldStats.uploadCalls,warmAdditionalUploads:result.warmStats.uploadCalls-result.coldStats.uploadCalls,
    checkedSamples:128,reportPath},null,2));
} finally {
  clearTimeout(watchdog);
  await cleanup();
}
