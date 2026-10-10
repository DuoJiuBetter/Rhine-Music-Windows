import {
  matchingPreset,
  presetLabels,
  type QualityPreset,
  type RenderQuality,
} from "./render-quality";

function select(
  quality: RenderQuality,
  key: keyof RenderQuality,
  label: string,
  choices: (readonly [string | number, string])[],
) {
  return `<label class="quality-control"><span>${label}</span><select data-quality="${key}" aria-label="${label}">${choices.map(([value, text]) => `<option value="${value}" ${quality[key] === value ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
}
function range(
  quality: RenderQuality,
  key: "scale" | "depthOfField",
  label: string,
  min: number,
  max: number,
) {
  return `<label class="quality-control quality-range"><span>${label}</span><div><input type="range" data-quality="${key}" aria-label="${label}" min="${min}" max="${max}" step="5" value="${quality[key]}"/><output data-quality-output="${key}">${quality[key]}%</output></div></label>`;
}
export function qualityMarkup(quality: RenderQuality) {
  const preset = matchingPreset(quality);
  return `<section class="quality-settings" aria-label="画质设置">
    <div class="quality-heading"><h3>RENDER QUALITY <span>渲染画质</span></h3><select id="quality-preset" aria-label="画质预设">${(Object.keys(presetLabels) as QualityPreset[]).map((key) => `<option value="${key}" ${preset === key ? "selected" : ""}>${presetLabels[key]}</option>`).join("")}<option value="custom" disabled ${preset === "custom" ? "selected" : ""}>自定义</option></select></div>
    <p class="quality-summary" id="quality-summary" aria-live="polite"></p>
    <details class="quality-advanced"><summary>精细设置 <span>清晰度 / 材质 / 阴影</span></summary><div class="quality-grid">
    ${range(quality, "scale", "渲染比例", 50, 200)}
    ${select(
      quality,
      "pixelRatio",
      "像素密度上限",
      [1, 1.5, 2, 3].map((v) => [v, `${v}×`]),
    )}
    ${select(quality, "antialias", "抗锯齿", [
      ["off", "原始"],
      ["smaa", "SMAA"],
    ])}
    ${select(quality, "pixelBudget", "主画面像素上限", [
      [1_440_000, "144 万 · 核显"], [2_073_600, "207 万 · MX"],
      [3_686_400, "369 万 · 增强"], [8_294_400, "829 万"],
    ])}
    ${select(
      quality,
      "anisotropy",
      "纹理过滤",
      [1, 2, 4, 8, 16].map((v) => [v, `${v}×`]),
    )}
    ${select(
      quality,
      "transmission",
      "透明材质分辨率",
      [0.25, 0.5, 0.75, 1].map((v) => [v, `${v * 100}%`]),
    )}
    ${select(
      quality,
      "shadows",
      "阴影分辨率 · 阵列",
      [
        [0, "关闭"],
        [1024, "1024"],
        [2048, "2048"],
        [4096, "4096"],
      ],
    )}
    ${select(
      quality,
      "aoSamples",
      "环境遮蔽 · 阵列",
      [
        [0, "关闭"],
        [8, "8 采样"],
        [16, "16 采样"],
        [32, "32 采样"],
        [64, "64 采样"],
      ],
    )}
    ${select(
      quality,
      "aoResolution",
      "遮蔽分辨率 · 阵列",
      [0.5, 0.75, 1].map((v) => [v, `${v * 100}%`]),
    )}
    ${range(quality, "depthOfField", "景深强度 · 阵列", 0, 150)}
    ${select(quality, "arrayBudget", "阵列渲染", [[0, "全阵列完整玻璃"], [1, "可见完整玻璃"]])}
    ${select(
      quality,
      "depthOfFieldResolution",
      "景深分辨率 · 阵列",
      [0.5, 0.75, 1].map((v) => [v, `${v * 100}%`]),
    )}
    </div></details>
  </section>`;
}

export function syncQualityUI(quality: RenderQuality) {
  const preset = document.querySelector<HTMLSelectElement>("#quality-preset");
  if (!preset) return;
  preset.value = matchingPreset(quality);
  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-quality]")
    .forEach((control) => {
      const key = control.dataset.quality as keyof RenderQuality;
      control.value = String(quality[key]);
      control.disabled = (key === "aoResolution" && quality.aoSamples === 0) ||
        (key === "depthOfFieldResolution" && quality.depthOfField === 0);
    });
  document
    .querySelectorAll<HTMLOutputElement>("[data-quality-output]")
    .forEach((output) => {
      output.value = `${quality[output.dataset.qualityOutput as keyof RenderQuality]}%`;
    });
}
