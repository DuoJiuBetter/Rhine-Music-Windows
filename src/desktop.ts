import { invoke } from "@tauri-apps/api/core";
import "./desktop.css";
import { normalizeWindowDisplayMode, windowExpandAction, type WindowDisplayMode } from './window-display-mode';
export { normalizeWindowDisplayMode } from './window-display-mode';
export type { WindowDisplayMode } from './window-display-mode';

export const isDesktop = () => "__TAURI_INTERNALS__" in window;
type WindowState = { fullscreen: boolean; maximized: boolean };
let windowState: WindowState = { fullscreen: false, maximized: false };
let preferredWindowMode: WindowDisplayMode = 'maximized';
function syncDisplayControls() {
  document.querySelectorAll<HTMLSelectElement>('#window-display-mode').forEach(select => { select.value = preferredWindowMode; });
  const button = document.querySelector<HTMLButtonElement>('.desktop-chrome [data-window="maximize"]');
  const label = windowState.fullscreen || windowState.maximized ? '还原' : preferredWindowMode === 'fullscreen' ? '全屏' : '最大化';
  button?.setAttribute('aria-label', label);
  button?.setAttribute('title', label);
}
export function windowDisplayMarkup() {
  return `<label class="settings-row"><span>中间窗口按钮的展开方式</span><select id="window-display-mode" aria-label="中间窗口按钮的展开方式">${([
    ['maximized', '最大化模式'], ['fullscreen', '全屏模式'],
  ] as const).map(([value, label]) => `<option value="${value}" ${value === preferredWindowMode ? 'selected' : ''}>${label}</option>`).join('')}</select></label><p class="quality-note">点击右上角中间按钮时，最大化模式保留任务栏，全屏模式覆盖任务栏；再次点击还原窗口。</p>`;
}
export function setWindowDisplayMode(mode: WindowDisplayMode) {
  preferredWindowMode = normalizeWindowDisplayMode(mode);
  syncDisplayControls();
}
document.addEventListener('fullscreenchange', syncDisplayControls);
function showError(error: unknown) {
  const toast = document.querySelector<HTMLElement>("#music-toast");
  if (!toast) return;
  toast.textContent = `桌面操作失败：${String(error)}`;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 5500);
}
export function mountDesktop() {
  if (!isDesktop()) return;
  document.documentElement.classList.add("rhine-desktop");
  const bar = document.createElement("header");
  bar.className = "desktop-chrome";
  const icon = (paths: string) => `<svg viewBox="0 0 12 12" aria-hidden="true">${paths}</svg>`;
  const maximizeIcon = icon('<rect x="1.5" y="1.5" width="9" height="9"/>');
  const restoreIcon = icon('<path d="M3.5 3.5V1.5H10.5V8.5H8.5"/><rect x="1.5" y="3.5" width="7" height="7"/>');
  bar.innerHTML = `<div class="desktop-drag" data-tauri-drag-region aria-hidden="true"></div>
    <nav aria-label="窗口控制"><button data-window="minimize" aria-label="最小化">${icon('<path d="M1 6.5H11"/>')}</button><button data-window="maximize" aria-label="最大化">${maximizeIcon}</button><button data-window="close" aria-label="关闭">${icon('<path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5"/>')}</button></nav>`;
  document.body.prepend(bar);
  const syncWindowState = (state: WindowState) => {
    windowState = state;
    document.documentElement.classList.toggle("desktop-maximized", state.maximized);
    document.documentElement.classList.toggle("desktop-fullscreen", state.fullscreen);
    syncDisplayControls();
    const maximize = bar.querySelector<HTMLButtonElement>('[data-window="maximize"]')!;
    const restore = state.maximized || state.fullscreen;
    maximize.innerHTML = restore ? restoreIcon : maximizeIcon;
    window.dispatchEvent(new Event("resize"));
  };
  const act = async (action: string) => {
    try {
      await invoke("desktop_window_action", { action });
    } catch (error) { showError(error); }
    // Refresh even after partial failures (for example, fullscreen succeeded
    // but focusing failed), so the middle button can still restore the window.
    try { syncWindowState(await invoke<WindowState>("desktop_window_state")); }
    catch (error) { showError(error); }
  };
  bar.addEventListener("click", event => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-window]")?.dataset.window;
    if (action) void act(action === 'maximize' ? windowExpandAction(preferredWindowMode, windowState) : action);
  });
  // Keep native single-click dragging, but use the same preference for the
  // title area's double-click instead of Tauri's built-in maximize-only path.
  bar.addEventListener('mousedown', event => {
    if (event.button !== 0 || event.detail !== 2 || !(event.target as HTMLElement).closest('.desktop-drag')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void act(windowExpandAction(preferredWindowMode, windowState));
  }, true);
  window.addEventListener("rhine-desktop-window-state", event => {
    syncWindowState((event as CustomEvent<{ fullscreen: boolean; maximized: boolean }>).detail);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "F11") { event.preventDefault(); event.stopImmediatePropagation(); void act("fullscreen"); }
    else if (event.key === "Escape" && windowState.fullscreen) {
      event.preventDefault(); event.stopImmediatePropagation(); void act("leave-fullscreen");
    }
    else if (event.key === "Escape" && document.documentElement.classList.contains("desktop-maximized") &&
      !document.querySelector(".music-panel") && document.querySelector<HTMLElement>("#stage")?.dataset.presentation === "archive" &&
      document.querySelector<HTMLElement>("#stage")?.dataset.overview !== "true") {
      event.preventDefault(); event.stopImmediatePropagation(); void act("restore");
    }
  }, true);
  document.addEventListener("click", event => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (anchor && anchor.origin !== location.origin && /^https?:$/.test(anchor.protocol)) {
      event.preventDefault(); void invoke("desktop_open_link", { url: anchor.href }).catch(showError);
    }
    const choose = (event.target as HTMLElement).closest('[data-action="choose-music-folder"]');
    if (choose) void (async () => {
      const folder = await invoke<string | null>("desktop_pick_folder");
      const field = document.querySelector<HTMLTextAreaElement>("#music-roots");
      if (!folder || !field) return;
      const roots = field.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      if (!roots.includes(folder)) roots.push(folder);
      field.value = roots.join("\n"); field.dispatchEvent(new Event("input", { bubbles: true }));
    })().catch(showError);
  });
  // Restored window state can predate the frontend listeners.
  void invoke<{ fullscreen: boolean; maximized: boolean }>("desktop_window_state").then(syncWindowState).catch(showError);
}

export async function openFeedbackDraft(url: string) {
  if (isDesktop()) await invoke('desktop_open_feedback', { url });
  else window.location.assign(url);
}
