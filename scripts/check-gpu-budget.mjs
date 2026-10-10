// Pure quality/lifecycle regression with renderer calls recorded, no GL context.
// Shader compilation, pixels and real-device frame time require separate QA.
import test from "node:test";
import assert from "node:assert/strict";
import {
  Scene,
  PerspectiveCamera,
  Texture,
  WebGLRenderTarget,
  Frustum,
  Matrix4,
  MeshPhysicalMaterial,
  Mesh, PlaneGeometry, MeshLambertMaterial, Color,
} from "three";
import { SceneInstanceBudget } from "../src/scene-instance-budget.ts";
import { ShadowUpdateBudget } from "../src/shadow-update-budget.ts";
import { GpuFrameTiming } from "../src/gpu-frame-timing.ts";
import { CoverClarityPass, CoverClarityState } from "../src/cover-clarity-pass.ts";
import { addGlassCoverage, createFarGlass } from "../src/music-glass-lod.ts";
import { BudgetSSAOPass } from "../src/budget-ssao.ts";
import { SharedDepthBokehPass } from "../src/shared-depth-bokeh.ts";
import {
  initialDesktopQuality,
  qualityPresets,
  normalizeQuality,
  renderDimensions,
} from "../src/render-quality.ts";

test("desktop migration only changes the old default once and preserves custom/explicit choices", () => {
  const { depthOfFieldResolution: _new, ...oldDefault } =
    qualityPresets.original;
  const migrated = initialDesktopQuality(
    { quality: "original", renderQuality: oldDefault },
    true,
  );
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.quality, qualityPresets.balanced);
  assert.deepEqual(
    initialDesktopQuality({}, true).quality,
    qualityPresets.balanced,
  );
  assert.deepEqual(
    initialDesktopQuality({}, false).quality,
    qualityPresets.original,
  );
  const custom = { ...oldDefault, transmission: 0.75 };
  assert.deepEqual(
    initialDesktopQuality({ quality: "original", renderQuality: custom }, true)
      .quality,
    normalizeQuality(custom),
  );
  assert.deepEqual(
    initialDesktopQuality(
      { quality: "original", qualityPipelineVersion: 2 },
      true,
    ).quality,
    qualityPresets.original,
  );
  assert.deepEqual(
    initialDesktopQuality(
      { quality: "original", renderQuality: oldDefault },
      false,
    ).quality,
    qualityPresets.original,
  );
  assert.deepEqual(
    initialDesktopQuality({ quality: "performance" }, true).quality,
    qualityPresets.performance,
  );
});

test("Perf3 balanced settings upgrade once, custom and explicit original settings survive", () => {
  const previous = { ...qualityPresets.balanced, antialias: "off", pixelRatio: 1.5, aoSamples: 16, transmission: 0.5 };
  assert.deepEqual(initialDesktopQuality({ quality: "balanced", renderQuality: previous, qualityPipelineVersion: 2 }, true).quality, qualityPresets.balanced);
  const custom = { ...previous, scale: 90 };
  assert.deepEqual(initialDesktopQuality({ quality: "balanced", renderQuality: custom, qualityPipelineVersion: 2 }, true).quality, custom);
  assert.deepEqual(initialDesktopQuality({ quality: "balanced", renderQuality: previous, qualityPipelineVersion: 4 }, true).quality, previous);
  assert.deepEqual(initialDesktopQuality({ quality: "original", qualityPipelineVersion: 4 }, true).quality, qualityPresets.original);
  const desktop = renderDimensions(qualityPresets.balanced, 1280, 800, 1, 1.5, 16384);
  assert.deepEqual([desktop.width, desktop.height], [1280, 800]);
  const large = renderDimensions(qualityPresets.balanced, 2560, 1600, 1, 1.5, 16384);
  assert.ok(large.width * large.height <= 1_440_000);
});

