import { randomUUID } from 'node:crypto';
import { NeteaseSessionStore } from './netease-session.mjs';
import { PlatformLoginProtocols, validPlatformCredential } from './platform-login-protocols.mjs';
import { BodianProtocol } from './bodian-protocol.mjs';

const failure = (message, status = 502) => Object.assign(new Error(message), { status });
/** Each platform owns its encrypted session; the catalog observes account epochs. */
export class PlatformAuth {
  constructor({ provider, dataDir, transport = provider === 'bodian' ? new BodianProtocol() : new PlatformLoginProtocols(provider), store = new NeteaseSessionStore(dataDir, provider), now = Date.now }) {
    if (!['qq', 'bodian'].includes(provider)) throw new Error('Unsupported login provider');
    this.provider = provider; this.transport = transport; this.store = store; this.now = now;
    this.epoch = 0; this.writes = Promise.resolve();
    this.ready = store.load().then(value => {
      if (validPlatformCredential(provider, value.credential)) this.credential = value.credential;
    }).catch(() => {});
  }
  snapshot() { return { provider: this.provider, loggedIn: !!this.credential && !!this.profile, profile: this.profile, persistent: !!this.store.file, warning: this.warning }; }
  async status() {
    await this.ready;
    if (!this.credential) return this.snapshot();
    if (this.statusPending) return this.statusPending;
    const epoch = this.epoch, credential = this.credential;
    const task = (async () => {
      let profile;
      try { profile = await this.transport.profile(credential); }
      catch (error) { if (this.provider === 'bodian' && error.status === 401) { await this.invalidateCredential(credential, epoch); return this.snapshot(); } throw error; }
      if (epoch === this.epoch && this.credential === credential) this.profile = profile;
      return this.snapshot();
    })();
    this.statusPending = task;
    try { return await task; } finally { if (this.statusPending === task) this.statusPending = undefined; }
  }
  discardChallenge() { this.challenge?.controller.abort(); this.challenge = undefined; }
  async start(method = 'qq') {
    await this.ready;
    this.discardChallenge(); const epoch = ++this.epoch;
    const challenge = { id: randomUUID(), controller: new AbortController(), epoch, expiresAt: this.now() + 120000 };
    this.challenge = challenge;
    try {
      const value = await this.transport.start(challenge.controller.signal, method === 'wechat' ? 'wechat' : 'qq');
      if (epoch !== this.epoch || this.challenge !== challenge) throw failure('此次登录已取消。', 409);
      if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value.image) || value.image.length > 131072) throw failure('登录二维码格式发生变化。');
      Object.assign(challenge, value); challenge.ready = true;
      return { id: challenge.id, image: value.image, expiresAt: challenge.expiresAt, state: 'waiting' };
    } catch (error) { if (this.challenge === challenge) this.discardChallenge(); throw error; }
  }
  async poll(id) {
    const challenge = this.challenge;
    if (!challenge || challenge.id !== id || !challenge.ready || this.now() >= challenge.expiresAt) { if (challenge?.id === id) this.discardChallenge(); return { state: 'expired' }; }
    if (challenge.polling || this.now() < (challenge.nextPoll || 0)) throw failure('正在确认扫码状态。', 429);
    challenge.polling = true; challenge.nextPoll = this.now() + (this.provider === 'bodian' ? 2000 : 1200);
    try {
      const result = await this.transport.poll(challenge, challenge.controller.signal);
      if (this.challenge !== challenge || challenge.epoch !== this.epoch || this.now() >= challenge.expiresAt) return { state: 'expired' };
      if (result.state === 'expired') { this.discardChallenge(); return { state: 'expired' }; }
      if (result.state !== 'authorized') return { state: result.state === 'scanned' ? 'scanned' : 'waiting' };
      if (!validPlatformCredential(this.provider, result.credential) || !result.profile?.userId) throw failure('平台未返回有效登录信息。');
      let authorized = false;
      await this.write(async () => {
        if (this.challenge !== challenge || challenge.epoch !== this.epoch || this.now() >= challenge.expiresAt) return;
        let warning;
        try { await this.store.save({ credential: result.credential }); }
        catch { warning = '已登录，但本机无法保存登录信息，关闭后需要重新扫码。'; }
        if (this.challenge !== challenge || challenge.epoch !== this.epoch || this.now() >= challenge.expiresAt) {
          // Cancel/logout can occur while DPAPI is writing. Restore the last
          // committed account before the next serialized login/logout write.
          try { this.credential ? await this.store.save({ credential: this.credential }) : await this.store.clear(); } catch {}
          return;
        }
        this.warning = warning;
        this.credential = result.credential; this.profile = { userId: String(result.profile.userId).slice(0, 32), nickname: String(result.profile.nickname || '').slice(0, 120) };
        authorized = true;
        this.discardChallenge(); this.epoch++; this.statusPending = undefined;
      });
      return authorized ? { state: 'authorized', ...this.snapshot() } : { state: 'expired' };
    } catch (error) {
      if (error.loginExpired) {
        if (this.challenge === challenge) this.discardChallenge();
        return { state: 'expired', message: error.message };
      }
      throw error;
    } finally { challenge.polling = false; }
  }
  cancel(id) { if (this.challenge?.id === id) { this.discardChallenge(); this.epoch++; } return { state: 'cancelled' }; }
  write(task) { const operation = this.writes.then(task); this.writes = operation.catch(() => {}); return operation; }
  async invalidateCredential(credential, epoch) {
    if (credential !== this.credential || epoch !== this.epoch) return;
    this.epoch++; this.discardChallenge(); this.credential = undefined; this.profile = undefined; this.statusPending = undefined;
    this.warning = '登录信息已失效，请重新扫码。';
    await this.write(() => this.store.clear()).catch(() => {});
  }
  async logout() {
    await this.ready; this.epoch++; this.discardChallenge(); this.credential = undefined; this.profile = undefined; this.warning = undefined; this.statusPending = undefined;
    await this.write(() => this.store.clear()); return this.snapshot();
  }
}
