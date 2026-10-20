import * as THREE from 'three';
import {RenderCostTiming} from './render-cost-timing.mjs';
import {configureMusicGlass, MUSIC_MODEL, MUSIC_COVER} from '../src/music-model.ts';
import {splitMicroFrames} from './transmission-micro-report.mjs';

// Tiny, fixed synthetic scene. No player, audio, accounts, external files or loop.
const sourceComparison = new URLSearchParams(location.search).get('sources') === '1';
const width = 640, height = 400, count = 4, coverSize = 1024, repeats = sourceComparison ? 4 : 8;
const renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: 'default'});
renderer.setPixelRatio(1); renderer.setSize(width, height);
renderer.transmissionResolutionScale = .25;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(renderer.domElement);
const gl = renderer.getContext();
const timer = new RenderCostTiming(gl, {sampleEvery: 1, maxQueries: 192});
let counters = {}, paths = [], recording = false;
globalThis.__rhineMicro = {
  measure(label, draw) {
    if (!recording) return draw();
    const path = [...paths, label].join('/');
    counters[path] = (counters[path] || 0) + 1;
    paths.push(label);
    try { return timer.measure(path, draw); }
    finally { paths.pop(); }
  },
};
const scene = new THREE.Scene(); scene.background = new THREE.Color('#101a28');
scene.add(new THREE.HemisphereLight('#ffffff', '#334455', 3));
const light = new THREE.DirectionalLight('#ffffff', 4); light.position.set(4, 8, 12); scene.add(light);
const camera = new THREE.PerspectiveCamera(40, width / height, .1, 100);
camera.position.set(7, 5, 19); camera.lookAt(0, 0, 0);
const shellGeometry = new THREE.BoxGeometry(MUSIC_MODEL.width, MUSIC_MODEL.height, MUSIC_MODEL.depth);
const coverGeometry = new THREE.PlaneGeometry(MUSIC_COVER.width, MUSIC_COVER.height);
const glass = new THREE.MeshPhysicalMaterial(); configureMusicGlass('Frosted_Polymer', glass);
function makeCanvases(cpu = false) { return Array.from({length: count}, (_, i) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = coverSize;
  const c = canvas.getContext('2d', cpu ? {willReadFrequently: true} : undefined);
  c.fillStyle = ['#bb7041', '#4687a9', '#ad547b', '#789c58'][i]; c.fillRect(0, 0, coverSize, coverSize);
  for (let y = 0; y < 32; y++) {
    c.fillStyle = y % 2 ? '#ffffff55' : '#00000033'; c.fillRect(0, y * 32, coverSize, 12);
  }
  c.fillStyle = '#fff'; c.font = 'bold 100px sans-serif'; c.fillText('SYNTH ' + (i + 1), 70, 540);
  return canvas;
}); }
const canvases = makeCanvases();
let cpuCanvases, pixels, bitmaps, sourcePreparationMs;
const textures = (kind = 'canvas') => canvases.map((canvas,i) => {
  let t;
  if (kind === 'data') {
    t = new THREE.DataTexture(pixels[i], coverSize, coverSize); t.flipY = true;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
  } else if (kind === 'bitmap') {
    t = new THREE.Texture(bitmaps[i]); t.flipY = false; t.needsUpdate = true;
  } else t = new THREE.CanvasTexture(kind === 'cpu' ? cpuCanvases[i] : canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
});
const resident = textures(), recycled = textures(), materials = [], shells = [], transientTextures = new Set();
for (let i = 0; i < count; i++) {
  const group = new THREE.Group(); group.position.set((i % 2 - .5) * 4.9, (.5 - Math.floor(i / 2)) * 3.8, 0);
  group.rotation.y = -.2;
  const shell = new THREE.Mesh(shellGeometry, glass); shells.push(shell); group.add(shell);
  const material = new THREE.MeshBasicMaterial({map: resident[i]}); materials.push(material);
  const print = new THREE.Mesh(coverGeometry, material); print.position.set(MUSIC_COVER.x, 0, MUSIC_COVER.z);
  print.onBeforeRender = () => {
    if (recording) {
      const name = 'coverDraw/' + (paths.includes('transmissionOpaque') ? 'transmission' : 'main');
      counters[name] = (counters[name] || 0) + 1;
    }
  };
  group.add(print); scene.add(group);
}
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const cases = sourceComparison ? ['resident','cold-new','cold-cpu-canvas','cold-data','cold-bitmap']
  : ['resident', 'cold-new', 'dirty-reuse', 'cold-preupload-same-frame', 'cold-preupload-prior-frame', 'resident-no-glass'];
let contextLost = false;
renderer.domElement.addEventListener('webglcontextlost', () => {contextLost = true;});
function check() {
  if (contextLost || gl.isContextLost()) throw Error('Context lost; no retry');
  if (gl.getError() !== gl.NO_ERROR) throw Error('WebGL error; no retry');
}
async function capture(draw, preupload) {
  const phases = [];
  timer.start();
  for (const issue of preupload ? [preupload, draw] : [draw]) {
    await nextFrame(); check(); counters = {}; paths = []; recording = true; timer.begin();
    const started = performance.now(); let issuedQueries;
    try { issue(); } finally {
      issuedQueries = (timer.frame?.queries.length || 0) + Number(Boolean(timer.current));
      timer.end(); recording = false;
    }
    phases.push({submissionMs: performance.now() - started, counters: {...counters}, issuedQueries});
  }
  // Do not wait for an upload-only query before submitting the following draw.
  // Both frames remain separately measured; no gl.flush/finish or free upload.
  timer.stop();
  const deadline = performance.now() + 2000;
  let result = timer.snapshot();
  while (result.capture.pendingFrames && performance.now() < deadline) {
    await nextFrame(); result = timer.snapshot();
  }
  check();
  if (!result.available || result.samples !== phases.length || result.capture.pendingFrames || result.capture.droppedFrames || result.capture.disjointEvents) {
    window.transmissionMicroFailure = {available: result.available, samples: result.samples,
      pending: result.capture.pendingFrames, dropped: result.capture.droppedFrames, disjoint: result.capture.disjointEvents,
      phases, capture: result.capture};
    throw Error('Incomplete GPU sample: ' + JSON.stringify({available: result.available, samples: result.samples,
      pending: result.capture.pendingFrames, dropped: result.capture.droppedFrames, disjoint: result.capture.disjointEvents,
      issuedQueries: phases.map(p => p.issuedQueries)}) + '; no retry');
  }
  const captures = splitMicroFrames(result.capture, phases);
  return {render: captures.at(-1), preparation: preupload ? captures[0] : undefined};
}
window.runTransmissionMicro = async () => {
  const started = performance.now(), rows = [];
  window.transmissionMicroPartial = {rows, currentTrial: null};
  try {
    if (sourceComparison) {
      let t = performance.now(); cpuCanvases = makeCanvases(true);
      const cpuCanvasMs = performance.now() - t;
      t = performance.now(); pixels = cpuCanvases.map(c => new Uint8Array(c.getContext('2d').getImageData(0,0,coverSize,coverSize).data));
      const pixelReadMs = performance.now() - t;
      t = performance.now(); bitmaps = await Promise.all(canvases.map(c => createImageBitmap(c, {imageOrientation:'flipY',premultiplyAlpha:'none'})));
      sourcePreparationMs = {cpuCanvasMs,pixelReadMs,bitmapMs:performance.now()-t};
    }
    for (const t of [...resident, ...recycled]) renderer.initTexture(t);
    await renderer.compileAsync(scene, camera);
    for (let i = 0; i < 4; i++) {await nextFrame(); renderer.render(scene, camera);}
    if (!timer.ext) throw Error('GPU timing extension unavailable; no software fallback');
    const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const device = rendererInfo ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const warmPrograms = renderer.info.programs.length;
    Object.assign(window.transmissionMicroPartial, {device, warmPrograms,
      config: {width, height, count, coverSize, transmissionScale: .25, sourceComparison, sourcePreparationMs}});
    for (let repeat = 0; repeat < repeats; repeat++) {
      // Rotate case order to distribute ordering bias, while keeping every pair.
      for (let index = 0; index < cases.length; index++) {
        if (performance.now() - started > 12000) throw Error('12s scene deadline; no retry');
        const name = cases[(index + repeat) % cases.length];
        window.transmissionMicroPartial.currentTrial = {repeat, name};
        const kind = name === 'cold-cpu-canvas' ? 'cpu' : name === 'cold-data' ? 'data' : name === 'cold-bitmap' ? 'bitmap' : 'canvas';
        const cold = name.startsWith('cold-'), current = cold ? textures(kind) : name === 'dirty-reuse' ? recycled : resident;
        if (cold) current.forEach(t => transientTextures.add(t));
        for (let i = 0; i < count; i++) {materials[i].map = current[i]; shells[i].visible = name !== 'resident-no-glass';}
        if (name === 'dirty-reuse') for (const t of current) t.needsUpdate = true;
        const preupload = () => globalThis.__rhineMicro.measure('explicitPreupload', () => current.forEach(t => renderer.initTexture(t)));
        const {render, preparation} = await capture(() => {
          if (name === 'cold-preupload-same-frame') globalThis.__rhineMicro.measure('explicitPreupload', () => current.forEach(t => renderer.initTexture(t)));
          globalThis.__rhineMicro.measure('renderRest', () => renderer.render(scene, camera));
        }, name === 'cold-preupload-prior-frame' ? preupload : undefined);
        const expected = name === 'resident-no-glass' ? 0 : count;
        if ((render.counters['coverDraw/transmission'] || 0) !== expected || render.counters['coverDraw/main'] !== count)
          throw Error('Expected cover draws did not occur');
        rows.push({repeat, name, preparation, render, programs: renderer.info.programs.length,
          drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles});
        if (cold) {for (let i = 0; i < count; i++) materials[i].map = resident[i]; current.forEach(t => {t.dispose(); transientTextures.delete(t);});}
      }
    }
    if (renderer.info.programs.length !== warmPrograms) throw Error('Unexpected shader compilation during trials');
    return {completed: true, device, elapsedMs: performance.now() - started,
      config: {width, height, transmissionWidth: width * .25, transmissionHeight: height * .25,
        cards: count, coverSize, repeats, antialias: false, transmissionScale: .25, sourceComparison, sourcePreparationMs,
        glass: {transmission: glass.transmission, roughness: glass.roughness, thickness: glass.thickness, ior: glass.ior},
        note: 'Uses project glass configuration and dimensions; simplified boxes, no array, custom row lighting, AO, shadows, DOF or player.'},
      warmPrograms, rows};
  } finally {
    recording = false; timer.dispose(); [...resident, ...recycled, ...transientTextures].forEach(t => t.dispose());
    materials.forEach(m => m.dispose()); glass.dispose(); shellGeometry.dispose(); coverGeometry.dispose(); renderer.dispose();
    bitmaps?.forEach(b => b.close());
  }
};