test("Perf4 exact balanced preset enables SMAA once without changing custom preferences", () => {
  const previous = { ...qualityPresets.balanced, antialias: "off" };
  assert.deepEqual(initialDesktopQuality({ quality: "balanced", renderQuality: previous, qualityPipelineVersion: 4 }, true).quality, qualityPresets.balanced);
  assert.deepEqual(initialDesktopQuality({ quality: "balanced", renderQuality: previous, qualityPipelineVersion: 5 }, true).quality, previous);
  const custom = { ...previous, scale: 90 };
  assert.deepEqual(initialDesktopQuality({ quality: "balanced", renderQuality: custom, qualityPipelineVersion: 4 }, true).quality, custom);
});

test("native clear cover pass retains scene visibility, depth ownership and exposure after success or failure", () => {
  const scene = new Scene(), camera = new PerspectiveCamera();
  scene.background = new Color("navy");
  const background = scene.background;
  const cover = new Mesh(new PlaneGeometry(), new MeshLambertMaterial({ toneMapped: false }));
  cover.userData.albumCover = true;
  const shell = new Mesh(new PlaneGeometry(), new MeshPhysicalMaterial());
  const hidden = new Mesh(new PlaneGeometry(), new MeshPhysicalMaterial()); hidden.visible = false;
  scene.add(cover, shell, hidden);
  const state = new CoverClarityState();
  const pass = new CoverClarityPass(scene, camera, state);
  pass.renderToScreen = true; pass.setSize(1280, 800);
  const source = new Texture(); pass.depthSource = () => ({ texture: source, packed: false });
  const read = new WebGLRenderTarget(1280, 800), write = read.clone();
  const { renderer } = recorder();
  renderer.shadowMap = { autoUpdate: true, needsUpdate: true };
  renderer.getDrawingBufferSize = size => size.set(1920, 1200);
  let fail = false, coverFrames = 0;
  renderer.render = object => {
    if (object !== scene) return;
    assert.equal(shell.visible, false);
    assert.equal(cover.visible, true);
    assert.equal(state.depth.value, source);
    assert.equal(cover.material.depthTest, false);
    assert.equal(cover.material.toneMapped, true);
    assert.equal(cover.material.transparent, true, "only the sharp overlay uses alpha blending");
    coverFrames++;
    if (fail) throw new Error("draw failure");
  };
  pass.render(renderer, write, read);
  assert.deepEqual([pass.getStats().width, pass.getStats().height], [1920, 1200]);
  fail = true;
  assert.throws(() => pass.render(renderer, write, read), /draw failure/);
  assert.equal(coverFrames, 2);
  assert.equal(shell.visible, true); assert.equal(hidden.visible, false);
  assert.equal(cover.material.depthTest, true); assert.equal(cover.material.toneMapped, false);
  assert.equal(cover.material.transparent, false, "the physical print stays opaque after success and failure");
  assert.equal(state.enabled.value, false); assert.equal(state.depth.value, null);
  assert.equal(scene.background, background); assert.equal(scene.overrideMaterial, null);
  assert.equal(renderer.shadowMap.autoUpdate, true); assert.equal(renderer.shadowMap.needsUpdate, true);
  assert.equal(renderer.autoClear, true);
  pass.dispose(); source.dispose(); read.dispose(); write.dispose();
  for (const mesh of [cover, shell, hidden]) { mesh.geometry.dispose(); mesh.material.dispose(); }
});

test("Perf2 presets backfill the new array control without overriding an explicit saved choice", () => {
  const { arrayBudget: _new, ...perf2 } = qualityPresets.balanced;
  assert.equal(
    initialDesktopQuality(
      { quality: "balanced", renderQuality: perf2, qualityPipelineVersion: 2 },
      true,
    ).quality.arrayBudget,
    1,
  );
  assert.equal(
    initialDesktopQuality(
      {
        quality: "balanced",
        renderQuality: { ...perf2, arrayBudget: 0 },
        qualityPipelineVersion: 2,
      },
      true,
    ).quality.arrayBudget,
    0,
  );
});

