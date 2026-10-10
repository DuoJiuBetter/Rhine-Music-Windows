import {
  MeshLambertMaterial,
  type MeshPhysicalMaterial,
  type Material,
} from "three";
import type { MusicSelectionLighting } from "./music-lighting";

/** Complementary screen coverage avoids two overlapping glass bodies at the
 * transition. Both shaders are created once and keep stable program keys. */
export function addGlassCoverage(material: Material, inverse = false) {
  const compile = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.vertexShader =
      "attribute float sceneCoverage;\nvarying float vSceneCoverage;\n" +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvSceneCoverage = sceneCoverage;",
    );
    shader.fragmentShader =
      "varying float vSceneCoverage;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphatest_fragment>",
      `
      #include <alphatest_fragment>
      float sceneNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (${inverse ? "1.0 - vSceneCoverage > sceneNoise" : "vSceneCoverage <= sceneNoise"}) discard;
    `,
    );
  };
  material.customProgramCacheKey = () => `${key}-scene-coverage-v1`;
}

/** Far frosted glass keeps environment reflection and guided lighting, while
 * alpha approximates transmission over the existing paper/substrate geometry. */
export function createFarGlass(
  source: MeshPhysicalMaterial,
  surface: string,
  lighting: () => MusicSelectionLighting | undefined,
) {
  const material = new MeshLambertMaterial({
    name: `${surface} distance approximation`,
    color: source.color,
    envMapIntensity: source.envMapIntensity,
    side: source.side,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    forceSinglePass: true,
  });
  const roughness = { value: Math.max(0.38, source.roughness) };
  material.userData.distanceRoughness = roughness;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.distanceRoughness = roughness;
    shader.fragmentShader = "uniform float distanceRoughness;\n" + shader.fragmentShader;
    lighting()?.shade(shader, surface);
    // A light face tint preserves the cover; grazing rims retain body density.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
      float distanceRim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
      #ifdef USE_ENVMAP
        outgoingLight += getIBLRadiance(normalize(vViewPosition), normal, distanceRoughness) * (0.06 + 0.18 * distanceRim);
      #endif
      diffuseColor.a = min(0.55, opacity + 0.4 * distanceRim);
      #include <opaque_fragment>
    `,
    );
  };
  material.customProgramCacheKey = () => `music-far-glass-lambert-${surface}-v2`;
  addGlassCoverage(material, true);
  return material;
}
