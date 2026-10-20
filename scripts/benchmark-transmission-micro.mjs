import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {build} from 'vite';
import {chromium} from 'playwright';
import {startFixture} from './windows-fixture.mjs';
import {instrumentTransmission} from './transmission-micro-transform.mjs';
import {summarizeTransmission, countMicroOperation} from './transmission-micro-report.mjs';

// Explicit tiny one-shot experiment; never launched by normal builds or player.
const run = process.argv.includes('--run');
const sourceComparison = process.argv.includes('--sources');
const outDir = 'artifacts/benchmark/transmission-micro-dist';
const entry = 'artifacts/benchmark/transmission-micro-entry.html';
const output = process.env.RHINE_TRANSMISSION_OUTPUT || 'artifacts/benchmark/transmission-micro-' + (run ? 'results' : 'build-only') + '.json';
const report = {at: new Date().toISOString(), failures: [], note:
  'One tiny session, 4 fixed cards, 6 rotated cases x 8 paired trials, no player/account/audio/network. GPU scopes exclusive; prefix sums include children. Prior-frame preupload reported separately and in combined cost; no finish/readPixels/flush. Case order rotated, shader programs prewarmed. First-use texture tests intentionally upload 4 synthetic 1024px canvases. Not UHD/MX550/WebView2 validation.'};
if (sourceComparison) report.note = 'Source comparison: 4 cards, 5 rotated cases x 4 paired trials. Same pixels and 1024px size; canvas/cpu-canvas/RGBA-data/ImageBitmap inputs. Source preparation recorded separately, outside upload-only comparison. No player/accounts/audio. GPU intervals exclusive, may include driver waits. One bounded session, no automatic retry.';
let browser, fixture, page, transformed = false, closing;
const cleanup = () => closing ??= (async () => {await browser?.close().catch(() => {}); await fixture?.close().catch(() => {});})();
const deadline = setTimeout(() => {report.failures.push('60s process deadline; no retry'); void cleanup();}, 60000); deadline.unref();

try {
  await fs.mkdir(path.dirname(entry), {recursive: true});
  await fs.writeFile(entry, '<!doctype html><html><head><meta charset="utf-8"><title>Transmission micro experiment</title></head><body style="margin:0;background:#101a28"><script type="module" src="/scripts/transmission-micro-scene.mjs"></script></body></html>');
  await build({configFile: false, publicDir: false, logLevel: 'error', plugins: [{name: 'micro-transmission-only', enforce: 'pre', transform(source, id) {
    if (!id.endsWith('/node_modules/three/build/three.module.js')) return;
    transformed = true; return instrumentTransmission(source);
  }}], build: {outDir, emptyOutDir: false, reportCompressedSize: false, rollupOptions: {input: path.resolve(entry)}}});
  assert.equal(transformed, true);
  report.buildOnly = !run;
  if (run) {
    const {stdout} = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory'], {timeout: 10000});
    const freeKiB = Number(stdout.trim()); assert.ok(Number.isFinite(freeKiB) && freeKiB >= 6 * 1024 * 1024, 'At least 6 GiB free physical memory required');
    report.freeMemoryGiB = freeKiB / 1024 / 1024;
    fixture = await startFixture(outDir, 0);
    browser = await chromium.launch({executablePath: process.env.RHINE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, timeout: 15000});
    const context = await browser.newContext({viewport: {width: 640, height: 400}, deviceScaleFactor: 1});
    page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', e => {report.failures.push(e.message); void cleanup();});
    page.on('crash', () => {report.failures.push('Page crashed; no retry'); void cleanup();});
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(fixture.url).origin ? route.continue() : route.abort('blockedbyclient'));
    await page.goto(fixture.url + 'artifacts/benchmark/transmission-micro-entry.html' + (sourceComparison ? '?sources=1' : ''));
    await page.waitForFunction(() => typeof window.runTransmissionMicro === 'function');
    report.result = await page.evaluate(() => window.runTransmissionMicro());
    assert.deepEqual(report.failures, []); assert.equal(report.result.completed, true);
    assert.equal(report.result.rows.length, sourceComparison ? 20 : 48);
    report.summary = summarizeTransmission(report.result);
    for (const rows of Object.values(report.summary)) assert.equal(rows.renderGpuMs.samples, sourceComparison ? 4 : 8);
    for (const row of report.result.rows) {
      assert.equal(countMicroOperation(row.render, 'textureUploadRest'), ['cold-new', 'dirty-reuse', 'cold-preupload-same-frame','cold-cpu-canvas','cold-data','cold-bitmap'].includes(row.name) ? 4 : 0, row.name + ' upload path');
      assert.equal(countMicroOperation(row.render, 'textureStorage'), ['cold-new', 'cold-preupload-same-frame','cold-cpu-canvas','cold-data','cold-bitmap'].includes(row.name) ? 4 : 0, row.name + ' storage path');
      if (row.preparation) {assert.equal(countMicroOperation(row.preparation, 'textureUploadRest'), 4); assert.equal(countMicroOperation(row.preparation, 'textureStorage'), 4);}
      assert.equal(countMicroOperation(row.render, 'texturePixels') + countMicroOperation(row.preparation, 'texturePixels'), row.name.startsWith('cold-') || row.name === 'dirty-reuse' ? 4 : 0, row.name + ' pixel transfers');
    }
    console.log(JSON.stringify({device: report.result.device, elapsedMs: report.result.elapsedMs,
      summary: Object.fromEntries(Object.entries(report.summary).map(([name, s]) => [name, Object.fromEntries(Object.entries(s).map(([key, value]) => [key, value.mean]))]))}));
  }
  report.completed = true;
} catch (error) {
  report.failures.push(String(error.stack || error)); process.exitCode = 1; console.error(error);
  if (page && !page.isClosed()) report.partial = await page.evaluate(() => ({
    progress: window.transmissionMicroPartial, failure: window.transmissionMicroFailure,
  })).catch(() => null);
  if (report.partial?.progress?.rows?.length) report.partialSummary = summarizeTransmission(report.partial.progress);
}
finally {clearTimeout(deadline); await cleanup(); await fs.mkdir(path.dirname(output), {recursive: true}); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log('Saved ' + output);}
