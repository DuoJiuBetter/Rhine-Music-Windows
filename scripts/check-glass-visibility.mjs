// Pure synthetic regression cases; no DOM, GL, accounts, files or audio.
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { canSeedGlassDepth, createConservativeGlassDepthGeometry, GlassVisibilityRenderPass } from "../src/glass-visibility-pass.ts";

function shell() {
  const material = new THREE.MeshPhysicalMaterial({ transmission: .96, transparent: false });
  material.userData.musicShell = true;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(4.1, 3.35, .018), material, 4);
  mesh.userData.surface = "Frosted_Polymer";
  mesh.count = 2;
  return mesh;
}

function fixture(fail) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#eae5e1");
  const group = new THREE.Group(), mesh = shell();
  group.position.set(2, 1, -10); group.add(mesh); scene.add(group);
  const camera = new THREE.PerspectiveCamera(30, 1, 5, 300);
  const pass = new GlassVisibilityRenderPass(scene, camera);
  const read = new THREE.WebGLRenderTarget(300, 180, {
    depthTexture: new THREE.DepthTexture(300, 180, THREE.UnsignedIntType),
  });
  const events = [], clearColor = new THREE.Color("#102030");
  let alpha = .4, target = null;
  const renderer = {
    autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
    shadowMap: { autoUpdate: false, needsUpdate: true },
    extensions: { has: () => false },
    getClearColor: (out) => out.copy(clearColor), getClearAlpha: () => alpha,
    setClearColor: (color, nextAlpha = alpha) => { clearColor.set(color); alpha = nextAlpha; },
    getRenderTarget: () => target, setRenderTarget: (next) => { target = next; },
    clear: (...flags) => events.push({ stage: "clear", flags }),
    render: (drawScene) => {
      const stage = drawScene === scene ? "color" : "depth";
      events.push({ stage, shadowDirty: renderer.shadowMap.needsUpdate,
        clearDepth: renderer.autoClearDepth, background: drawScene.background,
        override: drawScene.overrideMaterial, objects: [...drawScene.children] });
      if (stage === fail) throw new Error("synthetic draw failure");
      if (stage === "color") renderer.shadowMap.needsUpdate = false;
    },
  };
  return { scene, group, mesh, pass, camera, renderer, read, events, clearColor };
}

test("depth proxy selects actual front triangles without filling holes or replacing vertices", () => {
  const source = new THREE.BoxGeometry(4.1, 3.35, .018);
  const depth = createConservativeGlassDepthGeometry(source);
  assert.equal(depth.index.count, 6, "Only the two authored front triangles");
  assert.equal(depth.getAttribute("position"), source.getAttribute("position"));
  const sourceTriples = new Set();
  for (let i = 0; i < source.index.count; i += 3) sourceTriples.add([...source.index.array.slice(i, i + 3)].join(","));
  for (let i = 0; i < depth.index.count; i += 3)
    assert.ok(sourceTriples.has([...depth.index.array.slice(i, i + 3)].join(",")));
  source.setDrawRange(0, 0);
  assert.equal(createConservativeGlassDepthGeometry(source).index.count, 0);
});

test("ordinary alpha, unknown surfaces and altered depth cannot seed glass visibility", () => {
  assert.equal(canSeedGlassDepth(shell()), true);
  for (const change of [
    (m) => { m.material.transparent = true; },
    (m) => { m.material.opacity = .5; },
    (m) => { m.material.alphaTest = .1; },
    (m) => { m.material.depthWrite = false; },
    (m) => { m.material.depthTest = false; },
    (m) => { m.material.wireframe = true; },
    (m) => { m.material.side = THREE.DoubleSide; },
    (m) => { m.material.clippingPlanes = [new THREE.Plane()]; },
    (m) => { m.material.depthFunc = THREE.AlwaysDepth; },
    (m) => { m.material.userData.musicShell = false; },
    (m) => { m.userData.surface = "Unknown custom glass"; },
    (m) => { m.material.transmission = 0; },
  ]) {
    const mesh = shell(); change(mesh); assert.equal(canSeedGlassDepth(mesh), false);
  }
});

