import { createHash, randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { createGunzip } from 'node:zlib';
import { createRequire } from 'node:module';

// Protocol adapted from MoeclubM/PyBodian (MIT); see third-party/PyBodian-LICENSE.txt.
const require = createRequire(import.meta.url);
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const md5 = value => createHash('md5').update(value).digest('hex');
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) : '';
export const bodianId = value => /^[1-9]\d{0,15}$/.test(String(value)) && (typeof value !== 'number' || Number.isSafeInteger(value));
export function validBodianCredential(value) {
  return !!value && bodianId(value.uid) && typeof value.token === 'string' && /^[A-Za-z0-9_+/=.-]{8,4096}$/.test(value.token)
    && /^[a-f0-9]{32}$/.test(value.deviceId) && typeof value.nickname === 'string' && value.nickname.length <= 120;
}

/** GET bodies are required by the desktop protocol. Never use fetch GET here. */
export class BodianProtocol {
  constructor(requester = httpsRequest) { this.requester = requester; this.deviceId = randomBytes(16).toString('hex'); this.active = 0; this.limit = 4; }
  async json(url, { body = '', method = 'GET', signal, deviceId = this.deviceId, credential } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['bd-api.kuwo.cn', 'mlyric.kuwo.cn'].includes(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw fail('不支持的波点服务地址。', 400);
    if (signal?.aborted) throw fail('波点请求已取消。', 409);
    if (this.active >= this.limit) throw fail('波点服务繁忙，请稍后重试。', 429);
    this.active++;
    try {
      return await new Promise((resolve, reject) => {
        let settled = false, response, decoded, timer, request;
        const finish = (error, value) => {
          if (settled) return; settled = true;
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          if (error) { decoded?.destroy(); response?.destroy(); request?.destroy(); reject(error); } else resolve(value);
        };
        const abort = () => finish(fail('波点请求已取消。', 409));
        const headers = { 'User-Agent': 'Dart/3.3 (dart:io)', plat: 'win', channel: 'W1', ver: '1.1.7', svrver: '13',
          devid: deviceId, qimei36: deviceId, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...(credential ? { uid: String(credential.uid), token: credential.token } : {}) };
        request = this.requester(parsed, { method, headers }, incoming => {
          response = incoming;
          if (incoming.statusCode !== 200 || Number(incoming.headers['content-length'] || 0) > 8388608) return finish(fail('波点服务暂时不可用。'));
          const encoding = incoming.headers['content-encoding'];
          if (encoding && encoding !== 'gzip' && encoding !== 'identity') return finish(fail('波点响应编码不支持。'));
          decoded = encoding === 'gzip' ? incoming.pipe(createGunzip()) : incoming;
          const chunks = []; let bytes = 0, wireBytes = 0;
          incoming.on('data', chunk => { wireBytes += chunk.length; if (wireBytes > 8388608) finish(fail('波点响应过大。')); });
          incoming.on('error', () => finish(fail('波点响应读取失败。')));
          decoded.on('data', chunk => { bytes += chunk.length; if (bytes > 8388608) return finish(fail('波点响应过大。')); chunks.push(chunk); });
          decoded.on('error', () => finish(fail('波点响应解码失败。')));
          decoded.on('end', () => {
            if (settled) return;
            try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { finish(fail('波点响应格式发生变化。')); }
          });
        });
        request.on('error', () => finish(fail('波点请求失败，请检查网络后重试。')));
        timer = setTimeout(() => finish(fail('波点请求超时。')), 15000);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        request.end(body || undefined);
      });
    } finally { this.active--; }
  }
  async api(path, values = {}, { credential, signal, payload, method = 'GET', timed = false, allowEmpty = false } = {}) {
    if (!/^\/api\/(?:ucenter|service|search|play)\/[A-Za-z0-9/_]+$/.test(path)) throw fail('无效的波点接口路径。', 400);
    const params = new URLSearchParams({ ...values, uid: credential?.uid || '-1', token: credential?.token || '', ...(timed ? { timestamp: String(Date.now()) } : {}) });
    const body = payload ? JSON.stringify(payload) : '';
    if (timed) {
      const seed = `kuwotest${[...params.toString()].filter(char => /[A-Za-z0-9]/.test(char)).sort().join('')}${method === 'POST' && body ? md5(body + 'kuwotest') : ''}${path}`;
      params.set('sign', md5(seed));
    }
    const result = await this.json(`https://bd-api.kuwo.cn${path}?${params}`, { method, body, signal, deviceId: credential?.deviceId, credential });
    if (allowEmpty && method === 'POST' && Number(result?.code) === 200 && result.data == null) return {};
    return this.data(result);
  }
  data(result) {
    if (Number(result?.code) !== 200) {
      if (Number(result?.code) === 407) throw fail('波点音乐仅限中国大陆地区播放，请检查网络环境。', 403);
      if (Number(result?.code) === 11027 || Number(result?.code) === 401) throw fail('波点音乐登录已失效，请重新扫码。', 401);
      const code = Number.isSafeInteger(Number(result?.code)) ? Number(result.code) : '格式异常';
      throw fail(`波点音乐请求未成功（错误码 ${code}），请稍后重试。`);
    }
    if (result.data === null || typeof result.data !== 'object') throw fail('波点音乐没有返回有效数据。');
    return result.data;
  }
  async start(signal) {
    const data = await this.api('/api/ucenter/login/qrCode', {}, { signal, timed: true });
    const key = data.qrCode;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(key)) throw fail('波点音乐没有返回有效二维码。');
    const QRCode = require('qrcode');
    return { key, deviceId: this.deviceId, image: await QRCode.toDataURL(`https://bodian-oia.kuwo.cn/bodian/download.html?pageName=login_pc&pt=3&id=${encodeURIComponent(key)}`, { width: 192, margin: 2 }) };
  }
  async poll(challenge, signal) {
    const state = await this.api('/api/ucenter/login/qrCodeStatus', { qrCode: challenge.key }, { signal, timed: true });
    if (Number(state.status) !== 3) return { state: Number(state.status) === 1 ? 'scanned' : 'waiting' };
    const data = await this.api('/api/ucenter/users/login', {}, { signal, timed: true, method: 'POST', payload: { authType: 10, qrCode: challenge.key } });
    const uid = String(data.id || data.uid || data.userId || '');
    const credential = { uid, token: data.token || data.userToken, deviceId: challenge.deviceId, nickname: text(data.userInfo?.nickname) || '波点音乐用户' };
    // Never accept a QR exchange that changes an identity returned by confirmation.
    const confirmed = state.uid || state.userId || state.id;
    if (!validBodianCredential(credential) || confirmed && String(confirmed) !== uid) throw Object.assign(fail('波点授权身份不一致或信息不完整，请重新扫码。'), { loginExpired: true });
    return { state: 'authorized', credential, profile: { userId: uid, nickname: credential.nickname } };
  }
  async profile(credential, signal) {
    if (!validBodianCredential(credential)) throw fail('请重新登录波点音乐。', 401);
    // Verify a private account operation rather than treating public profile lookup as authentication.
    await this.api('/api/service/playlist/fond', { userId: credential.uid }, { credential, signal });
    return { userId: credential.uid, nickname: credential.nickname };
  }
  async lyrics(track, credential) {
    const raw = `type=lyric&req=2&lrcx=1&rid=${track.onlineSource.id}&songname=${track.title}&artist=${track.artist}&corp=kuwo&fromchannel=bodian`;
    const encoded = [...raw].map(char => char === '=' || char === '&' ? char : encodeURIComponent(char).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('');
    const query = new URLSearchParams({ f: 'bodian', q: Buffer.from(encoded).toString('base64'), uid: credential.uid, token: credential.token });
    const data = this.data(await this.json(`https://mlyric.kuwo.cn/mobi.s?${query}`, { credential, deviceId: credential.deviceId }));
    if (typeof data.content !== 'string' || data.content.length > 280000 || !/^[A-Za-z0-9+/=\r\n]*$/.test(data.content)) throw fail('波点歌词格式发生变化。');
    return Buffer.from(data.content, 'base64').toString('utf8').slice(0, 200000).replace(/<[^>]*>/g, '').replace(/^\[kuwo:.*\]\s*$/gm, '');
  }
}
