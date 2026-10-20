import * as THREE from "three";

export type SelectedCover = {
  readonly key: string;
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.DataTexture;
  references: number;
  decodedSize: number;
};

/** Keep full-size immutable identities across selection and returning models.
 * Only unreferenced entries are evicted. Idle retention has a fixed limit;
 * live references have the same lifetime as their actual on-screen models. */
export class SelectedCoverCache {
  private entries = new Map<string, SelectedCover>();
  private hits = 0;
  private created = 0;
  private evicted = 0;
  private recycled = 0;
  private pixelReads = 0;
  private preparedInstalls = 0;
  readonly size: number;
  readonly idleLimit: number;
  constructor(size: number, idleLimit = 4) { this.size = size; this.idleLimit = idleLimit; }
  acquire(key: string, paint: (canvas: HTMLCanvasElement) => number, anisotropy: number,
    prepared?: {pixels: Uint8ClampedArray<ArrayBuffer>; decodedSize: number}) {
    let entry = this.entries.get(key);
    if (entry) {
      this.hits++; this.entries.delete(key); this.entries.set(key, entry);
      if (entry.texture.anisotropy !== anisotropy) {
        entry.texture.anisotropy = anisotropy; entry.texture.needsUpdate = true;
      }
    }
    else {
      // Recycle only an idle identity. Keep the same canvas, Texture and Source
      // objects so Three can update existing texStorage instead of allocating a
      // brand-new GPU texture inside the next transmission capture.
      const idle = [...this.entries.values()].filter(candidate => !candidate.references);
      const retired = this.idleLimit > 0 && idle.length >= this.idleLimit ? idle[0] : undefined;
      let canvas: HTMLCanvasElement, texture: THREE.DataTexture;
      if (retired) {
        this.entries.delete(retired.key); canvas = retired.canvas; texture = retired.texture;
        this.evicted++; this.recycled++;
      } else {
        canvas = document.createElement("canvas"); canvas.width = canvas.height = this.size;
        texture = new THREE.DataTexture(new Uint8Array(this.size * this.size * 4), this.size, this.size);
        texture.colorSpace = THREE.SRGBColorSpace;
        // getImageData is top-down. Copy rows explicitly into GL order below;
        // no DOM-canvas conversion or implementation-dependent typed-array flip.
        texture.flipY = false; texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
        texture.userData.maxAnisotropy = 8; texture.userData.selectedCoverCache = true;
        this.created++;
      }
      const decodedSize = prepared ? prepared.decodedSize : paint(canvas);
      texture.anisotropy = anisotropy;
      entry = {key, canvas, texture, references: 0, decodedSize};
      if(prepared)this.refreshPrepared(entry,prepared.pixels);else this.refresh(entry);
      this.entries.set(key, entry);
    }
    entry.references++; this.trim(); return entry;
  }
  retain(entry: SelectedCover) { entry.references++; }
  refresh(entry: SelectedCover) {
    copyCoverPixels(entry.canvas, entry.texture.image.data as Uint8Array);
    this.pixelReads++; entry.texture.needsUpdate = true;
  }
  refreshPrepared(entry: SelectedCover, pixels: Uint8ClampedArray<ArrayBuffer>) {
    const {width,height}=entry.canvas;
    const context=entry.canvas.getContext('2d',{willReadFrequently:true})!;
    context.putImageData(new ImageData(pixels,width,height),0,0);
    copyCoverRows(pixels,width,height,entry.texture.image.data as Uint8Array);
    this.preparedInstalls++;entry.texture.needsUpdate=true;
  }
  release(entry: SelectedCover) {
    entry.references = Math.max(0, entry.references - 1); this.trim();
  }
  private trim() {
    let idle = [...this.entries.values()].filter(entry => !entry.references).length;
    for (const [key, entry] of this.entries) {
      if (idle <= this.idleLimit) break;
      if (entry.references) continue;
      this.entries.delete(key); this.destroy(entry);
      this.evicted++; idle--;
    }
  }
  stats() {
    const entries = [...this.entries.values()];
    return {entries: entries.length, pinned: entries.filter(entry => entry.references > 0).length,
      idleLimit: this.idleLimit, bytes: entries.length * this.size * this.size * 4,
      hits: this.hits, created: this.created, evicted: this.evicted, recycled: this.recycled,
      uploadSource: 'rgba', pixelReads: this.pixelReads, preparedInstalls:this.preparedInstalls,
      cpuPixelBytes: entries.length * this.size * this.size * 4};
  }
  dispose() {
    for (const entry of this.entries.values()) {
      this.destroy(entry);
    }
    this.entries.clear();
  }
  private destroy(entry: SelectedCover) {
    entry.texture.dispose(); entry.canvas.width = entry.canvas.height = 1;
    // Disposed materials/late promise closures can still reference the token.
    // Drop the full CPU payload immediately; only idle entries or a disposed
    // scene reach this path, so current/returning owners are never overwritten.
    entry.texture.image = {data: new Uint8Array(4), width: 1, height: 1};
  }
}

/** Preserve exact unpremultiplied sRGB RGBA and transparent margins. */
export function copyCoverPixels(canvas: HTMLCanvasElement, target: Uint8Array) {
  const {width, height} = canvas;
  if (target.length !== width * height * 4) throw new Error('Cover pixel buffer dimensions differ');
  const pixels = canvas.getContext('2d', {willReadFrequently: true})!.getImageData(0, 0, width, height).data;
  copyCoverRows(pixels,width,height,target);
}
export function copyCoverRows(pixels: Uint8ClampedArray, width: number, height: number, target: Uint8Array) {
  if(pixels.length !== width*height*4 || target.length !== pixels.length)throw new Error('Cover pixel buffer dimensions differ');
  const stride = width * 4;
  for (let row = 0; row < height; row++)
    target.set(pixels.subarray(row * stride, (row + 1) * stride), (height - row - 1) * stride);
}
