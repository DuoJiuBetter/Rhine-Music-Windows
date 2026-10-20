import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RapidSwitchBudget} from '../src/rapid-switch-budget.ts';
import {CoverWorkBudget} from '../src/cover-work-budget.ts';
import {ShadowUpdateBudget} from '../src/shadow-update-budget.ts';
import {BudgetSSAOPass} from '../src/budget-ssao.ts';
import {SharedDepthBokehPass} from '../src/shared-depth-bokeh.ts';
import * as THREE from 'three';

test('real selection cadence activates the budget; restoration does not wait for the springs',()=>{
 const input=new CoverWorkBudget(),budget=new RapidSwitchBudget();
 for(const now of [0,40]){input.selection(now);assert.equal(budget.update(input.plan(now).phase==='burst',true,.016),0);}
 input.selection(80);assert.equal(budget.update(input.plan(80).phase==='burst',true,.016),1);
 assert.equal(budget.update(input.plan(259).phase==='burst',true,.016),1);
 for(let frame=0;frame<13;frame++)budget.update(input.plan(260+frame*16).phase==='burst',true,.016);
 assert.equal(budget.active,false);assert.equal(budget.snapshot().restored,1);
 budget.update(true,true,.016);assert.equal(budget.update(true,false,.016),0,'Details/overview/reference cannot retain reduced effects');
});
test('burst retirement releases only oldest outgoing owners, preserving the newest four',()=>{
 const budget=new RapidSwitchBudget(),entries=[],released=[];
 for(let i=0;i<250;i++){entries.push({id:i});budget.trimReturns(entries,owner=>released.push(owner.id));}
 assert.deepEqual(entries.map(o=>o.id),[246,247,248,249]);assert.equal(released.length,246);
 assert.equal(new Set(released).size,released.length,'Each outgoing owner releases once');
 budget.trimReturns(entries,owner=>released.push(owner.id));assert.equal(released.length,246);
});
test('motion uniforms keep render targets and material programs stable and restore full samples',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
 const ao=new BudgetSSAOPass(scene,camera,64,64,16),bokeh=new SharedDepthBokehPass(scene,camera,{focus:25,aperture:.0018,maxblur:.011});
 bokeh.setResolutionScale(.5);
 const version=ao.ssaoMaterial.version,bokehVersion=bokeh.materialBokeh.version,normal=ao.normalRenderTarget,blur=ao.ssaoRenderTarget;
 for(let i=0;i<20;i++){ao.setMotionBudget(1);bokeh.setMotionBudget(1);assert.equal(ao.ssaoMaterial.uniforms.activeKernelSize.value,4);assert.equal(bokeh.getBudget().colorSamples,5);ao.setMotionBudget(0);bokeh.setMotionBudget(0);}
 assert.equal(ao.ssaoMaterial.uniforms.activeKernelSize.value,16);assert.equal(bokeh.getBudget().colorSamples,13);
 assert.equal(ao.ssaoMaterial.version,version);assert.equal(bokeh.materialBokeh.version,bokehVersion);assert.equal(ao.normalRenderTarget,normal);assert.equal(ao.ssaoRenderTarget,blur);
 assert.ok(ao.ssaoMaterial.fragmentShader.includes('if (float(i) >= activeKernelSize) break;'));
 assert.ok(ao.ssaoMaterial.fragmentShader.includes('occlusion / activeKernelSize'));
 assert.ok(!ao.ssaoMaterial.fragmentShader.includes('occlusion / float( KERNEL_SIZE )'));
 ao.dispose();bokeh.dispose();
});
test('lower shadow cadence preserves dirty invalidation and original stationary cadence',()=>{
 const b=new ShadowUpdateBudget();assert.equal(b.shouldUpdate([0],true,.01,0,12),true);
 assert.equal(b.shouldUpdate([1],true,.01,.04,12),false);assert.equal(b.shouldUpdate([2],true,.01,.09,12),true);
 b.invalidate();assert.equal(b.shouldUpdate([2],true,.01,.10,12),true,'Quality/theme invalidation is never deferred');
 assert.equal(b.shouldUpdate([3],true,.01,.14),true,'Restored 30Hz cadence');
});