test("view compaction retains logical picking IDs and independent offscreen shadow casters", () => {
  const budget = new SceneInstanceBudget(4);
  const camera = new PerspectiveCamera(60, 1, 1, 100);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const shadow = new Frustum().setFromProjectionMatrix(
    new Matrix4().makeOrthographic(-200, 200, 200, -200, 0.1, 500),
  );
  new Matrix4().makeTranslation(0, 0, -10).toArray(budget.pool, 0);
  new Matrix4().makeTranslation(50, 0, -10).toArray(budget.pool, 16);
  new Matrix4().makeTranslation(0, 0, -30).toArray(budget.pool, 32);
  new Matrix4().makeScale(0, 0, 0).toArray(budget.pool, 48);
  budget.update(camera, shadow, 10, 0.003, 0.011, 2560, 0.016, false);
  assert.deepEqual(budget.visibleSlots, [0, 2]);
  assert.ok(
    budget.shadowSlots.includes(1),
    "Outside the view is not outside the light",
  );
  assert.ok(
    !budget.shadowSlots.includes(3),
    "Hidden ownership copies remain hidden",
  );
  assert.deepEqual(budget.nearSlots, [0, 2], "Even out-of-focus visible cards keep physical glass");
  assert.deepEqual(budget.farSlots, []);
  assert.equal(budget.snapshot().materialPolicy, "all-visible-physical");
  assert.equal(
    budget.visibleMatrices.array[16 + 14],
    -30,
    "Instance ID 1 maps back to logical slot 2",
  );
  budget.update(camera, shadow, 10, 0, 0.011, 2560, 0.01, true);
  assert.equal(budget.snapshot().overlappingGlass, 0);
  budget.update(camera, shadow, 10, 0, 0.011, 2560, 1, false);
  assert.equal(budget.farSlots.length, 0, "Visible cards never use simplified glass");
  assert.deepEqual(budget.nearSlots, [0, 2]);
});

test("dense visible shelf keeps every card physical with DOF on or off", () => {
  const budget = new SceneInstanceBudget(40);
  const camera = new PerspectiveCamera(60, 1, 1, 100);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const shadow = new Frustum().setFromProjectionMatrix(new Matrix4().makeOrthographic(-200, 200, 200, -200, .1, 500));
  for (let i = 0; i < 40; i++) new Matrix4().makeTranslation((i % 8 - 4) * .2, 0, -10 - Math.floor(i / 8) * .1).toArray(budget.pool, i * 16);
  for (const aperture of [0, .0003]) {
    budget.update(camera, shadow, 10, aperture, .011, 1280, .016, true);
    assert.equal(budget.nearSlots.length, 40);
    assert.equal(budget.farSlots.length, 0);
    assert.equal(budget.snapshot().nearLimit, null);
    assert.equal(new Set([...budget.nearSlots, ...budget.farSlots]).size, 40);
    assert.equal(budget.snapshot().overlappingGlass, 0);
  }
});

test("shadow cadence keeps accumulated movement and invalidation remains immediate", () => {
  const budget = new ShadowUpdateBudget();
  assert.equal(budget.shouldUpdate([0], false, .01, 0), true);
  assert.equal(budget.shouldUpdate([.1], false, .01, .05), false);
  assert.equal(budget.shouldUpdate([.1], false, .01, .13), true);
  assert.equal(budget.shouldUpdate([.2], true, .01, .14), false);
  assert.equal(budget.shouldUpdate([.2], true, .01, .17), true);
  budget.invalidate();
  assert.equal(budget.shouldUpdate([.2], false, .01, .171), true);
  assert.equal(budget.snapshot().throttled, 2);
});

test("shadow budget accumulates small movement and updates throughout choreography", () => {
  const budget = new ShadowUpdateBudget();
  assert.equal(budget.shouldUpdate([0, 0], false, 0.004), true);
  assert.equal(budget.shouldUpdate([0, 0], false, 0.004), false);
  assert.equal(budget.shouldUpdate([0.002, 0], false, 0.004), false);
  assert.equal(budget.shouldUpdate([0.005, 0], false, 0.004), true);
  assert.equal(budget.shouldUpdate([0.005, 0], true, 0.004), true);
  budget.invalidate();
  assert.equal(budget.shouldUpdate([0.005, 0], false, 0.004), true);
  assert.equal(budget.shouldUpdate([0.005, 0, 1], false, 0.004), true);
});

