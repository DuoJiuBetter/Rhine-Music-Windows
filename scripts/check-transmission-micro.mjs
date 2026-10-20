import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {instrumentTransmission} from './transmission-micro-transform.mjs';
import {splitMicroFrames, summarizeTransmission, countMicroOperation} from './transmission-micro-report.mjs';

test('locked Three instrumentation parses and covers upload and render scopes',async()=>{
  const source = await fs.readFile('node_modules/three/build/three.module.js','utf8');
  const result = instrumentTransmission(source);
  assert.ok(result.includes("measure('textureStorage'"));
  assert.ok(result.includes("measure('texturePixels'"));
  assert.ok(result.includes("measure('glassShading'"));
  assert.ok(result.includes('renderTransmissionPassMicroRaw'));
  // Rollup also validates imports; parsing validates the injected forwarding.
  new vm.SourceTextModule(result);
  assert.throws(()=>instrumentTransmission(result),/Unique/);
});

test('paired upload/render frames keep both costs and exclusive prefix accounting',()=>{
  const frames = [{id:2,values:{'renderRest/transmissionRest/transmissionOpaque':2,'renderRest/glassShading':1}},
    {id:1,values:{'explicitPreupload/textureUploadRest/texturePixels':10,'explicitPreupload':.5}}];
  const [preparation,render]=splitMicroFrames({frames,pendingFrames:0,droppedFrames:0,disjointEvents:0},
    [{submissionMs:3,counters:{}},{submissionMs:1,counters:{}}]);
  assert.equal(preparation.gpu.totalMs,10.5);assert.equal(render.gpu.totalMs,3);
  const summary=summarizeTransmission({rows:[{name:'paired',preparation,render}]});
  assert.equal(summary.paired.combinedGpuMs.mean,13.5);
  assert.equal(summary.paired.transmissionOpaqueInclusiveMs.mean,2);
  assert.equal(summary.paired.textureUploadAllMs.mean,10);
  assert.equal(summary.paired.renderGpuMs.median,3);
  assert.equal(summary.paired.renderGpuMs.samples,1);
  assert.throws(()=>splitMicroFrames({frames,pendingFrames:1},[{},{}]),/incomplete/);
});

test('nested upload is part of opaque inclusive time but not its exclusive draw',()=>{
  const render={submissionMs:1,gpu:{totalMs:15},frames:[{id:1,values:{
    'renderRest/transmissionRest/transmissionOpaque':2,
    'renderRest/transmissionRest/transmissionOpaque/textureUploadRest':1,
    'renderRest/transmissionRest/transmissionOpaque/textureUploadRest/texturePixels':10,
    'renderRest/glassShading':2,
  }}]};
  const s=summarizeTransmission({rows:[{name:'cold',render}]}).cold;
  assert.equal(s.transmissionOpaqueInclusiveMs.mean,13);
  assert.equal(s.transmissionOpaqueExclusiveMs.mean,2);
  assert.equal(s.transmissionTextureUploadMs.mean,11);
  assert.equal(s.texturePixelsMs.mean,10);
});

test('absent preparation contributes zero operations instead of duplicating render',()=>{
  const render={counters:{'renderRest/texturePixels':4}};
  assert.equal(countMicroOperation(render,'texturePixels')+countMicroOperation(undefined,'texturePixels'),4);
});
