import {SelectedCoverCache} from '../src/selected-cover-cache.ts';
import {paintCover} from '../src/cover-atlas.ts';

// No WebGLRenderer/context. Exercise production CPU painting and RGBA cache.
window.runCoverPreparationCpu = async () => {
  const source=document.createElement('canvas');source.width=source.height=256;
  const sourceContext=source.getContext('2d',{willReadFrequently:true});
  sourceContext.fillStyle='#367aac';sourceContext.fillRect(0,0,256,256);
  sourceContext.fillStyle='#edbc75';sourceContext.fillRect(0,0,128,128);
  const cache=new SelectedCoverCache(1024,4),cold=[],warm=[],retained=[];
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const statistics=rows=>{const sorted=[...rows].sort((a,b)=>a-b);return{samples:rows.length,
    mean:rows.reduce((a,b)=>a+b,0)/rows.length,median:sorted[Math.floor(rows.length*.5)],
    p95:sorted[Math.floor(rows.length*.95)],max:sorted.at(-1)};};
  let readMs=0,reads=0,paintMs=0;
  try {
    for(let i=0;i<24;i++) {
      const start=performance.now();
      const entry=cache.acquire('cpu-fixture-'+i,canvas=>{
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        assert(ctx.getContextAttributes().willReadFrequently,'software upload-source hint missing');
        // Time the real browser read, not a mock or already prepared byte array.
        if(!ctx.__cpuReadWrapped) {
          const read=ctx.getImageData.bind(ctx);ctx.__cpuReadWrapped=true;
          ctx.getImageData=(...args)=>{const t=performance.now();try{return read(...args);}finally{readMs+=performance.now()-t;reads++;}};
        }
        const paintStart=performance.now();paintCover(canvas,{title:'Synthetic '+i},{source,width:256,height:256});
        paintMs+=performance.now()-paintStart;return 1024;
      },8);
      cold.push(performance.now()-start);
      if(i>=22)retained.push(entry);else cache.release(entry);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    const versions=retained.map(entry=>entry.texture.version),readsBefore=reads;
    for(let i=0;i<48;i++) {
      const start=performance.now(),entry=cache.acquire('cpu-fixture-'+(22+i%2),()=>{throw Error('warm repaint');},8);
      cache.release(entry);warm.push(performance.now()-start);
    }
    assert(reads===readsBefore,'warm revisit extracted pixels');
    assert(retained.every((entry,i)=>entry.texture.version===versions[i]),'warm revisit changed texture version');
    assert(retained.every(entry=>entry.texture.image.data.byteLength===4*1024*1024),'wrong pixel size');
    const stats=cache.stats();cache.dispose();
    assert(retained.every(entry=>entry.texture.image.data.byteLength===4),'disposed retained token keeps a full pixel allocation');
    return {passed:true,webglContextsCreated:0,sourceSize:256,outputSize:1024,cold:statistics(cold),warm:statistics(warm),
      totalReadMs:readMs,readCalls:reads,totalPaintMs:paintMs,stats,retainedPayloadReleased:true,
      note:'CPU 2D canvas/cache evidence only; includes production paint+read+row reversal. No texture upload, player, account or FPS measurement.'};
  } finally {cache.dispose();source.width=source.height=1;}
};
