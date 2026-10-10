// In-memory cookies belong to one QR challenge, never to a global account jar.
const failure = message => Object.assign(new Error(message), { status: 502, loginExpired: true });
const endpoints = new Map([
  ['ssl.ptlogin2.qq.com', new Set(['/check_sig', '/ptqrlogin', '/ptqrshow'])],
  ['ssl.ptlogin2.graph.qq.com', new Set(['/check_sig'])],
  ['ptlogin2.graph.qq.com', new Set(['/check_sig'])],
  ['graph.qq.com', new Set(['/oauth2.0/login_jump', '/oauth2.0/authorize'])],
]);
export function qqLoginUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw failure('QQ 授权跳转地址无效，请重新扫码。'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !endpoints.get(url.hostname)?.has(url.pathname))
    throw failure('QQ 授权跳转地址不受支持，请重新扫码。');
  return url;
}
export class QQLoginSession {
  constructor() { this.cookies = new Map(); }
  collect(url, headers) {
    const origin = qqLoginUrl(url);
    for (const raw of headers.getSetCookie().slice(0, 64)) {
      const parts = raw.split(';'), match = /^\s*([A-Za-z0-9_-]{1,64})=([^;\s\x00-\x1f\x7f]{0,4096})\s*$/.exec(parts.shift());
      if (!match) continue;
      const attributes = Object.fromEntries(parts.map(part => { const index = part.indexOf('='); return index < 0 ? [part.trim().toLowerCase(), ''] : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()]; }));
      const domain = (attributes.domain || origin.hostname).replace(/^\./, '').toLowerCase();
      if (!(domain === 'qq.com' || domain.endsWith('.qq.com')) || !(origin.hostname === domain || origin.hostname.endsWith('.' + domain))) continue;
      const path = attributes.path?.startsWith('/') ? attributes.path : origin.pathname.slice(0, origin.pathname.lastIndexOf('/')) || '/';
      if (path.length > 256) continue;
      let expires = attributes.expires ? Date.parse(attributes.expires) : Infinity;
      if (!Number.isFinite(expires)) expires = Infinity;
      if (attributes['max-age'] !== undefined && /^-?\d+$/.test(attributes['max-age'])) expires = Date.now() + Number(attributes['max-age']) * 1000;
      const key = `${domain}:${path}:${match[1]}`;
      if (expires <= Date.now() || !match[2]) { this.cookies.delete(key); continue; }
      if (!this.cookies.has(key) && this.cookies.size >= 64) continue;
      this.cookies.set(key, { name: match[1], value: match[2], domain, path, hostOnly: attributes.domain === undefined, expires });
    }
  }
  values(url) {
    const target = qqLoginUrl(url);
    return [...this.cookies.values()].filter(cookie => cookie.expires > Date.now() &&
      (target.hostname === cookie.domain || !cookie.hostOnly && target.hostname.endsWith('.' + cookie.domain)) &&
      (target.pathname === cookie.path || target.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/')))
      .sort((a, b) => b.path.length - a.path.length);
  }
  header(url) { return this.values(url).map(cookie => `${cookie.name}=${cookie.value}`).join('; '); }
  value(url, names) {
    const cookies = this.values(url);
    for (const name of names) { const cookie = cookies.find(item => item.name === name); if (cookie) return cookie.value; }
  }
  async follow(transport, initial, signal) {
    let url = qqLoginUrl(initial);
    const visited = new Set();
    for (let hop = 0; hop < 6; hop++) {
      if (visited.has(url.href)) throw failure('QQ 授权跳转重复，请重新扫码。');
      visited.add(url.href);
      const response = await transport.request(url.href, { signal, manual: true, withHeaders: true,
        headers: { Referer: 'https://xui.ptlogin2.qq.com/', Cookie: this.header(url) } });
      this.collect(url, response.headers);
      const location = response.headers.get('location');
      if (!location || ![301, 302, 303, 307, 308].includes(response.status)) return;
      url = qqLoginUrl(location, url);
    }
    throw failure('QQ 授权跳转次数过多，请重新扫码。');
  }
}
