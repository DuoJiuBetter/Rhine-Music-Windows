// Rasterize the existing shared vector mark; no alternate logo or generated art.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { labelMarkSvg } from "../src/brand.ts";
const {default:sharp}=await import(process.env.SHARP_MODULE ? pathToFileURL(resolve(process.env.SHARP_MODULE)).href : 'sharp');
const mark=labelMarkSvg.replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'');
// Preserve the shared contour, enlarge its painted width from ~326px to ~459px.
// Keep the enlarged mark on the requested rounded warm-white tile.
const drawing = `<g transform="translate(23.5 148.75) scale(1.5)" color="#171713">${mark}</g>`;
const wrap = content => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${content}${drawing}</svg>`;
const svg = wrap('<rect x="8" y="8" width="496" height="496" rx="110" fill="#e8e5e1"/>');
await mkdir('public/icons',{recursive:true});
await writeFile('public/icons/app-icon.svg',svg);
await writeFile('public/favicon.svg',svg);
for(const [name,size] of [['apple-touch-icon',180],['icon-192',192],['icon-512',512]])
  await sharp(Buffer.from(svg)).resize(size,size).png().toFile(`public/icons/${name}.png`);
// Keep the compatibility filename; all icons are declared as "any".
await sharp(Buffer.from(svg)).png().toFile('public/icons/icon-maskable-512.png');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(size => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((png, index) => {
  const entry = 6 + index * 16, size = sizes[index];
  header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await mkdir('src-tauri/icons', { recursive: true });
await writeFile('src-tauri/icons/icon.ico', Buffer.concat([header, ...images]));
console.log('Existing Rhine Lab mark enlarged on a rounded warm-white tile; native ICO has seven sizes.');
