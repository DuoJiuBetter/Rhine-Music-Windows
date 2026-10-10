import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'desktop-runtime');
// This fixed staging directory is inside the project, never a user library.
if (path.dirname(target) !== path.resolve(root)) throw new Error('Invalid runtime staging path');
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
await fs.copyFile(process.execPath, path.join(target, 'node.exe'));
await fs.cp(path.join(root, 'scripts'), path.join(target, 'scripts'), { recursive: true });
await fs.cp(path.join(root, 'dist'), path.join(target, 'dist'), { recursive: true });
await fs.cp(path.join(root, 'native'), path.join(target, 'native'), { recursive: true });
await fs.cp(path.join(root, 'third-party'), path.join(target, 'third-party'), { recursive: true });
for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'NOTICE.md', 'README.original.md'])
  await fs.copyFile(path.join(root, name), path.join(target, name));
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const child = spawnSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: target, stdio: 'inherit' });
if (child.status !== 0) throw new Error('Could not prepare locked production dependencies');
// Optional user-supplied FFmpeg binaries. Their licenses must accompany them.
const bin = path.join(root, 'desktop-binaries');
try {
  await fs.access(bin);
  for (const name of ['ffmpeg.exe', 'ffprobe.exe', 'FFMPEG-LICENSE.txt', 'FFMPEG-README.txt']) await fs.access(path.join(bin, name));
  await fs.cp(bin, path.join(target, 'bin'), { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT' || await fs.stat(bin).catch(() => null)) throw error;
}
console.log('Desktop runtime prepared; end users do not need Node.js or npm.');
