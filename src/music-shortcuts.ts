/** User-assigned playback shortcuts.
 *
 * Bindings live in preferences, matching and capture are pure functions here, and
 * the app only supplies the action implementations — so the same table can drive
 * the settings screen, the key handler and the tests without a second source of
 * truth. Keys the interface itself relies on are reserved instead of silently
 * fighting the existing Space/Enter/Tab/Escape behaviour. */
export type MusicShortcutAction =
  | "previous"
  | "next"
  | "toggle"
  | "stop"
  | "seekBack"
  | "seekForward"
  | "volumeDown"
  | "volumeUp"
  | "modeSequential"
  | "modeLoopAll"
  | "modeLoopOne"
  | "modeShuffle";

export type MusicShortcutBindings = Partial<Record<MusicShortcutAction, string>>;

export const musicShortcutActions: readonly {
  id: MusicShortcutAction;
  label: string;
}[] = [
  { id: "previous", label: "上一首" },
  { id: "next", label: "下一首" },
  { id: "toggle", label: "播放 / 暂停" },
  { id: "stop", label: "停止播放" },
  { id: "seekBack", label: "后退 10 秒" },
  { id: "seekForward", label: "前进 10 秒" },
  { id: "volumeDown", label: "音量 −5%" },
  { id: "volumeUp", label: "音量 +5%" },
  { id: "modeSequential", label: "顺序播放" },
  { id: "modeLoopAll", label: "循环播放" },
  { id: "modeLoopOne", label: "单曲循环" },
  { id: "modeShuffle", label: "随机播放" },
];

/** The two the maintainer asked for: 1 = previous track, 5 = single-track loop. */
export const DEFAULT_MUSIC_SHORTCUTS: MusicShortcutBindings = {
  previous: "1",
  modeLoopOne: "5",
};

/** Keys the interface itself needs; binding them would fight the app. */
export const RESERVED_MUSIC_SHORTCUT_KEYS: readonly string[] = [" ", "Enter", "Tab", "Escape"];

export const MUSIC_SHORTCUT_STEP_SECONDS = 10;
export const MUSIC_SHORTCUT_VOLUME_STEP = 0.05;

const actionIds = musicShortcutActions.map((entry) => entry.id);

export function musicShortcutLabel(action: MusicShortcutAction): string {
  return musicShortcutActions.find((entry) => entry.id === action)?.label ?? action;
}

