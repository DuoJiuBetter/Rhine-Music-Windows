import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Scene, PerspectiveCamera, Texture, WebGLRenderTarget } from 'three';
import { RenderScheduler } from '../src/render-scheduler.ts';
import { GpuFrameTiming } from '../src/gpu-frame-timing.ts';
import { SharedDepthBokehPass } from '../src/shared-depth-bokeh.ts';
import { findExecutable } from './music-audio.mjs';
import { silentWav } from './windows-fixture.mjs';

test('render scheduler bounds 60/120/144 Hz work while restoring full interaction rate', () => {
  for (const hz of [60, 120, 144]) {
    const idle = new RenderScheduler(), active = new RenderScheduler();
    active.wake(0);
    let idleFrames = 0, activeFrames = 0;
    for (let i = 0; i < hz * 4; i++) {
      const ms = i * 1000 / hz;
      idleFrames += Number(idle.shouldRender(ms, false, true));
      activeFrames += Number(active.shouldRender(ms, false, true));
    }
    assert.ok(Math.abs(idleFrames - 120) <= 2, `${hz} Hz idle: ${idleFrames}`);
    assert.ok(Math.abs(activeFrames - 240) <= 2, `${hz} Hz active: ${activeFrames}`);
  }
  const policy = new RenderScheduler();
  assert.equal(policy.shouldRender(0, false, true), true);
  assert.equal(policy.shouldRender(16.67, false, true), false);
  policy.wake(16.67);
  assert.equal(policy.shouldRender(16.67, false, true), true);
  policy.reset(); assert.equal(policy.shouldRender(17, false, true), true);
  assert.equal(policy.shouldRender(18, false, false), true);
});

test('shared-depth bokeh removes only the redundant scene render and retains original blur uniforms', () => {
  const scene = new Scene(), camera = new PerspectiveCamera(34, 1, 5, 300);
  const pass = new SharedDepthBokehPass(scene, camera, { focus: 25, aperture: .0018, maxblur: .011 });
  const read = new WebGLRenderTarget(100, 100), write = read.clone(), depth = new Texture();
  const draws = [];
  const renderer = { autoClear: true, getClearColor: color => color.set('white'), getClearAlpha: () => 1,
    setClearColor() {}, setClearAlpha() {}, setRenderTarget() {}, clear() {}, render: object => draws.push(object) };
  pass.depthSource = () => depth;
  pass.render(renderer, write, read);
  assert.equal(draws.length, 1); assert.equal(draws[0].isMesh, true);
  assert.equal(scene.overrideMaterial, null);
  assert.equal(pass.sharedFrames, 1);
  assert.equal(draws[0].material.fragmentShader, pass.materialBokeh.fragmentShader);
  assert.equal(draws[0].material.defines.DEPTH_PACKING, 0);
  for (const key of ['focus', 'aperture', 'aspect', 'maxblur'])
    assert.equal(draws[0].material.uniforms[key].value, pass.uniforms[key].value);
  pass.depthSource = () => null;
  draws.length = 0; pass.render(renderer, write, read);
  assert.equal(draws[0], scene); assert.equal(draws.length, 2);
  assert.equal(scene.overrideMaterial, null);
  pass.dispose(); read.dispose(); write.dispose(); depth.dispose();
});

test('GPU timer remains asynchronous, bounded, and rejects disjoint measurements', () => {
  let disjoint = false, available = false, created = 0, deleted = 0, starts = 0, ends = 0;
  const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = { QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4, getExtension: () => ext, isContextLost: () => false,
    getParameter: () => disjoint, getQueryParameter: (_q, p) => p === 3 ? available : 2_500_000,
    createQuery: () => ({ id: ++created }), deleteQuery: () => deleted++, beginQuery: () => starts++, endQuery: () => ends++ };
  const timer = new GpuFrameTiming(gl);
  for (let i = 0; i < 100; i++) { timer.begin(); timer.end(); }
  assert.equal(created, 16); assert.equal(starts, ends);
  available = true; timer.begin(); timer.end();
  assert.equal(timer.snapshot().gpuP95, 2.5);
  disjoint = true; timer.begin(); timer.end();
  assert.equal(timer.snapshot().gpuP95, null);
  timer.dispose(); assert.equal(created, deleted);
  const unavailable = new GpuFrameTiming({ getExtension: () => null });
  unavailable.begin(); unavailable.end(); assert.equal(unavailable.snapshot().available, false);
});

test('Windows decoder finds .exe names in PATH without launching a shell', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rhine-path-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = process.env.PATH;
  t.after(() => { process.env.PATH = original; });
  await fs.writeFile(path.join(root, 'rhine-decoder-test.exe'), 'fixture');
  process.env.PATH = `"${root}"`;
  assert.equal(await findExecutable('rhine-decoder-test'), path.join(root, 'rhine-decoder-test.exe'));
  assert.equal(await findExecutable('rhine-decoder-test.exe'), path.join(root, 'rhine-decoder-test.exe'));
});

test('owned desktop service handles occupied port, Unicode music paths, security boundaries and graceful shutdown', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rhine-desktop-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const foreign = http.createServer((_req, res) => res.end('foreign'));
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => foreign.close(resolve)));
  const port = foreign.address().port;
  const music = path.join(root, '中文 音乐目录'); await fs.mkdir(music);
  const wav = silentWav(); await fs.writeFile(path.join(music, '合成静音.wav'), wav);
  const child = spawn(process.execPath, ['scripts/desktop-server.mjs'], { windowsHide: true,
    env: { ...process.env, MUSIC_DATA_DIR: path.join(root, 'data'), MUSIC_ROOTS: '', RHINE_DESKTOP_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = '', stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Desktop readiness timeout: ${stderr}`)), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Desktop early exit ${code}: ${stderr}`)); });
    child.stdout.on('data', data => {
      stdout += data; const match = /RHINE_READY (http:\/\/127\.0\.0\.1:\d+\/)/.exec(stdout);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  assert.notEqual(new URL(address).port, String(port));
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'foreign');
  const health = await (await fetch(`${address}api/health`)).json();
  assert.equal(health.pid, child.pid);
  assert.equal((await fetch(`${address}api/library`, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.get(`${address}api/library`, { headers: { Host: 'evil.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(wrongHost, 403);
  const post = (route, value) => fetch(`${address}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  for (let i = 0; i < 100; i++) {
    const library = await (await fetch(`${address}api/library`)).json();
    if (!library.scan.running) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal((await post('api/config', { roots: [music] })).status, 200);
  assert.equal((await post('api/library/scan', {})).status, 202);
  let library;
  for (let i = 0; i < 100; i++) {
    library = await (await fetch(`${address}api/library`)).json();
    if (!library.scan.running) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(library.albums.length, 1);
  assert.deepEqual(await fs.readFile(path.join(music, '合成静音.wav')), wav);
  const exit = once(child, 'exit'); child.stdin.write('shutdown\n');
  const [code] = await exit; assert.equal(code, 0);
  await assert.rejects(fetch(`${address}api/health`));
});
