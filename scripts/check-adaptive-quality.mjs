// Pure controller cases; no DOM, GL, accounts, files or audio.
import test from "node:test";
import assert from "node:assert/strict";
import { AdaptiveQuality, adaptiveSteps } from "../src/adaptive-quality.ts";
import { qualityPresets, normalizeQuality } from "../src/render-quality.ts";

const loaded = { gpuP95: 24, frameP95: 26 };
const relaxed = { gpuP95: 8, frameP95: 12 };

function settle(adaptive, sample, times) {
  let last = null;
  for (let i = 0; i < times; i++) last = adaptive.sample({ ...sample, now: i * 1500 }) ?? last;
  return last;
}

test("a single spike is not a trend, and the loop starts from the preset", () => {
  const adaptive = new AdaptiveQuality();
  adaptive.reset(qualityPresets.discretePlus);
  assert.equal(adaptive.sample({ ...loaded, now: 0 }), null, "one over-budget window changes nothing");
  assert.deepEqual(adaptive.snapshot().applying, []);
  assert.equal(adaptive.snapshot().quality.shadows, qualityPresets.discretePlus.shadows);
});

test("sustained overload gives up the least visible work first", () => {
  const adaptive = new AdaptiveQuality();
  adaptive.reset(qualityPresets.discretePlus);
  const first = settle(adaptive, loaded, 2);
  assert.equal(first.shadows, 1024, "shadow map resolution is the cheapest visible step");
  const second = settle(adaptive, loaded, 2);
  assert.equal(second.aoSamples, 8, "occlusion sampling is next, not the rest of the shadow map");
  assert.equal(second.shadows, 1024, "a second level of one knob waits for every knob's first level");
  const third = settle(adaptive, loaded, 2);
  assert.equal(third.transmission, 0.5);
  assert.deepEqual(adaptive.snapshot().applying, ["shadows", "aoSamples", "transmission"]);
  assert.equal(adaptive.snapshot().changes, 3);
});

test("recovery returns the authored preset exactly", () => {
  const adaptive = new AdaptiveQuality();
  adaptive.reset(qualityPresets.discretePlus);
  settle(adaptive, loaded, 10);
  assert.ok(adaptive.snapshot().step > 0);
  // Never above the preset, and the floor is respected while overloaded.
  for (const value of Object.entries(adaptive.snapshot().quality)) {
    const base = qualityPresets.discretePlus[value[0]];
    assert.ok(value[1] <= base || value[0] === "aoResolution" && value[1] >= base,
      `${value[0]} may only move away from the preset`);
  }
  settle(adaptive, relaxed, 200);
  assert.deepEqual(adaptive.snapshot().quality, normalizeQuality(qualityPresets.discretePlus),
    "headroom restores exactly the automatic preset");
  assert.equal(adaptive.snapshot().step, 0);
});

test("mixed evidence leaves the profile alone", () => {
  const adaptive = new AdaptiveQuality();
  adaptive.reset(qualityPresets.balanced);
  for (let i = 0; i < 60; i++)
    adaptive.sample(i % 2 ? { ...loaded, now: i * 1500 } : { ...relaxed, now: i * 1500 });
  assert.equal(adaptive.snapshot().step, 0, "an alternating load never accumulates either counter");

  const borderline = new AdaptiveQuality();
  borderline.reset(qualityPresets.balanced);
  settle(borderline, { gpuP95: 15, frameP95: 18 }, 40);
  assert.equal(borderline.snapshot().step, 0, "between load and recovery nothing is touched");
  assert.equal(borderline.snapshot().reason, "borderline");
});

test("frame time alone drives the loop when GPU timing is unavailable", () => {
  const adaptive = new AdaptiveQuality();
  adaptive.reset(qualityPresets.balanced);
  assert.equal(adaptive.sample({ gpuP95: null, frameP95: 30, now: 0 }), null);
  const stepped = adaptive.sample({ gpuP95: null, frameP95: 30, now: 1500 });
  assert.equal(stepped.shadows, 0, "the balanced preset drops a 1024 shadow map first");
  const recovered = settle(adaptive, { gpuP95: null, frameP95: 12 }, 4);
  assert.equal(recovered.shadows, qualityPresets.balanced.shadows);
});

test("the floor stops at the last step instead of removing the 3D array", () => {
  const adaptive = new AdaptiveQuality();
  adaptive.reset(qualityPresets.discretePlus);
  settle(adaptive, loaded, 400);
  const snapshot = adaptive.snapshot();
  // Every knob is exhausted: two shadow levels, two occlusion levels, two
  // transmission levels, four anisotropy levels, one depth-of-field level and
  // three render-scale levels.
  assert.equal(snapshot.step, 14);
  assert.equal(snapshot.reason, "floor");
  assert.equal(snapshot.quality.scale, 70, "render scale never drops below 70%");
  assert.equal(snapshot.quality.anisotropy, 1);
  assert.equal(snapshot.quality.aoSamples, 0);
  assert.ok(snapshot.quality.arrayBudget === qualityPresets.discretePlus.arrayBudget,
    "the visible-glass budget and the physical glass path are not quality steps");
  assert.equal(settle(adaptive, loaded, 6), null, "a floored device keeps rendering at the floor");
});

test("resetting drops previous adaptation instead of stacking it", () => {
  const adaptive = new AdaptiveQuality();
  adaptive.reset(qualityPresets.discretePlus);
  settle(adaptive, loaded, 6);
  assert.ok(adaptive.snapshot().step > 0);
  adaptive.reset(qualityPresets.balanced);
  assert.deepEqual(adaptive.snapshot().quality, normalizeQuality(qualityPresets.balanced));
  assert.equal(adaptive.snapshot().step, 0);
  adaptive.sample({ ...loaded, now: 0 }); adaptive.sample({ ...loaded, now: 1500 });
  assert.equal(adaptive.snapshot().quality.shadows, 0, "the new preset decides the next step");
});

test("disabling the loop leaves the preset untouched", () => {
  const adaptive = new AdaptiveQuality();
  adaptive.reset(qualityPresets.discretePlus);
  adaptive.enabled = false;
  assert.equal(settle(adaptive, loaded, 20), null);
  assert.equal(adaptive.snapshot().step, 0);
  assert.equal(adaptive.snapshot().enabled, false);
});
