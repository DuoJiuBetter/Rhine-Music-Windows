import type { MusicProvider } from './music-platform';
import { isDiagnosticSystemCode, sanitizeOnlineChain, sanitizeOnlineTransport } from './online-debug-details.ts';

export type Diagnostic = {
  time: string; provider: MusicProvider; operation: string; stage: string; code: string;
  httpStatus?: number; upstreamStatus?: number; businessCode?: number;
  causes?: string[]; nodeVersion?: string; undiciVersion?: string; id?: string; attempt?: number;
  chain?: ReturnType<typeof sanitizeOnlineChain>; transport?: ReturnType<typeof sanitizeOnlineTransport>;
};
const records: Diagnostic[] = [];
const operations = new Set(['search', 'playback', 'qrKey', 'qrCreate', 'qrCheck', 'status', 'playlists', 'playlistDetail', 'playlistTracks', 'songDetail', 'songInfo', 'album', 'lyric', 'start', 'poll', 'cancel', 'logout', 'cover', 'request']);
const safeNumber = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 999999 ? value : undefined;
let refresh: (() => void) | undefined;

export function reportOnlineFailure(provider: MusicProvider, operation: string, value: unknown, httpStatus?: number, attempt?: number) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const prefix = provider.toUpperCase();
  const networkCode = typeof input.code === 'string' && input.code.startsWith(`${prefix}_NETWORK_`) ? input.code.slice(prefix.length + 9) : undefined;
  const validNetworkCode = networkCode === 'UNKNOWN' || networkCode === 'TIMEOUT' || isDiagnosticSystemCode(networkCode);
  const code = typeof input.code === 'string' && (validNetworkCode || new RegExp(`^${prefix}_(?:HTTP_\\d{3}|BUSINESS_(?:-?\\d{1,6}|MISSING_CODE)|INTERNAL_(?:TYPEERROR|REFERENCEERROR|RANGEERROR|UNKNOWN)|RESPONSE_(?:INVALID_JSON|TOO_LARGE)|PLAYBACK_NO_URL|FRONTEND_(?:FETCH_FAILED|INVALID_JSON|EMPTY_SOURCE)|MEDIA_[1-4]|PLAY_(?:NOT_ALLOWED|ABORTED|FAILED))$`).test(input.code)) ? input.code : `${prefix}_HTTP_${httpStatus || 0}`;
  records.push({ time: new Date().toISOString(), provider, operation: operations.has(input.operation as string) ? input.operation as string : operations.has(operation) ? operation : 'request',
    stage: ['http', 'business', 'network', 'response', 'internal', 'permission', 'media', 'frontend'].includes(input.stage as string) ? input.stage as string : 'http', code,
    httpStatus: safeNumber(httpStatus), upstreamStatus: safeNumber(input.upstreamStatus), businessCode: safeNumber(input.businessCode), attempt: safeNumber(attempt),
    causes: Array.isArray(input.causes) ? input.causes.filter(isDiagnosticSystemCode).slice(0, 8) : undefined,
    nodeVersion: typeof input.nodeVersion === 'string' && /^\d+\.\d+\.\d+$/.test(input.nodeVersion) ? input.nodeVersion : undefined,
    undiciVersion: typeof input.undiciVersion === 'string' && /^\d+\.\d+\.\d+$/.test(input.undiciVersion) ? input.undiciVersion : undefined,
    id: typeof input.id === 'string' && /^[0-9a-f-]{36}$/.test(input.id) ? input.id : undefined,
    chain: sanitizeOnlineChain(input.chain), transport: sanitizeOnlineTransport(input.transport),
  });
  if (records.length > 20) records.shift();
  refresh?.();
}

// Observe failures without changing endpoints, response bodies or retry policy.
export async function fetchOnline(provider: MusicProvider, operation: string, url: string, options?: RequestInit, attempt?: number): Promise<Response> {
  let response: Response;
  try { response = await fetch(url, options); }
  catch (failure) {
    if (!options?.signal?.aborted) reportOnlineFailure(provider, operation, { stage: 'frontend', code: `${provider.toUpperCase()}_FRONTEND_FETCH_FAILED` }, undefined, attempt);
    throw failure;
  }
  if (!response.ok && !options?.signal?.aborted) {
    const body = await response.clone().json().catch(() => null);
    if (!options?.signal?.aborted) reportOnlineFailure(provider, operation, body?.diagnostic, response.status, attempt);
  }
  return response;
}

export function onlineErrorReport(version: string) { return JSON.stringify({ version, errors: records }, null, 2); }

export function mountOnlineDebug(root: HTMLElement, version: string, enabled = false) {
  const panel = document.createElement('aside');
  panel.className = 'online-debug'; panel.hidden = true; panel.setAttribute('aria-label', '在线错误调试');
  panel.innerHTML = '<header><strong>在线请求报错</strong><button type="button" data-debug-close aria-label="关闭错误详情">×</button></header><code></code><small data-debug-deepest></small><textarea readonly aria-label="可复制的错误诊断" spellcheck="false"></textarea><footer><button type="button" data-debug-copy>复制报错</button><button type="button" data-debug-clear>清空</button><span role="status" aria-live="polite"></span></footer>';
  root.append(panel);
  // Keep selection, copy shortcuts and wheel scrolling inside the diagnostic UI.
  for (const type of ['keydown', 'wheel', 'pointerdown', 'click']) panel.addEventListener(type, event => event.stopPropagation());
  const text = panel.querySelector('textarea')!;
  const status = panel.querySelector<HTMLElement>('[role="status"]')!;
  const render = () => {
    panel.querySelector('code')!.textContent = records.at(-1)?.code || '暂无错误记录';
    const latest = records.at(-1);
    const deepest = latest?.chain?.nodes.filter(node => !node.cycle).sort((a, b) => (b.depth || 0) - (a.depth || 0))[0];
    panel.querySelector('[data-debug-deepest]')!.textContent = [deepest && `最深层：${deepest.code || deepest.name || '未知'}`, deepest?.syscall, deepest?.errno !== undefined && `errno ${deepest.errno}`, latest?.transport?.lastRequestPhase && `阶段：${latest.transport.lastRequestPhase}`].filter(Boolean).join(' · ');
    text.value = onlineErrorReport(version);
  };
  const show = () => { if (!enabled) return; render(); panel.hidden = false; status.textContent = ''; };
  refresh = () => { render(); if (enabled) show(); };
  panel.querySelector('[data-debug-close]')!.addEventListener('click', () => { panel.hidden = true; });
  panel.querySelector('[data-debug-clear]')!.addEventListener('click', () => { records.length = 0; render(); status.textContent = '已清空'; });
  panel.querySelector('[data-debug-copy]')!.addEventListener('click', () => { void (async () => {
    const report = text.value;
    try { await navigator.clipboard.writeText(report); status.textContent = '已复制'; }
    catch { text.focus(); text.select(); status.textContent = '请按 Ctrl+C 复制'; }
  })(); });
  return { show, setEnabled: (value: boolean) => { enabled = value; if (!enabled) panel.hidden = true; }, dispose: () => { refresh = undefined; records.length = 0; panel.remove(); } };
}