test("glass coverage shaders use complementary discard rules and far glass has no physical transmission", () => {
  const source = new MeshPhysicalMaterial({ transmission: 0.96 });
  addGlassCoverage(source);
  const far = createFarGlass(source, "Frosted_Polymer", () => undefined);
  const shader = () => ({
    uniforms: {},
    vertexShader: "#include <begin_vertex>",
    fragmentShader: "#include <alphatest_fragment>\n#include <opaque_fragment>",
  });
  const nearShader = shader(),
    farShader = shader();
  source.onBeforeCompile(nearShader, {});
  far.onBeforeCompile(farShader, {});
  assert.match(nearShader.fragmentShader, /vSceneCoverage <= sceneNoise/);
  assert.match(farShader.fragmentShader, /1.0 - vSceneCoverage > sceneNoise/);
  assert.equal(far.isMeshPhysicalMaterial, undefined);
  assert.equal(far.isMeshLambertMaterial, true);
  assert.equal(far.forceSinglePass, true);
  assert.equal(far.transparent, true);
  assert.equal(far.depthWrite, false);
  assert.equal(far.transmission, undefined);
  source.dispose();
  far.dispose();
});

test("GPU pass measurements never nest queries, collect asynchronously and dispose pending queries", () => {
  let active = null, created = 0;
  const deleted = new Set();
  const gl = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
    getExtension: () => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 }),
    isContextLost: () => false, getParameter: () => false,
    getQueryParameter: (_query, parameter) => parameter === 1 ? true : 2e6,
    createQuery: () => ({ id: ++created }),
    beginQuery: (_kind, query) => { assert.equal(active, null); active = query; },
    endQuery: () => { assert.ok(active); active = null; },
    deleteQuery: (query) => deleted.add(query.id),
  };
  const timing = new GpuFrameTiming(gl);
  let draws = 0;
  for (let frame = 0; frame < 64; frame++) {
    timing.begin();
    timing.measure("scene", () => draws++);
    timing.measure("dof", () => draws++);
    timing.end();
  }
  assert.equal(draws, 128);
  assert.ok(timing.snapshot().samples > 0);
  assert.equal(timing.snapshot().passes.scene.gpuP50, 2);
  timing.dispose();
  assert.equal(active, null);
  assert.equal(deleted.size, created);
});

test("small AO retains full-size depth and restores original blur at full resolution", () => {
  const pass = new BudgetSSAOPass(
    new Scene(),
    new PerspectiveCamera(34, 16 / 9, 5, 300),
    1,
    1,
    16,
  );
  const depth = pass.normalRenderTarget.depthTexture;
  const originalBlur = pass.blurMaterial.fragmentShader;
  pass.setContactStrength(0.22);
  pass.setSamplingScale(0.5);
  pass.setSize(2560, 1440);
  assert.equal(pass.width, 1280);
  assert.equal(pass.height, 720);
  assert.equal(pass.ssaoRenderTarget.width, 1280);
  assert.equal(pass.blurRenderTarget.height, 720);
  assert.equal(pass.normalRenderTarget.width, 2560);
  assert.equal(pass.normalRenderTarget.height, 1440);
  assert.equal(pass.normalRenderTarget.depthTexture, depth);
  assert.equal(pass.copyMaterial.uniforms.tFullDepth.value, depth);
  assert.notEqual(pass.blurMaterial.fragmentShader, originalBlur);
  pass.setSamplingScale(0.75);
  pass.setSize(641, 359);
  assert.equal(pass.width, 480);
  assert.equal(pass.height, 269);
  assert.equal(pass.normalRenderTarget.width, 641);
  pass.setSamplingScale(1);
  assert.equal(pass.width, 641);
  assert.equal(pass.blurMaterial.fragmentShader, originalBlur);
  assert.equal(pass.copyMaterial.uniforms.contactStrength.value, 0.22);
  let materialDisposed = 0,
    noiseDisposed = 0;
  pass.ssaoMaterial.addEventListener("dispose", () => materialDisposed++);
  pass.noiseTexture.addEventListener("dispose", () => noiseDisposed++);
  pass.dispose();
  assert.equal(materialDisposed, 1);
  assert.equal(noiseDisposed, 1);
});

