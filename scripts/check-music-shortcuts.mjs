// Pure module cases; no DOM, GL, accounts, files or audio.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MUSIC_SHORTCUTS,
  RESERVED_MUSIC_SHORTCUT_KEYS,
  bindMusicShortcut,
  clearMusicShortcut,
  musicShortcutMarkup,
  musicShortcutActions,
  normalizeMusicShortcuts,
  renderMusicShortcuts,
  resolveMusicShortcutCapture,
  shortcutActionForEvent,
  shortcutKeyFromEvent,
} from "../src/music-shortcuts.ts";

const event = (key, extra = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, ...extra });
const typing = { closest: (selector) => (selector.includes("input") ? {} : null) };

test("the requested defaults survive a round trip and unknown actions are dropped", () => {
  assert.deepEqual(DEFAULT_MUSIC_SHORTCUTS, { previous: "1", modeLoopOne: "5" });
  assert.deepEqual(normalizeMusicShortcuts(DEFAULT_MUSIC_SHORTCUTS), DEFAULT_MUSIC_SHORTCUTS);
  assert.deepEqual(normalizeMusicShortcuts(undefined), DEFAULT_MUSIC_SHORTCUTS);
  assert.deepEqual(normalizeMusicShortcuts({ nonsense: "9", previous: "8" }), { previous: "8" });
  assert.deepEqual(normalizeMusicShortcuts({ previous: 8, next: "" }), {}, "only real keys are kept");
  assert.deepEqual(normalizeMusicShortcuts({ previous: "x".repeat(40) }), {}, "a stored key stays bounded");
  assert.deepEqual(
    normalizeMusicShortcuts({ previous: "9", next: "9" }),
    { previous: "9" },
    "a stored duplicate keeps the first action only",
  );
});

test("single keys bind, modifier combinations stay with the platform", () => {
  assert.equal(shortcutKeyFromEvent(event("A")), "a");
  assert.equal(shortcutKeyFromEvent(event("5")), "5");
  assert.equal(shortcutKeyFromEvent(event("ArrowLeft")), "ArrowLeft");
  assert.equal(shortcutKeyFromEvent(event("1", { ctrlKey: true })), null);
  assert.equal(shortcutKeyFromEvent(event("1", { altKey: true })), null);
  assert.equal(shortcutKeyFromEvent(event("1", { metaKey: true })), null);
  assert.equal(shortcutKeyFromEvent(event("Shift")), null);
  assert.equal(shortcutKeyFromEvent(event("Dead")), null);
});

test("matching honours the binding table and never fires while typing", () => {
  const bindings = { previous: "1", modeLoopOne: "5", next: "n" };
  assert.equal(shortcutActionForEvent(bindings, event("1"), null), "previous");
  assert.equal(shortcutActionForEvent(bindings, event("5"), null), "modeLoopOne");
  assert.equal(shortcutActionForEvent(bindings, event("N"), null), "next", "letters ignore case");
  assert.equal(shortcutActionForEvent(bindings, event("9"), null), null);
  assert.equal(shortcutActionForEvent(bindings, event("1"), typing), null);
  assert.equal(shortcutActionForEvent(bindings, event("1", { ctrlKey: true }), null), null);
});

test("binding a taken key releases it from its previous action", () => {
  const bound = bindMusicShortcut({ previous: "1", next: "9" }, "previous", "9");
  assert.deepEqual(bound, { previous: "9" }, "one key, one action");
  assert.deepEqual(clearMusicShortcut(bound, "previous"), {});
  assert.deepEqual(clearMusicShortcut({ previous: "1" }, "next"), { previous: "1" });
});

test("capture cancels, clears, refuses reserved keys and reports conflicts", () => {
  const bindings = { previous: "1", modeLoopOne: "5" };
  assert.deepEqual(resolveMusicShortcutCapture(bindings, "next", event("Escape")), {
    bindings, status: "已取消绑定", done: true,
  });
  const cleared = resolveMusicShortcutCapture(bindings, "previous", event("Backspace"));
  assert.deepEqual(cleared.bindings, { modeLoopOne: "5" });
  assert.equal(cleared.done, true);
  // Escape is the cancel key above; the remaining reserved keys are refused.
  for (const key of RESERVED_MUSIC_SHORTCUT_KEYS.filter((entry) => entry !== "Escape")) {
    const reserved = resolveMusicShortcutCapture(bindings, "next", event(key));
    assert.equal(reserved.done, false, `${key} is not bindable`);
    assert.deepEqual(reserved.bindings, bindings);
    assert.ok(reserved.status.includes("保留按键"));
  }
  const modifier = resolveMusicShortcutCapture(bindings, "next", event("k", { ctrlKey: true }));
  assert.equal(modifier.done, false);
  assert.ok(modifier.status.includes("组合键"));
  const taken = resolveMusicShortcutCapture(bindings, "next", event("5"));
  assert.deepEqual(taken.bindings, { previous: "1", next: "5" }, "the conflicting action lost the key");
  assert.ok(taken.status.includes("单曲循环"), "the message names the action that lost its key");
  const fresh = resolveMusicShortcutCapture(bindings, "next", event("8"));
  assert.deepEqual(fresh.bindings, { previous: "1", modeLoopOne: "5", next: "8" });
  assert.equal(fresh.done, true);
});

test("the section lists every action and shows unbound rows as 未设置", () => {
  const markup = musicShortcutMarkup();
  assert.ok(markup.includes('id="shortcut-settings"'));
  assert.ok(markup.includes('data-settings-group="appearance"'));
  for (const action of musicShortcutActions) assert.ok(markup.includes(`data-shortcut-action="${action.id}"`));
  assert.equal(markup.match(/data-shortcut-action=/g).length, musicShortcutActions.length);
  assert.ok(markup.includes("data-shortcut-reset"));
  assert.ok(markup.includes("data-shortcut-clear"));
  assert.ok(markup.includes('role="status"'));
});

test("rendering shows the key, the waiting state and one pressed row", () => {
  const buttons = musicShortcutActions.map((action) => ({
    dataset: { shortcutAction: action.id },
    textContent: "", setAttribute() {}, removeAttribute() {},
  }));
  const root = {
    querySelectorAll: () => buttons,
    querySelector: () => null,
  };
  renderMusicShortcuts(root, { previous: "1", modeLoopOne: "5" }, "next");
  const shown = Object.fromEntries(buttons.map((button) => [button.dataset.shortcutAction, button.textContent]));
  assert.equal(shown.previous, "1");
  assert.equal(shown.modeLoopOne, "5");
  assert.equal(shown.next, "等待按键…", "the capturing row asks for a key");
  assert.equal(shown.stop, "未设置");
});
