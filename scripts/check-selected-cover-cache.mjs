import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectedCoverCache,copyCoverPixels} from '../src/selected-cover-cache.ts';

function fixture(t) {
  const original=globalThis.document;
  const oldImageData=globalThis.ImageData;
  globalThis.ImageData=class{constructor(data,width,height){this.data=data;this.width=width;this.height=height;}};
  globalThis.document={createElement:()=>({width:0,height:0,getContext(){return {getImageData:()=>({data:new Uint8ClampedArray(this.width*this.height*4)}),putImageData:()=>{}};}})};
  t.after(()=>globalThis.document=original);
  t.after(()=>globalThis.ImageData=oldImageData);
  return new SelectedCoverCache(4,2);
}
test('warm selected identity reuses canvas/texture/version without invoking the painter',t=>{
  const c=fixture(t);let paints=0;
  const a=c.acquire('a',()=>{paints++;return 1024;},8),version=a.texture.version;
  c.release(a);const again=c.acquire('a',()=>{throw Error('warm repaint');},8);
  assert.equal(a,again);assert.equal(paints,1);assert.equal(a.texture.version,version);
  assert.equal(c.stats().hits,1);c.dispose();
});
test('active and returning owners pin their image while idle retention stays bounded',t=>{
  const c=fixture(t),a=c.acquire('a',()=>1024,8);c.retain(a);c.release(a);
  let disposed=0;a.texture.addEventListener('dispose',()=>disposed++);
  for(let i=0;i<100;i++){const e=c.acquire(String(i),()=>1024,8);c.release(e);}
  assert.equal(c.stats().entries,3);assert.equal(c.stats().pinned,1);
  assert.equal(disposed,0);assert.equal(a.canvas.width,4);
  c.release(a);assert.equal(c.stats().entries,2);assert.equal(disposed,1);
  assert.equal(a.canvas.width,1);assert.equal(a.texture.image.data.byteLength,4,'idle eviction drops the full CPU pixel payload');c.dispose();
});
test('dispose releases shared images once, later owner cleanup cannot dispose them again',t=>{
  const c=fixture(t),a=c.acquire('a',()=>1024,8);c.retain(a);
  let disposed=0;a.texture.addEventListener('dispose',()=>disposed++);
  c.dispose();c.release(a);c.release(a);assert.equal(disposed,1);assert.equal(c.stats().bytes,0);
  assert.equal(a.texture.image.data.byteLength,4,'a retained disposed token no longer holds its full RGBA allocation');
});

test('different idle identities recycle the same canvas/Texture/Source without disposing GPU storage',t=>{
  const c=fixture(t),a=c.acquire('a',()=>1024,8),b=c.acquire('b',()=>1024,8);
  c.release(a);c.release(b);const texture=a.texture,canvas=a.canvas,source=texture.source,version=texture.version;
  let disposals=0;texture.addEventListener('dispose',()=>disposals++);
  const next=c.acquire('c',target=>{assert.equal(target,canvas);return 1024;},8);
  assert.notEqual(next,a,'new identity gets a new ownership token');
  assert.equal(next.texture,texture);assert.equal(next.texture.source,source);assert.equal(next.canvas.width,4);
  assert.ok(next.texture.version>version);assert.equal(disposals,0);c.release(next);
  for(let i=0;i<1000;i++){const e=c.acquire('new-'+i,()=>1024,8);c.release(e);}
  assert.equal(c.stats().created,2);assert.equal(c.stats().entries,2);assert.equal(c.stats().recycled,1001);
  c.dispose();assert.equal(disposals,1);
});

test('RGBA transfer reverses rows exactly and preserves alpha without resizing',()=>{
  const data=new Uint8ClampedArray([255,0,0,255,0,255,0,128,0,0,255,64,11,22,33,0]);
  const canvas={width:2,height:2,getContext:(kind,options)=>{
    assert.equal(kind,'2d');assert.equal(options.willReadFrequently,true);
    return {getImageData:()=>({data})};
  }};
  const target=new Uint8Array(16);copyCoverPixels(canvas,target);
  assert.deepEqual([...target],[0,0,255,64,11,22,33,0,255,0,0,255,0,255,0,128]);
  assert.throws(()=>copyCoverPixels(canvas,new Uint8Array(4)),/dimensions/);
});

test('pixel refresh preserves texture/source/data identity and full filtering',t=>{
  const c=fixture(t),entry=c.acquire('a',()=>1024,8);
  const source=entry.texture.source,data=entry.texture.image.data,version=entry.texture.version;
  c.refresh(entry);
  assert.equal(entry.texture.source,source);assert.equal(entry.texture.image.data,data);
  assert.ok(entry.texture.version>version);assert.equal(entry.texture.flipY,false);
  assert.equal(entry.texture.generateMipmaps,true);assert.equal(entry.texture.isDataTexture,true);
  assert.equal(c.stats().pixelReads,2);c.dispose();
});

test('worker-prepared pixels skip the painter/readback and retain ownership',t=>{
  const c=fixture(t),pixels=new Uint8ClampedArray(4*4*4);pixels[0]=255;pixels[3]=128;
  const entry=c.acquire('prepared',()=>{throw Error('main repaint');},8,{pixels,decodedSize:1024});
  assert.equal(c.stats().pixelReads,0);assert.equal(c.stats().preparedInstalls,1);
  assert.equal(entry.texture.image.data[48],255);assert.equal(entry.texture.image.data[51],128);
  const texture=entry.texture,source=texture.source,data=texture.image.data;
  pixels[0]=0;assert.equal(data[48],255,'cache pixels own a copy, not a mutable worker buffer');
  c.refreshPrepared(entry,pixels);assert.equal(entry.texture,texture);assert.equal(texture.source,source);assert.equal(texture.image.data,data);
  assert.equal(c.stats().pixelReads,0);c.dispose();
});
