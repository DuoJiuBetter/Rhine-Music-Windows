import {CoverPreparation} from '../src/cover-preparation.ts';
import {SelectedCoverCache} from '../src/selected-cover-cache.ts';
import {paintCover} from '../src/cover-painter.ts';

window.runCoverWorkerCheck=async()=>{
  const input=document.createElement('canvas');input.width=2;input.height=3;
  const ctx=input.getContext('2d',{willReadFrequently:true});
  ctx.putImageData(new ImageData(new Uint8ClampedArray([255,0,0,255,0,255,0,128,0,0,255,255,255,255,0,64,128,128,128,255,0,0,0,0]),2,3),0,0);
  const image=new Image();image.src=input.toDataURL();await image.decode();
  const manager=new CoverPreparation(),cache=new SelectedCoverCache(1024);
  try{
    const prepared=await manager.prepare(image,1024,true);if(!prepared?.coverPixels)throw Error('Worker did not prepare full cover');
    const reference=document.createElement('canvas');reference.width=reference.height=1024;
    paintCover(reference,{title:'Synthetic'},{source:image,width:2,height:3});
    const pixels=reference.getContext('2d',{willReadFrequently:true}).getImageData(0,0,1024,1024).data;
    let maxDifference=0;for(let i=0;i<pixels.length;i++)maxDifference=Math.max(maxDifference,Math.abs(pixels[i]-prepared.coverPixels[i]));
    if(maxDifference>1)throw Error('Worker painter differs: '+maxDifference);
    const aspectChecks=[];
    for(const [width,height] of [[1800,600],[600,1800],[1024,1024]]){
      const art=document.createElement('canvas');art.width=width;art.height=height;
      const c=art.getContext('2d',{willReadFrequently:true});c.fillStyle='#184762';c.fillRect(0,0,width,height);
      c.fillStyle='#bd673e';c.fillRect(0,0,width*.37,height*.43);c.fillStyle='#c9dd9c80';c.fillRect(width*.3,height*.2,width*.5,height*.7);
      const img=new Image();img.src=art.toDataURL();await img.decode();
      const result=await manager.prepare(img,1024,true);if(!result?.coverPixels)throw Error('Missing aspect preparation');
      const resized=document.createElement('canvas');const scale=Math.min(1,1024/Math.max(width,height));
      resized.width=Math.round(width*scale);resized.height=Math.round(height*scale);
      resized.getContext('2d',{willReadFrequently:true}).drawImage(img,0,0,resized.width,resized.height);
      paintCover(reference,undefined,{source:resized,width,height});
      const expected=reference.getContext('2d',{willReadFrequently:true}).getImageData(0,0,1024,1024).data;
      let difference=0;for(let i=0;i<expected.length;i++)difference=Math.max(difference,Math.abs(expected[i]-result.coverPixels[i]));
      if(difference>1)throw Error('Aspect painter differs: '+JSON.stringify({width,height,difference}));
      aspectChecks.push({width,height,maxDifference:difference});img.src='';art.width=art.height=resized.width=resized.height=1;
    }
    const entry=cache.acquire('prepared',()=>{throw Error('Worker path repainted on main');},8,{pixels:prepared.coverPixels,decodedSize:3});
    if(cache.stats().pixelReads!==0)throw Error('Worker path did main readback');
    const stats=manager.stats(),cacheStats=cache.stats();
    const jobs=Array.from({length:3},()=>manager.prepare(image,1024,true));manager.cancel();
    if((await Promise.all(jobs)).some(Boolean))throw Error('Cancelled jobs published');
    cache.dispose();if(entry.texture.image.data.byteLength!==4)throw Error('Disposed payload retained');
    return{passed:true,maxDifference,aspectChecks,sourceWidth:prepared.sourceWidth,sourceHeight:prepared.sourceHeight,
      worker:stats,cache:cacheStats,cancelledFlightCount:3,webglContextsCreated:0,note:'Real bounded worker, production painter and cache; no WebGL/player/frame-rate measurement.'};
  }finally{manager.dispose();cache.dispose();image.src='';input.width=input.height=1;}
};
