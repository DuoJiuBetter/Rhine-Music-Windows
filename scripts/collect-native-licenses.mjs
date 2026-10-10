import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Packaging metadata only: no application, network service or audio is started.
export async function collectNativeLicenses(output, root = fileURLToPath(new URL('../', import.meta.url))) {
  const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
  const cargo = path.join(cargoHome, 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  const result = spawnSync(cargo, ['metadata', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml'), '--locked', '--offline', '--filter-platform', 'x86_64-pc-windows-msvc', '--format-version', '1'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Cannot collect locked native dependency metadata: ${result.error?.message || result.stderr}`);
  const metadata = JSON.parse(result.stdout);
  const active = new Set(metadata.resolve.nodes.map(node => node.id));
  const inventory = [];
  for (const dependency of metadata.packages) {
    if (!dependency.source || !active.has(dependency.id)) continue;
    const crateRoot = path.dirname(dependency.manifest_path);
    const name = `${dependency.name}-${dependency.version}`;
    if (!/^[A-Za-z0-9_.+-]+$/.test(name)) throw new Error('Invalid native dependency name');
    const licenseDir = path.join(output, 'licenses', name);
    await fs.mkdir(licenseDir, { recursive: true });
    const notices = [];
    for (const entry of await fs.readdir(crateRoot, { withFileTypes: true })) {
      if (entry.isFile() && /^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT|AUTHORS|UNLICENSE)/i.test(entry.name)) {
        await fs.copyFile(path.join(crateRoot, entry.name), path.join(licenseDir, entry.name));
        notices.push(entry.name);
      }
    }
    if (!notices.length) {
      const supplement = path.join(root, 'third-party/native-supplements', name);
      for (const entry of await fs.readdir(supplement, { withFileTypes: true })) {
        if (entry.isFile()) {
          await fs.copyFile(path.join(supplement, entry.name), path.join(licenseDir, entry.name));
          if (entry.name !== 'SOURCE.json') notices.push(entry.name);
        }
      }
    }
    if (!notices.length) throw new Error(`Missing license text for ${name}`);
    const sourceIncluded = dependency.license?.includes('MPL-2.0') || false;
    if (sourceIncluded) {
      // Supply the exact, unmodified registry source alongside the executable.
      // MPL notices and each source file's existing copyright remain intact.
      await fs.cp(crateRoot, path.join(output, 'sources', name), { recursive: true, filter: file => !['.cargo-ok', 'target'].includes(path.basename(file)) });
    }
    inventory.push({ name: dependency.name, version: dependency.version, license: dependency.license, repository: dependency.repository, noticeFiles: notices, sourceIncluded });
  }
  await fs.writeFile(path.join(output, 'DEPENDENCIES.json'), JSON.stringify(inventory, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'README.txt'), 'Native dependency notices for the locked Windows x64 build.\nIncludes runtime and build dependencies conservatively; this is not a claim that every dependency is linked into the executable.\nExact unmodified MPL-2.0 dependency sources are included under sources/. Each retains its original license.\nDEPENDENCIES.json contains versions, source repositories and applicable license identifiers. No local manifest paths are exported.\n');
  return inventory.length;
}
