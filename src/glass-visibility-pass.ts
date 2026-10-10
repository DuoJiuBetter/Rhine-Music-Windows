import * as THREE from "three";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

export type GlassOcclusionMode = "on" | "off" | "debug";

/** Only final, unblended music-shell surfaces qualify. Three captures their
 * transmitted background separately BEFORE the main color draw. A nearer shell
 * then replaces a farther shell's color, rather than blending with it. Seeding
 * the main depth therefore saves shading that would be overwritten anyway.
 * This is NOT an opaque occluder for transmission, AO, shadows or alpha glass. */
export function canSeedGlassDepth(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || object instanceof THREE.BatchedMesh ||
      object.morphTargetInfluences?.length || Array.isArray(object.material)) return false;
  const material = object.material;
  return material instanceof THREE.MeshPhysicalMaterial && material.visible &&
    ["Frosted_Polymer", "Ivory_Edges", "Optical_Diffuser"].includes(object.userData.surface) &&
    material.userData.musicShell === true && material.transmission > 0 &&
    material.opacity === 1 && !material.transparent && !material.alphaHash && !material.alphaToCoverage &&
    material.alphaTest === 0 && material.colorWrite && material.depthTest && material.depthWrite &&
    material.depthFunc === THREE.LessEqualDepth && material.side === THREE.FrontSide &&
    material.blending === THREE.NormalBlending && !material.clippingPlanes?.length &&
    !material.displacementMap && !material.polygonOffset && !material.wireframe;
}

/** Exact subset of authored front-cap triangles, NOT a filled bounding box.
 * Rounded corners, holes, front depth and winding remain those of the source.
 * Bevels/back/side faces stay in the real color/AO/shadow scene but need not
 * burden this auxiliary depth draw. Local +Z cap faces are the broad lids. */
export function createConservativeGlassDepthGeometry(source: THREE.BufferGeometry) {
  const position = source.getAttribute("position"), index = source.getIndex();
  const indices: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  if (position) for (let offset = 0; offset + 2 < (index?.count ?? position.count); offset += 3) {
    if (offset < source.drawRange.start || offset + 2 >= source.drawRange.start + source.drawRange.count) continue;
    const ai = index ? index.getX(offset) : offset;
    const bi = index ? index.getX(offset + 1) : offset + 1;
    const ci = index ? index.getX(offset + 2) : offset + 2;
    a.fromBufferAttribute(position, ai); b.fromBufferAttribute(position, bi); c.fromBufferAttribute(position, ci);
    normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    if (normal.lengthSq() < 1e-16 || Math.max(a.z, b.z, c.z) - Math.min(a.z, b.z, c.z) > 1e-6) continue;
    if (normal.normalize().z > .99999) indices.push(ai, bi, ci);
  }
  const geometry = new THREE.BufferGeometry();
  if (position) geometry.setAttribute("position", position);
  geometry.setIndex(indices);
  return geometry;
}

const analysisVertex = /* glsl */ `
  void main() {
    vec3 transformed = position;
    #include <project_vertex>
  }
`;
const analysisFragment = /* glsl */ `
  #include <packing>
  uniform sampler2D frontDepth;
  uniform vec2 inverseAnalysisSize;
  uniform vec2 inverseDepthSize;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform bool moving;
  float distanceAt(vec2 uv) {
    return -perspectiveDepthToViewZ(texture2D(frontDepth, clamp(uv, vec2(0.0), vec2(1.0))).r,
      cameraNear, cameraFar);
  }
  void main() {
    vec2 uv = gl_FragCoord.xy * inverseAnalysisSize;
    float here = -perspectiveDepthToViewZ(gl_FragCoord.z, cameraNear, cameraFar);
    float front = distanceAt(uv);
    // Classification is diagnostic only. Actual rejection uses SAME-resolution
    // hardware depth, so low-resolution edge sampling never removes geometry.
    float minimum = front, maximum = front;
    vec2 stepSize = inverseDepthSize * 3.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      float sampleDistance = distanceAt(uv + vec2(float(x), float(y)) * stepSize);
      minimum = min(minimum, sampleDistance); maximum = max(maximum, sampleDistance);
    }
    bool hidden = here > maximum + 0.02;
    bool boundary = maximum - minimum > 0.05 || here > front + 0.02;
    // No global "never visible" inference from past frames. During ANY motion,
    // all estimates become uncertain and the exact depth is regenerated now.
    if (moving) gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0);
    else if (hidden) gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    else if (boundary) gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0);
    else gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0);
  }
`;

