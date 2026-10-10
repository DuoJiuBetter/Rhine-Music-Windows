import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export function protectSecret(mode, input) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = fileURLToPath(new URL('./windows-protect-secret.ps1', import.meta.url));
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '', settled = false;
    const finish = (failure, value) => { if (settled) return; settled = true; clearTimeout(timer); failure ? reject(failure) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Windows 登录信息加密超时。')); }, 10000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 131072) { child.kill(); finish(new Error('登录信息过大。')); } });
    child.on('error', () => finish(new Error('无法启动 Windows 登录信息加密。')));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      if (code || !/^[A-Za-z0-9+/=]+$/.test(output)) return finish(new Error('Windows 无法加密或恢复登录信息，请重新扫码。'));
      finish(undefined, Buffer.from(output, 'base64'));
    });
    // Secrets only travel through pipes, never command arguments or logs.
    child.stdin.end(Buffer.from(input).toString('base64'));
  });
}

export class NeteaseSessionStore {
  constructor(dataDir, provider = 'netease') {
    if (!['netease', 'qq', 'kugou', 'bodian'].includes(provider)) throw new Error('Unsupported session provider');
    this.file = dataDir && process.platform === 'win32' ? path.join(dataDir, `${provider}-session.dpapi`) : undefined;
  }
  async load() {
    if (!this.file) return {};
    try {
      const file = await fs.open(this.file, 'r');
      let encrypted;
      try { if ((await file.stat()).size > 131072) throw new Error('Session too large'); encrypted = await file.readFile(); }
      finally { await file.close(); }
      const value = JSON.parse((await protectSecret('Unprotect', encrypted)).toString('utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }
  async save(cookie) {
    if (!this.file) return;
    const encrypted = await protectSecret('Protect', Buffer.from(JSON.stringify(cookie)));
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, encrypted, { mode: 0o600 }); await fs.rename(temporary, this.file); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  async clear() { if (this.file) await fs.rm(this.file, { force: true }); }
}
