import { randomUUID } from 'node:crypto';
import { errorChain } from './online-error-chain.mjs';

const operations = new Set(['search', 'playback', 'qrKey', 'qrCreate', 'qrCheck', 'status', 'accountProfile', 'playlists', 'playlistWrite', 'playlistCreate', 'playlistRename', 'playlistDelete', 'playlistAdd', 'playlistRemove', 'playlistDetail', 'playlistTracks', 'songDetail', 'songInfo', 'album', 'lyric', 'start', 'poll', 'cancel', 'logout', 'cover', 'request', 'together', 'togetherStatus', 'togetherCreate', 'togetherJoin', 'togetherEnd', 'togetherHeartbeat', 'togetherPlaylist', 'togetherQueue', 'togetherCommand']);
const networkCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_ABORTED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE']);
const diagnostics = new WeakMap();
const number = value => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d{1,6}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(numeric) && numeric >= -999999 && numeric <= 999999 ? numeric : undefined;
};

// Collect only recognized codes, never messages/stacks/headers/URLs or raw bodies.
export function networkFailureCodes(failure) {
  const pending = [failure], seen = new Set(), codes = new Set();
  while (pending.length && seen.size < 12) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (networkCodes.has(item.code)) codes.add(item.code);
    if (item.cause) pending.push(item.cause);
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 8));
  }
  return [...codes].slice(0, 8);
}

export function withOnlineDiagnostic(failure, { provider = 'netease', operation = 'request', stage = 'internal', code = 'INTERNAL_UNKNOWN', upstreamStatus, businessCode, causes = [], chain, transport } = {}) {
  if (!(failure instanceof Error) || diagnostics.has(failure)) return failure;
  const source = ['netease', 'qq', 'bodian'].includes(provider) ? provider : 'netease';
  const safeCode = /^(?:HTTP_\d{3}|BUSINESS_(?:-?\d{1,6}|MISSING_CODE)|NETWORK_(?:UNKNOWN|TIMEOUT)|INTERNAL_(?:TYPEERROR|REFERENCEERROR|RANGEERROR|UNKNOWN)|RESPONSE_(?:INVALID_JSON|TOO_LARGE)|PLAYBACK_NO_URL)$/.test(code) || code.startsWith('NETWORK_') && networkCodes.has(code.slice(8)) ? code : 'INTERNAL_UNKNOWN';
  diagnostics.set(failure, {
    id: randomUUID(), time: new Date().toISOString(), provider: source,
    operation: operations.has(operation) ? operation : 'request',
    stage: ['http', 'business', 'network', 'response', 'internal', 'permission'].includes(stage) ? stage : 'internal',
    code: `${source.toUpperCase()}_${safeCode}`, upstreamStatus: number(upstreamStatus), businessCode: number(businessCode),
    causes: causes.filter(code => networkCodes.has(code)).slice(0, 8), nodeVersion: process.versions.node, undiciVersion: process.versions.undici,
    chain: chain || errorChain(failure), transport,
  });
  return failure;
}

export function diagnoseOnlineFailure(failure, provider, operation) {
  if (diagnostics.has(failure)) return failure;
  const causes = networkFailureCodes(failure);
  const timeout = ['TimeoutError', 'AbortError'].includes(failure?.name);
  const fetchFailure = failure?.name === 'TypeError' && ['fetch failed', 'terminated'].includes(failure?.message);
  const name = { TypeError: 'TYPEERROR', ReferenceError: 'REFERENCEERROR', RangeError: 'RANGEERROR' }[failure?.name];
  return withOnlineDiagnostic(failure, { provider, operation,
    stage: causes.length || timeout || fetchFailure ? 'network' : failure?.status ? 'http' : 'internal',
    code: causes.length ? `NETWORK_${causes[0]}` : timeout ? 'NETWORK_TIMEOUT' : fetchFailure ? 'NETWORK_UNKNOWN' : failure?.status ? `HTTP_${failure.status}` : `INTERNAL_${name || 'UNKNOWN'}`,
    causes,
  });
}

export function onlineDiagnostic(failure) { return diagnostics.get(failure); }

export function addOnlineTransport(failure, transport) {
  const value = diagnostics.get(failure);
  if (value) diagnostics.set(failure, { ...value, transport });
}

export function onlineRouteContext(requestUrl) {
  // Deliberately ignore query strings, IDs and login challenge values.
  const match = /^\/api\/online\/(netease|qq|bodian)\/(.+)$/.exec(String(requestUrl || '').split('?')[0]);
  if (!match) return undefined;
  const suffix = match[2];
  const operation = suffix === 'playlist-management' ? 'playlistWrite' : suffix.startsWith('prepare/') ? 'playback' : suffix.startsWith('songs/') ? 'songInfo' : suffix.startsWith('playlists/') ? 'playlistTracks' : suffix.startsWith('auth/') ? suffix.slice(5) : suffix;
  return { provider: match[1], operation: operations.has(operation) ? operation : 'request' };
}
