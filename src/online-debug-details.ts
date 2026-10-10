const codes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_ABORTED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_CRYPTO_INVALID_KEYLEN', 'ERR_CRYPTO_UNKNOWN_CIPHER']);
export const isDiagnosticSystemCode = (value: unknown): value is string => typeof value === 'string' && codes.has(value);
const names = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AggregateError', 'DOMException', 'AbortError', 'TimeoutError', 'ConnectTimeoutError', 'HeadersTimeoutError', 'BodyTimeoutError', 'SocketError', 'RequestAbortedError']);
const messages = new Set(['fetch failed', 'terminated', 'socket hang up', 'other side closed', 'aborted', 'The operation was aborted.', 'The operation was aborted due to timeout', 'Request aborted', 'Connect Timeout Error', 'Headers Timeout Error', 'Body Timeout Error', 'Client network socket disconnected before secure TLS connection was established', 'certificate has expired', 'self-signed certificate', 'unable to verify the first certificate', 'TLS wrong version number', 'TLS certificate verify failed', 'TLS alert handshake failure', 'TLS alert internal error', 'Invalid key length', 'Invalid initialization vector', 'Invalid argument type', 'Cannot find required module']);
const files = new Set(['netease-online.mjs', 'netease-auth.mjs', 'online-diagnostics.mjs', 'online-error-chain.mjs', 'online-transport-trace.mjs', 'music-server.mjs', 'crypto.js', 'option.js', 'song_url_v1.js', 'cloudsearch.js', 'playlist_detail.js', 'user_playlist.js', 'song_detail.js', 'lyric.js', 'album.js', 'login_status.js', 'login_qr_key.js', 'login_qr_create.js', 'login_qr_check.js']);
const calls = new Set(['read', 'write', 'connect', 'getaddrinfo', 'lookup', 'send', 'recv', 'shutdown', 'open', 'readFile']);
const events = new Set(['request-created', 'sending-headers', 'request-body-sent', 'response-headers', 'response-complete', 'request-error', 'before-connect', 'connected', 'connect-error']);
const origins = new Set(['https://music.163.com', 'https://interface.music.163.com']);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const allowed = (value: unknown, set: Set<string>) => typeof value === 'string' && set.has(value) ? value : undefined;
const number = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isInteger(value) ? number(value, min, max) : undefined;
const bool = (value: unknown) => typeof value === 'boolean' ? value : undefined;
const safeMessage = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  if (messages.has(value) || codes.has(value)) return value;
  if (/^[A-Za-z_$][A-Za-z0-9_$.[\]() ]{0,70} is not (?:a function|iterable|async iterable|defined)$/.test(value) || /^Cannot read properties of (?:undefined|null) \(reading '[A-Za-z_$][A-Za-z0-9_$]{0,50}'\)$/.test(value)) return value;
  const match = /^(?:read|write|connect|getaddrinfo|lookup|send|recv|shutdown) ([A-Z_]+)$/.exec(value);
  return match && codes.has(match[1]) ? value : undefined;
};
export function sanitizeOnlineChain(value: unknown) {
  const chain = object(value);
  if (!Array.isArray(chain.nodes)) return undefined;
  return { truncated: chain.truncated === true, nodes: chain.nodes.slice(0, 32).map(value => {
    const node = object(value);
    const path = typeof node.path === 'string' && /^root(?:\.cause|\.errors\[[0-7]\]){0,31}$/.test(node.path) ? node.path : 'root';
    const frames = Array.isArray(node.frames) ? node.frames.slice(0, 6).map(value => {
      const frame = object(value);
      const file = typeof frame.file === 'string' && (/^node:[\w./-]{1,120}$/.test(frame.file) || files.has(frame.file)) ? frame.file : undefined;
      return { file, line: integer(frame.line, 1, 9999999), column: integer(frame.column, 1, 9999999) };
    }).filter(frame => frame.file && frame.line && frame.column) : [];
    return { path, depth: integer(node.depth, 0, 31), cycle: bool(node.cycle), name: allowed(node.name, names), code: allowed(node.code, codes),
      errno: integer(node.errno, -2147483648, 2147483648), syscall: allowed(node.syscall, calls), message: safeMessage(node.message),
      messageRedacted: bool(node.messageRedacted), codeUnrecognized: bool(node.codeUnrecognized), frames };
  }) };
}
function sanitizeSocket(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const socket = object(value);
  return { bytesRead: integer(socket.bytesRead), bytesWritten: integer(socket.bytesWritten),
    family: allowed(socket.family, new Set(['IPv4', 'IPv6'])), tlsProtocol: allowed(socket.tlsProtocol, new Set(['TLSv1.2', 'TLSv1.3'])),
    tlsAuthorized: bool(socket.tlsAuthorized), destroyed: bool(socket.destroyed) };
}
export function sanitizeOnlineTransport(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const transport = object(value);
  const event = (value: unknown) => {
    const item = object(value);
    return { event: allowed(item.event, events), elapsedMs: number(item.elapsedMs, 0, 86400000), origin: allowed(item.origin, origins),
      status: integer(item.status, 100, 599), previousObservedRequestsOnSocket: integer(item.previousObservedRequestsOnSocket),
      socket: sanitizeSocket(item.socket), chain: sanitizeOnlineChain(item.chain) };
  };
  return { durationMs: number(transport.durationMs, 0, 86400000), timeoutMs: integer(transport.timeoutMs, 1, 1200000),
    lastRequestPhase: allowed(transport.lastRequestPhase, new Set([...events, 'no-request-event'])),
    requestEvents: Array.isArray(transport.requestEvents) ? transport.requestEvents.slice(0, 16).map(event).filter(item => item.event) : [],
    socketAtFailure: sanitizeSocket(transport.socketAtFailure),
    connectionEventScope: transport.connectionEventScope === 'shared-origin-pool-time-window' ? transport.connectionEventScope : undefined,
    connectionEvents: Array.isArray(transport.connectionEvents) ? transport.connectionEvents.slice(-12).map(event).filter(item => item.event) : [],
  };
}
