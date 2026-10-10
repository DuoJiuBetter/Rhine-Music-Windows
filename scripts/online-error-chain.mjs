// Preserve system error structure without exporting credentials, URLs or paths.
export const diagnosticSystemCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_ABORTED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_CRYPTO_INVALID_KEYLEN', 'ERR_CRYPTO_UNKNOWN_CIPHER']);
const names = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AggregateError', 'DOMException', 'AbortError', 'TimeoutError', 'ConnectTimeoutError', 'HeadersTimeoutError', 'BodyTimeoutError', 'SocketError', 'RequestAbortedError']);
const calls = new Set(['read', 'write', 'connect', 'getaddrinfo', 'lookup', 'send', 'recv', 'shutdown', 'open', 'readFile']);
const files = new Set(['netease-online.mjs', 'netease-auth.mjs', 'online-diagnostics.mjs', 'online-error-chain.mjs', 'online-transport-trace.mjs', 'music-server.mjs', 'crypto.js', 'option.js', 'song_url_v1.js', 'cloudsearch.js', 'playlist_detail.js', 'user_playlist.js', 'song_detail.js', 'lyric.js', 'album.js', 'login_status.js', 'login_qr_key.js', 'login_qr_create.js', 'login_qr_check.js']);
const exactMessages = new Set(['fetch failed', 'terminated', 'socket hang up', 'other side closed', 'aborted', 'The operation was aborted.', 'The operation was aborted due to timeout', 'Request aborted', 'Connect Timeout Error', 'Headers Timeout Error', 'Body Timeout Error', 'Invalid key length', 'Invalid initialization vector', 'Invalid argument type', 'Cannot find required module']);
const messages = [
  ['Client network socket disconnected before secure TLS connection was established', 'Client network socket disconnected before secure TLS connection was established'],
  ['certificate has expired', 'certificate has expired'], ['self-signed certificate', 'self-signed certificate'],
  ['unable to verify the first certificate', 'unable to verify the first certificate'],
  ['Connect Timeout Error', 'Connect Timeout Error'], ['Headers Timeout Error', 'Headers Timeout Error'], ['Body Timeout Error', 'Body Timeout Error'],
  ['wrong version number', 'TLS wrong version number'], ['certificate verify failed', 'TLS certificate verify failed'],
  ['alert handshake failure', 'TLS alert handshake failure'], ['alert internal error', 'TLS alert internal error'],
];
export function safeErrorMessage(value, code) {
  if (typeof value !== 'string') return undefined;
  if (exactMessages.has(value)) return value;
  if (/^[A-Za-z_$][A-Za-z0-9_$.[\]() ]{0,70} is not (?:a function|iterable|async iterable|defined)$/.test(value) || /^Cannot read properties of (?:undefined|null) \(reading '[A-Za-z_$][A-Za-z0-9_$]{0,50}'\)$/.test(value)) return value;
  if (value.startsWith('Cannot find module') || value.startsWith('Cannot find package')) return 'Cannot find required module';
  const system = /^(?:(read|write|connect|getaddrinfo|lookup|send|recv|shutdown) )?([A-Z_]+)$/.exec(value);
  if (system && diagnosticSystemCodes.has(system[2])) return value;
  for (const [needle, replacement] of messages) if (value.includes(needle)) return replacement;
  return diagnosticSystemCodes.has(code) ? code : undefined;
}
export function safeErrorFrames(stack) {
  if (typeof stack !== 'string') return [];
  const frames = [];
  for (const line of stack.split('\n').slice(1, 24)) {
    if (!/^\s*at /.test(line)) continue;
    const match = /((?:node:[\w./-]+)|(?:[A-Za-z0-9_-]+\.(?:mjs|cjs|js|ts))):(\d{1,7}):(\d{1,7})\)?$/.exec(line);
    if (!match || !(match[1].startsWith('node:') || files.has(match[1]))) continue;
    frames.push({ file: match[1], line: Number(match[2]), column: Number(match[3]) });
    if (frames.length >= 6) break;
  }
  return frames;
}
export function errorChain(failure, maxNodes = 32) {
  const pending = [{ value: failure, path: 'root', depth: 0 }], seen = new Set(), nodes = [];
  let truncated = false;
  while (pending.length && nodes.length < maxNodes) {
    const { value, path, depth } = pending.shift();
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) { nodes.push({ path, depth, cycle: true }); continue; }
    seen.add(value);
    const code = diagnosticSystemCodes.has(value.code) ? value.code : undefined;
    const message = safeErrorMessage(value.message, code);
    nodes.push({ path, depth, name: names.has(value.name) ? value.name : 'Error', code,
      errno: Number.isInteger(value.errno) && Math.abs(value.errno) <= 2147483648 ? value.errno : undefined,
      syscall: calls.has(value.syscall) ? value.syscall : undefined,
      message, messageRedacted: typeof value.message === 'string' && message !== value.message,
      codeUnrecognized: typeof value.code === 'string' && !code,
      frames: safeErrorFrames(value.stack),
    });
    if (depth >= 31) { if (value.cause || value.errors?.length) truncated = true; continue; }
    if (value.cause) pending.push({ value: value.cause, path: `${path}.cause`, depth: depth + 1 });
    if (Array.isArray(value.errors)) {
      if (value.errors.length > 8) truncated = true;
      value.errors.slice(0, 8).forEach((item, index) => pending.push({ value: item, path: `${path}.errors[${index}]`, depth: depth + 1 }));
    }
  }
  return { nodes, truncated: truncated || pending.length > 0 };
}
