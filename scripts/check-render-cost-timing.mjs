import test from 'node:test';
import assert from 'node:assert/strict';
import {RenderCostTiming} from './render-cost-timing.mjs';
function mock() {
  let active, created=0; const deleted=new Set();
  const state={ready:false,disjoint:false,fail:false};
  const gl={QUERY_RESULT_AVAILABLE:1,QUERY_RESULT:2,
    getExtension:()=>({TIME_ELAPSED_EXT:3,GPU_DISJOINT_EXT:4}),
    isContextLost:()=>false,getParameter:()=>state.disjoint,
    createQuery:()=>state.fail?null:{id:++created},
    beginQuery:(_,query)=>{assert.equal(active,undefined);active=query;},
    endQuery:()=>{assert.ok(active);active=undefined;},
    getQueryParameter:(_,p)=>p===1?state.ready:1e6,
    deleteQuery:q=>{assert.ok(!deleted.has(q.id));deleted.add(q.id);}};
  return {gl,state,deleted,count:()=>created,active:()=>active};
}
test('exclusive nested GPU scopes resolve only complete same-frame samples',()=>{
  const m=mock(),p=new RenderCostTiming(m.gl);p.start();p.begin();p.end();p.begin();
  assert.equal(p.measure('scene',()=>p.measure('shadows',()=>17)),17);
  p.measure('ao',()=>{});p.end();p.stop();
  assert.equal(p.snapshot().samples,0);assert.equal(p.snapshot().capture.pendingFrames,1);
  m.state.ready=true;const s=p.snapshot().capture;
  assert.equal(s.gpu.totalMs,7);assert.equal(s.stages.scene.totalMs,2);
  assert.equal(s.stages.shadows.totalMs,1);assert.equal(s.stages.otherRender.totalMs,3);
  assert.ok(Math.abs(Object.values(s.stages).reduce((a,b)=>a+b.sharePercent,0)-100)<1e-10);
  assert.equal(s.stages.scene.samples,s.gpu.samples);p.dispose();assert.equal(m.deleted.size,m.count());
});
test('exceptions resume outer scopes and query creation failures reject entire frame',()=>{
  const m=mock(),p=new RenderCostTiming(m.gl);p.start();p.begin();p.end();p.begin();
  assert.throws(()=>p.measure('scene',()=>p.measure('shadow',()=>{throw Error('draw');})),/draw/);
  m.state.fail=true;p.measure('ao',()=>{});p.end();m.state.ready=true;
  const s=p.snapshot().capture;assert.equal(s.gpu.samples,0);assert.equal(s.droppedFrames,1);
  p.dispose();assert.equal(m.active(),undefined);assert.equal(m.deleted.size,m.count());
});
test('disjoint clears invalid GPU data and pending query growth is bounded',()=>{
  const m=mock(),p=new RenderCostTiming(m.gl);p.start();
  for(let i=0;i<50;i++){p.begin();p.measure('scene',()=>{});p.end();}
  assert.equal(p.snapshot().capture.pendingFrames,16);assert.ok(p.snapshot().capture.droppedFrames>0);
  m.state.disjoint=true;assert.equal(p.snapshot().samples,0);assert.equal(p.snapshot().capture.pendingFrames,0);
  p.dispose();assert.equal(m.deleted.size,m.count());
});
test('CPU nested scopes do not double count, unsupported GPU still records CPU',t=>{
  const original=Object.getOwnPropertyDescriptor(performance,'now');let now=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  t.after(()=>original?Object.defineProperty(performance,'now',original):delete performance.now);
  const p=new RenderCostTiming({getExtension:()=>null});p.start();p.begin();
  p.cpu('frameOther',()=>{now+=2;p.measure('scene',()=>{now+=3;p.cpu('coverPrepare',()=>{now+=4;});});now+=1;});
  p.end();p.stop();const s=p.snapshot();assert.equal(s.available,false);assert.equal(s.samples,0);
  assert.equal(s.capture.cpu.frameOther.totalMs,3);assert.equal(s.capture.cpu.scene.totalMs,3);
  assert.equal(s.capture.cpu.coverPrepare.totalMs,4);assert.equal(s.capture.cpu.coverPrepare.sharePercentOfInstrumentedCpu,40);
});

test('micro experiment samples first frame with a bounded larger query limit',()=>{
  const m=mock(),p=new RenderCostTiming(m.gl,{sampleEvery:1,maxQueries:192});p.start();p.begin();
  for(let i=0;i<40;i++)p.measure('upload',()=>{});
  p.end();p.stop();m.state.ready=true;
  const result=p.snapshot().capture;
  assert.equal(result.renderedFrames,1);assert.equal(result.sampledEvery,1);
  assert.equal(result.gpu.samples,1);assert.equal(result.droppedFrames,0);p.dispose();
  assert.equal(m.deleted.size,m.count());
  assert.throws(()=>new RenderCostTiming(m.gl,{maxQueries:1000}),/bounded/);
  assert.throws(()=>new RenderCostTiming(m.gl,{sampleEvery:0}),/bounded/);
});

test('query result polling is charged separately from scene CPU work',t=>{
  const descriptor=Object.getOwnPropertyDescriptor(performance,'now');let now=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  t.after(()=>descriptor?Object.defineProperty(performance,'now',descriptor):delete performance.now);
  const m=mock();m.gl.getParameter=()=>{now+=7;return false;};
  const p=new RenderCostTiming(m.gl);p.start();
  p.cpu('sceneUpdate',()=>{now++;p.begin();now+=2;p.end();});p.stop();
  const s=p.snapshot().capture.cpu;
  assert.equal(s.queryCollection.totalMs,7);assert.equal(s.sceneUpdate.totalMs,3);p.dispose();
});
