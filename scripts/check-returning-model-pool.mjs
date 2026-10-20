import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ReturningModelPool} from '../src/returning-model-pool.ts';
import {FrameFieldCache} from '../src/frame-field-cache.ts';
import {archiveWave, idleWave, settlingWave, columnStrength, musicSelectionWave} from '../src/motion.ts';
import {GpuFrameTiming} from '../src/gpu-frame-timing.ts';

test('returning model reuse preserves geometry/material identity and resets pose and visibility',()=>{
  const pool=new ReturningModelPool(2),template=new THREE.Group();
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshPhysicalMaterial());template.add(mesh);
  template.position.set(1,2,3);template.rotation.y=.4;template.scale.setScalar(2);
  let prepares=0,releases=0;
  const prepare=g=>{prepares++;g.children[0].material=g.children[0].material.clone();};
  const a=pool.acquire(template,prepare),material=a.children[0].material;
  assert.notEqual(material,mesh.material);assert.equal(a.children[0].geometry,mesh.geometry);
  const scene=new THREE.Scene();scene.add(a);a.position.set(100,200,300);a.children[0].visible=false;
  pool.release(a,()=>releases++,()=>assert.fail('within pool limit'));
  assert.equal(a.parent,null);const b=pool.acquire(template,prepare);
  assert.equal(a,b);assert.equal(b.children[0].material,material);assert.equal(prepares,1);assert.equal(releases,1);
  assert.deepEqual(b.position.toArray(),template.position.toArray());assert.deepEqual(b.quaternion.toArray(),template.quaternion.toArray());
  assert.equal(b.children[0].visible,true);assert.equal(pool.stats().reused,1);
  pool.release(b,()=>{},()=>{});pool.invalidate(g=>g.children[0].material.dispose());
  mesh.geometry.dispose();mesh.material.dispose();
});
test('pool releases cover ownership before caching, bounds idle models and rejects prior theme/layout epoch',()=>{
  const pool=new ReturningModelPool(2),template=new THREE.Group(),disposed=[],released=[];
  const a=pool.acquire(template,()=>{}),b=pool.acquire(template,()=>{}),c=pool.acquire(template,()=>{});
  const release=g=>released.push(g),dispose=g=>{assert.ok(released.includes(g));disposed.push(g);};
  pool.release(a,release,dispose);pool.release(b,release,dispose);pool.release(c,release,dispose);
  assert.equal(pool.stats().idle,2);assert.deepEqual(disposed,[c]);
  const active=pool.acquire(template,()=>{});
  pool.invalidate(dispose);pool.release(active,release,dispose);
  assert.ok(disposed.includes(active));assert.equal(pool.stats().idle,0);
});

test('1000 completed return cycles use one model/material allocation instead of 1000',()=>{
  const template=new THREE.Group(),geometry=new THREE.BoxGeometry(),sourceMaterial=new THREE.MeshPhysicalMaterial();
  template.add(new THREE.Mesh(geometry,sourceMaterial));const pool=new ReturningModelPool(8);
  let prepares=0,material;
  for(let i=0;i<1000;i++){
    const g=pool.acquire(template,group=>{prepares++;group.children[0].material=sourceMaterial.clone();});
    if(!material)material=g.children[0].material;
    assert.equal(g.children[0].material,material);pool.release(g,()=>{},()=>assert.fail('pool overflow'));
  }
  assert.equal(prepares,1);assert.deepEqual(pool.stats(),{idle:1,limit:8,created:1,reused:999});
  pool.invalidate(g=>g.children[0].material.dispose());geometry.dispose();sourceMaterial.dispose();
});
test('finite field cache is numerically identical for full pool, slopes and out-of-window samples',()=>{
  const cache=new FrameFieldCache(),origin={row:100000,lane:-200},time=27.24;
  cache.begin(origin.lane-7,origin.row-64);let evaluations=0;
  const field=(row,lane)=>{evaluations++;return archiveWave(row,lane,time)*.6+idleWave(row,lane,time)*.4+
    settlingWave(row-origin.row,26.56)*columnStrength(lane,origin.lane)+musicSelectionWave(Math.hypot(row-origin.row,lane-origin.lane),.5);};
  for(let lane=origin.lane-4;lane<=origin.lane+4;lane++)for(let row=origin.row-24;row<origin.row+24;row++){
    for(const r of [row-.5,row,row+.5])assert.equal(cache.read(r,lane,field),field(r,lane));
  }
  assert.equal(cache.stats().hits,423,'adjacent slopes share 47 exact half-row samples per lane');
  assert.equal(cache.stats().evaluations,873);assert.equal(cache.stats().bytes,49152);
  for(const [row,lane] of [[origin.row+10000,origin.lane],[origin.row+.25,origin.lane],[origin.row,origin.lane+.5]])
    assert.equal(cache.read(row,lane,field),field(row,lane));
});
test('new frames, in-frame pulse changes and epoch overflow cannot reuse stale field values',()=>{
  const cache=new FrameFieldCache();let value=1,calls=0;const field=()=>{calls++;return value;};
  cache.begin(-5,-20);assert.equal(cache.read(0,0,field),1);value=2;
  assert.equal(cache.read(0,0,field),1);cache.invalidate();assert.equal(cache.read(0,0,field),2);
  value=3;cache.begin(-5,-20);assert.equal(cache.read(0,0,field),3);
  value=4;cache.epoch=0xffffffff;cache.invalidate();assert.equal(cache.read(0,0,field),4);
  assert.equal(calls,4);
});

test('GPU diagnostic collection polls at sample cadence and snapshot still rejects disjoint data immediately',()=>{
  let polls=0,disjoint=false,active=null,created=0;
  const gl={QUERY_RESULT_AVAILABLE:1,QUERY_RESULT:2,
    getExtension:()=>({TIME_ELAPSED_EXT:3,GPU_DISJOINT_EXT:4}),isContextLost:()=>false,
    getParameter:()=>{polls++;return disjoint;},getQueryParameter:(_,p)=>p===1?true:1e6,
    createQuery:()=>({id:++created}),deleteQuery(){},
    beginQuery:(_,q)=>{assert.equal(active,null);active=q;},endQuery:()=>{assert.ok(active);active=null;}};
  const timer=new GpuFrameTiming(gl);
  for(let i=0;i<64;i++){timer.begin();timer.measure('scene',()=>timer.measure('nested',()=>{}));timer.end();}
  assert.equal(polls,16,'64 rendered frames need 16 polls instead of 64');
  assert.ok(timer.snapshot().samples>0);disjoint=true;assert.equal(timer.snapshot().gpuP95,null);
  assert.equal(active,null);timer.dispose();
});
