// Synthetic cases only. This debug delivery syntax-checks but does not execute them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { networkFailureCodes, diagnoseOnlineFailure, onlineDiagnostic, onlineRouteContext, withOnlineDiagnostic } from './online-diagnostics.mjs';
import { NeteaseOnline } from './netease-online.mjs';
import { fetchOnline, onlineErrorReport, reportOnlineFailure } from '../src/online-debug.ts';
import { errorChain } from './online-error-chain.mjs';
import { traceOnlineRequest } from './online-transport-trace.mjs';
import { channel } from 'node:diagnostics_channel';
import { sanitizeOnlineChain } from '../src/online-debug-details.ts';

test('deep errors preserve errno, syscall and TLS evidence without private messages or paths', () => {
  const leaf = Object.assign(new Error('Client network socket disconnected before secure TLS connection was established: private-host'), { code: 'ECONNRESET', errno: -4077, syscall: 'connect' });
  leaf.stack = 'Error: private-token\n    at privateFunction (file:///C:/private-user/netease-online.mjs:64:28)\n    at privateFunction (C:/private-user/private-file.js:8:1)';
  const result = errorChain(new TypeError('fetch failed', { cause: leaf }));
  assert.equal(result.nodes[1].depth, 1);
  assert.equal(result.nodes[1].errno, -4077); assert.equal(result.nodes[1].syscall, 'connect');
  assert.equal(result.nodes[1].message, 'Client network socket disconnected before secure TLS connection was established');
  assert.deepEqual(result.nodes[1].frames, [{ file: 'netease-online.mjs', line: 64, column: 28 }]);
  assert.doesNotMatch(JSON.stringify(result), /private|file:\/\/\/|C:/);
  assert.deepEqual(sanitizeOnlineChain(result), { ...result, nodes: result.nodes.map(node => ({ ...node, cycle: undefined })) });
  leaf.cause = leaf;
  assert.equal(errorChain(leaf).nodes.at(-1).cycle, true);
  let nested = leaf; for (let i = 0; i < 40; i++) nested = new Error('private', { cause: nested });
  const bounded = errorChain(nested);
  assert.equal(bounded.nodes.length, 32); assert.equal(bounded.truncated, true);
});

test('documented Undici events retain stage and socket evidence while omitting request data', async () => {
  const request = { origin: 'https://interface.music.163.com', path: '/private-song?cookie=private', headers: ['Cookie', 'private'] };
  const socket = { bytesRead: 12, bytesWritten: 256, remoteFamily: 'IPv4', remoteAddress: 'private-IP', authorized: true, destroyed: false, getProtocol: () => 'TLSv1.3' };
  const connectParams = { protocol: 'https:', hostname: 'interface.music.163.com', port: '443' };
  await assert.rejects(traceOnlineRequest('netease', 'playback', async () => {
    channel('undici:request:create').publish({ request });
    channel('undici:client:beforeConnect').publish({ connectParams });
    channel('undici:client:connected').publish({ connectParams, socket });
    channel('undici:client:sendHeaders').publish({ request, socket, headers: 'Cookie: private' });
    channel('undici:request:bodySent').publish({ request });
    channel('undici:request:error').publish({ request, error: new Error('private') });
    throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', errno: -4077, syscall: 'read' });
  }), failure => {
    const result = onlineDiagnostic(failure);
    assert.equal(result.transport.lastRequestPhase, 'request-body-sent');
    assert.equal(result.transport.socketAtFailure.tlsProtocol, 'TLSv1.3');
    assert.equal(result.transport.connectionEventScope, 'shared-origin-pool-time-window');
    assert.equal(result.transport.requestEvents[1].previousObservedRequestsOnSocket, 0);
    assert.equal(result.chain.nodes[0].errno, -4077);
    assert.doesNotMatch(JSON.stringify(result), /private|Cookie|remoteAddress|cookie=/);
    return true;
  });
});

test('network cause chains retain recognized codes and discard private values', () => {
  const cause = Object.assign(new Error('Cookie=MUSIC_U=private-cookie; https://private-address'), { code: 'ECONNRESET' });
  const aggregate = new AggregateError([cause, Object.assign(new Error('private'), { code: 'PRIVATE_TOKEN' })], 'private details');
  aggregate.cause = aggregate;
  const failure = new TypeError('fetch failed', { cause: aggregate });
  diagnoseOnlineFailure(failure, 'netease', 'playback');
  const result = onlineDiagnostic(failure);
  assert.equal(result.code, 'NETEASE_NETWORK_ECONNRESET');
  assert.deepEqual(result.causes, ['ECONNRESET']);
  assert.equal(result.operation, 'playback');
  assert.doesNotMatch(JSON.stringify(result), /private|MUSIC_U|Cookie|https:/i);
  assert.deepEqual(networkFailureCodes(aggregate), ['ECONNRESET']);
});

