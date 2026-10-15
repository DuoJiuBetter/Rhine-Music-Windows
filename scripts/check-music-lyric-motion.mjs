// Pure module cases; no DOM, GL, accounts, files or audio.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LYRIC_MOTION,
  LYRIC_MOTION_PREVIEW_LINES,
  applyLyricMotion,
  getLyricMotion,
  handleLyricMotionClick,
  lyricMotionMarkup,
  lyricMotionMilliseconds,
  lyricMotionModes,
  lyricMotionSpeeds,
  normalizeLyricMotion,
  onLyricMotionChange,
  setLyricMotion,
  syncLyricMotionUi,
} from "../src/music-lyric-motion.ts";

const fakeRoot = () => ({
  dataset: {},
  style: { values: {}, setProperty(name, value) { this.values[name] = value; } },
});

const fakeList = (entries) => ({
  querySelectorAll: (selector) =>
    entries.filter(
      (entry) =>
        (selector === "[data-lyric-mode]" && entry.dataset.lyricMode !== undefined) ||
        (selector === "[data-lyric-speed]" && entry.dataset.lyricSpeed !== undefined),
    ),
});

test("unknown or partial preferences fall back per field", () => {
  assert.deepEqual(normalizeLyricMotion(undefined), DEFAULT_LYRIC_MOTION);
  assert.deepEqual(normalizeLyricMotion({ mode: "slide" }), { mode: "slide", speed: DEFAULT_LYRIC_MOTION.speed });
  assert.deepEqual(normalizeLyricMotion({ speed: "fast" }), { mode: DEFAULT_LYRIC_MOTION.mode, speed: "fast" });
  assert.deepEqual(normalizeLyricMotion({ mode: "spin", speed: 12 }), DEFAULT_LYRIC_MOTION);
  assert.deepEqual(normalizeLyricMotion("fade"), DEFAULT_LYRIC_MOTION, "a non-object value cannot corrupt the choice");
});

test("durations map to the authored speed steps", () => {
  assert.equal(lyricMotionMilliseconds({ mode: "fade", speed: "slow" }), 520);
  assert.equal(lyricMotionMilliseconds({ mode: "fade", speed: "normal" }), 320);
  assert.equal(lyricMotionMilliseconds({ mode: "fade", speed: "fast" }), 170);
  assert.deepEqual(lyricMotionSpeeds.map((entry) => entry.milliseconds), [520, 320, 170]);
  assert.equal(lyricMotionModes.length, 4, "the four authored effects stay available");
});

test("the section renders every effect, every speed and a live preview", () => {
  const markup = lyricMotionMarkup();
  assert.ok(markup.includes('id="lyric-motion-settings"'));
  assert.ok(markup.includes('data-settings-group="appearance"'), "个性化 owns the section");
  for (const entry of lyricMotionModes) assert.ok(markup.includes(`data-lyric-mode="${entry.id}"`));
  for (const entry of lyricMotionSpeeds) assert.ok(markup.includes(`data-lyric-speed="${entry.id}"`));
  for (const line of LYRIC_MOTION_PREVIEW_LINES) assert.ok(markup.includes(line));
  assert.equal(markup.match(/class="lyric-line/g).length, LYRIC_MOTION_PREVIEW_LINES.length);
  assert.ok(markup.includes('class="lyric-line current"'), "the preview starts on its first line");
  assert.ok(markup.includes('aria-pressed="false"'), "the renderer owns the pressed state");
  assert.ok(markup.includes('role="radiogroup"'), "each row is a single choice");
});

test("changing the effect notifies once and ignores a no-op", () => {
  const seen = [];
  const stop = onLyricMotionChange((value) => seen.push(value));
  setLyricMotion({ mode: "zoom", speed: "slow" });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { mode: "zoom", speed: "slow" });
  assert.deepEqual(getLyricMotion(), { mode: "zoom", speed: "slow" });
  setLyricMotion({ mode: "zoom", speed: "slow" });
  assert.equal(seen.length, 1, "re-selecting the same choice does not notify");
  setLyricMotion({ mode: "zoom", speed: "fast" });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].speed, "fast");
  stop();
  setLyricMotion(DEFAULT_LYRIC_MOTION);
  assert.equal(seen.length, 2, "an unsubscribed listener stays quiet");
});

test("a settings click routes to the choice it belongs to", () => {
  setLyricMotion(DEFAULT_LYRIC_MOTION);
  assert.equal(handleLyricMotionClick({ dataset: {} }), false, "unrelated clicks are not consumed");
  assert.equal(handleLyricMotionClick({ dataset: { lyricMode: "slide" } }), true);
  assert.deepEqual(getLyricMotion(), { mode: "slide", speed: DEFAULT_LYRIC_MOTION.speed });
  assert.equal(handleLyricMotionClick({ dataset: { lyricSpeed: "slow" } }), true);
  assert.deepEqual(getLyricMotion(), { mode: "slide", speed: "slow" }, "each row keeps the other row's choice");
  setLyricMotion(DEFAULT_LYRIC_MOTION);
});

test("applying writes the attributes the stylesheet keys on", () => {
  const root = fakeRoot();
  applyLyricMotion(root, { mode: "slide", speed: "slow" });
  assert.equal(root.dataset.lyricMotion, "slide");
  assert.equal(root.dataset.lyricMotionSpeed, "slow");
  assert.equal(root.style.values["--lyric-motion-duration"], "520ms", "the base duration stays a CSS variable");
});

test("syncing marks exactly one button per row", () => {
  const buttons = [
    { dataset: { lyricMode: "none" }, pressed: null, setAttribute(_n, v) { this.pressed = v; } },
    { dataset: { lyricMode: "fade" }, pressed: null, setAttribute(_n, v) { this.pressed = v; } },
    { dataset: { lyricSpeed: "slow" }, pressed: null, setAttribute(_n, v) { this.pressed = v; } },
    { dataset: { lyricSpeed: "fast" }, pressed: null, setAttribute(_n, v) { this.pressed = v; } },
  ];
  syncLyricMotionUi(fakeList(buttons), { mode: "fade", speed: "fast" });
  assert.deepEqual(buttons.map((button) => button.pressed), ["false", "true", "false", "true"]);
});
