import {COVER_PAINT_SIZE, paintCover} from './cover-painter.ts';

const source = new OffscreenCanvas(1,1), cover = new OffscreenCanvas(COVER_PAINT_SIZE,COVER_PAINT_SIZE);
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage: (data: unknown, transfer: Transferable[]) => void;
};
scope.onmessage = async ({data}) => {
  const {id,url,size,full} = data as {id:number;url:string;size:number;full:boolean};
  const started=performance.now();
  let bitmap:ImageBitmap | undefined;
  try {
    // Match crossorigin="anonymous": local-origin credentials only; never
    // send a platform's cookies to a different origin.
    const response=await fetch(url,{mode:'cors',credentials:'same-origin',cache:'default'});
    if(!response.ok)throw Error('cover fetch failed');
    bitmap=await createImageBitmap(await response.blob());
    const width=bitmap.width,height=bitmap.height,scale=Math.min(1,size/Math.max(width,height));
    const sw=Math.max(1,Math.round(width*scale)),sh=Math.max(1,Math.round(height*scale));
    if(source.width!==sw||source.height!==sh){source.width=sw;source.height=sh;}
    const ctx=source.getContext('2d',{willReadFrequently:true})!;
    ctx.clearRect(0,0,source.width,source.height);ctx.drawImage(bitmap,0,0,sw,sh);
    const sourcePixels=ctx.getImageData(0,0,source.width,source.height).data;
    let coverPixels: Uint8ClampedArray<ArrayBuffer> | undefined;
    if(full){paintCover(cover,undefined,{source,width,height});
      coverPixels=cover.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,COVER_PAINT_SIZE,COVER_PAINT_SIZE).data;}
    scope.postMessage({id,width,height,sourceWidth:source.width,sourceHeight:source.height,sourcePixels,coverPixels,workerMs:performance.now()-started},
      coverPixels ? [sourcePixels.buffer,coverPixels.buffer] : [sourcePixels.buffer]);
  } catch {scope.postMessage({id,error:'cover preparation failed'},[]);}
  finally {bitmap?.close();}
};
