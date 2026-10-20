import { escapeHtml } from './html.ts';

export const defaultKeybindings = {
  playlistPrevious: 'ArrowUp', playlistNext: 'ArrowDown',
  songPrevious: 'ArrowLeft', songNext: 'ArrowRight',
  seekBackward: 'ArrowLeft', seekForward: 'ArrowRight',
  boostPrimary: 'ArrowLeft', boostSecondary: 'ArrowRight',
} as const;
export type ShortcutAction = keyof typeof defaultKeybindings;
export type MusicKeybindings = Record<ShortcutAction, string>;
export const shortcutLabels: Record<ShortcutAction, string> = {
  playlistPrevious: '上一个歌单', playlistNext: '下一个歌单',
  songPrevious: '上一首／模型', songNext: '下一首／模型',
  seekBackward: '双击 · 回退 15 秒', seekForward: '双击 · 快进 15 秒',
  boostPrimary: '长按 · 2 倍速（键一）', boostSecondary: '长按 · 2 倍速（键二）',
};
export function shortcutKey(key: string): string | undefined {
  if (/^[a-z0-9]$/i.test(key) && key.toLowerCase() !== 'v') return key.toLowerCase();
  if (/^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|F([1-9]|10|12))$/.test(key)) return key;
}
const groups: ShortcutAction[][] = [
  ['playlistPrevious', 'playlistNext', 'songPrevious', 'songNext'],
  ['seekBackward', 'seekForward'], ['boostPrimary', 'boostSecondary'],
];
export function keybindingConflict(bindings: MusicKeybindings): string | undefined {
  for (const group of groups) if (new Set(group.map(action => bindings[action])).size !== group.length)
    return '同一种操作方式不能重复使用同一个键。单击、双击、长按可以共用一个键。';
}
export function normalizeKeybindings(value: unknown): MusicKeybindings {
  if (!value || typeof value !== 'object') return { ...defaultKeybindings };
  const input = value as Record<string, unknown>, result = { ...defaultKeybindings } as MusicKeybindings;
  for (const action of Object.keys(defaultKeybindings) as ShortcutAction[]) {
    const key = input[action];
    if (typeof key === 'string') result[action] = shortcutKey(key) ?? defaultKeybindings[action];
  }
  return keybindingConflict(result) ? { ...defaultKeybindings } : result;
}
export function swappedKeybindings(): MusicKeybindings {
  return { playlistPrevious: 'ArrowLeft', playlistNext: 'ArrowRight',
    songPrevious: 'ArrowUp', songNext: 'ArrowDown', seekBackward: 'ArrowUp', seekForward: 'ArrowDown',
    boostPrimary: 'ArrowUp', boostSecondary: 'ArrowDown' };
}
export function keyLabel(key: string): string {
  return ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'Page Up', PageDown: 'Page Down' } as Record<string, string>)[key] ?? key.toUpperCase();
}
export function keybindingsMarkup(bindings: MusicKeybindings): string {
  return `<div class="keyboard-presets"><button type="button" class="text-button" data-key-preset="default">恢复默认</button><button type="button" class="text-button" data-key-preset="swapped">交换上下／左右</button></div>
    <p class="quality-note">空格固定为暂停／继续。点击右侧按键即可重新设置；Esc 取消。可使用方向键、字母、数字、Home／End、Page Up／Down 或功能键（V、F11 等界面快捷键保留）。</p>
    ${Object.entries(shortcutLabels).map(([action, label]) => `<div class="settings-row shortcut-row"><span>${label}</span><button type="button" class="shortcut-binding" data-key-binding="${action}" aria-label="设置${label}快捷键">${escapeHtml(keyLabel(bindings[action as ShortcutAction]))}</button></div>`).join('')}
    <p id="shortcut-status" class="quality-note" role="status" aria-live="polite"></p>`;
}

/** The editor owns capture only while waiting for a key; no reload is required. */
export function mountKeybindingEditor(root: HTMLElement, read: () => MusicKeybindings, save: (bindings: MusicKeybindings) => void): () => void {
  const events = new AbortController(); let editing: HTMLButtonElement | undefined;
  const status = (text: string) => { const node = root.querySelector('#shortcut-status'); if (node) node.textContent = text; };
  const repaint = () => {
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-key-binding]')) {
      button.textContent = keyLabel(read()[button.dataset.keyBinding as ShortcutAction]);
      button.removeAttribute('data-recording');
    }
    editing = undefined;
  };
  root.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-key-binding], [data-key-preset]');
    if (!target) return;
    if (target.dataset.keyPreset) {
      save(target.dataset.keyPreset === 'swapped' ? swappedKeybindings() : { ...defaultKeybindings });
      repaint(); status('快捷键已保存。'); return;
    }
    repaint(); editing = target; target.dataset.recording = 'true'; target.textContent = '请按键…'; status('等待按键，Esc 取消。');
  }, { signal: events.signal });
  // Window capture runs before playback/navigation and focused control handlers.
  window.addEventListener('keydown', event => {
    if (!editing) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    if (event.key === 'Escape') { repaint(); status('已取消。'); return; }
    const key = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && shortcutKey(event.key);
    if (!key) { status('此按键为系统／界面保留键，请选择其他按键。'); return; }
    const next = { ...read(), [editing.dataset.keyBinding!]: key };
    const conflict = keybindingConflict(next);
    if (conflict) { status(conflict); return; }
    save(next); repaint(); status('快捷键已保存。');
  }, { capture: true, signal: events.signal });
  root.addEventListener('focusout', event => {
    if (editing && event.target === editing) { repaint(); status('已取消。'); }
  }, { signal: events.signal });
  return () => { repaint(); events.abort(); };
}