test("depth precedes physical color, shares compact matrices, preserves original scene and shadow update", () => {
  const f = fixture();
  const background = f.scene.background, sourceMaterial = f.mesh.material;
  f.pass.render(f.renderer, f.read, f.read, .016, false);
  assert.deepEqual(f.events.map((e) => e.stage), ["depth", "color"]);
  const [depth, color] = f.events;
  assert.equal(depth.shadowDirty, false);
  assert.equal(color.shadowDirty, true);
  assert.equal(color.clearDepth, true, "Transmission keeps its independent depth clear enabled");
  assert.equal(color.background, null, "Main Color background cannot force-clear the seeded depth");
  assert.equal(depth.objects[0].instanceMatrix, f.mesh.instanceMatrix);
  assert.equal(depth.objects[0].count, 2);
  assert.deepEqual(depth.objects[0].matrixWorld.elements, f.mesh.matrixWorld.elements);
  assert.equal(depth.override.colorWrite, false);
  assert.equal(depth.override.polygonOffset, true);
  assert.equal(f.mesh.material, sourceMaterial);
  assert.equal(f.scene.background, background);
  assert.equal(f.renderer.autoClear, true);
  assert.equal(f.renderer.shadowMap.needsUpdate, false, "Consumed real-scene shadow update is not re-armed");
  assert.equal(f.renderer.getClearAlpha(), .4);
  assert.equal(f.clearColor.getHexString(), "102030");
  f.pass.dispose();
});

test("failed depth/color draws restore clear, background, target and shadow scheduling", () => {
  for (const stage of ["depth", "color"]) {
    const f = fixture(stage), background = f.scene.background;
    assert.throws(() => f.pass.render(f.renderer, f.read, f.read, .016, false), /synthetic/);
    assert.equal(f.scene.background, background);
    assert.equal(f.pass.clear, true);
    assert.equal(f.renderer.autoClear, true);
    assert.equal(f.renderer.autoClearDepth, true);
    assert.equal(f.renderer.shadowMap.needsUpdate, true);
    assert.equal(f.renderer.getRenderTarget(), f.read);
    assert.equal(f.clearColor.getHexString(), "102030");
    f.pass.dispose();
  }
});

test("disabled mode and hidden parents retain original rendering behavior", () => {
  for (const off of [true, false]) {
    const f = fixture();
    if (off) f.pass.setMode("off"); else f.group.visible = false;
    f.pass.render(f.renderer, f.read, f.read, .016, false);
    assert.deepEqual(f.events.map((e) => e.stage), ["clear", "color"]);
    assert.equal(f.pass.getStats().depthFrames, 0);
    f.pass.dispose();
  }
});

test("optional analysis unsupported by driver retains optimized physical rendering", () => {
  const f = fixture(); f.pass.setMode("debug");
  f.pass.render(f.renderer, f.read, f.read, .016, false);
  assert.equal(f.pass.getStats().analysisAvailable, false);
  assert.equal(f.pass.getStats().depthFrames, 1);
  assert.equal(f.pass.getStats().areaEstimate, null);
  f.pass.dispose();
});

test("ordinary optimized rendering never creates diagnostic area targets or schedules area readback", () => {
  const f = fixture();
  f.renderer.extensions.has = () => { throw Error('ordinary mode must not probe analysis support'); };
  f.renderer.initRenderTarget = () => { throw Error('ordinary mode must not create diagnostic targets'); };
  f.renderer.readRenderTargetPixelsAsync = () => { throw Error('ordinary mode must not sample diagnostic pixels'); };
  for (let i = 0; i < 325; i++) f.pass.render(f.renderer, f.read, f.read, .016, false);
  assert.equal(f.pass.getStats().depthFrames,325);
  assert.equal(f.pass.getStats().analysisFrames,0);
  assert.equal(f.pass.getStats().areaSampleIntervalFrames,null);
  f.pass.dispose();
});

test("asynchronous area samples are bounded, detach depth and reject stale mode results", async () => {
  const f = fixture();
  f.pass.setMode("debug");
  f.renderer.extensions.has = () => true;
  f.renderer.initRenderTarget = () => {};
  f.renderer.copyTextureToTexture = (source, destination) => {
    assert.equal(source, f.read.depthTexture);
    assert.notEqual(source, destination, "Sampling depth cannot reference the current attachment");
  };
  let finish, reads = 0;
  f.renderer.readRenderTargetPixelsAsync = (_target, _x, _y, w, h, data) => {
    reads++; assert.equal(w, 192); assert.ok(h <= 192);
    data.set([2, 3, 4, 0]); return new Promise((resolve) => { finish = () => resolve(data); });
  };
  f.pass.frames = 63;
  f.pass.render(f.renderer, f.read, f.read, .016, false);
  assert.equal(reads, 1); assert.equal(f.pass.getStats().pendingAreaRead, true);
  f.pass.frames = 319;
  f.pass.render(f.renderer, f.read, f.read, .016, false);
  assert.equal(reads, 1, "One area read at a time; current rendering never waits");
  f.pass.setMode("off"); finish(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.pass.getStats().areaEstimate, null);
  assert.equal(f.renderer.autoClearDepth, true);
  f.pass.dispose();
});
