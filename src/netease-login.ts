import { escapeHtml as esc } from './html';
import { musicPlatforms, type MusicProvider } from './music-platform';
import { fetchOnline } from './online-debug';
export type NeteaseAccount = { loggedIn: boolean; profile?: { nickname: string; userId?: string }; warning?: string };
type Challenge = { id: string; image: string; expiresAt: number };
export class NeteaseLogin {
  private container?: HTMLElement;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private challenge?: Challenge;
  private generation = 0;
  private account: NeteaseAccount = { loggedIn: false };
  private qqMethod: 'qq' | 'wechat' = 'qq';
  constructor(private onAccountChange: (account: NeteaseAccount) => void = () => {}, readonly provider: MusicProvider = 'netease') {}
  private get name() { return musicPlatforms[this.provider]; }
  private pending = false;
  private message = '';
  private nativeHidden = false;
  private nativeVisibility = (event: Event) => { this.nativeHidden = (event as CustomEvent<{ hidden: boolean }>).detail.hidden; this.visibility(); };
  private visibility = () => { clearTimeout(this.timer); if (!this.nativeHidden && document.visibilityState === 'visible' && this.challenge && !this.pending) void this.poll(); };
  private async request(action: string, body?: object, signal?: AbortSignal) {
    const response = await fetchOnline(this.provider, action, `/api/online/${this.provider}/auth/${action}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal } : { signal });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `${this.name}登录暂时不可用。`);
    return value;
  }
  mount(container: HTMLElement, startLogin = false) {
    this.dispose(); this.container = container; this.render();
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('rhine-desktop-visibility', this.nativeVisibility);
    container.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-netease-auth]')?.dataset.neteaseAuth;
      if (action === 'start') void this.start();
      if (action === 'logout') void this.logout();
      if (action === 'status') void this.status();
    });
    container.addEventListener('change', event => {
      const input = event.target as HTMLSelectElement;
      if (this.provider === 'qq' && input.matches('[data-qq-login-method]')) {
        this.qqMethod = input.value === 'wechat' ? 'wechat' : 'qq'; this.cancel(); void this.start();
      }
    });
    const generation = this.generation;
    void (async () => {
      await this.status();
      if (startLogin && generation === this.generation && this.container === container && !this.account.loggedIn && !this.message) await this.start();
    })();
  }
  private render() {
    if (!this.container?.isConnected) return;
    const methods = this.provider === "qq" && !this.account.loggedIn ? `<label class="platform-login-method">登录方式<select data-qq-login-method aria-label="QQ 音乐登录方式"><option value="qq" ${this.qqMethod === "qq" ? "selected" : ""}>QQ 扫码</option><option value="wechat" ${this.qqMethod === "wechat" ? "selected" : ""}>微信扫码</option></select></label>` : "";
    this.container.innerHTML = methods + `<div class="netease-account"><div><strong>${this.name}</strong><small>${this.account.loggedIn ? `已登录 · ${esc(this.account.profile?.nickname || this.name + "用户")}` : '未登录'}</small></div><button class="text-button" data-netease-auth="${this.account.loggedIn ? 'logout' : 'start'}" ${this.pending ? 'disabled' : ''}>${this.account.loggedIn ? '退出登录' : this.challenge ? '刷新二维码' : this.provider === "qq" ? this.qqMethod === "qq" ? "QQ 扫码登录" : "微信扫码登录" : "扫码登录"}</button></div>${this.challenge ? `<div class="netease-qr"><img src="${esc(this.challenge.image)}" width="192" height="192" alt="${this.name}登录二维码"></div>` : ''}<p class="netease-auth-status" role="status" aria-live="polite">${esc(this.message || this.account.warning || '')}</p>${this.message && !this.challenge ? '<button class="text-button" data-netease-auth="status">刷新登录状态 ↻</button>' : ''}`;
  }
  private cancel() {
    const id = this.challenge?.id;
    this.challenge = undefined; this.controller?.abort(); clearTimeout(this.timer); this.generation++; this.pending = false;
    if (id) void this.request('cancel', { id }).catch(() => {});
  }
  dispose() { this.cancel(); document.removeEventListener('visibilitychange', this.visibility); window.removeEventListener('rhine-desktop-visibility', this.nativeVisibility); this.container = undefined; }
  async status(signal?: AbortSignal) {
    if (this.pending || this.challenge) return;
    const generation = this.generation; const controller = this.controller = new AbortController();
    try { const account = await this.request('status', undefined, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal); if (generation !== this.generation || controller.signal.aborted || signal?.aborted) return; this.account = account; this.onAccountChange(account); this.message = ''; this.render(); }
    catch (failure) { if (generation === this.generation && !controller.signal.aborted) { this.message = (failure as Error).message; this.render(); } }
  }
  private async start() {
    if (this.pending) return;
    this.cancel(); const generation = this.generation; const controller = this.controller = new AbortController();
    this.pending = true; this.message = `正在生成${this.name}登录二维码…`; this.render();
    try {
      const challenge = await this.request('start', this.provider === 'qq' ? { method: this.qqMethod } : {}, controller.signal) as Challenge;
      if (generation !== this.generation || controller.signal.aborted) { void this.request('cancel', { id: challenge.id }).catch(() => {}); return; }
      this.challenge = challenge; this.message = this.provider === 'bodian' ? '请使用波点音乐 App 扫码确认。' : '等待扫码…';
    } catch (failure) { if (!controller.signal.aborted && generation === this.generation) this.message = (failure as Error).message; }
    finally { if (generation === this.generation) { this.pending = false; this.render(); this.schedule(); } }
  }
  private schedule() { clearTimeout(this.timer); if (this.challenge && !this.nativeHidden && document.visibilityState === 'visible') this.timer = setTimeout(() => void this.poll(), this.provider === 'bodian' ? 2200 : 1800); }
  private async poll() {
    const challenge = this.challenge; if (!challenge || this.pending) return;
    if (Date.now() >= challenge.expiresAt) { this.cancel(); this.message = '二维码已过期。'; this.render(); return; }
    const generation = this.generation; const controller = this.controller = new AbortController(); this.pending = true;
    try {
      const result = await this.request('poll', { id: challenge.id }, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      if (result.state === 'authorized') { this.challenge = undefined; this.account = result; this.onAccountChange(result); this.message = result.warning || '已登录。'; }
      else if (result.state === 'expired') { this.challenge = undefined; this.message = result.message || '二维码已过期。'; }
      else this.message = result.state === 'scanned' ? '已扫码，等待确认。' : this.provider === 'bodian' ? '请使用波点音乐 App 扫码确认。' : '等待扫码…';
    } catch (failure) { if (generation === this.generation && !controller.signal.aborted) this.message = `${(failure as Error).message} 正在重试…`; }
    finally { if (generation === this.generation) { this.pending = false; this.render(); this.schedule(); } }
  }
  private async logout() {
    this.cancel(); const generation = this.generation; const controller = this.controller = new AbortController(); this.pending = true; this.render();
    try { const result = await this.request('logout', {}, controller.signal); if (generation === this.generation) { this.account = result; this.onAccountChange(result); this.message = `已退出${this.name}登录。`; } }
    catch (failure) { if (generation === this.generation && !controller.signal.aborted) this.message = (failure as Error).message; }
    finally { if (generation === this.generation) { this.pending = false; this.render(); } }
  }
}
