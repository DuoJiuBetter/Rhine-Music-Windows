import {COVER_PAINT_SIZE} from './cover-painter.ts';

export type PreparedCover = {
  width: number; height: number;
  sourceWidth: number; sourceHeight: number;
  sourcePixels: Uint8ClampedArray<ArrayBuffer>;
  coverPixels?: Uint8ClampedArray<ArrayBuffer>;
  workerMs: number;
};

/** At most three cover requests in flight; URLs stay local to the browser worker. */
export class CoverPreparation {
  private worker?: Worker;
  private pending = new Map<number, {resolve: (value: PreparedCover | undefined) => void;timer:ReturnType<typeof setTimeout>;full:boolean}>();
  private next = 0;
  private disabled = false;
  private disposed = false;
  private epoch = 0;
  private completed = 0;
  private failed = 0;
  private peak = 0;
  private workerMs = 0;
  get available() {
    return !this.disabled && !this.disposed && typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function' && typeof ImageData !== 'undefined';
  }
  prepare(image: HTMLImageElement, size: number, full: boolean): Promise<PreparedCover | undefined> {
    return this.prepareUrl(image.currentSrc || image.src,size,full);
  }
  prepareUrl(url: string, size: number, full: boolean): Promise<PreparedCover | undefined> {
    if (!this.available || this.pending.size >= 3) return Promise.resolve(undefined);
    const id = ++this.next, epoch = this.epoch;
    const result = new Promise<PreparedCover | undefined>(resolve => this.pending.set(id, {resolve,full,
      timer:setTimeout(()=>{this.failed++;this.disabled=true;this.cancel();},5000)}));
    this.peak = Math.max(this.peak, this.pending.size);
    void (() => {
      try {
        if (!this.worker) {
          this.worker = new Worker(new URL('./cover-preparation-worker.ts', import.meta.url), {type:'module'});
          this.worker.onmessage = event => {
            const {id: replyId, ...data} = event.data;
            const request = this.pending.get(replyId); if (!request) return;
            clearTimeout(request.timer);
            this.pending.delete(replyId);
            const valid = Number.isInteger(data.sourceWidth) && Number.isInteger(data.sourceHeight) &&
              Number.isInteger(data.width) && Number.isInteger(data.height) && data.width>0 && data.height>0 &&
              data.sourceWidth > 0 && data.sourceHeight > 0 && data.sourceWidth <= COVER_PAINT_SIZE && data.sourceHeight <= COVER_PAINT_SIZE &&
              data.sourcePixels instanceof Uint8ClampedArray && data.sourcePixels.length === data.sourceWidth * data.sourceHeight * 4 &&
              (!request.full || Boolean(data.coverPixels)) &&
              (!data.coverPixels || (data.coverPixels instanceof Uint8ClampedArray && data.coverPixels.length === COVER_PAINT_SIZE ** 2 * 4));
            if (!valid) {this.failed++;request.resolve(undefined);return;}
            this.completed++; this.workerMs += Number.isFinite(data.workerMs) ? data.workerMs : 0;
            request.resolve(data);
          };
          this.worker.onerror = event => {event.preventDefault();this.failed++;this.disabled=true;this.cancel();};
        }
        if (this.disposed || this.disabled || epoch !== this.epoch || !this.pending.has(id)) return;
        // Fetch, decode, resize and canvas readback all happen in the worker.
        // createImageBitmap(HTMLImageElement) itself can block the main thread.
        const absoluteUrl=new URL(url,typeof document==='undefined' ? import.meta.url : document.baseURI).href;
        this.worker!.postMessage({id,url:absoluteUrl,size:Math.min(COVER_PAINT_SIZE,Math.max(1,size)),full});
      } catch {
        const request=this.pending.get(id);this.pending.delete(id);this.failed++;
        if(request){clearTimeout(request.timer);request.resolve(undefined);}
        this.disabled=true;this.cancel();
      }
    })();
    return result;
  }
  cancel() {
    this.epoch++;this.worker?.terminate();this.worker=undefined;
    for (const request of this.pending.values()) {clearTimeout(request.timer);request.resolve(undefined);}
    this.pending.clear();
  }
  dispose() {this.disposed=true;this.cancel();}
  stats() {return {available:this.available,inFlight:this.pending.size,limit:3,peak:this.peak,
    completed:this.completed,failed:this.failed,workerMs:this.workerMs};}
}
