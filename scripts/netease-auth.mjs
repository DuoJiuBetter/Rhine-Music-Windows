import { randomUUID } from 'node:crypto';
import { NeteaseSessionStore } from './netease-session.mjs';
const failure = (message, status = 502) => Object.assign(new Error(message), { status });
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) : '';
function credentials(values) {
  const result = {};
  for (const value of Array.isArray(values) ? values : []) {
    const match = /^(MUSIC_U|MUSIC_A|__csrf)=([^;\r\n]*)/.exec(value);
    if (match && match[2].length <= 16384) result[match[1]] = match[2];
  }
  return result;
}
export class NeteaseAuth {
  constructor({ call, dataDir, sessionStore = new NeteaseSessionStore(dataDir), now = Date.now, changed = () => {} }) {
    this.call = call; this.store = sessionStore; this.now = now; this.changed = changed;
    this.cookie = {}; this.deviceId = randomUUID(); this.epoch = 0; this.writes = Promise.resolve();
    this.ready = this.store.load().then(value => { this.cookie = credentials(Object.entries(value).map(([key, value]) => `${key}=${value}`)); }).catch(() => {});
  }
  snapshot() { return { provider: 'netease', loggedIn: !!this.cookie.MUSIC_U, profile: this.profile, persistent: !!this.store.file, warning: this.warning }; }
  async status() {
    await this.ready;
    if (!this.cookie.MUSIC_U) return this.snapshot();
    const epoch = this.epoch;
    const result = await this.call('status', { cookie: { ...this.cookie }, deviceId: this.deviceId });
    if (epoch !== this.epoch) return this.snapshot();
    const body = result?.body?.data || result?.body;
    if (body?.code === 301 || (body?.code === 200 && !body.account && !body.profile)) { await this.logout(); return this.snapshot(); }
    if (body?.code !== 200) throw failure('无法确认网易云登录状态，请稍后重试。');
    const profile = body.profile;
    this.profile = profile ? { nickname: clean(profile.nickname) || '网易云用户', userId: String(profile.userId || body.account?.id || '') } : { nickname: '网易云用户' };
    return this.snapshot();
  }
  async start() {
    await this.ready;
    const epoch = ++this.epoch; this.challenge = undefined;
    const result = await this.call('qrKey', { cookie: {}, deviceId: this.deviceId });
    const key = result?.body?.data?.unikey;
    if (result?.body?.code !== 200 || !key || !/^[A-Za-z0-9_-]{8,256}$/.test(key)) throw failure('网易云登录二维码暂时无法生成，请重试。');
    const image = await this.call('qrCreate', { key, qrimg: true, cookie: {}, deviceId: this.deviceId });
    const qr = image?.body?.data?.qrimg;
    if (typeof qr !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr) || qr.length > 131072) throw failure('网易云二维码格式发生变化。');
    if (epoch !== this.epoch) throw failure('此次登录已取消。', 409);
    this.challenge = { id: randomUUID(), key, expiresAt: this.now() + 120000, epoch };
    return { id: this.challenge.id, image: qr, expiresAt: this.challenge.expiresAt, state: 'waiting' };
  }
  async poll(id) {
    const challenge = this.challenge;
    if (!challenge || challenge.id !== id || this.now() >= challenge.expiresAt) return { state: 'expired' };
    if (challenge.polling) throw failure('正在确认扫码状态。', 429);
    challenge.polling = true;
    try {
      const result = await this.call('qrCheck', { key: challenge.key, cookie: {}, deviceId: this.deviceId });
      if (this.challenge !== challenge || challenge.epoch !== this.epoch) return { state: 'expired' };
      const code = result?.body?.code;
      if (code === 800) { this.challenge = undefined; return { state: 'expired' }; }
      if (code === 801) return { state: 'waiting' };
      if (code === 802) return { state: 'scanned' };
      if (code !== 803) throw failure('暂时无法确认扫码结果，请稍后重试。');
      const cookie = credentials(result.cookie);
      if (!cookie.MUSIC_U) throw failure('网易云没有返回有效登录信息，请重新扫码。');
      await this.write(async () => {
        if (challenge.epoch !== this.epoch) return;
        try { await this.store.save(cookie); this.warning = undefined; }
        catch { this.warning = '已登录，但本机无法保存登录信息，关闭软件后需要重新扫码。'; }
        if (challenge.epoch !== this.epoch) return;
        this.cookie = cookie; this.profile = undefined; this.challenge = undefined; this.epoch++; this.changed();
      });
      if (!this.cookie.MUSIC_U) return { state: 'expired' };
      try { await this.status(); } catch { /* Account display may be retried; credentials stay private. */ }
      return { state: this.cookie.MUSIC_U ? 'authorized' : 'expired', ...this.snapshot() };
    } finally { challenge.polling = false; }
  }
  cancel(id) { if (this.challenge && this.challenge.id === id) { this.challenge = undefined; this.epoch++; } return { state: 'cancelled' }; }
  write(task) { const operation = this.writes.then(task); this.writes = operation.catch(() => {}); return operation; }
  async logout() {
    await this.ready;
    this.epoch++; this.challenge = undefined; this.cookie = {}; this.profile = undefined; this.warning = undefined; this.changed();
    await this.write(() => this.store.clear());
    return this.snapshot();
  }
}
