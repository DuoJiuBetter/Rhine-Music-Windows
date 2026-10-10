import {
  HalfFloatType,
  ShaderMaterial,
  WebGLRenderTarget,
  Vector2,
  type Texture,
  type WebGLRenderer,
  type IUniform,
  type PerspectiveCamera,
} from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// Same circle-of-confusion radius as the authored shader, with 13 color taps.
// Used only on the budget grid; scale 1 retains the original 41-tap program.
const budgetBokeh = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform float maxblur, aperture, nearClip, farClip, focus, aspect, budgetWidth;
  #include <common>
  #include <packing>
  void main() {
    vec4 rawDepth = texture2D(tDepth, vUv);
    #if DEPTH_PACKING == 1
      float depth = unpackRGBAToDepth(rawDepth);
    #else
      float depth = rawDepth.x;
    #endif
    #if PERSPECTIVE_CAMERA == 1
      float z = perspectiveDepthToViewZ(depth, nearClip, farClip);
    #else
      float z = orthographicDepthToViewZ(depth, nearClip, farClip);
    #endif
    vec2 radius = vec2(1.0, aspect) * clamp((focus + z) * aperture, -maxblur, maxblur) * 0.4;
    vec4 color = texture2D(tColor, vUv);
    if (abs(radius.x) * budgetWidth < 0.5) { gl_FragColor = vec4(color.rgb, 1.0); return; }
    for (int i = 0; i < 8; i++) {
      float angle = float(i) * 0.785398163;
      color += texture2D(tColor, vUv + radius * vec2(cos(angle), sin(angle)));
    }
    for (int i = 0; i < 4; i++) {
      float angle = float(i) * 1.570796327 + 0.392699082;
      color += texture2D(tColor, vUv + radius * 0.5 * vec2(cos(angle), sin(angle)));
    }
    gl_FragColor = vec4(color.rgb / 13.0, 1.0);
  }
