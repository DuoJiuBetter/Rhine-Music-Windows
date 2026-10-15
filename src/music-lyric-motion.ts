/** Lyric switching animation: how one lyric line hands over to the next.
 *
 * The effect itself lives in CSS (`music-song-view.css`) so it cannot drift from
 * the authored line styles; this module owns the choice, the persisted shape and
 * the settings markup. Durations are expressed as a CSS variable so the existing
 * 动效速度 control keeps scaling them like every other transition.
 */
export type LyricMotionMode = "none" | "fade" | "slide" | "zoom";
export type LyricMotionSpeed = "slow" | "normal" | "fast";
export type LyricMotion = { mode: LyricMotionMode; speed: LyricMotionSpeed };

export const lyricMotionModes: readonly {
  id: LyricMotionMode;
  label: string;
  hint: string;
}[] = [
  { id: "none", label: "无动画", hint: "直接切换，不做过渡" },
  { id: "fade", label: "淡入淡出", hint: "透明度与颜色渐变（默认）" },
  { id: "slide", label: "上滑淡入", hint: "当前句自下而上就位" },
  { id: "zoom", label: "缩放聚焦", hint: "当前句由小放大到正常" },
];

export const lyricMotionSpeeds: readonly {
  id: LyricMotionSpeed;
  label: string;
  milliseconds: number;
}[] = [
  { id: "slow", label: "慢", milliseconds: 520 },
  { id: "normal", label: "标准", milliseconds: 320 },
  { id: "fast", label: "快", milliseconds: 170 },
];

export const DEFAULT_LYRIC_MOTION: LyricMotion = { mode: "fade", speed: "normal" };
/** Written by hand: the preview must read like a lyric list, not like test data. */
export const LYRIC_MOTION_PREVIEW_LINES = [
  "玻璃与档案盒之间的光",
  "每一句歌词都会切换动画",
  "这里可以即时看到效果",
];

const modeIds = lyricMotionModes.map((entry) => entry.id);
const speedIds = lyricMotionSpeeds.map((entry) => entry.id);

export function normalizeLyricMotion(value: unknown): LyricMotion {
  const source = value && typeof value === "object" ? (value as Partial<LyricMotion>) : {};
  return {
    mode: modeIds.includes(source.mode as LyricMotionMode)
      ? (source.mode as LyricMotionMode)
      : DEFAULT_LYRIC_MOTION.mode,
    speed: speedIds.includes(source.speed as LyricMotionSpeed)
      ? (source.speed as LyricMotionSpeed)
      : DEFAULT_LYRIC_MOTION.speed,
  };
}

export function lyricMotionMilliseconds(value: LyricMotion): number {
  return (
    lyricMotionSpeeds.find((entry) => entry.id === value.speed)?.milliseconds ??
    lyricMotionSpeeds[1].milliseconds
  );
}

let motion: LyricMotion = { ...DEFAULT_LYRIC_MOTION };
const listeners = new Set<(value: LyricMotion) => void>();

export const getLyricMotion = () => motion;

export function setLyricMotion(value: unknown) {
  const next = normalizeLyricMotion(value);
  if (next.mode === motion.mode && next.speed === motion.speed) return;
  motion = next;
  for (const listener of listeners) listener(motion);
}

export function onLyricMotionChange(listener: (value: LyricMotion) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sets the attributes the stylesheet keys on. The duration stays a variable so
 * the global motion-speed scale keeps applying to it. */
export function applyLyricMotion(root: HTMLElement, value: LyricMotion = motion) {
  root.dataset.lyricMotion = value.mode;
  root.dataset.lyricMotionSpeed = value.speed;
  root.style.setProperty("--lyric-motion-duration", `${lyricMotionMilliseconds(value)}ms`);
}

export function lyricMotionMarkup() {
  const modes = lyricMotionModes
    .map(
      (entry) =>
        `<button type="button" data-lyric-mode="${entry.id}" title="${entry.hint}" aria-pressed="false">${entry.label}</button>`,
    )
    .join("");
  const speeds = lyricMotionSpeeds
    .map(
      (entry) =>
        `<button type="button" data-lyric-speed="${entry.id}" aria-pressed="false">${entry.label}</button>`,
    )
    .join("");
  const preview = LYRIC_MOTION_PREVIEW_LINES.map(
    (text, index) =>
      `<button type="button" tabindex="-1" class="lyric-line${index === 0 ? " current" : ""}">${text}</button>`,
  ).join("");
  return `<section class="panel-section" id="lyric-motion-settings" data-settings-group="appearance"><h3>歌词切换动画</h3><p>控制歌词在句与句之间切换的过渡效果；开启「减少动态效果」时一律不播放动画。下方为实时预览。</p><div class="lyric-motion-preview" id="lyric-motion-preview" aria-hidden="true">${preview}</div><label class="settings-row"><span>切换效果</span><span class="segmented" role="radiogroup" aria-label="歌词切换动画">${modes}</span></label><label class="settings-row"><span>动画速度</span><span class="segmented" role="radiogroup" aria-label="歌词动画速度">${speeds}</span></label></section>`;
}

export function syncLyricMotionUi(root: ParentNode, value: LyricMotion = motion) {
  for (const button of root.querySelectorAll<HTMLElement>("[data-lyric-mode]"))
    button.setAttribute("aria-pressed", String(button.dataset.lyricMode === value.mode));
  for (const button of root.querySelectorAll<HTMLElement>("[data-lyric-speed]"))
    button.setAttribute("aria-pressed", String(button.dataset.lyricSpeed === value.speed));
}

/** Applies a settings click, if it was one. Returns true when the click was a
 * lyric-animation choice so the caller stops routing it. */
export function handleLyricMotionClick(target: HTMLElement): boolean {
  const mode = target.dataset.lyricMode;
  const speed = target.dataset.lyricSpeed;
  if (!mode && !speed) return false;
  setLyricMotion({
    mode: mode ?? motion.mode,
    speed: speed ?? motion.speed,
  });
  return true;
}

/** Cycles the preview so the chosen effect can be judged without playing a song.
 * The interval retires itself as soon as the section leaves the document. */
export function followLyricMotionPreview(root: ParentNode, intervalMs = 1700) {
  const box = root.querySelector<HTMLElement>("#lyric-motion-preview");
  if (!box) return () => {};
  const timer = window.setInterval(() => {
    if (!box.isConnected) {
      window.clearInterval(timer);
      return;
    }
    const lines = [...box.querySelectorAll<HTMLElement>(".lyric-line")];
    if (!lines.length) return;
    const at = (Number(box.dataset.previewIndex ?? "0") + 1) % lines.length;
    box.dataset.previewIndex = String(at);
    lines.forEach((line, index) => {
      line.classList.toggle("current", index === at);
      if (index === at) line.setAttribute("aria-current", "true");
      else line.removeAttribute("aria-current");
    });
  }, intervalMs);
  return () => window.clearInterval(timer);
}
