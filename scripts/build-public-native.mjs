import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// Run in a Visual Studio Developer terminal. Remap compiler source locations
// without committing a developer's private directories into configuration.
if (process.env.RUSTFLAGS || process.env.CARGO_ENCODED_RUSTFLAGS) throw new Error('Review and clear existing Rust flags before the public build.');
const root = process.cwd();
const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
const rustupHome = process.env.RUSTUP_HOME || path.join(os.homedir(), '.rustup');
const mappings = [[root, '/rhine-source'], [cargoHome, '/cargo'], [rustupHome, '/rust'], [os.homedir(), '/build-user']];
const flags = mappings.flatMap(([from, to]) => [...new Set([from, from.replaceAll('\\', '/')])].map(prefix => `--remap-path-prefix=${prefix}=${to}`));
const result = spawnSync(path.join(cargoHome, 'bin', 'cargo.exe'), ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--release', '--locked', '--offline'], {
  stdio: 'inherit',
  env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f'), CARGO_TARGET_DIR: path.join(root, 'src-tauri/target-public') },
});
if (result.error || result.status !== 0) throw new Error('Public native build failed; use a Windows x64 Visual Studio Developer terminal with the locked dependencies installed.');
