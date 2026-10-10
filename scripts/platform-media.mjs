const matches = (host, domains) => domains.some(domain => host === domain || host.endsWith(`.${domain}`));
export function platformMediaUrl(provider, value, cover = false) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password) return undefined;
    if (!['qq', 'kugou', 'bodian'].includes(provider)) return undefined;
    const domains = provider === 'bodian' ? ['kuwo.cn'] : provider === 'qq' ? cover ? ['gtimg.cn', 'gtimg.com'] : ['qqmusic.qq.com']
      : cover ? ['kgimg.com', 'imge.kugou.com', 'img.kugou.com', 'imgessl.kugou.com', 'imgssl.kugou.com'] : ['kugou.com', 'kgimg.com'];
    if (!matches(url.hostname, domains) || (!cover && provider === 'kugou' && !/^(?:fs|dl|webfs|trackercdn|audiocdn)/.test(url.hostname))) return undefined;
    // Some multi-level Kuwo CDN endpoints do not offer matching TLS certificates.
    // Preserve their returned scheme; never forward account credentials to media.
    if (provider !== 'bodian' || !url.hostname.endsWith('.kwcdn.kuwo.cn')) url.protocol = 'https:';
    return url.href;
  } catch { return undefined; }
}
export function platformCover(provider, source) {
  const url = platformMediaUrl(provider, typeof source === 'string' ? source.replace('{size}', '512') : '', true);
  return url ? `/api/online/${provider}/cover?url=${encodeURIComponent(url)}` : undefined;
}

/** CORS-safe covers share a bounded cache. Credentials never accompany image requests. */
export class PlatformCoverStore {
  constructor(fetcher = fetch) { this.fetcher = fetcher; this.cache = new Map(); this.pending = new Map(); this.bytes = 0; this.active = 0; this.waiting = []; }
  async run(task) {
    if (this.active >= 4) {
      await new Promise((resolve, reject) => {
        const entry = { start: () => { clearTimeout(timer); resolve(); } };
        const timer = setTimeout(() => { const index = this.waiting.indexOf(entry); if (index >= 0) this.waiting.splice(index, 1); reject(new Error('封面请求等待超时。')); }, 10000);
        this.waiting.push(entry);
      });
    } else this.active++;
    try { return await task(); } finally { const next = this.waiting.shift(); next ? next.start() : this.active--; }
  }
  async get(provider, source) {
    const url = platformMediaUrl(provider, source, true);
    if (!url) throw Object.assign(new Error('无效的平台封面地址。'), { status: 400 });
    const key = `${provider}:${url}`, cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 300000) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 36) throw Object.assign(new Error('封面请求繁忙。'), { status: 429 });
    const operation = this.run(async () => {
      const response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Referer: provider === 'qq' ? 'https://y.qq.com/' : provider === 'bodian' ? 'https://bodian.kuwo.cn/' : 'https://www.kugou.com/' } });
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type) || Number(response.headers.get('content-length') || 0) > 4194304) throw new Error('平台封面暂时不可用。');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 4194304) throw new Error('平台封面过大。'); chunks.push(chunk); }
      const result = { bytes: Buffer.concat(chunks), type, at: Date.now() };
      const previous = this.cache.get(key);
      if (previous) { this.cache.delete(key); this.bytes -= previous.bytes.length; }
      this.cache.set(key, result); this.bytes += size;
      while (this.cache.size > 64 || this.bytes > 33554432) { const first = this.cache.keys().next().value; this.bytes -= this.cache.get(first).bytes.length; this.cache.delete(first); }
      return result;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, operation); return operation;
  }
}