`;

/** Reuse the scene's full-size depth even when AO sampling is smaller. A small
 * 13-tap budget blur is reconstructed with depth weights; in-focus pixels come from
 * the full-size color buffer. At scale 1 the original shared shader is retained. */
export class SharedDepthBokehPass extends BokehPass {
  private sharedMaterial: ShaderMaterial;
  private sharedQuad: FullScreenQuad;
  private blurTarget = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    depthBuffer: false,
  });
  private compositeMaterial: ShaderMaterial;
  private compositeQuad: FullScreenQuad;
  private resolutionScale = 1;
  private fullWidth = 1;
  private fullHeight = 1;
  private originalBokeh: string;
  sharedFrames = 0;
  reducedFrames = 0;
  fallbackFrames = 0;
  constructor(...args: ConstructorParameters<typeof BokehPass>) {
    super(...args);
    this.originalBokeh = this.materialBokeh.fragmentShader;
    this.materialBokeh.uniforms.budgetWidth = { value: 1 };
    this.sharedMaterial = new ShaderMaterial({
      name: "RhineSharedDepthBokeh",
      uniforms: Object.fromEntries(
        Object.entries(this.uniforms as Record<string, IUniform>).map(
          ([key, uniform]) => [key, { value: uniform.value }],
        ),
      ),
      defines: { ...this.materialBokeh.defines, DEPTH_PACKING: 0 },
      vertexShader: this.materialBokeh.vertexShader,
      fragmentShader: this.materialBokeh.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.sharedQuad = new FullScreenQuad(this.sharedMaterial);
    this.blurTarget.texture.name = "RhineBudgetBokeh.blur";
    this.compositeMaterial = new ShaderMaterial({
      name: "RhineBudgetBokehComposite",
      uniforms: {
        tSharp: { value: null },
        tBlur: { value: this.blurTarget.texture },
        tDepth: { value: null },
        packedDepth: { value: false },
        blurSize: { value: new Vector2(1, 1) },
        fullWidth: { value: 1 },
        focus: { value: 25 },
        aperture: { value: 0.0018 },
        maxblur: { value: 0.011 },
        nearClip: { value: 0.1 },
        farClip: { value: 300 },
      },
      vertexShader: this.materialBokeh.vertexShader,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D tSharp;
        uniform sampler2D tBlur;
        uniform sampler2D tDepth;
        uniform bool packedDepth;
        uniform vec2 blurSize;
        uniform float fullWidth;
        uniform float focus;
        uniform float aperture;
        uniform float maxblur;
        uniform float nearClip;
        uniform float farClip;
        #include <packing>
        float viewZ(vec2 uv) {
          vec4 depth = texture2D(tDepth, uv);
          return perspectiveDepthToViewZ(packedDepth ? unpackRGBAToDepth(depth) : depth.x, nearClip, farClip);
        }
        void main() {
          vec4 sharp = texture2D(tSharp, vUv);
          float centerZ = viewZ(vUv);
          // Bokeh's outer sample radius is 0.4 * its UV blur radius.
          float radius = abs(clamp((focus + centerZ) * aperture, -maxblur, maxblur)) * fullWidth * 0.4;
          float blurMix = smoothstep(0.5, 2.0, radius);
          if (blurMix <= 0.0) { gl_FragColor = sharp; return; }
          vec2 grid = vUv * blurSize - 0.5;
          vec2 base = floor(grid);
          vec2 blend = fract(grid);
          vec4 sum = vec4(0.0);
          float weights = 0.0;
          for (int y = 0; y < 2; y++) {
            for (int x = 0; x < 2; x++) {
              vec2 uv = (base + vec2(float(x), float(y)) + 0.5) / blurSize;
              float bilinear = (x == 0 ? 1.0 - blend.x : blend.x) * (y == 0 ? 1.0 - blend.y : blend.y);
              float weight = bilinear * exp(-abs(centerZ - viewZ(uv)) / max(0.015, abs(centerZ) * 0.0025));
              sum += texture2D(tBlur, uv) * weight;
              weights += weight;
            }
          }
          // Thin, out-of-focus shelf edges may have no matching depth on the
          // smaller grid. Falling back to sharp resurrects dark horizontal
          // stripes. Keep them blurred; in-focus pixels returned above.
          vec4 blurred = weights > 0.00001 ? sum / weights : texture2D(tBlur, vUv);
          gl_FragColor = vec4(mix(sharp.rgb, blurred.rgb, blurMix), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeQuad = new FullScreenQuad(this.compositeMaterial);
  }
  depthSource?: () => Texture | null;
  setResolutionScale(value: number) {
    this.resolutionScale = Math.min(1, Math.max(0.5, value));
    const fragment = this.resolutionScale < 1 ? budgetBokeh : this.originalBokeh;
    for (const material of [this.materialBokeh, this.sharedMaterial]) {
      if (material.fragmentShader !== fragment) {
        material.fragmentShader = fragment;
        material.needsUpdate = true;
      }
    }
    this.setSize(this.fullWidth, this.fullHeight);
  }
  override setSize(width: number, height: number) {
    super.setSize(width, height);
    this.fullWidth = width;
    this.fullHeight = height;
    this.blurTarget.setSize(
      Math.max(1, Math.floor(width * this.resolutionScale)),
      Math.max(1, Math.floor(height * this.resolutionScale)),
    );
    this.compositeMaterial.uniforms.blurSize.value.set(
      this.blurTarget.width,
      this.blurTarget.height,
    );
    this.compositeMaterial.uniforms.fullWidth.value = width;
    this.materialBokeh.uniforms.budgetWidth.value = width;
    this.sharedMaterial.uniforms.budgetWidth.value = width;
  }
  getBudget() {
    return {
      scale: this.resolutionScale,
      width: this.blurTarget.width,
      height: this.blurTarget.height,
      reducedFrames: this.reducedFrames,
      fallbackFrames: this.fallbackFrames,
      colorSamples: this.resolutionScale < 1 ? 13 : 41,
    };
  }
  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    deltaTime = 0,
    maskActive = false,
  ) {
    const depth = this.depthSource?.();
    const source = this.uniforms as Record<string, IUniform>;
    if (depth) {
      const uniforms = this.sharedMaterial.uniforms;
      for (const key of ["focus", "aperture", "aspect", "maxblur"])
        uniforms[key].value = source[key].value;
      uniforms.tDepth.value = depth;
      uniforms.tColor.value = readBuffer.texture;
      uniforms.nearClip.value = (this.camera as PerspectiveCamera).near;
      uniforms.farClip.value = (this.camera as PerspectiveCamera).far;
      renderer.setRenderTarget(
        this.resolutionScale < 1
          ? this.blurTarget
          : this.renderToScreen
            ? null
            : writeBuffer,
      );
      this.sharedQuad.render(renderer);
      this.sharedFrames++;
    } else {
      // AO can be disabled independently. Preserve BokehPass's owned packed
      // depth fallback and its renderer-state restoration in that case.
      const screen = this.renderToScreen;
      if (this.resolutionScale < 1) this.renderToScreen = false;
      try {
        super.render(
          renderer,
          this.resolutionScale < 1 ? this.blurTarget : writeBuffer,
          readBuffer,
          deltaTime,
          maskActive,
        );
      } finally {
        this.renderToScreen = screen;
      }
      this.fallbackFrames++;
    }
    if (this.resolutionScale >= 1) return;
    const composite = this.compositeMaterial.uniforms;
    for (const key of ["focus", "aperture", "maxblur"])
      composite[key].value = source[key].value;
    composite.tSharp.value = readBuffer.texture;
    composite.tDepth.value = depth || source.tDepth.value;
    composite.packedDepth.value = !depth;
    composite.nearClip.value = (this.camera as PerspectiveCamera).near;
    composite.farClip.value = (this.camera as PerspectiveCamera).far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compositeQuad.render(renderer);
    this.reducedFrames++;
  }
  override dispose() {
    this.blurTarget.dispose();
    this.compositeMaterial.dispose();
    this.compositeQuad.dispose();
    this.sharedMaterial.dispose();
    this.sharedQuad.dispose();
    super.dispose();
  }
}
