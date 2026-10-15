// Pure module cases; no DOM, GL, accounts, files or audio.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PLAYBACK_ORDER,
  musicPlaybackOrders,
  normalizePlaybackOrder,
  playbackOrderMarkup,
  predecessorIndex,
  restoreQueueOrder,
  shuffledQueue,
  successorIndex,
  syncPlaybackOrderUi,
} from "../src/music-playback-order.ts";

const tracks = (ids) => ids.map((id) => ({ id, title: id }));

test("only the four authored orders are accepted", () => {
  assert.equal(normalizePlaybackOrder(undefined), DEFAULT_PLAYBACK_ORDER);
  assert.equal(normalizePlaybackOrder("loopOne"), "loopOne");
  assert.equal(normalizePlaybackOrder("random"), DEFAULT_PLAYBACK_ORDER);
  assert.deepEqual(musicPlaybackOrders.map((entry) => entry.id), ["sequential", "loopAll", "loopOne", "shuffle"]);
});

test("the natural end of a track follows the chosen order", () => {
  assert.equal(successorIndex("sequential", 0, 3, true), 1);
  assert.equal(successorIndex("sequential", 2, 3, true), null, "顺序播放 stops after the last track");
  assert.equal(successorIndex("loopAll", 2, 3, true), 0, "循环播放 returns to the first track");
  assert.equal(successorIndex("loopOne", 1, 3, true), 1, "单曲循环 repeats the same track");
  assert.equal(successorIndex("shuffle", 2, 3, true), 0, "随机播放 walks its shuffled queue and wraps");
  assert.equal(successorIndex("loopOne", 0, 1, true), 0, "a single-track queue keeps looping");
  assert.equal(successorIndex("sequential", -1, 0, true), null, "an empty queue never advances");
});

test("pressing next moves on even in single-track loop", () => {
  assert.equal(successorIndex("loopOne", 1, 3, false), 2, "an explicit step is not a repeat");
  assert.equal(successorIndex("loopOne", 2, 3, false), null);
  assert.equal(successorIndex("loopAll", 2, 3, false), 0);
});

test("a backward step clamps, and wraps only when looping", () => {
  assert.equal(predecessorIndex("sequential", 2, 3), 1);
  assert.equal(predecessorIndex("sequential", 0, 3), 0, "the first track stays put");
  assert.equal(predecessorIndex("loopAll", 0, 3), 2, "循环播放 wraps backwards");
  assert.equal(predecessorIndex("shuffle", 0, 3), 2);
  assert.equal(predecessorIndex("loopOne", 0, 3), 0);
  assert.equal(predecessorIndex("sequential", 0, 0), null);
});

test("one shuffled round keeps the current track first and every track once", () => {
  const queue = tracks(["a", "b", "c", "d"]);
  const round = shuffledQueue(queue, "c", () => 0);
  assert.equal(round.length, queue.length);
  assert.equal(round[0].id, "c", "the playing track is never interrupted");
  assert.deepEqual([...round.map((track) => track.id)].sort(), ["a", "b", "c", "d"]);
  const deterministic = shuffledQueue(queue, "a", () => 0.999);
  assert.deepEqual(deterministic.map((track) => track.id), ["a", "b", "c", "d"], "a fixed random source is reproducible");
  assert.deepEqual(shuffledQueue(queue, undefined, () => 0).map((track) => track.id), ["b", "c", "d", "a"]);
  assert.deepEqual(shuffledQueue([], "a", () => 0), []);
});

test("leaving shuffle restores the authored order without dropping new tracks", () => {
  const authored = tracks(["a", "b", "c"]);
  const shuffled = tracks(["c", "a", "b"]);
  assert.deepEqual(restoreQueueOrder(shuffled, authored).map((track) => track.id), ["a", "b", "c"]);
  const extended = tracks(["c", "a", "d", "b"]);
  assert.deepEqual(
    restoreQueueOrder(extended, authored).map((track) => track.id),
    ["a", "b", "c", "d"],
    "a track added while shuffling keeps playing instead of being lost",
  );
  assert.deepEqual(restoreQueueOrder(tracks(["b"]), authored).map((track) => track.id), ["b"]);
});

test("the transport offers four buttons and marks exactly one", () => {
  const markup = playbackOrderMarkup();
  for (const order of musicPlaybackOrders) assert.ok(markup.includes(`data-playback-order="${order.id}"`));
  assert.equal(markup.match(/data-playback-order=/g).length, 4);
  assert.ok(markup.includes("<svg"), "icons follow the app's stroke language");
  const buttons = musicPlaybackOrders.map((order) => ({
    dataset: { playbackOrder: order.id },
    pressed: null,
    pressedAttr: null,
    setAttribute(name, value) { if (name === "aria-pressed") this.pressed = value; else this.pressedAttr = value; },
    removeAttribute(name) { if (name === "aria-checked") this.pressedAttr = null; },
  }));
  syncPlaybackOrderUi({ querySelectorAll: () => buttons }, "loopOne");
  assert.deepEqual(buttons.map((button) => button.pressed), ["false", "false", "true", "false"]);
  assert.equal(buttons[2].pressedAttr, "true");
});
