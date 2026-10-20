import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
export class TogetherNim {
  constructor() { this.connected = false; this.messages = []; this.pending = new Map(); this.epoch = 0; }
  remember(message) {
    if (!message?.id || typeof message.text !== 'string' || this.messages.some(item => item.id === message.id)) return;
    this.messages.push({ id: String(message.id).slice(0, 120), text: message.text.slice(0, 2000), nickname: String(message.nickname || '一起听成员').slice(0, 120), time: Number(message.time) || Date.now() });
    this.messages.sort((a, b) => a.time - b.time); this.messages = this.messages.slice(-200);
  }
  async connect(value) {
    if (this.roomId === value.roomId && this.child) return;
    this.dispose(); const epoch = this.epoch;
    const directory = await mkdtemp(path.join(os.tmpdir(), 'rhine-together-'));
    if (epoch !== this.epoch) { void this.remove(directory); return; }
    this.roomId = value.roomId; this.directory = directory;
    const child = this.child = fork(fileURLToPath(new URL('./together-nim-worker.mjs', import.meta.url)), [], {
      windowsHide: true, execArgv: ['--max-old-space-size=96'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    this.error = undefined; this.stage = 'starting';
    this.timer = setTimeout(() => { if (this.child === child && !this.connected) { this.error = `聊天室连接超时（${this.stage}），请手动重新连接。`; child.kill(); } }, 25000);
    const failed = () => { if (this.child === child) { clearTimeout(this.timer); this.connected = false; this.child = undefined; this.error ||= '聊天室连接已断开，请重新连接。'; for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(this.error)); } this.pending.clear(); } void this.remove(directory); };
    child.once('error', failed); child.once('exit', failed);
    child.on('message', raw => {
      if (epoch !== this.epoch || this.child !== child) return;
      if (raw.event === 'stage' && ['sdk-load', 'login', 'ticket', 'chat-enter'].includes(raw.stage)) this.stage = raw.stage;
      if (raw.event === 'enter-step') this.stage = `chat-enter-${Number(raw.step)||0}-${Number(raw.code)||0}-${raw.matches ? 'matched' : 'other'}`;
      if (raw.event === 'connection') { this.connected = raw.connected === true; if (this.connected) { clearTimeout(this.timer); this.error = undefined; } else this.error = `聊天室连接中断（${Number(raw.code) || 0}）。`; }
      if (raw.event === 'failed') { this.error = `聊天室连接失败（${raw.stage || 'sdk'} / ${Number(raw.code) || 0}）。`; child.kill(); }
      if (raw.event === 'history-error') this.historyError = '暂时无法读取历史消息。';
      if (raw.event === 'message') this.remember(raw.message);
      if (raw.event === 'playback' && raw.playback) this.playback = raw.playback;
      const pending = this.pending.get(raw.requestId);
      if (pending) { clearTimeout(pending.timer); this.pending.delete(raw.requestId); if (raw.ok === true) { this.remember(raw.message); pending.resolve({ ok: true }); } else pending.reject(new Error(`消息未确认发送成功（${Number(raw.code) || 0}），请勿自动重发。`)); }
    });
    child.send({ ...value, directory, action: 'connect' }, error => { if (error) failed(); });
  }
  send(text) {
    if (!this.connected || !this.child?.connected) throw Object.assign(new Error('聊天室尚未连接，请稍后重试。'), { status: 409 });
    if (this.pending.size || Date.now() - (this.lastSend || 0) < 1000) throw Object.assign(new Error('消息发送中，请稍候。'), { status: 429 });
    this.lastSend = Date.now(); const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('消息发送结果未确认，请先查看聊天记录。')); }, 12000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.child.send({ action: 'send', requestId, text }, error => { if (error) { clearTimeout(timer); this.pending.delete(requestId); reject(new Error('聊天室连接已断开。')); } });
    });
  }
  async remove(directory) {
    if (path.dirname(directory) === os.tmpdir() && /^rhine-together-[A-Za-z0-9]+$/.test(path.basename(directory))) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
  dispose() {
    this.epoch++; clearTimeout(this.timer); this.child?.kill(); this.child = undefined;
    this.connected = false; this.roomId = undefined; this.messages = []; this.playback = undefined; this.error = undefined; this.historyError = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('一起听连接已关闭。')); } this.pending.clear();
    if (this.directory) { void this.remove(this.directory); this.directory = undefined; }
  }
}