test('concurrent request lifecycle events are correlated by request identity', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = { origin: 'https://interface.music.163.com' }, second = { origin: 'https://interface.music.163.com' };
  const a = traceOnlineRequest('netease', 'playlistDetail', async () => {
    channel('undici:request:create').publish({ request: first });
    await gate;
    channel('undici:request:headers').publish({ request: first, response: { statusCode: 201 } });
    throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  }).catch(failure => onlineDiagnostic(failure));
  const b = await traceOnlineRequest('netease', 'playback', async () => {
    channel('undici:request:create').publish({ request: second });
    channel('undici:request:headers').publish({ request: second, response: { statusCode: 202 } });
    throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  }).catch(failure => onlineDiagnostic(failure));
  release(); const result = await a;
  assert.deepEqual(result.transport.requestEvents.filter(event => event.status).map(event => event.status), [201]);
  assert.deepEqual(b.transport.requestEvents.filter(event => event.status).map(event => event.status), [202]);
});

test('wrapped service error preserves network codes and the existing HTTP policy', async () => {
  const api = new NeteaseOnline({ call: async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('private'), { code: 'ENOTFOUND' }) }); } });
  await assert.rejects(api.prepare('123'), failure => {
    assert.equal(failure.status, 502);
    assert.equal(onlineDiagnostic(failure).code, 'NETEASE_NETWORK_ENOTFOUND');
    assert.equal(onlineDiagnostic(failure).operation, 'playback'); return true;
  });
  assert.equal(api.active, 0);
});

test('upstream HTTP status and platform business status remain separate', async () => {
  const http = withOnlineDiagnostic(Object.assign(new Error('safe text'), { status: 502 }), { operation: 'playback', stage: 'http', code: 'HTTP_503', upstreamStatus: 503 });
  assert.equal(onlineDiagnostic(http).upstreamStatus, 503);
  const api = new NeteaseOnline({ call: async () => ({ status: 200, body: { code: 405, message: 'private upstream body' } }) });
  await assert.rejects(api.prepare('123'), failure => {
    const result = onlineDiagnostic(failure);
    assert.equal(failure.status, 502); assert.equal(result.code, 'NETEASE_BUSINESS_405');
    assert.equal(result.upstreamStatus, 200); assert.equal(result.businessCode, 405);
    assert.doesNotMatch(JSON.stringify(result), /private/); return true;
  });
});

test('route context never retains song IDs, search strings or challenge values', () => {
  assert.deepEqual(onlineRouteContext('/api/online/netease/prepare/123?token=private'), { provider: 'netease', operation: 'playback' });
  assert.deepEqual(onlineRouteContext('/api/online/qq/search?q=private'), { provider: 'qq', operation: 'search' });
  assert.deepEqual(onlineRouteContext('/api/online/bodian/auth/poll?key=private'), { provider: 'bodian', operation: 'poll' });
  assert.equal(onlineRouteContext('/api/library'), undefined);
});

test('debug observer keeps the response intact, excludes aborted work and bounds memory', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const error = withOnlineDiagnostic(new Error('safe'), { operation: 'playback', stage: 'http', code: 'HTTP_429', upstreamStatus: 429 });
  const body = { error: 'safe', diagnostic: onlineDiagnostic(error), cookie: 'private' };
  globalThis.fetch = async () => Response.json(body, { status: 429 });
  const response = await fetchOnline('netease', 'playback', '/api/online/netease/prepare/123', {}, 2);
  assert.deepEqual(await response.json(), body);
  let report = JSON.parse(onlineErrorReport('synthetic'));
  assert.equal(report.errors.at(-1).code, 'NETEASE_HTTP_429');
  assert.equal(report.errors.at(-1).httpStatus, 429); assert.equal(report.errors.at(-1).attempt, 2);
  const before = report.errors.length;
  const controller = new AbortController(); controller.abort();
  await fetchOnline('netease', 'playback', '/api/online/netease/prepare/123', { signal: controller.signal });
  assert.equal(JSON.parse(onlineErrorReport('synthetic')).errors.length, before);
  for (let index = 0; index < 30; index++) reportOnlineFailure('netease', 'private-search', { code: 'NETEASE_HTTP_502', cookie: 'private', stack: 'private', operation: 'private-song' }, 502);
  report = JSON.parse(onlineErrorReport('synthetic'));
  assert.equal(report.errors.length, 20);
  assert.doesNotMatch(JSON.stringify(report), /private|cookie|stack|prepare/);
});
