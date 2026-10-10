import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const name = process.env.RHINE_PACKAGE_NAME || 'Rhine-Music-Windows';
if (!/^Rhine-Music-Windows(?:-[A-Za-z0-9-]+)?$/.test(name)) throw new Error('Invalid portable folder name');
const output = path.resolve('release', name);
if (path.dirname(output) !== path.resolve('release')) throw new Error('Invalid portable output path');
// Windows forbids opening a running executable for writing. Check before
// removing any files so an open preview remains a complete, usable package.
for (const executable of [path.join(output, 'Rhine Music.exe'), path.join(output, 'runtime', 'node.exe')]) {
  try { const handle = await fs.open(executable, 'r+'); await handle.close(); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('The target preview is running. Close it or use a separate RHINE_PACKAGE_NAME before packaging.'); }
}
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await fs.copyFile('src-tauri/target/release/rhine-music-windows.exe', path.join(output, 'Rhine Music.exe'));
await fs.cp('desktop-runtime', path.join(output, 'runtime'), { recursive: true });
await fs.copyFile('README.windows.md', path.join(output, 'README.txt'));
await fs.copyFile('LICENSE', path.join(output, 'LICENSE'));
await fs.copyFile('NOTICE.md', path.join(output, 'NOTICE.md'));
await fs.copyFile('README.original.md', path.join(output, 'README.original.md'));
await fs.mkdir(path.join(output, 'docs'), { recursive: true });
await fs.copyFile('docs/WINDOWS-VALIDATION.md', path.join(output, 'docs/WINDOWS-VALIDATION.md'));
try {
  await fs.copyFile('docs/WINDOWS-PERFORMANCE-PROJECT.md', path.join(output, 'docs/WINDOWS-PERFORMANCE-PROJECT.md'));
  await fs.copyFile('docs/WINDOWS-PERF10.md', path.join(output, 'docs/WINDOWS-PERF10.md'));
  await fs.copyFile('docs/WINDOWS-PERF11.md', path.join(output, 'docs/WINDOWS-PERF11.md'));
  await fs.copyFile('docs/WINDOWS-PERF12.md', path.join(output, 'docs/WINDOWS-PERF12.md'));
  await fs.copyFile('docs/WINDOWS-PERF13.md', path.join(output, 'docs/WINDOWS-PERF13.md'));
  await fs.copyFile('docs/WINDOWS-PERF14.md', path.join(output, 'docs/WINDOWS-PERF14.md'));
  await fs.copyFile('docs/WINDOWS-PERF15.md', path.join(output, 'docs/WINDOWS-PERF15.md'));
  await fs.copyFile('docs/WINDOWS-PERF16.md', path.join(output, 'docs/WINDOWS-PERF16.md'));
  await fs.copyFile('docs/WINDOWS-PERF17.md', path.join(output, 'docs/WINDOWS-PERF17.md'));
  await fs.copyFile('docs/WINDOWS-PERF18.md', path.join(output, 'docs/WINDOWS-PERF18.md'));
  await fs.copyFile('docs/WINDOWS-PERF19.md', path.join(output, 'docs/WINDOWS-PERF19.md'));
  await fs.copyFile('docs/WINDOWS-PERF20-DEBUG.md', path.join(output, 'docs/WINDOWS-PERF20-DEBUG.md'));
  await fs.copyFile('docs/WINDOWS-PERF21.md', path.join(output, 'docs/WINDOWS-PERF21.md'));
  await fs.copyFile('docs/WINDOWS-PERF20A-DEBUG.md', path.join(output, 'docs/WINDOWS-PERF20A-DEBUG.md'));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const hashes = [];
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.name !== 'SHA256SUMS.txt') hashes.push(`${createHash('sha256').update(await fs.readFile(file)).digest('hex')}  ${path.relative(output, file).replaceAll('\\', '/')}`);
  }
}
await walk(output);
await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
console.log(`Portable desktop: ${output}`);
