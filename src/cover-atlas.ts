import * as THREE from "three";
import type { MusicSelectionLighting } from "./music-lighting";
import type { ArchiveRecord } from "./data";
import { MUSIC_COVER, createAlbumPrintMaterial } from "./music-model.ts";
import type { CoverClarityState } from "./cover-clarity-pass";
import { SelectedCoverCache, type SelectedCover } from "./selected-cover-cache.ts";

// Paper insert inside the thin lid, shared by shelf, selection and viewer.
export const COVER_SIZE = MUSIC_COVER;
import {COVER_PAINT_SIZE, COVER_INSET, paintCover, type CoverImage} from './cover-painter.ts';
export {COVER_PAINT_SIZE, COVER_INSET, containCover, paintCover, type CoverImage} from './cover-painter.ts';
import {CoverPreparation} from './cover-preparation.ts';
type DecodedCoverImage = CoverImage & { decodedSize: number; pixels: number; preparedPixels?: Uint8ClampedArray<ArrayBuffer> };
type DecodeJob = { url: string; generation: number; size: number; priority: number; resolve: (image: DecodedCoverImage | undefined) => void; image?: HTMLImageElement };
type ResidentCover = {
  key: string; tile: number; slots: Set<number>; used: number;
  ready: boolean; hasImage: boolean; loading: boolean; failed: boolean;
};
/** Fixed-size resident image atlas; model slots share tiles by visual identity. */
export class CoverAtlas {
  readonly array: THREE.InstancedMesh;
  readonly selected: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private readonly atlasCanvas = document.createElement("canvas");
  private selectedCanvas = document.createElement("canvas");
  private readonly tileCanvas = document.createElement("canvas");
  private readonly uploadSources: { canvas: HTMLCanvasElement; texture: THREE.Texture }[] = [];
  private readonly uploadTiles = new Map<number, HTMLCanvasElement>();
  private readonly uploadTilePool: HTMLCanvasElement[] = [];
  private readonly uploadTileCapacity = 32;
  private isolatedTileUploads = 0;
  private atlasFallbackTiles = 0;
  // Diagnostic escape hatch for comparing the same scene without strip uploads.
  private readonly batchUploads = typeof window === "undefined" ||
    new URLSearchParams(window.location.search).get("coverBatch") !== "0";
  private readonly atlas: THREE.CanvasTexture;
  private selectedTexture: THREE.Texture;
  private selectedEntry?: SelectedCover;
  private readonly selectedCache = new SelectedCoverCache(COVER_PAINT_SIZE);
  private snapshotReuses = 0;
  private readonly pendingImages = new Map<string, Promise<DecodedCoverImage | undefined>>();
  private readonly decodedImages = new Map<string, DecodedCoverImage | undefined>();
  private readonly decodeJobs = new Map<string, DecodeJob>();
  private readonly decodeQueue: DecodeJob[] = [];
  private readonly activeJobs = new Set<DecodeJob>();
  // These indices address image tiles, independently of logical model slots.
  private readonly dirtySlots = new Set<number>();
  private readonly coverReady: THREE.InstancedBufferAttribute;
  private readonly sourceReady: Float32Array;
  private readonly sourceTiles: Float32Array;
  private readonly tileOffsets: Float32Array;
  private readonly slotTiles: Int32Array;
  private readonly tileResidents: (ResidentCover | undefined)[];
  private readonly residents = new Map<string, ResidentCover>();
  private residencyClock = 0;
  private residentReuses = 0;
  private residentReadyReuses = 0;
  private residentEvictions = 0;
  private readonly coverTiles: THREE.InstancedBufferAttribute;
  private readonly slotToInstance: Int32Array;
  private readonly renderSlots: number[];
  private readonly desiredKeys: (string | undefined)[];
  private frameBudget = false;
  private readonly pendingPaints = new Map<number, () => void>();
  private lastPrepared = 0;
  private lastPreparationMs = 0;
  private lastUploadMs = 0;
  private lastUploadLimit = 8;
  private gpuInitialized = false;
  private uploadedBytes = 0;
  private uploadBatches = 0;
  private uploadedTiles = 0;
  private uploadCalls = 0;
  private batchedTiles = 0;
  private peakDecodes = 0;
  private decodedPixels = 0;
  private readonly maxDecodeConcurrency = 3;
  private readonly maxDecodedPixels = 12 * 1024 * 1024;
  private readonly coverPreparation = new CoverPreparation();
  private prefetchRequests = 0;
  private prefetchHits = 0;
  private readonly slotKeys: (string | undefined)[];
  private readonly recordKeys = new WeakMap<ArchiveRecord, string>();
  private readonly paintedTiles = new Map<string, { source: WeakRef<CanvasImageSource>; canvas: HTMLCanvasElement }>();
  private selectedRecord?: ArchiveRecord;
  private selectedKey?: string;
  private generation = 0;
  private disposed = false;
  private readonly columns = 16;
  private readonly rows: number;
  private readonly tileWidth: number;
  private readonly tileHeight: number;

