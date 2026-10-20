import {
  Vector2,
  type PerspectiveCamera,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";

const depthHelpers = /* glsl */ `
  uniform sampler2D tFullDepth;
  uniform float cameraNear;
  uniform float cameraFar;
  #include <packing>
  float viewDepth(vec2 uv) {
    return -perspectiveDepthToViewZ(texture2D(tFullDepth, uv).x, cameraNear, cameraFar);
  }
  float depthWeight(float center, float sampleDepth) {
    return exp(-abs(center - sampleDepth) / max(0.015, center * 0.0025));
  }
`;

/** Keep one full-size normal/depth geometry pass for precise silhouettes and
 * shared DOF depth. Only the expensive AO sampling and blur use the small grid. */
export class BudgetSSAOPass extends SSAOPass {
  private samplingScale = 1;
  private fullWidth = 1;
  private fullHeight = 1;
  private originalBlur: string;
  private budgetBlur: string;

  constructor(...args: ConstructorParameters<typeof SSAOPass>) {
    super(...args);
    this.originalBlur = this.blurMaterial.fragmentShader;
    // One program for both stationary and moving frames; no kernel recompile.
    this.ssaoMaterial.uniforms.activeKernelSize={value:this.kernel.length};
    this.ssaoMaterial.fragmentShader='uniform float activeKernelSize;\n'+this.ssaoMaterial.fragmentShader
      .replace('for ( int i = 0; i < KERNEL_SIZE; i ++ ) {',
        'for ( int i = 0; i < KERNEL_SIZE; i ++ ) { if (float(i) >= activeKernelSize) break;')
      .replace('occlusion / float( KERNEL_SIZE )','occlusion / activeKernelSize');
    this.budgetBlur = /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      ${depthHelpers}
      void main() {
        float center = viewDepth(vUv);
        vec4 sum = vec4(0.0);
        float weights = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 uv = vUv + vec2(float(x), float(y)) / resolution;
            float spatial = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
            float weight = spatial * depthWeight(center, viewDepth(uv));
            sum += texture2D(tDiffuse, uv) * weight;
            weights += weight;
          }
        }
        gl_FragColor = sum / max(weights, 0.00001);
      }
    `;
    this.copyMaterial.uniforms.aoSize = {
      value: new Vector2(this.width, this.height),
    };
    this.copyMaterial.uniforms.samplingScale = { value: 1 };
    this.copyMaterial.uniforms.contactStrength = { value: 1 };
    this.copyMaterial.fragmentShader = /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float opacity;
      uniform float contactStrength;
      uniform float samplingScale;
      uniform vec2 aoSize;
      ${depthHelpers}
      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        if (samplingScale < 0.999) {
          float center = viewDepth(vUv);
          vec2 grid = vUv * aoSize - 0.5;
          vec2 base = floor(grid);
          vec2 blend = fract(grid);
          vec4 sum = vec4(0.0);
          float weights = 0.0;
          for (int y = 0; y < 2; y++) {
            for (int x = 0; x < 2; x++) {
              vec2 uv = (base + vec2(float(x), float(y)) + 0.5) / aoSize;
              float bilinear = (x == 0 ? 1.0 - blend.x : blend.x) * (y == 0 ? 1.0 - blend.y : blend.y);
              float weight = bilinear * depthWeight(center, viewDepth(uv));
              sum += texture2D(tDiffuse, uv) * weight;
              weights += weight;
            }
          }
          // No nearby low-resolution surface: leave this thin edge unoccluded.
          texel = weights > 0.00001 ? sum / weights : vec4(1.0);
        }
        gl_FragColor = opacity * vec4(mix(vec3(1.0), texel.rgb, contactStrength), texel.a);
      }
    `;
    for (const material of [this.copyMaterial, this.blurMaterial]) {
      material.uniforms.tFullDepth = {
        value: this.normalRenderTarget.depthTexture,
      };
      material.uniforms.cameraNear = {
        value: (this.camera as PerspectiveCamera).near,
      };
      material.uniforms.cameraFar = {
        value: (this.camera as PerspectiveCamera).far,
      };
    }
  }

  setContactStrength(value: number) {
    this.copyMaterial.uniforms.contactStrength.value = value;
  }
  setMotionBudget(strength: number) {
    const full=this.kernel.length;
    this.ssaoMaterial.uniforms.activeKernelSize.value=Math.max(1,Math.round(full+(Math.min(4,full)-full)*strength));
  }

  setSamplingScale(value: number) {
    const scale = Math.min(1, Math.max(0.5, value));
    if (this.samplingScale === scale) return;
    this.samplingScale = scale;
    this.copyMaterial.uniforms.samplingScale.value = scale;
    const shader = scale < 1 ? this.budgetBlur : this.originalBlur;
    if (this.blurMaterial.fragmentShader !== shader) {
      this.blurMaterial.fragmentShader = shader;
      this.blurMaterial.needsUpdate = true;
    }
    this.setSize(this.fullWidth, this.fullHeight);
  }

  override setSize(width: number, height: number) {
    this.fullWidth = width;
    this.fullHeight = height;
    super.setSize(
      Math.max(1, Math.floor(width * this.samplingScale)),
      Math.max(1, Math.floor(height * this.samplingScale)),
    );
    this.normalRenderTarget.setSize(width, height);
    this.copyMaterial.uniforms.aoSize.value.set(this.width, this.height);
  }

  override render(
    renderer: WebGLRenderer,
    write: WebGLRenderTarget,
    read: WebGLRenderTarget,
    delta = 0,
    mask = false,
  ) {
    for (const material of [this.copyMaterial, this.blurMaterial]) {
      material.uniforms.cameraNear.value = (
        this.camera as PerspectiveCamera
      ).near;
      material.uniforms.cameraFar.value = (
        this.camera as PerspectiveCamera
      ).far;
    }
    super.render(renderer, write, read, delta, mask);
  }

  override dispose() {
    this.ssaoMaterial.dispose();
    this.noiseTexture.dispose();
    super.dispose();
  }
}
