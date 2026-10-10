// Static PE inspection only. Never launches the executable or probes a GPU.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const file = process.argv[2] || 'src-tauri/target/release/rhine-music-windows.exe';
const bytes = await fs.readFile(file), pe = bytes.readUInt32LE(0x3c);
assert.equal(bytes.toString('ascii', pe, pe + 4), 'PE\u0000\u0000');
assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, 'Windows x64');
const optional = pe + 24;
assert.equal(bytes.readUInt16LE(optional), 0x20b, 'PE32+');
const sectionCount = bytes.readUInt16LE(pe + 6);
const sections = optional + bytes.readUInt16LE(pe + 20);
function address(rva) {
  for (let i = 0; i < sectionCount; i++) {
    const section = sections + i * 40, base = bytes.readUInt32LE(section + 12);
    const size = Math.max(bytes.readUInt32LE(section + 8), bytes.readUInt32LE(section + 16));
    if (rva >= base && rva < base + size) return bytes.readUInt32LE(section + 20) + rva - base;
  }
  throw new Error(`Unmapped PE RVA ${rva}`);
}
const directory = address(bytes.readUInt32LE(optional + 112));
const functions = address(bytes.readUInt32LE(directory + 28));
const names = address(bytes.readUInt32LE(directory + 32));
const ordinals = address(bytes.readUInt32LE(directory + 36));
let hint;
for (let i = 0; i < bytes.readUInt32LE(directory + 24); i++) {
  const start = address(bytes.readUInt32LE(names + i * 4));
  const name = bytes.toString('ascii', start, bytes.indexOf(0, start));
  if (name !== 'NvOptimusEnablement') continue;
  const ordinal = bytes.readUInt16LE(ordinals + i * 2);
  hint = bytes.readUInt32LE(address(bytes.readUInt32LE(functions + ordinal * 4)));
}
assert.equal(hint, 1, 'NVIDIA Optimus DWORD export must survive release LTO');
assert.ok(bytes.includes(Buffer.from('--force_high_performance_gpu')), 'WebView2 preference embedded');
console.log(JSON.stringify({ architecture: 'x64', NvOptimusEnablement: hint, webViewPreferenceEmbedded: true, runtimeChecked: false }));