  constructor(count: number, maxTextureSize: number, anisotropy: number, lighting?: MusicSelectionLighting, backgroundTileSize = 256, clarity?: CoverClarityState) {
    this.rows = Math.ceil(count / this.columns);
    this.tileWidth = Math.min(
      Math.min(256, Math.max(64, backgroundTileSize)),
      Math.floor(maxTextureSize / this.columns),
      Math.floor(maxTextureSize / this.rows),
    );
    this.tileHeight = this.tileWidth;
    this.atlasCanvas.width = this.columns * this.tileWidth;
    this.atlasCanvas.height = this.rows * this.tileHeight;
    this.tileCanvas.width = this.tileWidth;
    this.tileCanvas.height = this.tileHeight;
    // Prepared strip sources avoid resizing a canvas during navigation. They
    // remain CPU-only and are never initialized as standalone GPU textures.
    for (let tiles = 1; tiles <= 4; tiles++) {
      const canvas = document.createElement("canvas");
      canvas.width = this.tileWidth * tiles;
      canvas.height = this.tileHeight;
      const texture = new THREE.Texture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      this.uploadSources.push({ canvas, texture });
    }
    this.selectedCanvas.width = COVER_PAINT_SIZE;
    this.selectedCanvas.height = COVER_PAINT_SIZE;
    this.slotKeys = Array(count);
    this.slotTiles = new Int32Array(count).fill(-1);
    this.tileResidents = Array(count);
    this.atlas = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    // No whole-atlas mip pyramid: independent transparent tile margins prevent bleed.
    this.atlas.generateMipmaps = false;
    this.atlas.minFilter = THREE.LinearFilter;
    // Atlas derivatives at steep shelf angles must not sample another tile.
    // Detailed selected art keeps anisotropic filtering on its own texture.
    this.atlas.anisotropy = 1;
    this.atlas.userData.maxAnisotropy = 1;
    this.selectedTexture = new THREE.CanvasTexture(this.selectedCanvas);
    this.selectedTexture.colorSpace = THREE.SRGBColorSpace;
    this.selectedTexture.anisotropy = Math.min(8, anisotropy);
    this.selectedTexture.userData.maxAnisotropy = 8;
    const geometry = new THREE.PlaneGeometry(
      COVER_SIZE.width,
      COVER_SIZE.height,
    ).translate(COVER_SIZE.x, COVER_SIZE.y, COVER_SIZE.z);
    const tileOffsets = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      tileOffsets.set(
        [
          (i % this.columns) / this.columns,
          1 - (Math.floor(i / this.columns) + 1) / this.rows,
          1 / this.columns,
          1 / this.rows,
        ],
        i * 4,
      );
    }
    this.tileOffsets = tileOffsets;
    this.sourceTiles = tileOffsets.slice();
    this.coverTiles = new THREE.InstancedBufferAttribute(tileOffsets.slice(), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("coverTile", this.coverTiles);
    this.sourceReady = new Float32Array(count);
    this.slotToInstance = Int32Array.from({ length: count }, (_, i) => i);
    this.renderSlots = Array.from({ length: count }, (_, i) => i);
    this.desiredKeys = new Array(count);
    this.coverReady = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.coverReady.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("coverReady", this.coverReady);
    // Instances, selected art and snapshots use one matte diffuse material and
    // one moving light field; no ownership-specific brightness/scale switches.
    const makePrint = (texture: THREE.Texture, selected = false) => {
      const print = createAlbumPrintMaterial(texture);
      const compile = print.onBeforeCompile;
      print.onBeforeCompile = (shader, renderer) => {
        compile.call(print, shader, renderer);
        lighting?.shadePrint(shader);
        clarity?.bind(shader, selected);
      };
      print.customProgramCacheKey = () => `album-diffuse-print-${Boolean(lighting)}-${Boolean(clarity)}-${selected}-v6`;
      return print;
    };
    const material = makePrint(this.atlas);
    const compileAtlas = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      compileAtlas.call(material, shader, renderer);
      shader.vertexShader = "attribute vec4 coverTile;\nattribute float coverReady;\nvarying float vCoverReady;\nvarying vec4 vCoverTile;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nvCoverReady = coverReady;\nvCoverTile = coverTile;\nvMapUv = coverTile.xy + uv * coverTile.zw;",
      );
      shader.uniforms.coverAtlasTexel = { value: new THREE.Vector2(1 / this.atlasCanvas.width, 1 / this.atlasCanvas.height) };
      shader.fragmentShader = "varying float vCoverReady;\nvarying vec4 vCoverTile;\nuniform vec2 coverAtlasTexel;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>",
        "if (vCoverReady < 0.5) discard;\n" + THREE.ShaderChunk.map_fragment.replace("texture2D( map, vMapUv )", "texture2D( map, clamp(vMapUv, vCoverTile.xy + coverAtlasTexel * 0.5, vCoverTile.xy + vCoverTile.zw - coverAtlasTexel * 0.5) )"));
    };
    material.customProgramCacheKey = () => `album-diffuse-atlas-${Boolean(lighting)}-${Boolean(clarity)}-v5`;
    this.array = new THREE.InstancedMesh(geometry, material, count);
    this.array.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.array.frustumCulled = false;
    this.array.visible = false;
    this.array.name = "Album cover atlas";
    this.array.userData.albumCover = true;
    this.array.receiveShadow = true;
    this.selected = new THREE.Mesh(
      new THREE.PlaneGeometry(COVER_SIZE.width, COVER_SIZE.height).translate(
        COVER_SIZE.x,
        COVER_SIZE.y,
        COVER_SIZE.z,
      ),
      makePrint(this.selectedTexture, true),
    );
    this.selected.userData.albumCover = true;
    this.selected.visible = false;
    this.selected.name = "Selected album cover";
    // A transmitting lid must not cast an opaque self-shadow across the insert.
    this.selected.receiveShadow = false;
  }

  private cachedImage(url?: string) {
    if (!url || !this.decodedImages.has(url)) return undefined;
    const image = this.decodedImages.get(url);
    this.decodedImages.delete(url);
    this.decodedImages.set(url, image);
    return image;
  }

  private loadImage(url?: string, priority = false, urgent = true) {
    if (!url) return Promise.resolve(undefined);
    if (this.disposed) return Promise.resolve(undefined);
    const size = priority ? COVER_PAINT_SIZE : this.tileWidth;
    if (this.decodedImages.has(url)) {
      const cached = this.cachedImage(url);
      if (!cached || cached.decodedSize >= Math.min(size, Math.max(cached.width, cached.height))) return Promise.resolve(cached);
    }
    let pending = this.pendingImages.get(url);
    if (pending) {
      const job = this.decodeJobs.get(url);
      if (job && (priority || urgent)) {
        job.size = Math.max(job.size, size);
        job.priority = Math.max(job.priority, urgent ? (priority ? 2 : 1) : 0);
        this.decodeQueue.sort((a, b) => b.priority - a.priority);
      }
      return pending;
    }
    let resolve!: DecodeJob["resolve"];
    pending = new Promise<DecodedCoverImage | undefined>((done) => { resolve = done; });
    const job: DecodeJob = { url, generation: this.generation, size, priority: urgent ? (priority ? 2 : 1) : 0, resolve };
    this.pendingImages.set(url, pending);
    this.decodeJobs.set(url, job);
    this.decodeQueue.push(job);
    this.decodeQueue.sort((a, b) => b.priority - a.priority);
    this.pumpDecodes();
    return pending;
  }

  private pumpDecodes() {
    while (!this.disposed && this.activeJobs.size < this.maxDecodeConcurrency && this.decodeQueue.length) {
      // Speculative work leaves a decoder available for a newly selected song.
      if (this.decodeQueue[0].priority === 0 && this.activeJobs.size >= 2) break;
      const job = this.decodeQueue.shift()!;
      this.activeJobs.add(job);
      this.peakDecodes = Math.max(this.peakDecodes, this.activeJobs.size);
      const legacy = (): Promise<DecodedCoverImage | undefined> => {
        const image=new Image();job.image=image;image.crossOrigin='anonymous';image.src=job.url;
        return image.decode().then(()=>{
          if(this.disposed||job.generation!==this.generation)return undefined;
          const width=image.naturalWidth,height=image.naturalHeight,scale=Math.min(1,job.size/Math.max(width,height));
          const source=document.createElement('canvas');source.width=Math.max(1,Math.round(width*scale));source.height=Math.max(1,Math.round(height*scale));
          source.getContext('2d',{willReadFrequently:true})!.drawImage(image,0,0,source.width,source.height);
          return {source,width,height,decodedSize:Math.max(source.width,source.height),pixels:source.width*source.height};
        });
      };
      const requested=job.size;
      const decoding=this.coverPreparation.available
        ? this.coverPreparation.prepareUrl(job.url,requested,requested===COVER_PAINT_SIZE).then(async prepared=>{
            // Priority can rise while fetching. One monotonic thumbnail-to-full
            // upgrade prevents a thumbnail becoming the final selected image.
            if(job.size>requested && !this.disposed && job.generation===this.generation)
              prepared=await this.coverPreparation.prepareUrl(job.url,job.size,job.size===COVER_PAINT_SIZE);
            if(this.disposed||job.generation!==this.generation)return undefined;
            if(!prepared)return legacy();
            const source=document.createElement('canvas');source.width=prepared.sourceWidth;source.height=prepared.sourceHeight;
            source.getContext('2d',{willReadFrequently:true})!.putImageData(new ImageData(prepared.sourcePixels,source.width,source.height),0,0);
            return {source,width:prepared.width,height:prepared.height,decodedSize:Math.max(source.width,source.height),preparedPixels:prepared.coverPixels,
              pixels:source.width*source.height+(prepared.coverPixels?.length||0)/4};
          }) : legacy();
      void decoding
        .catch(() => undefined)
        .then((decoded) => {
          if(job.image)job.image.src = "";
          this.activeJobs.delete(job);
          if (!this.disposed && job.generation === this.generation) {
            this.decodedPixels -= this.decodedImages.get(job.url)?.pixels ?? 0;
            this.decodedImages.delete(job.url);
            this.decodedImages.set(job.url, decoded);
            this.decodedPixels += decoded?.pixels ?? 0;
            while (this.decodedImages.size > 192 || this.decodedPixels > this.maxDecodedPixels) {
              const first = this.decodedImages.keys().next().value!;
              this.decodedPixels -= this.decodedImages.get(first)?.pixels ?? 0;
              this.decodedImages.delete(first);
            }
          }
          if (this.decodeJobs.get(job.url) === job) {
            this.decodeJobs.delete(job.url);
            this.pendingImages.delete(job.url);
          }
          job.resolve(this.disposed || job.generation !== this.generation ? undefined : decoded);
          this.pumpDecodes();
        });
    }
  }

  private recordKey(record: ArchiveRecord | undefined) {
    // Description/metadata refreshes replace record objects without changing
    // their print. Cache only the visual identity, not the object reference.
    let key = record ? this.recordKeys.get(record) : "";
    if (record && key === undefined) {
      // Playlist wrappers can give the same song different record IDs. Only
      // the cover URL and fallback title affect the pixels painted here.
      key = JSON.stringify([record.album?.coverUrl, record.title]);
      this.recordKeys.set(record, key);
    }
    return key!;
  }

  /** Decode ahead without painting/uploading the entire atlas. A focus-first
   * plan replaces stale speculative queue entries; urgent draws are retained. */
  prefetch(records: readonly (ArchiveRecord | undefined)[], detailed = 0) {
    if (this.disposed) return;
    const plan = records.slice(0, 192);
    const wanted = new Set(plan.map(record => record?.album?.coverUrl).filter(Boolean));
    for (let i = this.decodeQueue.length - 1; i >= 0; i--) {
      const job = this.decodeQueue[i];
      if (job.priority || wanted.has(job.url)) continue;
      this.decodeQueue.splice(i, 1);
      if (this.decodeJobs.get(job.url) === job) {
        this.decodeJobs.delete(job.url); this.pendingImages.delete(job.url);
      }
      job.resolve(undefined);
    }
    const seen = new Set<string>();
    for (let i = 0; i < plan.length; i++) {
      const url = plan[i]?.album?.coverUrl;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const high = i < detailed, size = high ? COVER_PAINT_SIZE : this.tileWidth;
      const cached = this.cachedImage(url);
      if (cached && cached.decodedSize >= Math.min(size, Math.max(cached.width, cached.height))) { this.prefetchHits++; continue; }
      if (this.decodeQueue.length >= 32 && !this.pendingImages.has(url)) break;
      this.prefetchRequests++; void this.loadImage(url, high, false);
    }
    // A background scan must not age the upcoming detailed prints simply
    // because they were inspected first in the focus-priority plan.
    for (let i = Math.min(detailed, plan.length) - 1; i >= 0; i--)
      this.cachedImage(plan[i]?.album?.coverUrl);
  }

  private copyCover(canvas: HTMLCanvasElement, key: string) {
    const selected = this.selectedKey === key && canvas !== this.selectedCanvas;
    const tile = selected ? -1 : this.residents.get(key)?.tile;
    if (!selected && tile === undefined) return false;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    // Copy the whole painted tile, including its UV inset, exactly once.
    if (selected) context.drawImage(this.selectedCanvas, 0, 0, canvas.width, canvas.height);
    else context.drawImage(
      this.atlasCanvas,
      (tile! % this.columns) * this.tileWidth,
      Math.floor(tile! / this.columns) * this.tileHeight,
      this.tileWidth, this.tileHeight,
      0, 0, canvas.width, canvas.height,
    );
    return true;
  }

  private paintTile(key: string, record: ArchiveRecord | undefined, image: CoverImage) {
    const cacheKey = record?.album?.coverUrl || key, cached = this.paintedTiles.get(cacheKey);
    if (cached?.source.deref() === image.source) {
      this.paintedTiles.delete(cacheKey); this.paintedTiles.set(cacheKey, cached);
      const context = this.tileCanvas.getContext('2d', { willReadFrequently: true })!;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, this.tileWidth, this.tileHeight);
      context.drawImage(cached.canvas, 0, 0); return;
    }
    paintCover(this.tileCanvas, record, image);
    const canvas = cached?.canvas || document.createElement('canvas');
    canvas.width = this.tileWidth; canvas.height = this.tileHeight;
    canvas.getContext('2d', { willReadFrequently: true })!.drawImage(this.tileCanvas, 0, 0);
    this.paintedTiles.delete(cacheKey);
    // Weak source identity avoids retaining decoded images beyond their existing budget.
    this.paintedTiles.set(cacheKey, { source: new WeakRef(image.source), canvas });
    while (this.paintedTiles.size > 32) {
      const oldest = this.paintedTiles.keys().next().value!;
      const retired = this.paintedTiles.get(oldest)!;
      retired.canvas.width = retired.canvas.height = 1; this.paintedTiles.delete(oldest);
    }
  }

  setSlot(slot: number, record: ArchiveRecord | undefined) {
    if (this.disposed) return;
    const key = this.recordKey(record);
    this.desiredKeys[slot] = key;
    if (this.slotKeys[slot] === key) return;
    this.releaseResident(slot);
    let entry = this.residents.get(key);
    if (entry) {
      entry.used = ++this.residencyClock;
      this.residentReuses++;
      if (entry.ready) this.residentReadyReuses++;
      this.bindResident(slot, entry);
      if (entry.failed && record?.album?.coverUrl && !this.decodedImages.has(record.album.coverUrl)) entry.failed = false;
      this.loadResidentImage(entry, record);
      return;
    }
    const image = this.cachedImage(record?.album?.coverUrl);
    // Selected art can seed a newly resident tile before background decoding.
    if (!image && !this.copyCover(this.tileCanvas, key)) paintCover(this.tileCanvas, record);
    // At most one binding per model slot means releasing this slot always
    // leaves an unreferenced tile when the cache is full. Live aliases pin it.
    let tile = slot;
    if (this.tileResidents[tile]) {
      tile = this.tileResidents.findIndex(candidate => !candidate);
      if (tile < 0) {
        let oldest = Infinity;
        for (const candidate of this.residents.values()) {
          if (!candidate.slots.size && candidate.used < oldest) { tile = candidate.tile; oldest = candidate.used; }
        }
      }
    }
    if (tile < 0) return;
    const retired = this.tileResidents[tile];
    if (retired) { this.residents.delete(retired.key); this.residentEvictions++; }
    this.dirtySlots.delete(tile);
    this.pendingPaints.delete(tile);
    entry = { key, tile, slots: new Set(), used: ++this.residencyClock,
      ready: false, hasImage: false, loading: false, failed: false };
    this.residents.set(key, entry);
    this.tileResidents[tile] = entry;
    this.bindResident(slot, entry);
    this.paintResident(entry, record, image);
    this.loadResidentImage(entry, record);
  }

  private releaseResident(slot: number) {
    const tile = this.slotTiles[slot];
    if (tile >= 0) this.tileResidents[tile]?.slots.delete(slot);
    this.slotTiles[slot] = -1;
    this.slotKeys[slot] = undefined;
    this.setReady(slot, 0);
  }

  private bindResident(slot: number, entry: ResidentCover) {
    this.slotKeys[slot] = entry.key;
    this.slotTiles[slot] = entry.tile;
    entry.slots.add(slot);
    const uv = this.tileOffsets.subarray(entry.tile * 4, entry.tile * 4 + 4);
    this.sourceTiles.set(uv, slot * 4);
    const instance = this.slotToInstance[slot];
    if (instance >= 0) {
      (this.coverTiles.array as Float32Array).set(uv, instance * 4);
      this.coverTiles.needsUpdate = true;
    }
    this.setReady(slot, entry.ready ? 1 : 0);
  }

  private paintResident(entry: ResidentCover, record: ArchiveRecord | undefined, image?: CoverImage) {
    if (image) this.paintTile(entry.key, record, image);
    const x = (entry.tile % this.columns) * this.tileWidth,
      y = Math.floor(entry.tile / this.columns) * this.tileHeight;
    const context = this.atlasCanvas.getContext("2d", { willReadFrequently: true })!;
    context.clearRect(x, y, this.tileWidth, this.tileHeight);
    context.drawImage(this.tileCanvas, x, y);
    // Keep a bounded small source for transfer. Cropping the large atlas at
    // upload time can force its entire backing surface through the driver.
    let upload = this.uploadTiles.get(entry.tile);
    if (!upload) {
      upload = this.uploadTilePool.pop();
      if (!upload && this.uploadTiles.size >= this.uploadTileCapacity) {
        const oldest = this.uploadTiles.keys().next().value!;
        upload = this.uploadTiles.get(oldest)!; this.uploadTiles.delete(oldest);
      }
      if (!upload) {
        upload = document.createElement("canvas"); upload.width = this.tileWidth; upload.height = this.tileHeight;
      }
    }
    const uploadContext = upload.getContext("2d", { willReadFrequently: true })!;
    uploadContext.clearRect(0, 0, this.tileWidth, this.tileHeight);
    uploadContext.drawImage(this.tileCanvas, 0, 0);
    this.uploadTiles.delete(entry.tile); this.uploadTiles.set(entry.tile, upload);
    entry.hasImage = Boolean(image);
    this.dirtySlots.add(entry.tile);
  }

  private loadResidentImage(entry: ResidentCover, record: ArchiveRecord | undefined) {
    if (entry.hasImage || entry.loading || entry.failed) return;
    const generation = this.generation, url = record?.album?.coverUrl;
    entry.loading = true;
    void this.loadImage(url).then(loaded => {
      if (this.disposed || generation !== this.generation || this.residents.get(entry.key) !== entry) return;
      if (!loaded) { entry.loading = false; entry.failed = true; return; }
      const paint = this.residentPaintJob(entry, record, url, generation);
      if (this.frameBudget) this.pendingPaints.set(entry.tile, paint);
      else paint();
    });
  }

  private residentPaintJob(entry: ResidentCover, record: ArchiveRecord | undefined, url: string | undefined, generation: number) {
    // This separate closure receives no decoded pixels from the completion
    // callback. Waiting jobs use only the existing bounded image LRU.
    return () => {
      if (this.disposed || generation !== this.generation || this.residents.get(entry.key) !== entry) return;
      entry.loading = false;
      const image = this.cachedImage(url);
      if (image) this.paintResident(entry, record, image);
    };
  }

  private setReady(slot: number, ready: number) {
    this.sourceReady[slot] = ready;
    const instance = this.slotToInstance[slot];
    if (instance >= 0) { this.coverReady.setX(instance, ready); this.coverReady.needsUpdate = true; }
  }

  /** Visible model slots pin shared tiles; offscreen prints remain evictable. */
  setVisibleSlots(slots: readonly number[]) {
    this.array.count = slots.length;
    if (slots.length === this.renderSlots.length && slots.every((slot, i) => slot === this.renderSlots[i])) return;
    this.slotToInstance.fill(-1);
    const visible = new Set(slots);
    for (const slot of this.renderSlots) if (!visible.has(slot)) this.releaseResident(slot);
    this.renderSlots.length = 0;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      this.renderSlots.push(slot); this.slotToInstance[slot] = i;
      (this.coverTiles.array as Float32Array).set(this.sourceTiles.subarray(slot * 4, slot * 4 + 4), i * 4);
      this.coverReady.setX(i, this.sourceReady[slot]);
    }
    this.coverTiles.needsUpdate = true; this.coverReady.needsUpdate = true;
  }

  setFrameBudget(enabled: boolean) { this.frameBudget = enabled; }

  /** Planning invalidates stale prints immediately. Canvas preparation happens
   * only for visible slots, in focus order, and yields between bounded frames. */
  prepareFrame(requests: readonly { slot: number; record: ArchiveRecord | undefined }[], maxJobs: number, timeBudgetMs: number) {
    const start = performance.now();
    let prepared = 0;
    for (const { slot, record } of requests) {
      const key = this.recordKey(record);
      this.desiredKeys[slot] = key;
      if (this.slotKeys[slot] !== key) {
        this.setReady(slot, 0);
        // Warm images require only UV/ownership changes, not a canvas paint
        // job; do not make them wait behind the per-frame painting budget.
        if (this.residents.has(key)) this.setSlot(slot, record);
      }
    }
    for (const { slot, record } of requests) {
      if (prepared >= maxJobs || (prepared && performance.now() - start >= timeBudgetMs)) break;
      if (this.slotKeys[slot] !== this.desiredKeys[slot]) {
        this.setSlot(slot, record); prepared++;
      } else {
        const tile = this.slotTiles[slot];
        const paint = this.pendingPaints.get(tile);
        if (paint) { this.pendingPaints.delete(tile); paint(); prepared++; }
        const entry = this.tileResidents[tile];
        if (entry) this.loadResidentImage(entry, record);
      }
    }
    this.lastPrepared = prepared; this.lastPreparationMs = performance.now() - start;
  }

  /** Includes requests not yet admitted by prepareFrame, and decoded images
   * still waiting for their bounded paint/upload turn. No pixels are read. */
  preparationState(requests: readonly { slot: number; record: ArchiveRecord | undefined }[]) {
    let pending = 0, failed = 0;
    for (const { slot, record } of requests) {
      const key = this.recordKey(record), entry = this.residents.get(key);
      if (!entry || this.slotKeys[slot] !== key || entry.loading ||
        this.pendingPaints.has(entry.tile) || this.dirtySlots.has(entry.tile) || !entry.ready) pending++;
      if (entry?.failed && record?.album?.coverUrl) failed++;
    }
    return { requested: requests.length, pending, failed };
  }

  async select(record: ArchiveRecord | undefined) {
    this.selectedRecord = record;
    const key = this.recordKey(record);
    if (this.selectedKey === key) return;
    const generation = this.generation;
    const cached = this.cachedImage(record?.album?.coverUrl);
    const entry = this.selectedCache.acquire(key, canvas => {
      if (cached) paintCover(canvas, record, cached);
      else if (!this.copyCover(canvas, key)) paintCover(canvas, record);
      return cached?.decodedSize ?? 0;
    }, this.selectedTexture.anisotropy, cached?.preparedPixels ? {pixels:cached.preparedPixels,decodedSize:cached.decodedSize} : undefined);
    if (this.selectedEntry) this.selectedCache.release(this.selectedEntry);
    else { this.selectedTexture.dispose(); this.selectedCanvas.width = this.selectedCanvas.height = 1; }
    this.selectedEntry = entry; this.selectedCanvas = entry.canvas; this.selectedTexture = entry.texture;
    this.selected.material.map = entry.texture;
    if (cached && cached.decodedSize > entry.decodedSize) {
      this.installSelectedImage(entry,record,cached);
    }
    this.selectedKey = key;
    // A GPU-ready selected image can survive eviction from the decoded-image
    // LRU. Revisit it without painting, decoding, or uploading the same art.
    if (entry.decodedSize >= COVER_PAINT_SIZE ||
      (cached && cached.decodedSize >= Math.min(COVER_PAINT_SIZE, Math.max(cached.width, cached.height)))) return;
    const image = await this.loadImage(record?.album?.coverUrl, true);
    if (
      !image ||
      this.disposed ||
      generation !== this.generation ||
      this.selectedKey !== key || this.selectedEntry !== entry
    )
      return;
    if (image.decodedSize > entry.decodedSize) {
      this.installSelectedImage(entry,record,image);
    }
  }

  snapshot(mesh: THREE.Mesh, reuseMaterial = false) {
    if (this.selectedEntry) {
      const entry = this.selectedEntry;
      this.selectedCache.retain(entry); this.snapshotReuses++;
      if (!reuseMaterial || !mesh.userData.returningCoverMaterial) mesh.material = this.selected.material.clone();
      mesh.userData.returningCoverMaterial = true;
      const material = mesh.material as THREE.MeshLambertMaterial;
      material.onBeforeCompile = this.selected.material.onBeforeCompile;
      material.customProgramCacheKey = this.selected.material.customProgramCacheKey;
      material.map = entry.texture;
      mesh.userData.coverDisposed = false;
      let released = false;
      mesh.userData.coverRelease = () => {
        if (released) return; released = true; this.selectedCache.release(entry);
      };
      // If the selected image was still decoding, only owners of this same
      // identity are upgraded; no snapshot-sized canvas/texture is copied.
      const record = this.selectedRecord, generation = this.generation;
      if (entry.decodedSize < COVER_PAINT_SIZE) void this.loadImage(record?.album?.coverUrl, true).then(image => {
        if (!image || released || this.disposed || generation !== this.generation || image.decodedSize <= entry.decodedSize) return;
        this.installSelectedImage(entry,record,image);
      });
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = this.selectedCanvas.width;
    canvas.height = this.selectedCanvas.height;
    canvas.getContext("2d", { willReadFrequently: true })!.drawImage(this.selectedCanvas, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.selectedTexture.anisotropy;
    mesh.material = this.selected.material.clone();
    mesh.material.onBeforeCompile = this.selected.material.onBeforeCompile;
    mesh.material.customProgramCacheKey = this.selected.material.customProgramCacheKey;
    (mesh.material as THREE.MeshLambertMaterial).map = texture;
    const record = this.selectedRecord;
    mesh.userData.coverDisposed = false;
    void this.loadImage(record?.album?.coverUrl, true).then((image) => {
      if (!image || mesh.userData.coverDisposed || this.disposed) return;
      paintCover(canvas, record, image);
      texture.needsUpdate = true;
    });
  }

  releaseSnapshot(mesh: THREE.Mesh) {
    if (typeof mesh.userData.coverRelease !== "function") return;
    mesh.userData.coverDisposed = true; mesh.userData.coverRelease(); delete mesh.userData.coverRelease;
    (mesh.material as THREE.MeshLambertMaterial).map = null;
  }
  private installSelectedImage(entry: SelectedCover, record: ArchiveRecord | undefined, image: DecodedCoverImage) {
    if(image.preparedPixels)this.selectedCache.refreshPrepared(entry,image.preparedPixels);
    else {paintCover(entry.canvas,record,image);this.selectedCache.refresh(entry);}
    entry.decodedSize=image.decodedSize;
  }

  /** Upload adjacent dirty tiles as short row strips; bound both pixels and calls. */
  flushUploads(renderer: THREE.WebGLRenderer, maxTiles = 8, budget?: { prioritySlots: readonly number[]; timeBudgetMs: number; maxTransfers?: number; deferLoading?: boolean }) {
    const start = performance.now();
    if (!this.frameBudget) {
      let painted = 0;
      for (const [slot, paint] of this.pendingPaints) {
        this.pendingPaints.delete(slot); paint();
        if (++painted >= 8 || performance.now() - start >= 2) break;
      }
    }
    if (this.disposed || !this.dirtySlots.size) { this.lastUploadMs = 0; return 0; }
    if (!this.gpuInitialized) {
      // Allocate immutable GPU storage without synchronously uploading the
      // full CPU canvas. Subsequent slots arrive through texSubImage2D copies.
      this.atlas.source.dataReady = false;
      try { renderer.initTexture(this.atlas); this.gpuInitialized = true; }
      finally { this.atlas.source.dataReady = true; }
    }
    const destination = new THREE.Vector2();
    let uploaded = 0;
    let transfers = 0;
    const limit = Math.max(1, Math.min(64, Math.floor(maxTiles) || 8));
    this.lastUploadLimit = limit;
    // Priority is expressed in model slots; uploads address resident image tiles.
    const candidates = budget ? new Set(budget.prioritySlots
      .filter(slot => this.slotKeys[slot] === this.desiredKeys[slot] && this.slotTiles[slot] >= 0)
      .map(slot => this.slotTiles[slot])) : this.dirtySlots;
    const eligible = budget?.deferLoading ? new Set([...candidates].filter(tile => {
      const resident = this.tileResidents[tile]; return !resident?.loading || resident.hasImage;
    })) : candidates;
    const transferLimit = Math.max(1, Math.floor(budget?.maxTransfers ?? limit));
    for (const slot of eligible) {
      if (!this.dirtySlots.has(slot)) continue;
      const resident = this.tileResidents[slot];
      // During a selection burst, don't transfer a temporary placeholder just
      // before the real cover arrives. Failed/no-art covers still upload.
      if (budget?.deferLoading && resident?.loading && !resident.hasImage) continue;
      const row = Math.floor(slot / this.columns);
      let first = slot, last = slot;
      const maxStrip = this.batchUploads ? Math.min(this.uploadSources.length, limit - uploaded) : 1;
      while (last - first + 1 < maxStrip && first > row * this.columns &&
        eligible.has(first - 1) && this.dirtySlots.has(first - 1)) first--;
      while (last - first + 1 < maxStrip && last + 1 < Math.min((row + 1) * this.columns, this.slotKeys.length) &&
        eligible.has(last + 1) && this.dirtySlots.has(last + 1)) last++;
      const count = last - first + 1;
      const x = (first % this.columns) * this.tileWidth;
      const y = row * this.tileHeight;
      const source = this.uploadSources[count - 1];
      const context = source.canvas.getContext("2d", { willReadFrequently: true })!;
      context.clearRect(0, 0, source.canvas.width, source.canvas.height);
      let isolated = 0, fallback = 0;
      for (let next = first; next <= last; next++) {
        const tileSource = this.uploadTiles.get(next), offset = (next - first) * this.tileWidth;
        if (tileSource) { context.drawImage(tileSource, offset, 0); isolated++; }
        else {
          // An older dirty tile may have left the bounded staging cache. Its
          // authoritative atlas pixels remain valid; correctness never depends
          // on retaining an unbounded set of additional canvas sources.
          context.drawImage(this.atlasCanvas, (next % this.columns) * this.tileWidth, y,
            this.tileWidth, this.tileHeight, offset, 0, this.tileWidth, this.tileHeight);
          fallback++;
        }
      }
      // Canvas rows run downwards; WebGL destination origins run upwards.
      destination.set(x, this.atlasCanvas.height - y - this.tileHeight);
      renderer.copyTextureToTexture(source.texture, this.atlas, null, destination);
      this.isolatedTileUploads += isolated; this.atlasFallbackTiles += fallback;
      for (let next = first; next <= last; next++) {
        this.dirtySlots.delete(next);
        const tileSource = this.uploadTiles.get(next);
        if (tileSource) { this.uploadTiles.delete(next); this.uploadTilePool.push(tileSource); }
        const entry = this.tileResidents[next];
        if (entry) {
          entry.ready = true;
          for (const bound of entry.slots) {
            if (this.desiredKeys[bound] === entry.key) this.setReady(bound, 1);
          }
        }
      }
      this.uploadedBytes += count * this.tileWidth * this.tileHeight * 4;
      this.uploadedTiles += count;
      this.batchedTiles += count > 1 ? count : 0;
      this.uploadCalls++;
      uploaded += count;
      if (++transfers >= transferLimit || uploaded >= limit ||
        (budget && performance.now() - start >= budget.timeBudgetMs)) break;
    }
    if (uploaded) { this.coverReady.needsUpdate = true; this.uploadBatches++; }
    this.lastUploadMs = performance.now() - start;
    return uploaded;
  }

  /** Bounded wait for the currently visible requests; no whole-library preload. */
  async prepareVisible(timeoutMs = 1200) {
    const pending = [...this.pendingImages.values()];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = !pending.length || await Promise.race([
      Promise.all(pending).then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), Math.max(0, Math.min(3000, timeoutMs))); }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    return { settled, ...this.getStats() };
  }

  getStats() {
    return {
      atlasWidth: this.atlasCanvas.width, atlasHeight: this.atlasCanvas.height,
      atlasBytes: this.atlasCanvas.width * this.atlasCanvas.height * 4,
      tileWidth: this.tileWidth, tileHeight: this.tileHeight,
      activeDecodes: this.activeJobs.size, queuedDecodes: this.decodeQueue.length,
      pendingImages: this.pendingImages.size, peakDecodes: this.peakDecodes,
      cachedImages: this.decodedImages.size, cachedBytes: this.decodedPixels * 4,
      cacheLimitBytes: this.maxDecodedPixels * 4, cacheLimitImages: 192,
      prefetchRequests: this.prefetchRequests, prefetchHits: this.prefetchHits,
      prefetchQueueLimit: 32,
      preparedTiles: this.paintedTiles.size, preparedTileBytes: this.paintedTiles.size * this.tileWidth * this.tileHeight * 4,
      dirtyTiles: this.dirtySlots.size, uploadedTiles: this.uploadedTiles,
      uploadCalls: this.uploadCalls, batchedTiles: this.batchedTiles,
      batchUploads: this.batchUploads,
      residentTiles: this.residents.size, residentCapacity: this.slotTiles.length,
      residentReuses: this.residentReuses, residentReadyReuses: this.residentReadyReuses,
      residentEvictions: this.residentEvictions,
      selectedCovers: { ...this.selectedCache.stats(), snapshotReuses: this.snapshotReuses },
      preparationWorker:this.coverPreparation.stats(),
      uploadStaging: { tiles: this.uploadTiles.size, capacity: this.uploadTileCapacity,
        bytes: (this.uploadTiles.size + this.uploadTilePool.length) * this.tileWidth * this.tileHeight * 4,
        isolatedTileUploads: this.isolatedTileUploads, atlasFallbackTiles: this.atlasFallbackTiles },
      uploadedBytes: this.uploadedBytes, uploadBatches: this.uploadBatches,
      gpuInitialized: this.gpuInitialized,
      visiblePrints: this.renderSlots.length, frameBudget: this.frameBudget,
      pendingPaints: this.pendingPaints.size, lastPrepared: this.lastPrepared,
      lastPreparationMs: +this.lastPreparationMs.toFixed(2), lastUploadMs: +this.lastUploadMs.toFixed(2),
      lastUploadLimit: this.lastUploadLimit,
    };
  }

  private cancelDecodes() {
    this.coverPreparation.cancel();
    for (const job of this.decodeQueue.splice(0)) job.resolve(undefined);
    for (const job of this.activeJobs) { job.resolve(undefined); if (job.image) job.image.src = ""; }
    this.pendingImages.clear();
    this.decodeJobs.clear();
    this.decodedImages.clear();
    this.decodedPixels = 0;
    for (const { canvas } of this.paintedTiles.values()) canvas.width = canvas.height = 1;
    this.paintedTiles.clear();
  }

  reset() {
    this.generation++;
    this.slotKeys.fill(undefined);
    this.slotTiles.fill(-1);
    this.tileResidents.fill(undefined);
    this.residents.clear();
    this.sourceTiles.set(this.tileOffsets);
    this.selectedRecord = undefined;
    this.selectedKey = undefined;
    // Current texture stays pinned until the next select. The other idle
    // entries remain bounded, and stale decode completions are generation gated.
    this.cancelDecodes();
    this.dirtySlots.clear();
    this.uploadTilePool.push(...this.uploadTiles.values()); this.uploadTiles.clear();
    this.pendingPaints.clear(); this.desiredKeys.fill(undefined); this.sourceReady.fill(0);
    this.coverReady.array.fill(0);
    this.coverReady.needsUpdate = true;
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.cancelDecodes();
    this.coverPreparation.dispose();
    this.residents.clear(); this.tileResidents.fill(undefined);
    this.dirtySlots.clear();
    this.pendingPaints.clear();
    for (const canvas of [...this.uploadTiles.values(), ...this.uploadTilePool]) canvas.width = canvas.height = 1;
    this.uploadTiles.clear(); this.uploadTilePool.length = 0;
    for (const { canvas, texture } of this.uploadSources) {
      texture.dispose();
      canvas.width = canvas.height = 1;
    }
    this.atlas.dispose();
    this.selectedCache.dispose();
    if (!this.selectedEntry) this.selectedTexture.dispose();
    this.array.geometry.dispose();
    (this.array.material as THREE.Material).dispose();
    this.selected.geometry.dispose();
    this.selected.material.dispose();
    this.atlasCanvas.width = this.atlasCanvas.height = 1;
    this.selectedCanvas.width = this.selectedCanvas.height = 1;
    this.tileCanvas.width = this.tileCanvas.height = 1;
  }
}
