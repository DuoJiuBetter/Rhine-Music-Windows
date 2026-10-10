import { invoke } from "@tauri-apps/api/core";
import "./desktop.css";

export const isDesktop = () => "__TAURI_INTERNALS__" in window;
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
  const syncWindowState = (state: { fullscreen: boolean; maximized: boolean }) => {
    document.documentElement.classList.toggle("desktop-maximized", state.maximized);
    const maximize = bar.querySelector<HTMLButtonElement>('[data-window="maximize"]')!;
    const restore = state.maximized;
    maximize.innerHTML = restore ? restoreIcon : maximizeIcon;
    maximize.setAttribute("aria-label", restore ? "还原" : "最大化");
    window.dispatchEvent(new Event("resize"));
  };
  const act = (action: string) => invoke("desktop_window_action", { action }).catch(showError);
  bar.addEventListener("click", event => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-window]")?.dataset.window;
    if (action) void act(action);
  });
  window.addEventListener("rhine-desktop-window-state", event => {
    syncWindowState((event as CustomEvent<{ fullscreen: boolean; maximized: boolean }>).detail);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "F11") { event.preventDefault(); event.stopImmediatePropagation(); void act("maximize"); }
    else if (event.key === "Escape" && document.documentElement.classList.contains("desktop-maximized") &&
      !document.querySelector(".music-panel") && document.querySelector<HTMLElement>("#stage")?.dataset.presentation === "archive" &&
      document.querySelector<HTMLElement>("#stage")?.dataset.overview !== "true") {
      event.preventDefault(); event.stopImmediatePropagation(); void act("restore");
    }
  }, true);
  // Route the existing settings control through the same work-area behavior.
  document.addEventListener("click", event => {
    if (!(event.target as HTMLElement).closest('[data-action="fullscreen"]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); void act("maximize");
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
