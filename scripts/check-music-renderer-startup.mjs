// Executes the production methods extracted with TypeScript's AST. The GPU is
// replaced by counters; this verifies ownership/order, not real frame rate.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import ts from "typescript";
import * as THREE from "three";

const source = await readFile(new URL("../src/scene.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const sceneClass = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "ArchiveScene");
assert.ok(sceneClass, "Production ArchiveScene must exist");
const methods = ["prepareMusicRenderer", "dispose"].map(name => {
  const method = sceneClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === name);
  assert.ok(method?.body, `Production ${name} must exist`);
  return method.getText(tree);
}).join("\n");
const compiled = ts.transpileModule(`return { ${methods} };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const microtasks = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function fixture({ dirtyTiles = 432, compileGate, coverGate, music = true, loaded = true, uploadCostMs = 0, offscreen = false } = {}) {
  const calls = [], frames = [], disposals = new Map();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), model = new THREE.Group();
  model.visible = false;
  let now = 1000, dirty = dirtyTiles;
  const recordDisposal = (name, resource) => {
    resource.addEventListener("dispose", () => disposals.set(name, (disposals.get(name) ?? 0) + 1));
    return resource;
  };
  const geometry = recordDisposal("sharedGeometry", new THREE.BoxGeometry());
  const pointGeometry = recordDisposal("pointGeometry", new THREE.BufferGeometry());
  const print = recordDisposal("sharedTexture", new THREE.Texture());
  const label = recordDisposal("labelTexture", new THREE.Texture());
  const environment = recordDisposal("environment", new THREE.Texture());
  environment.isRenderTargetTexture = true;
  const passTexture = recordDisposal("passTexture", new THREE.Texture());
  passTexture.isRenderTargetTexture = true;
  const material = recordDisposal("sharedMaterial", new THREE.MeshBasicMaterial({ map: print, envMap: environment }));
  const secondMaterial = recordDisposal("secondMaterial", new THREE.MeshBasicMaterial({ map: passTexture }));
  const pointMaterial = recordDisposal("pointMaterial", new THREE.PointsMaterial());
  scene.add(new THREE.Mesh(geometry, material));
  scene.add(new THREE.Mesh(geometry, [material, secondMaterial, material]));
  scene.add(new THREE.InstancedMesh(geometry, material, 2));
  scene.add(new THREE.Points(pointGeometry, pointMaterial));
  scene.environment = environment;
  const originalClear = scene.clear;
  scene.clear = function () { calls.push("scene.clear"); return originalClear.call(this); };
  const coverState = {
    async prepareVisible(timeout) {
      calls.push(["prepareVisible", timeout]);
      if (coverGate) await coverGate.promise;
      return { settled: dirty === 0 };
    },
    getStats: () => ({ dirtyTiles: dirty }),
    flushUploads(renderer, maximum, budget) {
      assert.equal(renderer, instance.renderer);
      assert.equal(budget.maxTransfers, 1);
      assert.equal(budget.timeBudgetMs, 2);
      const count = offscreen ? 0 : Math.min(maximum, dirty);
      now += uploadCostMs;
      dirty -= count;
      calls.push(["upload", maximum, count]);
      return count;
    },
    dispose() { calls.push("covers.dispose"); },
  };
  const instance = {
    async prepareIntroCovers() { calls.push('intro-covers'); },
    disposed: false, loaded, model, scene, camera, covers: coverState, coverPriority: Array.from({length: 432}, (_, i) => i),
    container: { dataset: {} }, labelTexture: label, outgoing: [{ group: model }],
    returningPool: { invalidate: () => calls.push("returningPool.dispose") },
    light: { shadow: { dispose: () => calls.push("shadow.dispose") } },
    renderer: {
      async compileAsync(actualScene, actualCamera) {
        assert.equal(actualScene, scene); assert.equal(actualCamera, camera);
        assert.equal(model.visible, true, "The selected model participates in compilation even when it was hidden");
        calls.push("compile");
        if (compileGate) await compileGate.promise;
      },
      extensions: { has: name => { assert.equal(name, "KHR_parallel_shader_compile"); return true; } },
      getContext: () => ({ getError: () => 0 }),
      dispose: () => calls.push("renderer.dispose"),
      forceContextLoss: () => calls.push("renderer.forceContextLoss"),
      domElement: { remove: () => calls.push("canvas.remove") },
    },
    composer: {
      passes: Array.from({ length: 5 }, (_, index) => ({ dispose() { calls.push(`pass${index}.dispose`); } })),
      render: () => calls.push("draw"),
      dispose: () => calls.push("composer.dispose"),
    },
    update(time, pose, render = true) {
      assert.equal(pose.musicIntro, true);
      assert.ok([21.92, 27.12].includes(pose.time));
      assert.ok(Number.isFinite(time));
      calls.push(["pose", render, pose.time]);
      // Main-scene update/render behavior is intentionally a mock boundary.
      // The tested production method must request exactly two real draws.
      if (render) this.composer.render();
    },
    setMode: mode => calls.push(["mode", mode]),
  };
  Object.assign(instance, new Function("THREE", "musicLibrary", "performance", "yieldStartupFrame", compiled)(
    THREE, music, { now: () => now }, () => new Promise(resolve => frames.push(resolve)),
  ));
  return {
    instance, calls, frames, disposals,
    nextFrame() { assert.ok(frames.length, "A prewarm continuation must exist"); now += 16; frames.shift()(now); },
    async finish(promise) {
      let done = false, failed;
      promise.then(() => { done = true; }, error => { failed = error; done = true; });
      for (let index = 0; index < 140 && !done; index++) {
        await microtasks();
        if (!done && frames.length) this.nextFrame();
      }
      assert.ok(done, "Renderer preparation cannot schedule unbounded frames");
      if (failed) throw failed;
      await promise;
    },
  };
}

const cold = fixture();
const coldPreparation = cold.instance.prepareMusicRenderer();
await cold.finish(coldPreparation);
const coldUploads = cold.calls.filter(call => Array.isArray(call) && call[0] === "upload");
assert.deepEqual(cold.calls.filter(call=>call[0]==='pose'&&call[1]).map(call=>call[2]),[27.12,21.92],
  'Exactly two draws warm the settled and opening cameras, ending at the first wave frame');
assert.equal(coldUploads.length, 108);
assert.equal(coldUploads.reduce((sum, call) => sum + call[2], 0), 432);
assert.ok(coldUploads.every(call => call[1] === 4 && call[2] <= 4));
assert.equal(cold.calls.filter(call => call === "draw").length, 2);
assert.ok(cold.calls.indexOf("compile") < cold.calls.indexOf("draw"), "Compilation precedes every real draw");
assert.deepEqual(cold.calls[0], ["pose", false, 27.12], "The first pose setup performs no render");
assert.deepEqual(cold.calls.filter(call => Array.isArray(call) && call[0] === "prepareVisible"), [["prepareVisible", 1200]]);
assert.equal(cold.instance.model.visible, false, "Compilation restores the model's original visibility");
assert.deepEqual(cold.calls.at(-1), ["mode", "hidden"], "Prewarm returns the scene to its hidden opening pose");
const diagnostics = JSON.parse(cold.instance.container.dataset.startupPreparation);
assert.equal(diagnostics.glError, 0);
assert.equal(diagnostics.parallelCompile, true);
assert.equal(diagnostics.covers.dirtyTiles, 0);
assert.ok(diagnostics.milliseconds > 0);
assert.ok(!cold.calls.includes('intro-covers'), 'Disabling the opening keeps ordinary startup short');
const openingArt = fixture({dirtyTiles: 0});
await openingArt.finish(openingArt.instance.prepareMusicRenderer(true));
assert.ok(openingArt.calls.indexOf('intro-covers') < openingArt.calls.indexOf('draw'),
  'Opening artwork preparation must finish before either real warmup draw');

const unboundedInputs = fixture({ dirtyTiles: 10000 });
await unboundedInputs.finish(unboundedInputs.instance.prepareMusicRenderer());
const boundedUploads = unboundedInputs.calls.filter(call => Array.isArray(call) && call[0] === "upload");
assert.equal(boundedUploads.length, 120, "Newly arriving covers cannot extend the prewarm loop indefinitely");
assert.equal(boundedUploads.reduce((sum, call) => sum + call[2], 0), 120 * 4);
assert.equal(unboundedInputs.calls.filter(call => call === "draw").length, 2);
const slowUploads = fixture({dirtyTiles: 10000, uploadCostMs: 100});
await slowUploads.finish(slowUploads.instance.prepareMusicRenderer());
assert.ok(slowUploads.calls.filter(call => call[0] === 'upload').length < 25, 'Slow transfers hit the wall-time cap instead of extending the loading screen');
const offscreen = fixture({offscreen: true});
await offscreen.finish(offscreen.instance.prepareMusicRenderer());
assert.equal(offscreen.calls.filter(call => call[0] === 'upload').length, 1, 'Offscreen dirty tiles do not cause an empty warmup loop');
const warm = fixture({ dirtyTiles: 0 });
await warm.finish(warm.instance.prepareMusicRenderer());
assert.equal(warm.calls.filter(call => Array.isArray(call) && call[0] === "upload").length, 0);
assert.equal(warm.calls.filter(call => call === "draw").length, 2);

for (const options of [{ music: false }, { loaded: false }]) {
  const skipped = fixture(options);
  await skipped.instance.prepareMusicRenderer();
  assert.deepEqual(skipped.calls, [], "A non-music or unloaded scene does no prewarm work");
}

function gpuWork(calls) {
  return calls.filter(call => call === "compile" || call === "draw" || Array.isArray(call) && call[0] === "upload");
}
for (const boundary of ["compile", "covers", "uploadFrame", "drawFrame"]) {
  const gate = deferred();
  const interrupted = fixture({
    dirtyTiles: boundary === "drawFrame" ? 0 : 432,
    compileGate: boundary === "compile" ? gate : undefined,
    coverGate: boundary === "covers" ? gate : undefined,
  });
  const task = interrupted.instance.prepareMusicRenderer();
  await microtasks();
  if (boundary === "compile") assert.ok(interrupted.calls.includes("compile"));
  if (boundary === "covers") assert.ok(interrupted.calls.some(call => call[0] === "prepareVisible"));
  if (boundary.endsWith("Frame")) assert.equal(interrupted.frames.length, 1);
  const before = gpuWork(interrupted.calls);
  interrupted.instance.dispose();
  if (boundary.endsWith("Frame")) interrupted.nextFrame();
  else gate.resolve();
  await interrupted.finish(task);
  assert.deepEqual(gpuWork(interrupted.calls), before, `Disposal during ${boundary} prevents all later compile/upload/draw work`);
  assert.equal(interrupted.frames.length, 0);
  assert.equal(interrupted.instance.container.dataset.startupPreparation, undefined, "An abandoned prewarm cannot report success");
}

const resources = fixture();
resources.instance.dispose();
assert.equal(resources.instance.disposed, true);
assert.equal(resources.instance.loaded, false);
assert.equal(resources.instance.covers, undefined);
assert.equal(resources.instance.scene.children.length, 0);
assert.deepEqual(resources.instance.outgoing, []);
assert.deepEqual(Object.fromEntries(resources.disposals), {
  sharedGeometry: 1, pointGeometry: 1,
  sharedMaterial: 1, secondMaterial: 1, pointMaterial: 1,
  sharedTexture: 1, labelTexture: 1, environment: 1,
}, "Shared meshes/material arrays release each owned geometry, material and standalone texture once; pass targets are owned by their pass");
for (const name of ["returningPool.dispose", "covers.dispose", "shadow.dispose", ...Array.from({ length: 5 }, (_, i) => `pass${i}.dispose`),
  "composer.dispose", "scene.clear", "renderer.dispose", "renderer.forceContextLoss", "canvas.remove"])
  assert.equal(resources.calls.filter(call => call === name).length, 1, `${name} runs exactly once`);
assert.deepEqual(resources.calls.slice(-3), ["renderer.dispose", "renderer.forceContextLoss", "canvas.remove"]);
const afterDispose = [...resources.calls];
resources.instance.dispose();
await resources.instance.prepareMusicRenderer();
assert.deepEqual(resources.calls, afterDispose, "Repeated cleanup and late preparation cannot resurrect the renderer");

const qualitySource = await readFile(new URL("../src/quality-renderer.ts", import.meta.url), "utf8");
const qualityTree = ts.createSourceFile("quality-renderer.ts", qualitySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const qualityFunction = qualityTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "applyTextureQuality");
assert.ok(qualityFunction?.body);
assert.deepEqual(qualityFunction.parameters.map(parameter => parameter.name.getText(qualityTree)), ["root", "renderer", "quality"]);
const qualityCode = ts.transpileModule(`return function applyTextureQuality(root, renderer, quality) ${qualityFunction.body.getText(qualityTree)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const applyTextureQuality = new Function("THREE", qualityCode)(THREE);
const qualityScene = new THREE.Scene();
const atlas = new THREE.Texture(), selected = new THREE.Texture(), ordinary = new THREE.Texture(), target = new THREE.Texture();
atlas.anisotropy = 1; atlas.userData.maxAnisotropy = 1;
selected.anisotropy = 8; selected.userData.maxAnisotropy = 8;
target.isRenderTargetTexture = true; target.anisotropy = 16; target.userData.maxAnisotropy = 1;
const textures = [atlas, selected, ordinary, target];
const qualityGeometry = new THREE.PlaneGeometry();
const qualityMaterials = textures.map(map => new THREE.MeshBasicMaterial({ map }));
qualityScene.add(new THREE.Mesh(qualityGeometry, qualityMaterials));
qualityScene.add(new THREE.Mesh(qualityGeometry, qualityMaterials));
const renderer = { capabilities: { getMaxAnisotropy: () => 16 } };
applyTextureQuality(qualityScene, renderer, { anisotropy: 16 });
assert.deepEqual(textures.map(texture => texture.anisotropy), [1, 8, 16, 16]);
assert.deepEqual(textures.map(texture => texture.version), [0, 0, 1, 0], "Quality presets cannot dirty the 108 MiB atlas when its guard is already correct");
applyTextureQuality(qualityScene, renderer, { anisotropy: 16 });
assert.deepEqual(textures.map(texture => texture.version), [0, 0, 1, 0], "Repeated quality requests do not upload textures again");
applyTextureQuality(qualityScene, renderer, { anisotropy: 4 });
assert.deepEqual(textures.map(texture => texture.anisotropy), [1, 4, 4, 16]);
assert.equal(atlas.version, 0);
renderer.capabilities.getMaxAnisotropy = () => 2;
applyTextureQuality(qualityScene, renderer, { anisotropy: 16 });
assert.deepEqual(textures.map(texture => texture.anisotropy), [1, 2, 2, 16], "Hardware limits remain authoritative inside ownership limits");
renderer.capabilities.getMaxAnisotropy = () => 16;
ordinary.userData.maxAnisotropy = NaN;
applyTextureQuality(qualityScene, renderer, { anisotropy: 16 });
assert.equal(ordinary.anisotropy, 16, "An invalid optional ownership limit cannot introduce NaN into GPU state");
for (const texture of textures) texture.dispose();
qualityGeometry.dispose(); qualityMaterials.forEach(material => material.dispose());

console.log(JSON.stringify({
  sourceHash: createHash("sha256").update(compiled).update(qualityCode).digest("hex").slice(0, 12),
  preparation: { coldTiles: 432, coldUploadTurns: coldUploads.length, maximumUploadTurns: boundedUploads.length, maximumTilesPerTurn: 4, realDraws: 2 },
  interruptionBoundaries: ["compile", "covers", "uploadFrame", "drawFrame"],
  disposal: { idempotent: true, uniqueResourceOwnership: true, passes: 5, contextLost: true, canvasRemoved: true },
  textureQuality: { atlasAnisotropy: 1, atlasReuploadsFromPresets: 0, selectionMaximum: 8, hardwareLimitRespected: true },
  scope: "Production AST method/function execution with mocked GPU. Browser pixel, GL error and frame-rate measurements are separate.",
}, null, 2));
