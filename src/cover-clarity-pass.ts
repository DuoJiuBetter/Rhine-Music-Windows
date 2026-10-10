import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/** One uniform set is shared by atlas, selection and outgoing cover materials.
 * It is disabled during ordinary scene/depth draws to avoid framebuffer feedback. */
export class CoverClarityState {
  readonly enabled = { value: false };
  readonly depth = { value: null as THREE.Texture | null };
  readonly packed = { value: false };
  readonly inverseSize = { value: new THREE.Vector2(1, 1) };
  readonly near = { value: 5 };
  readonly far = { value: 300 };
  readonly lidAllowance = { value: 0.16 };
  readonly inspection = { value: 0 };
  bind(shader: THREE.WebGLProgramParametersWithUniforms, selected = false) {
    Object.assign(shader.uniforms, {
      coverClarityEnabled: this.enabled, coverClarityDepth: this.depth,
      coverClarityPacked: this.packed, coverClarityInverseSize: this.inverseSize,
      coverClarityNear: this.near, coverClarityFar: this.far,
      coverClarityLidAllowance: this.lidAllowance,
      coverInspection: selected ? this.inspection : { value: 0 },
      coverSceneInspection: this.inspection,
      coverSelected: { value: selected },
    });
    shader.fragmentShader = /* glsl */ `
      uniform bool coverClarityEnabled;
      uniform sampler2D coverClarityDepth;
      uniform bool coverClarityPacked;
      uniform vec2 coverClarityInverseSize;
      uniform float coverClarityNear, coverClarityFar, coverClarityLidAllowance;
      uniform float coverInspection;
      uniform float coverSceneInspection;
      uniform bool coverSelected;
      #include <packing>
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <clipping_planes_fragment>", /* glsl */ `
      #include <clipping_planes_fragment>
      if (coverClarityEnabled) {
        // In inspection, only the extracted print needs the native sharp
        // overlay. Shelf prints keep the scene's DOF instead of bringing
        // thin background rows back as crisp stripes after postprocessing.
        if (!coverSelected && coverSceneInspection >= 0.85) discard;
        vec4 source = texture2D(coverClarityDepth, gl_FragCoord.xy * coverClarityInverseSize);
        float depth = coverClarityPacked ? unpackRGBAToDepth(source) : source.x;
        float frontDistance = -perspectiveDepthToViewZ(depth, coverClarityNear, coverClarityFar);
        float printDistance = -perspectiveDepthToViewZ(gl_FragCoord.z, coverClarityNear, coverClarityFar);
        // The insert lies behind its own thin glass lid. Allow that gap, but
        // reject prints behind other cards instead of drawing them on top.
        if (printDistance > frontDistance + coverClarityLidAllowance) discard;
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */ `
      // Inspection ink must not inherit the opaque shadow of its own glass lid.
      if (coverClarityEnabled) outgoingLight = mix(outgoingLight, diffuseColor.rgb, coverInspection);
      #include <opaque_fragment>
      if (coverClarityEnabled && !coverSelected)
        gl_FragColor.a *= 1.0 - smoothstep(0.0, 0.85, coverSceneInspection);
    `);
  }
}

/** Present the budget scene, then draw only visible paper inserts at native
 * display resolution, after DOF/transmission. No full native-size scene render. */
export class CoverClarityPass extends Pass {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private state: CoverClarityState;
  private copy = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    // OutputPass already applied tone mapping and output transfer to this buffer.
    fragmentShader: "varying vec2 vUv; uniform sampler2D tDiffuse; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }",
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  private quad = new FullScreenQuad(this.copy);
  private fallback = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    type: THREE.UnsignedByteType,
  });
  private depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, blending: THREE.NoBlending });
  private clearColor = new THREE.Color();
  private size = new THREE.Vector2();
  private frames = 0;
  private fallbackFrames = 0;
  private coverDraws = 0;
  depthSource?: () => { texture: THREE.Texture; packed: boolean } | null;
  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, state: CoverClarityState) {
    super(); this.scene = scene; this.camera = camera; this.state = state;
    this.needsSwap = false;
  }
  override setSize(width: number, height: number) {
    this.fallback.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
  }
  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const target = this.renderToScreen ? null : _write;
    const autoClear = renderer.autoClear, background = this.scene.background;
    const override = this.scene.overrideMaterial;
    const shadowAuto = renderer.shadowMap.autoUpdate, shadowDirty = renderer.shadowMap.needsUpdate;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    const hidden: THREE.Object3D[] = [];
    const materials = new Map<THREE.Material, { depthTest: boolean; depthWrite: boolean; toneMapped: boolean; transparent: boolean }>();
    try {
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      let depth = this.depthSource?.();
      if (!depth) {
        renderer.autoClear = true;
        renderer.setClearColor(0xffffff, 1);
        this.scene.background = null;
        this.scene.overrideMaterial = this.depthMaterial;
        renderer.setRenderTarget(this.fallback);
        renderer.render(this.scene, this.camera);
        depth = { texture: this.fallback.texture, packed: true };
        this.fallbackFrames++;
      }
      this.scene.background = null; this.scene.overrideMaterial = null;
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      this.copy.uniforms.tDiffuse.value = read.texture;
      this.quad.render(renderer);
      if (target) this.size.set(target.width, target.height);
      else renderer.getDrawingBufferSize(this.size);
      this.state.inverseSize.value.set(1 / this.size.x, 1 / this.size.y);
      this.state.depth.value = depth.texture; this.state.packed.value = depth.packed;
      this.state.near.value = this.camera.near; this.state.far.value = this.camera.far;
      this.state.enabled.value = true;
      this.coverDraws = 0;
      this.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) || !object.visible) return;
        if (!object.userData.albumCover) { hidden.push(object); object.visible = false; return; }
        this.coverDraws++;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!materials.has(material)) materials.set(material, {
            depthTest: material.depthTest, depthWrite: material.depthWrite, toneMapped: material.toneMapped, transparent: material.transparent,
          });
          material.depthTest = false; material.depthWrite = false;
          // Fade only the auxiliary sharp overlay; the physical print remains
          // opaque in the main scene, transmission and depth passes.
          material.transparent = true;
          // Native prints use the same renderer exposure as OutputPass.
          material.toneMapped = true;
        }
      });
      renderer.render(this.scene, this.camera);
      this.frames++;
    } finally {
      this.state.enabled.value = false; this.state.depth.value = null;
      for (const object of hidden) object.visible = true;
      for (const [material, values] of materials) Object.assign(material, values);
      this.scene.background = background; this.scene.overrideMaterial = override;
      renderer.shadowMap.autoUpdate = shadowAuto; renderer.shadowMap.needsUpdate = shadowDirty;
      renderer.autoClear = autoClear;
      renderer.setClearColor(this.clearColor, clearAlpha);
    }
  }
  getStats() {
    return { enabled: this.enabled, frames: this.frames, width: this.size.x, height: this.size.y,
      fallbackDepthFrames: this.fallbackFrames, coverDraws: this.coverDraws,
      afterDepthOfField: true, bypassesGlassTransmission: true };
  }
  override dispose() {
    this.copy.dispose(); this.quad.dispose(); this.fallback.dispose(); this.depthMaterial.dispose();
  }
}