const KEY_LABELS: Record<string, string> = {
  " ": "空格",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Enter: "Enter",
  Escape: "Esc",
  Backspace: "Backspace",
  Delete: "Delete",
  Tab: "Tab",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

export const musicShortcutKeyLabel = (key: string) => KEY_LABELS[key] ?? key;

export function normalizeMusicShortcuts(value: unknown): MusicShortcutBindings {
  if (!value || typeof value !== "object") return { ...DEFAULT_MUSIC_SHORTCUTS };
  const source = value as Record<string, unknown>;
  const bindings: MusicShortcutBindings = {};
  for (const id of actionIds) {
    const key = source[id];
    if (typeof key !== "string" || !key.length || key.length > 24) continue;
    // A stored key never wins over an earlier action: one key, one action.
    if (Object.values(bindings).includes(key)) continue;
    bindings[id] = key;
  }
  return bindings;
}

/** A single printable character or a named key, ignoring modifier combinations so
 * browser and system shortcuts keep working. */
export function shortcutKeyFromEvent(event: {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): string | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  const key = event.key;
  if (!key || key === "Dead" || key === "Unidentified") return null;
  if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return null;
  return key.length === 1 ? key.toLowerCase() : key;
}

export function isMusicTypingTarget(target: unknown): boolean {
  const node = target as { closest?: (selector: string) => unknown } | null;
  return Boolean(
    node?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']"),
  );
}

export function shortcutActionForEvent(
  bindings: MusicShortcutBindings,
  event: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
  target?: unknown,
): MusicShortcutAction | null {
  if (isMusicTypingTarget(target)) return null;
  const key = shortcutKeyFromEvent(event);
  if (!key) return null;
  for (const action of actionIds) if (bindings[action] === key) return action;
  return null;
}

/** One key, one action: assigning a taken key releases it from its old action. */
export function bindMusicShortcut(
  bindings: MusicShortcutBindings,
  action: MusicShortcutAction,
  key: string,
): MusicShortcutBindings {
  const next: MusicShortcutBindings = {};
  for (const id of actionIds) {
    const bound = bindings[id];
    if (id !== action && bound === key) continue;
    if (bound) next[id] = bound;
  }
  next[action] = key;
  return next;
}

export function clearMusicShortcut(
  bindings: MusicShortcutBindings,
  action: MusicShortcutAction,
): MusicShortcutBindings {
  const next = { ...bindings };
  delete next[action];
  return next;
}

export type MusicShortcutCapture = {
  bindings: MusicShortcutBindings;
  status: string;
  done: boolean;
};

/** Esc cancels, Backspace/Delete clear, anything else binds — including the
 * warning when the key was already used by another action. */
export function resolveMusicShortcutCapture(
  bindings: MusicShortcutBindings,
  action: MusicShortcutAction,
  event: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
): MusicShortcutCapture {
  if (event.key === "Escape") return { bindings, status: "已取消绑定", done: true };
  if (event.key === "Backspace" || event.key === "Delete")
    return { bindings: clearMusicShortcut(bindings, action), status: `已清除「${musicShortcutLabel(action)}」的按键`, done: true };
  const key = shortcutKeyFromEvent(event);
  if (!key)
    return { bindings, status: "组合键不可绑定，请按单个按键（Esc 取消）", done: false };
  if (RESERVED_MUSIC_SHORTCUT_KEYS.includes(key))
    return {
      bindings,
      status: `「${musicShortcutKeyLabel(key)}」是界面保留按键，请换一个（Esc 取消）`,
      done: false,
    };
  const taken = actionIds.find((id) => id !== action && bindings[id] === key);
  const next = bindMusicShortcut(bindings, action, key);
  return {
    bindings: next,
    status: taken
      ? `已绑定到「${musicShortcutLabel(action)}」，并解除了「${musicShortcutLabel(taken)}」上的同一按键`
      : `已绑定「${musicShortcutKeyLabel(key)}」到「${musicShortcutLabel(action)}」`,
    done: true,
  };
}

export function musicShortcutMarkup() {
  const rows = musicShortcutActions
    .map(
      (entry) =>
        `<div class="settings-row"><span>${entry.label}</span><button type="button" class="shortcut-key" data-shortcut-action="${entry.id}" aria-label="为${entry.label}绑定按键"></button></div>`,
    )
    .join("");
  return `<section class="panel-section" id="shortcut-settings" data-settings-group="appearance"><h3>自定义快捷键</h3><p>点击右侧按键框，然后按下要使用的按键即可绑定；按 Esc 取消，按 Backspace 清除。绑定的按键在播放界面任意位置生效，输入框内不会触发。空格、Enter、Tab、Esc 为界面保留按键。</p>${rows}<div class="shortcut-footer"><button type="button" class="text-button" data-shortcut-reset>恢复默认（1 上一首 · 5 单曲循环）</button><button type="button" class="text-button" data-shortcut-clear>清空全部</button></div><p class="shortcut-status" id="shortcut-status" role="status" aria-live="polite"></p></section>`;
}

export function renderMusicShortcuts(
  root: ParentNode,
  bindings: MusicShortcutBindings,
  capturing: MusicShortcutAction | null = null,
) {
  for (const button of root.querySelectorAll<HTMLElement>("[data-shortcut-action]")) {
    const action = button.dataset.shortcutAction as MusicShortcutAction;
    const key = bindings[action];
    const waiting = capturing === action;
    button.textContent = waiting ? "等待按键…" : key ? musicShortcutKeyLabel(key) : "未设置";
    button.dataset.bound = key ? "true" : "false";
    if (waiting) button.dataset.capturing = "true";
    else delete button.dataset.capturing;
    button.setAttribute("aria-pressed", String(waiting));
  }
  const status = root.querySelector<HTMLElement>("#shortcut-status");
  if (status && capturing) status.textContent = `请按下要绑定到「${musicShortcutLabel(capturing)}」的按键，Esc 取消，Backspace 清除`;
}

export function setMusicShortcutStatus(root: ParentNode, message: string) {
  const status = root.querySelector<HTMLElement>("#shortcut-status");
  if (status) status.textContent = message;
}
