export type WindowDisplayMode = 'maximized' | 'fullscreen';
export function normalizeWindowDisplayMode(value: unknown): WindowDisplayMode {
  return value === 'fullscreen' ? 'fullscreen' : 'maximized';
}
export function windowExpandAction(mode: WindowDisplayMode, state: { fullscreen: boolean; maximized: boolean }) {
  return state.fullscreen || state.maximized ? 'restore'
    : mode === 'fullscreen' ? 'enter-fullscreen' : 'maximize-window';
}
