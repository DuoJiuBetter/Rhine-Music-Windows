import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
import * as THREE from "three";
import { CoverAtlas, COVER_INSET, COVER_PAINT_SIZE, COVER_SIZE, containCover, paintCover } from "../src/cover-atlas.ts";
import { CoverClarityState } from '../src/cover-clarity-pass.ts';

const pixelTokens = new Map(), tokenPixels = new Map();
function imageToken(texture) {
  if (!texture.image.data) return texture.image.token;
  const data=texture.image.data;
  return pixelTokens.get(new DataView(data.buffer, data.byteOffset + data.length - texture.image.width * 4).getUint32(0,true));
}

// Deterministic image decode/canvas harness exercises production ownership and
// drawing code. Pixel quality and GPU transmission are checked in the browser.
class Canvas {
  width = 0; height = 0; token = "empty"; tiles = new Map(); calls = [];
  getContext() {
    return {
      getImageData: (_x,_y,width,height) => {
        if (!tokenPixels.has(this.token)) { const id=tokenPixels.size+1;tokenPixels.set(this.token,id);pixelTokens.set(id,this.token); }
        const data=new Uint8ClampedArray(width*height*4);new DataView(data.buffer).setUint32(0,tokenPixels.get(this.token),true);return {data};
      },
      setTransform: (...args) => this.calls.push(["transform", ...args]),
      clearRect: (x, y) => { this.token = "cleared"; this.tiles.delete(`${x},${y}`); },
      fillRect: () => { this.token = "placeholder"; },
      beginPath() {}, arc() {}, stroke() {},
      fillText: (title) => this.calls.push(["text", title]),
      drawImage: (source, ...args) => {
        const token = args.length === 8 ? source.tiles.get(`${args[0]},${args[1]}`) ?? source.token : source.token;
        this.token = token;
        this.calls.push(["draw", token, ...args]);
        if (args.length === 2) this.tiles.set(`${args[0]},${args[1]}`, token);
      },
    };
  }
}
const pending = new Map();
let decodes = 0;
class DeferredImage {
  naturalWidth = 1200; naturalHeight = 800; token = "";
  set src(value) { if (value) this.token = value; else this.reject?.(new DOMException("Cancelled", "AbortError")); }
  decode() {
    decodes++;
    return new Promise((resolve, reject) => { this.reject = reject; pending.set(this.token, { resolve, reject }); });
  }
}
const previousDocument = globalThis.document, previousImage = globalThis.Image;
let canvasesCreated = 0;
globalThis.document = { createElement: (name) => { assert.equal(name, "canvas"); canvasesCreated++; return new Canvas(); } };
globalThis.Image = DeferredImage;
const record = (id) => ({ id, title: `Album ${id}`, album: { id, title: `Album ${id}`, coverUrl: `cover-${id}` } });
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
// Keep this harness strip-types compatible even though CardAppearance has a
// transitive module using TS parameter properties. Exercise its real disposer.
const appearanceUrl = new URL('../src/appearance.ts', import.meta.url);
const appearanceSource = await fs.readFile(appearanceUrl, 'utf8');
const disposeBody = appearanceSource.slice(appearanceSource.indexOf('  dispose(group: THREE.Group) {'));
const {outputText:disposeCode} = ts.transpileModule('export class CoverDisposer {\n'+disposeBody,
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const {CoverDisposer} = await import(`data:text/javascript;base64,${Buffer.from(disposeCode).toString('base64')}`);

try {
  const clarity = new CoverClarityState();
  const selectedShader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  const shelfShader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  clarity.bind(selectedShader, true); clarity.bind(shelfShader, false);
  clarity.inspection.value = 1;
  assert.equal(selectedShader.uniforms.coverInspection.value, 1);
  assert.equal(shelfShader.uniforms.coverInspection.value, 0, 'inspection readability must not brighten every shelf cover');
  assert.ok(selectedShader.fragmentShader.includes('mix(outgoingLight, diffuseColor.rgb, coverInspection)'));
  // Complete art, centred on all aspect ratios, with resolution-independent
  // physical margins. No crop, negative size, UV flip or ownership rescale.
  for (const [width, height] of [[1024, 1024], [1800, 600], [600, 1800], [1, 2000], [2000, 1]]) {
    const box = containCover(width, height, 992, 992);
    assert.ok(Math.abs(box.width / box.height - width / height) < 1e-8);
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 992 && box.y + box.height <= 992);
    const commands = [];
    for (const size of [128, 248, 256, 1024]) {
      const canvas = new Canvas(); canvas.width = canvas.height = size;
      paintCover(canvas, record("art"), { source: { token: "asymmetric-art" }, width, height });
      const draw = canvas.calls.find(call => call[0] === "draw");
      const [, token, x, y, w, h] = draw;
      assert.equal(token, "asymmetric-art");
      assert.ok(x >= COVER_PAINT_SIZE * COVER_INSET && y >= COVER_PAINT_SIZE * COVER_INSET);
      assert.ok(w > 0 && h > 0, "source orientation is preserved");
      assert.ok(x + w <= COVER_PAINT_SIZE * (1 - COVER_INSET));
      assert.ok(y + h <= COVER_PAINT_SIZE * (1 - COVER_INSET));
      commands.push(draw);
    }
    commands.forEach(command => assert.deepEqual(command, commands[0], "atlas, selection and viewer paint in the same UV space"));
  }
  const atlas = new CoverAtlas(32, 4096, 16);
  const integrated = new CoverAtlas(432, 16384, 8, undefined, 128);
  assert.deepEqual([integrated.getStats().atlasWidth, integrated.getStats().atlasHeight, integrated.getStats().atlasBytes], [2048, 3456, 27 * 1024 ** 2]);
  assert.equal(integrated.selected.material.map.image.width, COVER_PAINT_SIZE, "Selected cover keeps its full resolution");
  integrated.dispose();
  assert.equal(atlas.array.geometry.attributes.coverTile.count, 32);
  assert.equal(atlas.array.material.map.generateMipmaps, false);
  assert.equal(atlas.array.material.map.anisotropy, 1);
  assert.ok(atlas.selected.material.map.anisotropy > 1);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  atlas.array.material.onBeforeCompile(shader, {});
  assert.ok(shader.fragmentShader.includes("clamp(vMapUv, vCoverTile.xy + coverAtlasTexel * 0.5"), "every sample stays within its own tile centres");
  assert.deepEqual(shader.uniforms.coverAtlasTexel.value.toArray(), [1 / 4096, 1 / 512]);
  const positions = atlas.selected.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) assert.ok(Math.abs(positions.getZ(i) - COVER_SIZE.z) < 1e-8);
  const uvs = atlas.selected.geometry.attributes.uv;
  assert.deepEqual(Array.from(uvs.array), [0, 1, 1, 1, 0, 0, 1, 0], "front-facing artwork is not reversed");

  const a = record("a"), b = record("b");
  atlas.setSlot(0, a);
  const selectA = atlas.select(a);
  assert.equal(decodes, 1, "slot and selection share one in-flight decode");
  const selectB = atlas.select(b);
  pending.get("cover-b").resolve(); await selectB;
  assert.equal(imageToken(atlas.selected.material.map), "cover-b");
  const version = atlas.selected.material.map.version;
  pending.get("cover-a").resolve(); await selectA; await flush();
  assert.equal(imageToken(atlas.selected.material.map), "cover-b", "late previous image cannot replace the active cover");
  assert.equal(atlas.selected.material.map.version, version, "late image does not clear or upload the active texture");
  await atlas.select(a);
  assert.equal(imageToken(atlas.selected.material.map), "cover-a", "decoded cached artwork is installed synchronously");
  const snapshot = new THREE.Mesh(atlas.selected.geometry, atlas.selected.material);
  const originalSelectedTexture = atlas.selected.material.map;
  const beforeSnapshotCanvases = canvasesCreated;
  atlas.snapshot(snapshot);
  assert.equal(canvasesCreated, beforeSnapshotCanvases, 'returning cover allocates no extra full-size canvas');
  assert.equal(snapshot.material.map, originalSelectedTexture, 'returning cover shares the original GPU texture by ownership');
  assert.equal(imageToken(snapshot.material.map), "cover-a");
  await atlas.select(b);
  assert.equal(imageToken(snapshot.material.map), "cover-a", "returning copy owns the old album's pixels");
  const warmVersion = originalSelectedTexture.version;
  for (let i = 0; i < 10; i++) { await atlas.select(a); await atlas.select(b); }
  assert.equal(originalSelectedTexture.version, warmVersion, 'warm revisits do not repaint or re-upload selected covers');
  assert.equal(atlas.getStats().selectedCovers.created, 2, 'two warm songs keep two reusable full-size textures');
  let sharedDisposals = 0; originalSelectedTexture.addEventListener('dispose', () => sharedDisposals++);
  const oldGroup = new THREE.Group(); snapshot.userData.albumCover = true; oldGroup.add(snapshot);
  new CoverDisposer().dispose(oldGroup);
  assert.equal(sharedDisposals, 0, 'retiring the old model must not dispose a cached or currently selected cover');
  assert.equal(typeof snapshot.userData.coverRelease, 'undefined', 'retirement releases and removes the pin closure');
  await atlas.select(a);
  assert.equal(atlas.selected.material.map, originalSelectedTexture);
  assert.equal(originalSelectedTexture.image.width, COVER_PAINT_SIZE, 'shared cover retains original full resolution');
  const pooledCover = new THREE.Mesh(atlas.selected.geometry,atlas.selected.material);
  atlas.snapshot(pooledCover,true);
  const pooledMaterial=pooledCover.material;
  atlas.releaseSnapshot(pooledCover);
  assert.equal(pooledMaterial.map,null,'an idle returning model releases its pinned texture');
  await atlas.select(b);atlas.snapshot(pooledCover,true);
  assert.equal(pooledCover.material,pooledMaterial,'returning material/program identity survives a different song');
  assert.equal(imageToken(pooledMaterial.map),'cover-b');
  atlas.releaseSnapshot(pooledCover);pooledMaterial.dispose();
  atlas.setSlot(1, record("old")); atlas.setSlot(1, record("new"));
  pending.get("cover-new").resolve(); await flush();
  const currentTile = atlas.array.geometry.attributes.coverTile;
  const origin = `${Math.round(currentTile.getX(1) * atlas.getStats().atlasWidth)},${Math.round((1 - currentTile.getY(1) - currentTile.getW(1)) * atlas.getStats().atlasHeight)}`;
  const tile = atlas.array.material.map.image.tiles.get(origin);
  pending.get("cover-old").resolve(); await flush();
  assert.equal(atlas.array.material.map.image.tiles.get(origin), tile, "recycled slots reject stale decoding");
  assert.equal(tile, "cover-new");

  // The standalone viewer calls the same painter, including missing art.
  const url = new URL("../src/viewer-album-cover.ts", import.meta.url);
  const { outputText } = ts.transpileModule(await fs.readFile(url, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  const code = outputText.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(specifier.startsWith(".") ? new URL(specifier === "./cover-atlas" ? "./cover-atlas.ts" : specifier, url).href : import.meta.resolve(specifier))}`);
  const { ViewerAlbumCover } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  const viewer = new ViewerAlbumCover(record("viewer").album, 8);
  pending.get("cover-viewer").resolve(); await viewer.ready;
  assert.equal(imageToken(viewer.mesh.material.map), "cover-viewer");
  assert.equal(viewer.mesh.userData.coverStatus, "loaded");
  viewer.dispose();
  const missing = new ViewerAlbumCover({ id: "missing", title: "Missing" });
  await missing.ready;
  assert.equal(missing.mesh.userData.coverStatus, "missing");
  assert.equal(imageToken(missing.mesh.material.map), "placeholder");
  missing.dispose();
  const lateViewer = new ViewerAlbumCover(record("late").album);
  lateViewer.dispose(); pending.get("cover-late").resolve(); await lateViewer.ready;
  assert.equal(lateViewer.mesh.userData.coverDisposed, true, "disposing during decode cannot revive a viewer");

  // Cold start: requests are bounded before Image allocation/decode, not merely
  // after completion in the LRU. 432 physical tiles keep one instanced batch.
  const cold = new CoverAtlas(432, 8192, 16);
  const copies = [], allocations = [];
  const renderer = {
    initTexture: texture => allocations.push({ ready: texture.source.dataReady, version: texture.version }),
    copyTextureToTexture: (source, destination, region, position) => copies.push({
      token: source.image.token, position: position.toArray(),
      width: source.image.width, height: source.image.height, region,
      draw: source.image.calls.at(-1),
    }),
  };
  const versionBefore = cold.array.material.map.version;
  for (let slot = 0; slot < 100; slot++) cold.setSlot(slot, record(`cold-${slot}`));
  assert.deepEqual([cold.getStats().atlasWidth, cold.getStats().atlasHeight, cold.getStats().atlasBytes], [4096, 6912, 108 * 1024 ** 2]);
  assert.equal(cold.getStats().activeDecodes, 3);
  assert.equal(cold.getStats().queuedDecodes, 97);
  assert.equal(cold.getStats().uploadStaging.tiles,32);
  assert.ok(cold.getStats().uploadStaging.bytes<=8*1024**2,'small transfer sources have an 8 MiB cap');
  assert.equal((await cold.prepareVisible(0)).settled, false, "prewarm has a bounded deadline when sources have not decoded");
  assert.equal(cold.array.geometry.attributes.coverReady.getX(0), 0);
  assert.equal(cold.flushUploads(renderer), 8);
  assert.deepEqual(allocations, [{ ready: false, version: versionBefore }], "initial GPU storage is allocated without uploading the 108 MiB canvas");
  assert.deepEqual(copies[0].position, [0, 6656], "top canvas row maps to the top WebGL tile");
  assert.deepEqual(copies.map(copy => [copy.position, copy.width, copy.height]), [
    [[0, 6656], 1024, 256], [[1024, 6656], 1024, 256],
  ], "eight adjacent tiles reach the same atlas row in two complete strips");
  assert.equal(cold.array.geometry.attributes.coverReady.getX(7), 1);
  assert.equal(cold.array.geometry.attributes.coverReady.getX(8), 0, "unuploaded cells cannot show stale artwork");
  assert.equal(cold.getStats().uploadCalls, 2);
  assert.equal(cold.getStats().uploadedBytes, 2 * 1024 ** 2, "one frame uploads at most 2 MiB at the default budget");
  assert.equal(cold.getStats().uploadStaging.atlasFallbackTiles,8,'older dirty tiles keep correct atlas fallback after staging eviction');
  assert.equal(cold.array.material.map.version, versionBefore, "dirty tile painting never requests a whole-atlas upload");
  const selectedCold = cold.select(record("cold-99"));
  pending.get("cover-cold-0").resolve(); await flush();
  assert.ok(pending.has("cover-cold-99"), "selection jumps ahead of the background decode queue");
  pending.get("cover-cold-99").resolve(); await selectedCold;
  assert.equal(imageToken(cold.selected.material.map), "cover-cold-99");
  assert.equal(cold.decodedImages.get("cover-cold-99").decodedSize, 1024, "priority selection keeps detailed artwork");
  assert.equal(cold.decodedImages.get("cover-cold-0").decodedSize, 256, "background cache retains thumbnails rather than 1024px sources");
  const resolved = new Set([0, 99]);
  while (cold.getStats().pendingImages) {
    for (let slot = 0; slot < 100; slot++) if (!resolved.has(slot) && pending.has(`cover-cold-${slot}`)) {
      resolved.add(slot); pending.get(`cover-cold-${slot}`).resolve();
    }
    await flush();
  }
  assert.equal(cold.getStats().peakDecodes, 3);
  assert.ok(cold.getStats().cachedBytes <= 48 * 1024 ** 2);
  assert.ok(cold.getStats().cachedImages <= 192);
  while (cold.getStats().dirtyTiles) cold.flushUploads(renderer);
  assert.equal(allocations.length, 1);
  assert.equal(cold.array.material.map.version, versionBefore);
  const last = copies.find(copy => copy.position[1] === 5120 && copy.position[0] <= 768 && copy.position[0] + copy.width > 768);
  assert.ok(last, "the final asynchronous tile belongs to an uploaded strip");
  assert.equal(cold.array.material.map.image.tiles.get("768,1536"), "cover-cold-99");
  assert.equal(last.draw[3], 1536, "strip source samples the correct canvas row");
  assert.equal(cold.flushUploads(renderer), 0, "settled frames upload nothing");
  assert.equal((await cold.prepareVisible()).settled, true);

  cold.setSlot(0, record("recycle"));
  assert.equal(cold.array.geometry.attributes.coverReady.getX(0), 0, "recycled cells hide old GPU art immediately");
  cold.flushUploads(renderer);
  assert.equal(cold.array.geometry.attributes.coverReady.getX(0), 1);
  const pendingBeforeReset = cold.select(record("reset-stale"));
  cold.reset(); await pendingBeforeReset; await flush();
  assert.equal(cold.getStats().dirtyTiles, 0);
  assert.equal(cold.getStats().pendingImages, 0);
  assert.equal(cold.getStats().activeDecodes, 0);
  assert.equal(cold.getStats().cachedBytes, 0);
  assert.equal(cold.array.geometry.attributes.coverReady.getX(0), 0);
  cold.setSlot(431, record("after-reset"));
  pending.get("cover-after-reset").resolve(); await flush();
  cold.flushUploads(renderer);
  assert.deepEqual(copies.at(-1).position, [3840, 0], "bottom-right tile retains its mapping after reset");
  assert.equal(copies.at(-1).token, "cover-after-reset");
  const pendingAtDisposal = cold.select(record("dispose-active"));
  for (let slot = 0; slot < 8; slot++) cold.setSlot(slot, record(`dispose-queued-${slot}`));
  cold.dispose(); await pendingAtDisposal; await flush();
  assert.equal(cold.getStats().pendingImages, 0);
  assert.equal(cold.getStats().queuedDecodes, 0);
  assert.equal(cold.getStats().activeDecodes, 0);
  assert.equal(cold.flushUploads(renderer), 0, "disposing cancels queue, source decoding and GPU uploads");
  const compact = new CoverAtlas(4, 8192, 8);
  const compactCopies = [];
  const compactRenderer = { initTexture() {}, copyTextureToTexture: (source, _target, _region, position) => compactCopies.push({ token: source.image.token, position: position.toArray() }) };
  const beforeUv = Array.from(compact.array.geometry.attributes.coverTile.array.slice(8, 12));
  compact.setVisibleSlots([2, 0]);
  assert.equal(compact.array.count, 2);
  assert.deepEqual(Array.from(compact.array.geometry.attributes.coverTile.array.slice(0, 4)), beforeUv, 'Compaction keeps logical atlas ownership');
  compact.setFrameBudget(true);
  const requests = [{ slot: 2, record: record('compact-2') }, { slot: 0, record: record('compact-0') }];
  compact.prepareFrame(requests, 1, 1000);
  assert.equal(compact.getStats().lastPrepared, 1);
  assert.equal(compact.getStats().activeDecodes, 1, 'Prepare jobs stop at the per-frame count');
  compact.flushUploads(compactRenderer, 1, { prioritySlots: [2, 0], timeBudgetMs: 1000 });
  assert.equal(compact.array.geometry.attributes.coverReady.getX(0), 1);
  pending.get('cover-compact-2').resolve(); await flush();
  assert.equal(compact.getStats().pendingPaints, 1, 'Decode completion queues canvas work');
  compact.prepareFrame(requests, 1, 1000);
  compact.flushUploads(compactRenderer, 1, { prioritySlots: [2], timeBudgetMs: 1000 });
  assert.equal(compactCopies.at(-1).token, 'cover-compact-2');
  compact.setVisibleSlots([0, 2]);
  assert.equal(compact.array.geometry.attributes.coverReady.getX(1), 1, 'Ready state follows the logical slot');
  compact.prepareFrame([{ slot: 2, record: record('compact-new') }], 0, 1000);
  assert.equal(compact.array.geometry.attributes.coverReady.getX(1), 0, 'Planning hides stale art before deferred painting');
  assert.equal(compact.flushUploads(compactRenderer, 1, { prioritySlots: [2], timeBudgetMs: 1000 }), 0);
  compact.reset();
  assert.equal(compact.getStats().pendingPaints, 0);
  compact.dispose();
  const edge = new CoverAtlas(20, 4096, 1);
  const edgeCopies = [];
  const edgeRenderer = { initTexture() {}, copyTextureToTexture: (source, _target, _region, position) =>
    edgeCopies.push({ width: source.image.width, position: position.toArray() }) };
  for (const slot of [14, 15, 16, 17]) edge.setSlot(slot, { id: `edge-${slot}`, title: `Edge ${slot}` });
  assert.equal(edge.flushUploads(edgeRenderer, 4,
    { prioritySlots: [15, 14, 16, 17], timeBudgetMs: 1000, maxTransfers: 1 }), 2);
  assert.deepEqual(edgeCopies, [{ width: 512, position: [14 * 256, 256] }],
    'a strip includes the higher-priority tile but never crosses the atlas row');
  assert.equal(edge.array.geometry.attributes.coverReady.getX(16), 0);
  assert.equal(edge.flushUploads(edgeRenderer, 4,
    { prioritySlots: [16, 17], timeBudgetMs: 1000, maxTransfers: 1 }), 2);
  assert.deepEqual(edgeCopies[1], { width: 512, position: [0, 0] });
  edge.dispose();
  const speculative = new CoverAtlas(432, 8192, 8);
  speculative.prefetch(Array.from({ length: 100 }, (_, index) => record(`ahead-${index}`)), 3);
  assert.equal(speculative.getStats().activeDecodes, 2, 'prefetch leaves a decoder for selection');
  assert.ok(speculative.getStats().queuedDecodes <= 32, 'ahead queue is bounded before image allocation');
  assert.equal(speculative.getStats().dirtyTiles, 0, 'preloading never paints or uploads the atlas');
  const immediate = speculative.select(record('urgent-ahead'));
  assert.equal(speculative.getStats().activeDecodes, 3, 'selected art can begin without waiting for speculative decoders');
  assert.ok(pending.has('cover-urgent-ahead'));
  speculative.prefetch([record('fresh-plan')], 1);
  assert.equal(speculative.getStats().queuedDecodes, 1, 'old speculative queue is replaced');
  pending.get('cover-urgent-ahead').resolve(); await immediate;
  pending.get('cover-ahead-0').resolve(); pending.get('cover-ahead-1').resolve(); await flush();
  pending.get('cover-fresh-plan').resolve(); await flush();
  const warmed = decodes;
  await speculative.select(record('fresh-plan'));
  speculative.setSlot(0, record('fresh-plan'));
  assert.equal(decodes, warmed, 'predecoded detailed art serves selection and tile without a new decode');
  assert.equal(imageToken(speculative.selected.material.map), 'cover-fresh-plan');
  speculative.reset(); await flush();
  assert.equal(speculative.getStats().cachedBytes, 0);
  assert.equal(speculative.getStats().queuedDecodes, 0);
  speculative.dispose();
  // A repeated shelf references resident images, rather than copying one print
  // into every physical model slot. Warm rebinds work with a zero paint budget.
  const resident = new CoverAtlas(432, 8192, 1);
  const library = Array.from({ length: 114 }, (_, id) => ({ id: `loop-${id}`, title: `Loop ${id}` }));
  const residentRenderer = { initTexture() {}, copyTextureToTexture() {} };
  for (let slot = 0; slot < 432; slot++) resident.setSlot(slot, library[slot % library.length]);
  assert.equal(resident.getStats().dirtyTiles, 114);
  while (resident.getStats().dirtyTiles) resident.flushUploads(residentRenderer, 64);
  assert.equal(resident.getStats().uploadedTiles, 114, '432 model slots upload only 114 unique prints');
  const residentUvs = resident.array.geometry.attributes.coverTile;
  assert.equal(residentUvs.getX(114), residentUvs.getX(0));
  assert.equal(residentUvs.getY(114), residentUvs.getY(0));
  resident.prepareFrame(Array.from({ length: 432 }, (_, slot) =>
    ({ slot, record: library[(slot + 31) % library.length] })), 0, 0);
  assert.equal(resident.getStats().lastPrepared, 0);
  assert.equal(resident.flushUploads(residentRenderer), 0, 'a fully resident permutation needs no transfer');
  for (let slot = 0; slot < 432; slot++) assert.equal(resident.array.geometry.attributes.coverReady.getX(slot), 1);
  resident.setSlot(0, { ...library[31], id: 'another-playlist-wrapper' });
  assert.equal(resident.flushUploads(residentRenderer), 0, 'record IDs do not duplicate identical pixel inputs');
  resident.setVisibleSlots([114, 0]);
  assert.deepEqual(Array.from(resident.array.geometry.attributes.coverTile.array.slice(0, 4)),
    Array.from(resident.array.geometry.attributes.coverTile.array.slice(4, 8)), 'compaction preserves shared image UVs');
  resident.reset();
  assert.equal(resident.getStats().residentTiles, 0);
  assert.equal(resident.getStats().dirtyTiles, 0);
  resident.dispose();

  const bounded = new CoverAtlas(4, 4096, 1);
  const pinned = { id: 'pinned', title: 'Pinned' };
  for (const slot of [1, 2, 3]) bounded.setSlot(slot, pinned);
  bounded.flushUploads(residentRenderer);
  const pinnedUv = Array.from(bounded.array.geometry.attributes.coverTile.array.slice(4, 8));
  for (let id = 0; id < 100; id++) {
    bounded.setSlot(0, { id: `churn-${id}`, title: `Churn ${id}` });
    bounded.flushUploads(residentRenderer);
    assert.ok(bounded.getStats().residentTiles <= 4, 'residency never grows beyond the fixed atlas');
    assert.deepEqual(Array.from(bounded.array.geometry.attributes.coverTile.array.slice(4, 8)), pinnedUv);
    assert.equal(bounded.array.geometry.attributes.coverReady.getX(1), 1, 'referenced images cannot be evicted');
  }
  assert.ok(bounded.getStats().residentEvictions > 0);
  bounded.dispose();

  const evicted = new CoverAtlas(2, 4096, 1);
  evicted.setSlot(0, record('resident-old'));
  evicted.setSlot(1, record('resident-other'));
  evicted.setSlot(0, record('resident-new'));
  pending.get('cover-resident-new').resolve(); await flush();
  const newPixels = evicted.array.material.map.image.tiles.get('0,0');
  pending.get('cover-resident-old').resolve(); await flush();
  assert.equal(evicted.array.material.map.image.tiles.get('0,0'), newPixels, 'evicted asynchronous jobs cannot repaint a reused tile');
  assert.equal(newPixels, 'cover-resident-new');
  evicted.dispose();
  const sharedArt = new CoverAtlas(4, 4096, 1);
  sharedArt.setFrameBudget(true);
  const sharedRecord = record('resident-art');
  const beforeSharedDecode = decodes;
  sharedArt.setSlot(0, sharedRecord);
  sharedArt.setSlot(1, sharedRecord);
  assert.equal(decodes - beforeSharedDecode, 1, 'aliases share one image completion path');
  pending.get('cover-resident-art').resolve(); await flush();
  assert.equal(sharedArt.getStats().pendingPaints, 1);
  sharedArt.prepareFrame([{ slot: 1, record: sharedRecord }], 1, 1000);
  let sharedTransfers = 0;
  const sharedRenderer = { initTexture() {}, copyTextureToTexture(source) {
    assert.equal(source.image.token, 'cover-resident-art'); sharedTransfers++;
  } };
  assert.equal(sharedArt.flushUploads(sharedRenderer, 1,
    { prioritySlots: [1], timeBudgetMs: 1000 }), 1, 'logical priority follows the shared resident tile');
  assert.equal(sharedTransfers, 1);
  for (const slot of [0, 1]) assert.equal(sharedArt.array.geometry.attributes.coverReady.getX(slot), 1);
  sharedArt.setSlot(2, sharedRecord);
  assert.equal(sharedArt.array.geometry.attributes.coverReady.getX(2), 1, 'warm artwork is immediately ready at another model slot');
  assert.equal(sharedArt.flushUploads(sharedRenderer), 0);
  sharedArt.setVisibleSlots([1]);
  sharedArt.setSlot(1, { id: 'temporary', title: 'Temporary' });
  sharedArt.prepareFrame([{ slot: 1, record: sharedRecord }], 0, 0);
  assert.equal(sharedArt.array.geometry.attributes.coverReady.getX(0), 1, 'an unreferenced cached print survives leaving and returning');
  assert.equal(sharedArt.flushUploads(sharedRenderer, 1, { prioritySlots: [1], timeBudgetMs: 1000 }), 0,
    'offscreen dirty cache entries do not consume the visible upload budget');
  sharedArt.dispose();
  const burst = new CoverAtlas(16,4096,8);
  burst.setFrameBudget(true);
  const noArt={id:'no-art',title:'No art'}, loadingArt=record('burst-loading');
  burst.prepareFrame([{slot:0,record:noArt},{slot:1,record:loadingArt}],2,1000);
  await flush();
  let burstTransfers=0;
  const burstRenderer={initTexture(){},copyTextureToTexture(source){
    burstTransfers++;assert.equal(source.image.width,256,'strip merging must not include a deferred loading neighbour');
  }};
  const burstBudget={prioritySlots:[0,1],timeBudgetMs:1000,maxTransfers:1,deferLoading:true};
  assert.equal(burst.flushUploads(burstRenderer,4,burstBudget),1,'missing-art placeholder remains available while loading-art placeholder is deferred');
  pending.get('cover-burst-loading').resolve();await flush();
  burst.prepareFrame([{slot:1,record:loadingArt}],1,1000);
  assert.equal(burst.flushUploads(burstRenderer,4,burstBudget),1,'the real cover uploads as soon as prepared');
  assert.equal(burstTransfers,2);
  assert.equal(burst.getStats().uploadStaging.isolatedTileUploads,2,'new uploads use only small per-tile canvases');
  assert.equal(burst.getStats().uploadStaging.atlasFallbackTiles,0);
  burst.dispose();
  atlas.dispose();
  assert.equal(sharedDisposals, 1, 'atlas disposal owns exactly one shared texture disposal');
  console.log("Cover pipeline passed: shared UV/painter, bounded decode and ahead queue, warm focus art, stale prefetch cancellation, 48 MiB cache cap, partial uploads, recycled slot safety and reset/dispose.");
  console.log('Cover residency passed: 432 slots / 114 uploads, zero-upload warm permutations, shared UV compaction, bounded pinned cache and stale eviction safety. No browser or GPU used.');
  // Execute the production opening scheduler against the real atlas, with
  // deterministic canvas/HTTP-decode/GPU boundaries. Only 2/12 slots start
  // visible: covers for later wave/camera poses must still be GPU-ready.
  const sceneSource = await fs.readFile(new URL('../src/scene.ts', import.meta.url), 'utf8');
  const sceneTree = ts.createSourceFile('scene.ts', sceneSource, ts.ScriptTarget.Latest, true);
  const sceneClass = sceneTree.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'ArchiveScene');
  const method = sceneClass.members.find(n => n.name?.getText(sceneTree) === 'prepareIntroCovers');
  const schedulerCode = ts.transpileModule(`return {${method.getText(sceneTree)}};`, {
    compilerOptions: {target: ts.ScriptTarget.ES2022},
  }).outputText;
  async function openingPreparation({stalled = false, cancel = false} = {}) {
    const art = new CoverAtlas(12, 4096, 1);
    art.setVisibleSlots([0, 1]); art.setFrameBudget(true);
    const records = Array.from({length: 12}, (_, i) => record(`opening-${stalled}-${cancel}-${i}`));
    const requests = records.map((record, slot) => ({slot, record}));
    assert.equal(art.preparationState(requests).pending, 12, 'Not-yet-admitted slots count as pending');
    let now = 0, frames = 0, uploads = 0;
    const renderer = {initTexture(){}, copyTextureToTexture(){uploads++;}};
    const instance = {covers: art, renderer, disposed: false, container: {dataset: {}},
      cells: records.map((_, i) => i), actualCell: () => true};
    Object.assign(instance, new Function('records', 'fileAtCell', 'performance', schedulerCode)(records, i => i, {now: () => now}));
    await instance.prepareIntroCovers(async () => {
      frames++; now += 16;
      if (cancel) instance.disposed = true;
      if (!stalled) {
        for (const [key, job] of [...pending]) { pending.delete(key); job.resolve(); }
        for (let i = 0; i < 12; i++) await Promise.resolve();
      }
    });
    const state = art.preparationState(requests);
    if (cancel) {
      assert.equal(frames, 1); assert.equal(uploads, 0, 'Disposal before decode never uploads later');
    } else if (stalled) {
      assert.equal(frames, 1200, 'Stalled loading has a strict turn cap');
      assert.ok(state.pending > 0);
      assert.ok(JSON.parse(instance.container.dataset.introCoverPreparation).pending > 0,
        'Incomplete prewarming is reported honestly');
    } else {
      assert.equal(state.pending, 0, 'Decode, paint and upload all finish before the wave');
      assert.equal(state.failed, 0);
      assert.ok(uploads > 0 && frames > 1, 'Preparation yields between small transfer turns');
      art.setVisibleSlots([8, 9, 10, 11]);
      assert.equal(art.preparationState(requests.slice(8)).pending, 0,
        'Artwork entering the view later reuses the already prepared resident tiles');
    }
    art.dispose(); pending.clear();
    return {frames, uploads, ...state};
  }
  const openingReady = await openingPreparation();
  await openingPreparation({stalled: true}); await openingPreparation({cancel: true});
  console.log('Opening preparation (synthetic):', JSON.stringify(openingReady));
} finally {
  globalThis.document = previousDocument; globalThis.Image = previousImage;
}
