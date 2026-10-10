import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { collectNativeLicenses } from './collect-native-licenses.mjs';

const root = process.cwd();
const releases = path.resolve('release');
const input = path.resolve(process.argv[2] || 'release/Rhine-Music-Windows');
const name = 'Rhine-Music-Windows-Perf21-Public';
const output = path.join(releases, name);
if (path.dirname(input) !== releases || input === output) throw new Error('Input must be a different portable directory directly under release/');
if (await fs.stat(output).catch(() => null)) throw new Error('Public output already exists; preserve it or choose a clean checkout.');
for (const file of ['Rhine Music.exe', 'runtime/node.exe', 'runtime/dist/index.html']) await fs.access(path.join(input, file));

// Always create a separate public package; private test packages stay intact.
await fs.cp(input, output, { recursive: true, filter: file => {
  const relative = path.relative(input, file).replaceAll('\\', '/');
  return relative !== 'SHA256SUMS.txt' && relative !== 'docs' && relative !== 'runtime/bin';
} });
for (const target of [output, path.join(output, 'runtime')]) {
  for (const file of ['README.md', 'README.windows.md', 'LICENSE', 'NOTICE.md', 'PRIVACY.md', 'PLATFORM-NOTICE.md', 'README.original.md', 'README.upstream.md']) await fs.copyFile(path.join(root, file), path.join(target, file));
  await fs.cp(path.join(root, 'third-party'), path.join(target, 'third-party'), { recursive: true });
}
await fs.copyFile('README.windows.md', path.join(output, 'README.txt'));
await fs.mkdir(path.join(output, 'docs'), { recursive: true });
for (const file of ['WINDOWS-PERF21.md', 'WINDOWS-VALIDATION.md']) await fs.copyFile(path.join(root, 'docs', file), path.join(output, 'docs', file));
const nativeDependencies = await collectNativeLicenses(path.join(output, 'third-party/native'), root);
const exeHash = createHash('sha256').update(await fs.readFile(path.join(output, 'Rhine Music.exe'))).digest('hex');
await fs.writeFile(path.join(output, 'PUBLIC-PACKAGE.txt'), `Rhine Music Windows 0.1.0 Preview / 0.4.1-perf21\nMaintainer: DuoJiuBetter\nSource: https://github.com/DuoJiuBetter/Rhine-Music-Windows\nContact: 2228396737@qq.com\nThis public package omits the optional FFmpeg/ffprobe binaries supplied in previous private test packages.\nThe Perf21 executable and built web application are reused without changes; public notices and dependency license material are added.\nEXE SHA-256: ${exeHash}\nNative dependency license entries: ${nativeDependencies}\nValidation: static packaging, hash and build checks only; no new application/GPU/audio/account runtime verification.\n`);
const manifest = [];
async function walk(directory) {
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else manifest.push(`${createHash('sha256').update(await fs.readFile(file)).digest('hex')}  ${path.relative(output, file).replaceAll('\\', '/')}`);
  }
}
await walk(output);
await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), manifest.join('\n') + '\n');
const sourceZip = path.join(releases, 'Rhine-Music-Windows-Perf21-Source.zip');
const sourceResult = spawnSync('git', ['archive', '--format=zip', '--prefix=Rhine-Music-Windows-Perf21-Source/', `--output=${sourceZip}`, 'HEAD'], { stdio: 'inherit' });
if (sourceResult.status !== 0) throw new Error('Cannot export committed source snapshot');
console.log(JSON.stringify({ output, sourceZip, files: manifest.length + 1, nativeDependencies, exeHash }));
// Archive the entire directory, including the required runtime. PowerShell's
// archive cmdlet is deliberately avoided because it can omit hidden files.
const archive = path.join(releases, `${name}-x64.zip`);
const python = spawnSync('python', ['-c', 'import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[1]); o=pathlib.Path(sys.argv[2])\nwith zipfile.ZipFile(o,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:\n for f in sorted(p.rglob("*")):\n  if f.is_file(): z.write(f, f.relative_to(p.parent).as_posix())', output, archive], { stdio: 'inherit' });
if (python.error || python.status !== 0) throw new Error('ZIP export requires Python 3. The complete uncompressed public directory has been retained.');
const checksums = [];
for (const file of [archive, sourceZip]) checksums.push(`${createHash('sha256').update(await fs.readFile(file)).digest('hex')}  ${path.basename(file)}`);
await fs.writeFile(path.join(releases, 'Rhine-Music-Windows-Perf21-Public-SHA256SUMS.txt'), checksums.join('\n') + '\n');
console.log(`Public release archive: ${archive}`);