/** A depth-only pass rejects hidden PARTS of each card before physical shading.
 * Source geometry/instance IDs are unchanged and all auxiliary passes keep the
 * full scene. The extra color capture for transmission is also unchanged. */
export class GlassVisibilityRenderPass extends RenderPass {
  mode: GlassOcclusionMode = "on";
  moving = false;
  measure = (_label: string, draw: () => void) => draw();
  private readonly depthScene = new THREE.Scene();
  private readonly proxies = new WeakMap<THREE.Mesh, THREE.Mesh>();
  private readonly depthGeometries = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
  private readonly ownedDepthGeometries = new Set<THREE.BufferGeometry>();
  private readonly depthMaterial = new THREE.MeshDepthMaterial({
    colorWrite: false, depthWrite: true, depthTest: true, side: THREE.FrontSide,
    // A tiny conservative offset prevents rounding differences from excluding
    // the front surface. It may retain a little extra work, never a visual hole.
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  private readonly analysisMaterial = new THREE.ShaderMaterial({
    uniforms: {
      frontDepth: { value: null }, inverseAnalysisSize: { value: new THREE.Vector2() },
      inverseDepthSize: { value: new THREE.Vector2() }, cameraNear: { value: 5 },
      cameraFar: { value: 300 }, moving: { value: false },
    },
    vertexShader: analysisVertex, fragmentShader: analysisFragment,
    side: THREE.FrontSide, depthTest: false, depthWrite: false, toneMapped: false,
    transparent: true, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendEquation: THREE.AddEquation,
  });
  private readonly overlayMaterial = new THREE.ShaderMaterial({
    uniforms: { regions: { value: null } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D regions; varying vec2 vUv;
      void main() {
        vec3 areas = texture2D(regions, vUv).rgb;
        float total = areas.r + areas.g + areas.b;
        if (total < 0.5) discard;
        // Additive layer counts show hidden work even behind the front card.
        vec3 color = (areas.r * vec3(1.0, 0.14, 0.16) +
          areas.g * vec3(1.0, 0.72, 0.08) + areas.b * vec3(0.08, 0.95, 0.48)) / total;
        gl_FragColor = vec4(color, 0.72);
      }
    `,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  private readonly overlay = new FullScreenQuad(this.overlayMaterial);
  private depthSnapshot?: THREE.WebGLRenderTarget;
  private analysisTarget?: THREE.WebGLRenderTarget;
  private readonly savedClearColor = new THREE.Color();
  private frames = 0;
  private depthFrames = 0;
  private analysisFrames = 0;
  private depthDraws = 0;
  private glassInstances = 0;
  private depthTriangles = 0;
  private fullGlassTriangles = 0;
  private width = 0;
  private height = 0;
  private depthCpuMs = 0;
  private lastAnalysisCpuMs = 0;
  private area: null | { hidden: number; possible: number; visible: number; total: number;
    hiddenRatio: number; sampleWidth: number; sampleHeight: number; frame: number } = null;
  private analysisAvailable: boolean | null = null;
  private analysisError: string | null = null;
  private pendingRead = false;
  private generation = 0;
  private disposed = false;
  private activeThisFrame = false;
  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) { super(scene, camera); }

  private collectGlass() {
    this.depthScene.clear();
    this.depthDraws = this.glassInstances = this.depthTriangles = this.fullGlassTriangles = 0;
    this.scene.updateMatrixWorld(true);
    this.scene.traverseVisible((source) => {
      if (!canSeedGlassDepth(source)) return;
      // Extracted and rotating cases keep their ordinary depth draw; only the
      // instanced shelf seeds depth, where its expensive overlap occurs.
      if (!(source instanceof THREE.InstancedMesh)) return;
      if (source instanceof THREE.InstancedMesh && source.count === 0) return;
      let geometry = this.depthGeometries.get(source.geometry);
      if (!geometry) {
        geometry = createConservativeGlassDepthGeometry(source.geometry);
        this.depthGeometries.set(source.geometry, geometry);
        this.ownedDepthGeometries.add(geometry);
      }
      if (!geometry.index?.count) return;
      let proxy = this.proxies.get(source);
      if (!proxy) {
        proxy = source instanceof THREE.InstancedMesh
          ? new THREE.InstancedMesh(geometry, this.depthMaterial, source.instanceMatrix.count)
          : new THREE.Mesh(geometry, this.depthMaterial);
        proxy.matrixAutoUpdate = proxy.matrixWorldAutoUpdate = false;
        proxy.frustumCulled = false;
        this.proxies.set(source, proxy);
      }
      proxy.geometry = geometry;
      proxy.userData.fullGlassGeometry = source.geometry;
      proxy.userData.depthGeometry = geometry;
      proxy.matrixWorld.copy(source.matrixWorld);
      proxy.layers.mask = source.layers.mask;
      if (proxy instanceof THREE.InstancedMesh && source instanceof THREE.InstancedMesh) {
        proxy.instanceMatrix = source.instanceMatrix; proxy.count = source.count;
      }
      this.depthScene.add(proxy);
      this.depthDraws++;
      const count = source instanceof THREE.InstancedMesh ? source.count : 1;
      this.glassInstances += count;
      this.depthTriangles += count * geometry.index.count / 3;
      this.fullGlassTriangles += count * (source.geometry.index?.count ?? source.geometry.getAttribute("position").count) / 3;
    });
  }

  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget,
    read: THREE.WebGLRenderTarget, deltaTime = 0, maskActive = false) {
    this.frames++;
    this.activeThisFrame = false;
    this.width = read.width; this.height = read.height;
    const background = this.scene.background;
    // This scene uses a flat Color background. Other backgrounds / override
    // passes retain RenderPass unchanged, rather than altering their pipeline.
    const active = this.mode !== "off" && background instanceof THREE.Color &&
      !this.scene.overrideMaterial && !this.overrideMaterial && !this.renderToScreen &&
      !maskActive && this.clear && !this.clearDepth && this.clearColor === null && this.clearAlpha === null &&
      renderer.autoClearColor && renderer.autoClearDepth;
    if (!active) {
      this.depthDraws = this.glassInstances = this.depthTriangles = this.fullGlassTriangles = this.depthCpuMs = 0;
      this.measure("sceneWithShadowsAndTransmission", () => super.render(renderer, write, read, deltaTime, maskActive));
      return;
    }
    const started = performance.now();
    this.collectGlass();
    if (!this.depthDraws) {
      this.depthCpuMs = 0;
      this.measure("sceneWithShadowsAndTransmission", () => super.render(renderer, write, read, deltaTime, maskActive));
      return;
    }
    const autoClear = renderer.autoClear, clear = this.clear;
    const shadowAuto = renderer.shadowMap.autoUpdate, shadowDirty = renderer.shadowMap.needsUpdate;
    renderer.getClearColor(this.savedClearColor);
    const clearAlpha = renderer.getClearAlpha();
    try {
      // Shadow rendering must remain in the real scene, with its independent
      // caster list. Never consume its pending update during the depth draw.
      renderer.autoClear = true;
      renderer.shadowMap.autoUpdate = renderer.shadowMap.needsUpdate = false;
      this.depthScene.background = background;
      this.depthScene.overrideMaterial = this.depthMaterial;
      renderer.setRenderTarget(read);
      try {
        this.measure("glassVisibilityDepth", () => renderer.render(this.depthScene, this.camera));
      } finally {
        renderer.shadowMap.autoUpdate = shadowAuto; renderer.shadowMap.needsUpdate = shadowDirty;
      }
      this.depthCpuMs = +(performance.now() - started).toFixed(3);
      this.depthFrames++;
      this.activeThisFrame = true;
      // A Color background forces a clear in Three even when autoClear=false.
      // Suppress ONLY that background clear for the main draw, preserving the
      // depth seed. The transmission target still clears its own full depth.
      renderer.setClearColor(background, 1);
      this.scene.background = null;
      this.clear = false;
      this.measure("sceneWithShadowsAndTransmission", () => super.render(renderer, write, read, deltaTime, maskActive));
      if (this.mode === "debug" || this.frames % 256 === 64) {
        try { this.measure("glassVisibilityAnalysis", () => this.analyze(renderer, read)); }
        catch {
          // Optional diagnostics must never interrupt playback/rendering.
          this.analysisAvailable = false; this.analysisError = "area-analysis-unavailable";
        }
      }
    } finally {
      this.clear = clear; this.scene.background = background;
      renderer.autoClear = autoClear;
      // Do not re-arm an update which the real main draw already performed.
      renderer.shadowMap.autoUpdate = shadowAuto;
      this.depthScene.overrideMaterial = null;
      renderer.setClearColor(this.savedClearColor, clearAlpha);
      renderer.setRenderTarget(read);
    }
  }

  private analyze(renderer: THREE.WebGLRenderer, read: THREE.WebGLRenderTarget) {
    if (this.pendingRead && this.mode !== "debug") return;
    if (this.analysisAvailable === null)
      this.analysisAvailable = renderer.extensions.has("EXT_color_buffer_float") &&
        renderer.extensions.has("EXT_float_blend");
    if (!this.analysisAvailable || !read.depthTexture || this.disposed) return;
    const started = performance.now();
    if (!this.depthSnapshot || this.depthSnapshot.width !== read.width || this.depthSnapshot.height !== read.height) {
      this.depthSnapshot?.dispose(); this.analysisTarget?.dispose(); this.generation++;
      this.depthSnapshot = new THREE.WebGLRenderTarget(read.width, read.height, {
        depthTexture: new THREE.DepthTexture(read.width, read.height, THREE.UnsignedIntType),
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      });
      const scale = Math.min(1, 192 / read.width, 192 / read.height);
      const width = Math.max(1, Math.floor(read.width * scale)), height = Math.max(1, Math.floor(read.height * scale));
      this.analysisTarget = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        depthBuffer: false,
      });
    }
    const snapshot = this.depthSnapshot, target = this.analysisTarget!;
    renderer.initRenderTarget(snapshot);
    renderer.initRenderTarget(read);
    // Official depth blit; no shader samples an attached depth texture.
    renderer.copyTextureToTexture(read.depthTexture, snapshot.depthTexture!);
    const autoClear = renderer.autoClear;
    const shadowAuto = renderer.shadowMap.autoUpdate, shadowDirty = renderer.shadowMap.needsUpdate;
    const oldOverride = this.depthScene.overrideMaterial, oldBackground = this.depthScene.background;
    const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    try {
      renderer.autoClear = true; renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.autoUpdate = renderer.shadowMap.needsUpdate = false;
      this.depthScene.background = null;
      this.depthScene.overrideMaterial = this.analysisMaterial;
      // Diagnostic estimates count all original shell faces; the optimization
      // itself needs only the cheap, exact front-cap subset.
      for (const object of this.depthScene.children)
        (object as THREE.Mesh).geometry = object.userData.fullGlassGeometry;
      const uniforms = this.analysisMaterial.uniforms;
      uniforms.frontDepth.value = snapshot.depthTexture;
      uniforms.inverseAnalysisSize.value.set(1 / target.width, 1 / target.height);
      uniforms.inverseDepthSize.value.set(1 / read.width, 1 / read.height);
      uniforms.cameraNear.value = (this.camera as THREE.PerspectiveCamera).near;
      uniforms.cameraFar.value = (this.camera as THREE.PerspectiveCamera).far;
      uniforms.moving.value = this.moving;
      renderer.setRenderTarget(target);
      renderer.render(this.depthScene, this.camera);
      this.analysisFrames++;
      this.overlayMaterial.uniforms.regions.value = target.texture;
      // At most one nonblocking read. Area statistics are sampled estimates of
      // projected LAYER area (overlap counts), never pixel-exact coverage claims.
      if (!this.pendingRead && this.frames % 256 === 64) {
        this.pendingRead = true;
        const generation = this.generation, frame = this.frames;
        const sampleWidth = target.width, sampleHeight = target.height;
        void renderer.readRenderTargetPixelsAsync(target, 0, 0, sampleWidth, sampleHeight,
          new Float32Array(sampleWidth * sampleHeight * 4)).then((pixels) => {
          if (this.disposed || generation !== this.generation) return;
          let hidden = 0, possible = 0, visible = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            hidden += pixels[i]; possible += pixels[i + 1]; visible += pixels[i + 2];
          }
          const total = hidden + possible + visible;
          this.area = { hidden, possible, visible, total,
            hiddenRatio: total ? +(hidden / total).toFixed(4) : 0,
            sampleWidth, sampleHeight, frame };
          this.analysisError = null;
        }).catch(() => { if (!this.disposed) this.analysisError = "asynchronous-area-read-unavailable"; })
          .finally(() => { this.pendingRead = false; });
      }
    } finally {
      this.analysisMaterial.uniforms.frontDepth.value = null;
      for (const object of this.depthScene.children)
        (object as THREE.Mesh).geometry = object.userData.depthGeometry;
      this.depthScene.overrideMaterial = oldOverride; this.depthScene.background = oldBackground;
      renderer.autoClear = autoClear; renderer.setClearColor(color, alpha);
      renderer.shadowMap.autoUpdate = shadowAuto; renderer.shadowMap.needsUpdate = shadowDirty;
      renderer.setRenderTarget(read);
      this.lastAnalysisCpuMs = +(performance.now() - started).toFixed(3);
    }
  }

  renderOverlay(renderer: THREE.WebGLRenderer) {
    if (this.mode !== "debug" || !this.analysisTarget || this.analysisAvailable !== true) return;
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
    try {
      renderer.autoClear = false; renderer.setRenderTarget(null);
      this.measure("glassVisibilityDebugOverlay", () => this.overlay.render(renderer));
    } finally { renderer.autoClear = autoClear; renderer.setRenderTarget(target); }
  }

  setMode(mode: GlassOcclusionMode) {
    if (this.mode === mode) return;
    this.mode = mode; this.activeThisFrame = false; this.area = null; this.generation++;
  }

  getStats() {
    return { mode: this.mode, active: this.activeThisFrame, algorithm: "current-frame-depth-prepass",
      scope: "main-color-only; no permanent geometry deletion", width: this.width, height: this.height,
      frames: this.frames, depthFrames: this.depthFrames, depthDraws: this.depthDraws,
      glassSurfaceInstances: this.glassInstances, depthCpuMs: this.depthCpuMs,
      depthTriangles: this.depthTriangles, fullGlassTriangles: this.fullGlassTriangles,
      depthGeometry: "exact-front-cap-triangle-subset",
      analysisFrames: this.analysisFrames, lastAnalysisCpuMs: this.lastAnalysisCpuMs,
      areaEstimate: this.area, areaEstimateIsLayerSamples: true,
      areaSampleIntervalFrames: 256,
      analysisAvailable: this.analysisAvailable, analysisError: this.analysisError,
      pendingAreaRead: this.pendingRead, moving: this.moving,
      regionScope: "current pose; every moving sample is uncertain",
      transmissionBackgroundPreserved: true, auxiliaryGeometryPreserved: true };
  }

  override dispose() {
    this.disposed = true; this.generation++;
    this.depthScene.clear(); this.depthScene.overrideMaterial = null;
    this.analysisMaterial.uniforms.frontDepth.value = null;
    this.overlayMaterial.uniforms.regions.value = null;
    this.depthMaterial.dispose(); this.analysisMaterial.dispose();
    for (const geometry of this.ownedDepthGeometries) geometry.dispose();
    this.ownedDepthGeometries.clear();
    this.overlay.dispose(); this.overlayMaterial.dispose();
    this.depthSnapshot?.dispose(); this.analysisTarget?.dispose();
  }
}
