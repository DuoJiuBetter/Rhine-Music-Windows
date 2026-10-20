import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CoverWorkBudget } from '../src/cover-work-budget.ts';
import { ReturningCardBudget } from '../src/returning-card-budget.ts';
import { damp } from '../src/motion.ts';

const budget = new CoverWorkBudget();
assert.equal(budget.plan(0).phase, 'quiet');
budget.interact(1000);
assert.equal(budget.plan(1179).phase, 'input');
assert.equal(budget.plan(1180).phase, 'quiet', 'Recovery depends on elapsed real time, not spring settlement');
assert.equal(budget.plan(5000,true).phase,'input','A held drag remains active');
assert.equal(budget.plan(5000,false).phase,'quiet');
budget.interact(2000); budget.interact(1900); budget.interact(NaN);
assert.equal(budget.snapshot(2100).inputAgeMs,100,'Out-of-order/invalid events cannot shorten the guard');
for (const now of [2000,2180,5000]) {
  assert.equal(budget.plan(now).transfers,1,'No recovery burst of multiple Canvas transfers');
}
for (const hz of [30,60,120]) {
  const spring={value:.9,velocity:0};
  let elapsed=0;
  while(elapsed<.2){damp(spring,0,4.5,1/hz);elapsed+=1/hz;}
  assert.ok(spring.value>.1,'Animation is still visibly returning after input-budget recovery');
  assert.equal(budget.plan(2200).phase,'quiet');
}

const retiring = new ReturningCardBudget();
retiring.bounds.set(new THREE.Vector3(-2.225,.175,-.07),new THREE.Vector3(2.225,3.525,.07));
const camera=new THREE.PerspectiveCamera(3,1.6,.1,300);
camera.position.set(0,1.85,0);camera.lookAt(0,1.85,-100);camera.updateMatrixWorld(true);
const group=new THREE.Group();group.position.set(0,.001,-100);
assert.equal(retiring.canRetire(group,.001,-.004,0,camera,1920,1200),true,'Subpixel distant tail may retire');
assert.equal(retiring.canRetire(group,.001,-.004,0,camera,7680,4800),false,'Higher pixel density retains visible residual');
group.position.z=-10;
assert.equal(retiring.canRetire(group,.001,-.004,0,camera,1920,1200),false,'Close-up residual stays animated');
group.position.z=-100;
assert.equal(retiring.canRetire(group,.02,-.004,0,camera,1920,1200),false,'Large world-space motion is never retired early');
assert.equal(retiring.canRetire(group,.001,-.1,0,camera,1920,1200),false,'Fast-moving return stays alive');
group.rotation.y=.001;
assert.equal(retiring.canRetire(group,.001,-.004,0,camera,1920,1200),false,'Rotation must finish first');
group.rotation.y=0;
assert.equal(retiring.canRetire(group,.001,-.004,.1,camera,1920,1200),false,'Visible resting tilt changes cannot be ignored');
assert.equal(retiring.canRetire(group,NaN,0,0,camera,1920,1200),false);
assert.equal(retiring.canRetire(group,.001,0,0,camera,Infinity,1200),false);
assert.equal(retiring.canRetire(group,.001,0,0,camera,0,0),false);
group.position.z=-.05;
assert.equal(retiring.canRetire(group,.001,0,0,camera,1920,1200),false,'Near-plane crossings use conservative retirement');
const empty=new ReturningCardBudget();
assert.equal(empty.canRetire(group,0,0,0,camera,1920,1200),false);
const timelines=[];
for(const hz of [30,60,120]) {
  const spring={value:.9,velocity:0}; let eligible,exact;
  group.rotation.set(0,0,0); group.position.z=-100;
  for(let frame=1;frame<hz*5;frame++) {
    damp(spring,0,4.5,1/hz);group.position.y=spring.value;
    if(eligible===undefined && retiring.canRetire(group,spring.value,spring.velocity,0,camera,1920,1200))eligible=frame/hz;
    if(Math.abs(spring.value)<1e-4){exact=frame/hz;break;}
  }
  assert.ok(eligible<exact-.3,'Static-camera subpixel retirement shortens the nearly invisible tail');
  timelines.push({hz,subpixelSeconds:eligible,exactSeconds:exact});
}
assert.ok(Math.max(...timelines.map(x=>x.subpixelSeconds))-Math.min(...timelines.map(x=>x.subpixelSeconds))<=1/30);
console.log(JSON.stringify({scope:'Pure math, fixed camera at z=100, FOV3, height1200; not application frame-rate data',timelines}));
console.log('Diagnostic budgets passed: real-time input recovery, bounded transfers, density-aware subpixel return, close-up/rotation/velocity/clip safeguards. No browser or GPU context.');
