import test from 'node:test';
import assert from 'node:assert/strict';
import {CoverPreparation} from '../src/cover-preparation.ts';

function fixture(t){
  const old={Worker:globalThis.Worker,OffscreenCanvas:globalThis.OffscreenCanvas,createImageBitmap:globalThis.createImageBitmap,ImageData:globalThis.ImageData};
  const workers=[],bitmaps=[];
  globalThis.Worker=class{constructor(){workers.push(this);this.requests=[];}postMessage(data){this.requests.push(data);}terminate(){this.terminated=true;}};
  globalThis.OffscreenCanvas=class{};globalThis.ImageData=class{};
  globalThis.createImageBitmap=async()=>{const b={width:1,height:1,close(){this.closed=true;}};bitmaps.push(b);return b;};
  const manager=new CoverPreparation();t.after(()=>{manager.dispose();Object.assign(globalThis,old);});
  return{manager,workers,bitmaps,image:{src:'data:image/png;base64,synthetic',naturalWidth:1,naturalHeight:1}};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
test('worker flights have a hard three-request bound and cancelled results cannot publish',async t=>{
  const f=fixture(t),jobs=Array.from({length:3},()=>f.manager.prepare(f.image,256,false));
  assert.equal(await f.manager.prepare(f.image,256,false),undefined);assert.equal(f.manager.stats().inFlight,3);
  f.manager.cancel();assert.deepEqual(await Promise.all(jobs),[undefined,undefined,undefined]);
  await flush();assert.equal(f.manager.stats().inFlight,0);assert.equal(f.bitmaps.length,0,'no main-thread bitmap conversion is used');assert.ok(f.workers.every(w=>w.terminated));
});
test('valid worker results transfer bounded arrays; error disables retries and resolves owners',async t=>{
  const f=fixture(t),job=f.manager.prepare(f.image,256,false);await flush();
  const worker=f.workers[0],id=worker.requests[0].id;
  worker.onmessage({data:{id,width:1,height:1,sourceWidth:1,sourceHeight:1,sourcePixels:new Uint8ClampedArray(4),workerMs:2}});
  assert.equal((await job).sourceWidth,1);assert.equal(f.manager.stats().completed,1);
  const failed=f.manager.prepare(f.image,1024,true);await flush();worker.onerror({preventDefault(){}});
  assert.equal(await failed,undefined);assert.equal(f.manager.available,false);assert.equal(await f.manager.prepare(f.image,256,false),undefined);
});
test('malformed/full-cover-missing replies cannot install pixels',async t=>{
  const f=fixture(t),job=f.manager.prepare(f.image,1024,true);await flush();
  f.workers[0].onmessage({data:{id:f.workers[0].requests[0].id,width:1,height:1,sourceWidth:1,sourceHeight:1,sourcePixels:new Uint8ClampedArray(4)}});
  assert.equal(await job,undefined);assert.equal(f.manager.stats().failed,1);
});

test('relative covers resolve against the document instead of worker asset directory',async t=>{
  const f=fixture(t),old=globalThis.document;globalThis.document={baseURI:'http://127.0.0.1:8123/ui/index.html'};
  t.after(()=>globalThis.document=old);
  const job=f.manager.prepareUrl('../demo.png',256,false);await flush();
  assert.equal(f.workers[0].requests[0].url,'http://127.0.0.1:8123/demo.png');
  f.manager.cancel();assert.equal(await job,undefined);
});

test('worker timeout resolves all owners and disables further worker attempts',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t),jobs=Array.from({length:3},()=>f.manager.prepareUrl('data:image/png;base64,synthetic',256,false));
  t.mock.timers.tick(5000);assert.deepEqual(await Promise.all(jobs),[undefined,undefined,undefined]);
  assert.equal(f.manager.stats().inFlight,0);assert.equal(f.manager.available,false);
  assert.equal(await f.manager.prepareUrl('data:image/png;base64,synthetic',256,false),undefined);
});
