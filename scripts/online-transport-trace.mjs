import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';
import { errorChain } from './online-error-chain.mjs';
import { addOnlineTransport, diagnoseOnlineFailure } from './online-diagnostics.mjs';

const context = new AsyncLocalStorage();
const requests = new WeakMap(), sockets = new WeakMap(), results = new WeakMap();
const origins = new Set(['https://music.163.com', 'https://interface.music.163.com']);
const connections = [];
const elapsed = (now, start) => Math.max(0, Math.round((now - start) * 100) / 100);
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const originOf = value => {
  try { const origin = new URL(String(value)).origin; return origins.has(origin) ? origin : undefined; } catch { return undefined; }
};
const socketInfo = socket => {
  if (!socket) return undefined;
  let protocol;
  try { protocol = socket.getProtocol?.(); } catch {}
  return { bytesRead: integer(socket.bytesRead), bytesWritten: integer(socket.bytesWritten),
    family: ['IPv4', 'IPv6'].includes(socket.remoteFamily) ? socket.remoteFamily : undefined,
    tlsProtocol: ['TLSv1.2', 'TLSv1.3'].includes(protocol) ? protocol : undefined,
    tlsAuthorized: typeof socket.authorized === 'boolean' ? socket.authorized : undefined,
    destroyed: typeof socket.destroyed === 'boolean' ? socket.destroyed : undefined,
  };
};
function append(store, item, limit) {
  if (store.length >= limit) store.splice(Math.floor(limit / 2), 1);
  store.push(item);
}
function subscribe(name, handler) {
  // Undici's documented observers run synchronously; never affect transport.
  channel(`undici:${name}`).subscribe(message => { try { handler(message); } catch {} });
}
subscribe('request:create', ({ request }) => {
  const current = context.getStore(), origin = originOf(request.origin);
  if (!current || !origin) return;
  requests.set(request, current); current.origins.add(origin);
  append(current.events, { event: 'request-created', at: performance.now(), origin }, 16);
});
subscribe('client:sendHeaders', ({ request, socket }) => {
  const current = requests.get(request); if (!current) return;
  const count = sockets.get(socket) || 0; sockets.set(socket, count + 1);
  current.socket = socket;
  append(current.events, { event: 'sending-headers', at: performance.now(), previousObservedRequestsOnSocket: count, socket: socketInfo(socket) }, 16);
});
for (const [name, event] of [['bodySent', 'request-body-sent'], ['headers', 'response-headers'], ['trailers', 'response-complete'], ['error', 'request-error']]) {
  subscribe(`request:${name}`, ({ request, response, error }) => {
    const current = requests.get(request); if (!current) return;
    append(current.events, { event, at: performance.now(), status: integer(response?.statusCode), chain: error ? errorChain(error, 8) : undefined }, 16);
  });
}
for (const [name, event] of [['beforeConnect', 'before-connect'], ['connected', 'connected'], ['connectError', 'connect-error']]) {
  subscribe(`client:${name}`, ({ connectParams, socket, error }) => {
    const origin = originOf(`${connectParams.protocol}//${connectParams.hostname}${connectParams.port && String(connectParams.port) !== '443' ? ':' + connectParams.port : ''}`);
    if (!origin) return;
    if (connections.length >= 64) connections.shift();
    connections.push({ event, at: performance.now(), origin, socket: socketInfo(socket), chain: error ? errorChain(error, 8) : undefined });
  });
}
function snapshot(current) {
  const end = performance.now();
  const event = item => { const { at, ...safe } = item; return { ...safe, elapsedMs: elapsed(at, current.start) }; };
  return {
    durationMs: elapsed(end, current.start), timeoutMs: integer(current.timeoutMs), requestEvents: current.events.map(event),
    lastRequestPhase: current.events.filter(item => item.event !== 'request-error').at(-1)?.event || 'no-request-event',
    socketAtFailure: socketInfo(current.socket),
    // Connections belong to an origin's shared pool, not to a specific request.
    connectionEventScope: 'shared-origin-pool-time-window',
    connectionEvents: connections.filter(item => current.origins.has(item.origin) && item.at >= current.start && item.at <= end).slice(-12).map(event),
  };
}
export async function traceOnlineRequest(provider, operation, action, { timeoutMs } = {}) {
  const current = { start: performance.now(), events: [], origins: new Set(), socket: undefined, timeoutMs };
  return context.run(current, async () => {
    try {
      const result = await action();
      if (result && typeof result === 'object') results.set(result, snapshot(current));
      return result;
    } catch (failure) {
      diagnoseOnlineFailure(failure, provider, operation);
      addOnlineTransport(failure, snapshot(current));
      throw failure;
    }
  });
}
export function onlineTransport(result) { return results.get(result); }
