import { randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Agent } from 'undici';
import { neteaseMediaUrl } from './netease-online.mjs';
import { platformMediaUrl } from './platform-media.mjs';

const failure = (message, status = 502) => Object.assign(new Error(message), { status });
const valid = (provider, url) => provider === 'netease' ? neteaseMediaUrl(url) : platformMediaUrl(provider, url);
/** Opaque, bounded playback tickets. No arbitrary client URL, account cookies,
 * disk cache, whole-file buffering or external CORS permission is introduced. */
export class OnlineAudioRelay {
  constructor(fetcher = fetch, now = Date.now) {
    this.fetcher = fetcher; this.now = now; this.tickets = new Map(); this.active = new Set();
    this.neteaseDispatcher = new Agent({ connect: { family: 4, autoSelectFamily: false } });
  }
  register(provider, source) {
    const url = valid(provider, source);
    if (!url) throw failure('平台音源地址无效。');
    const token = randomBytes(24).toString('hex');
    for (const [key, entry] of this.tickets) if (entry.expires < this.now()) this.tickets.delete(key);
    this.tickets.set(token, { provider, url, expires: this.now() + 4 * 3600000 });
    while (this.tickets.size > 32) this.tickets.delete(this.tickets.keys().next().value);
    return `/api/online/audio/${token}`;
  }
  async serve(token, request, response) {
    const ticket = this.tickets.get(token);
    if (!ticket || ticket.expires < this.now()) throw failure('音源已过期，请重新播放。', 410);
    if (this.active.size >= 4) throw failure('音频连接繁忙，请稍后重试。', 429);
    const range = request.headers.range;
    if (range && !/^bytes=\d*-\d*$/.test(range)) throw failure('无效音频范围。', 416);
    const controller = new AbortController(); this.active.add(controller);
    const abort = () => controller.abort();
    response.once('close', abort);
    const timeout = setTimeout(abort, 15000);
    let upstream;
    try {
      let url = ticket.url;
      for (let redirects = 0; redirects <= 3; redirects++) {
        upstream = await this.fetcher(url, { method: request.method, redirect: 'manual', signal: controller.signal,
          ...(ticket.provider === 'netease' ? { dispatcher: this.neteaseDispatcher } : {}),
          headers: { ...(range ? { Range: range } : {}), 'Accept-Encoding': 'identity',
            Referer: ticket.provider === 'netease' ? 'https://music.163.com/' : ticket.provider === 'qq' ? 'https://y.qq.com/' : 'https://bodian.kuwo.cn/' } });
        if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
        const next = upstream.headers.get('location');
        const resolved = next && valid(ticket.provider, new URL(next, url).href);
        await upstream.body?.cancel();
        if (!resolved || redirects === 3) throw failure('音频重定向地址不可用。');
        url = resolved;
      }
      clearTimeout(timeout);
      if (![200, 206, 416].includes(upstream.status)) throw failure('平台音频读取失败。', upstream.status === 403 ? 403 : 502);
      const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
      for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(key); if (value) headers[key] = value;
      }
      if (upstream.status !== 416 && !/^(?:audio\/|application\/octet-stream)/i.test(headers['content-type'] || ''))
        throw failure('平台返回了非音频内容。');
      response.writeHead(upstream.status, headers);
      if (request.method === 'HEAD' || upstream.status === 416 || !upstream.body) {
        await upstream.body?.cancel(); response.end(); return;
      }
      let bytes = 0;
      const idle = setInterval(() => { if (bytes === observed) controller.abort(); observed = bytes; }, 30000);
      let observed = -1;
      try {
        await pipeline(Readable.fromWeb(upstream.body), new Transform({ transform(chunk, _, done) {
          bytes += chunk.length;
          done(bytes > 512 * 1024 * 1024 ? failure('音频流超过容量限制。') : null, chunk);
        } }), response, { signal: controller.signal });
      } finally { clearInterval(idle); }
    } finally {
      clearTimeout(timeout); response.off('close', abort); controller.abort();
      this.active.delete(controller);
      if (upstream?.body && !upstream.body.locked) await upstream.body.cancel().catch(() => {});
    }
  }
  dispose() { for (const controller of this.active) controller.abort(); this.tickets.clear(); void this.neteaseDispatcher.destroy(); }
}