function recorder() {
  const draws = [];
  let target = null;
  const renderer = {
    autoClear: true,
    getClearColor: (color) => color.set("white"),
    getClearAlpha: () => 0.6,
    setClearColor() {},
    setClearAlpha() {},
    clear() {},
    setRenderTarget(next) {
      target = next;
    },
    render(object) {
      draws.push({ object, target, material: object.material });
    },
  };
  return { renderer, draws };
}

test("half-size DOF shares depth, reconstructs at full size and supports disabled-AO fallback", () => {
  const scene = new Scene(),
    camera = new PerspectiveCamera(34, 16 / 9, 5, 300);
  const pass = new SharedDepthBokehPass(scene, camera, {
    focus: 25,
    aperture: 0.0018,
    maxblur: 0.011,
  });
  const read = new WebGLRenderTarget(2560, 1440),
    write = read.clone(),
    depth = new Texture();
  const { renderer, draws } = recorder();
  pass.setSize(2560, 1440);
  pass.setResolutionScale(0.5);
  assert.equal(pass.getBudget().colorSamples, 13);
  pass.depthSource = () => depth;
  pass.render(renderer, write, read);
  assert.equal(
    draws.length,
    2,
    "Only two fullscreen draws, no scene depth draw",
  );
  assert.equal(draws[0].target.width, 1280);
  assert.equal(draws[0].target.height, 720);
  assert.equal(draws[1].target, write);
  assert.equal(draws[0].material.uniforms.tDepth.value, depth);
  assert.equal(draws[1].material.uniforms.tDepth.value, depth);
  assert.equal(draws[1].material.uniforms.tSharp.value, read.texture);
  assert.equal(draws[1].material.uniforms.packedDepth.value, false);
  assert.equal(pass.sharedFrames, 1);
  assert.equal(pass.getBudget().reducedFrames, 1);
  // An independently disabled AO uses BokehPass's owned packed depth.
  pass.depthSource = () => null;
  pass.renderToScreen = true;
  draws.length = 0;
  pass.render(renderer, write, read);
  assert.equal(draws.length, 3);
  assert.equal(draws[0].object, scene);
  assert.equal(draws[0].target.width, 2560);
  assert.equal(draws[1].target.width, 1280);
  assert.equal(draws[2].target, null);
  assert.equal(draws[2].material.uniforms.packedDepth.value, true);
  assert.equal(
    draws[2].material.uniforms.tDepth.value,
    pass.uniforms.tDepth.value,
  );
  assert.equal(renderer.autoClear, true);
  assert.equal(scene.overrideMaterial, null);
  assert.equal(pass.renderToScreen, true);
  // Full-size shared mode still uses the upstream 41-tap shader in one draw.
  pass.setResolutionScale(1);
  assert.equal(pass.getBudget().colorSamples, 41);
  pass.depthSource = () => depth;
  pass.renderToScreen = false;
  draws.length = 0;
  pass.render(renderer, write, read);
  assert.equal(draws.length, 1);
  assert.equal(
    draws[0].material.fragmentShader,
    pass.materialBokeh.fragmentShader,
  );
  assert.equal(draws[0].target, write);
  pass.setResolutionScale(0.5);
  pass.setSize(641, 359);
  assert.equal(pass.getBudget().width, 320);
  assert.equal(pass.getBudget().height, 179);
  pass.dispose();
  read.dispose();
  write.dispose();
  depth.dispose();
});
