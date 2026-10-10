// Static resource inspection only: reads PNG/ICO/PE bytes, never starts the app.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { default: sharp } = await import(process.env.SHARP_MODULE ? pathToFileURL(resolve(process.env.SHARP_MODULE)).href : 'sharp');
const ico = await fs.readFile('src-tauri/icons/icon.ico');
assert.equal(ico.readUInt16LE(2), 1);
const sizes = [16, 24, 32, 48, 64, 128, 256];
assert.equal(ico.readUInt16LE(4), sizes.length);
const images = [];
for (let index = 0; index < sizes.length; index++) {
  const entry = 6 + index * 16, size = sizes[index];
  assert.equal(ico[entry] || 256, size);
  const start = ico.readUInt32LE(entry + 12), length = ico.readUInt32LE(entry + 8);
  assert.ok(start >= 6 + sizes.length * 16 && start + length <= ico.length);
  const png = ico.subarray(start, start + length);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, size); assert.equal(info.height, size); assert.equal(info.channels, 4);
  for (const pixel of [0, size - 1, size * (size - 1), size * size - 1]) assert.equal(data[pixel * 4 + 3], 0, 'Corner alpha');
  let minX = size, maxX = -1, opaque = 0;
  for (let pixel = 0; pixel < size * size; pixel++) {
    if (data[pixel * 4 + 3] > 200 && Math.max(...data.subarray(pixel * 4, pixel * 4 + 3)) < 50) { minX = Math.min(minX, pixel % size); maxX = Math.max(maxX, pixel % size); opaque++; }
  }
  // Tiny raster sizes lose up to two opaque edge pixels to antialiasing.
  assert.ok(maxX - minX + 1 >= size * .88 - 2, 'Enlarged mark width');
  // At 16/24px, blending the contour with white removes a few fully-dark pixels.
  assert.ok(opaque > size * size * 0.1 - size * 0.5 && opaque < size * size * 0.4, 'Enlarged dark mark retained');
  const background = (Math.floor(size * .15) * size + Math.floor(size / 2)) * 4;
  assert.equal(data[background + 3], 255, 'Opaque warm-white tile');
  for (const [channel, expected] of [232, 229, 225].entries()) assert.ok(Math.abs(data[background + channel] - expected) <= 2, 'Warm-white background color');
  images.push(png);
}
const exe = await fs.readFile(process.argv[2] || 'src-tauri/target/release/rhine-music-windows.exe');
const pe = exe.readUInt32LE(0x3c), optional = pe + 24;
assert.equal(exe.toString('ascii', pe, pe + 4), 'PE\u0000\u0000');
assert.equal(exe.readUInt16LE(optional), 0x20b);
const sections = optional + exe.readUInt16LE(pe + 20);
function address(rva) {
  for (let i = 0; i < exe.readUInt16LE(pe + 6); i++) {
    const section = sections + i * 40, base = exe.readUInt32LE(section + 12);
    const size = Math.max(exe.readUInt32LE(section + 8), exe.readUInt32LE(section + 16));
    if (rva >= base && rva < base + size) return exe.readUInt32LE(section + 20) + rva - base;
  }
  throw new Error('Unmapped resource RVA');
}
const resource = address(exe.readUInt32LE(optional + 128));
const icons = new Map(); let groups = 0;
function walk(offset, path = []) {
  assert.ok(path.length <= 3);
  const directory = resource + offset, count = exe.readUInt16LE(directory + 12) + exe.readUInt16LE(directory + 14);
  assert.ok(count <= 1024);
  for (let i = 0; i < count; i++) {
    const entry = directory + 16 + i * 8, name = exe.readUInt32LE(entry), value = exe.readUInt32LE(entry + 4);
    const next = [...path, name];
    if (value & 0x80000000) walk(value & 0x7fffffff, next);
    else {
      const dataEntry = resource + value, start = address(exe.readUInt32LE(dataEntry)), length = exe.readUInt32LE(dataEntry + 4);
      const bytes = exe.subarray(start, start + length);
      if (next[0] === 3) icons.set(next[1], bytes);
      if (next[0] === 14) groups++;
    }
  }
}
walk(0);
assert.ok(groups > 0, 'Windows icon group present');
for (const png of images) assert.ok([...icons.values()].some(bytes => bytes.equals(png)), 'Exact rounded PNG embedded as RT_ICON');
console.log(JSON.stringify({ sizes, roundedWhiteBackground: true, transparentCorners: true, enlargedMark: true, embeddedIconGroups: groups, exactNativeImages: images.length, runtimeChecked: false }));
