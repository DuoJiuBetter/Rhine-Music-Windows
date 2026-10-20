import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { MusicSelectionRipples } from '../src/music-selection-ripples.ts';
import { musicSelectionWave, settlingWave, idleWave, rippleEnvelope, smooth } from '../src/motion.ts';

const clamp=x=>Math.max(-.24,Math.min(.24,x));
const field=(list,row,time,lane=2)=>clamp(list.reduce((sum,p)=>sum+musicSelectionWave(Math.hypot(row-p.row,(lane-p.lane)*2.2),time-p.time)*(p.gain??1),0));
const cell=row=>({row,lane:2});

test('rapid input coalesces into the final selection after 180ms, without delaying navigation',()=>{
  const policy=new MusicSelectionRipples();
  for(let i=0;i<12;i++){policy.request(cell(i),i/8);assert.equal(policy.update(i/8).length,0);}
  assert.equal(policy.update(11/8+.179).length,0);
  const wave=policy.update(11/8+.18);assert.equal(wave.length,1);assert.equal(wave[0].row,11);
  assert.equal(policy.snapshot().requested,12);assert.equal(policy.snapshot().coalesced,11);assert.equal(policy.snapshot().emitted,1);
});

test('replacement keeps moving during coalescing and hands off with complementary weights',()=>{
  const policy=new MusicSelectionRipples();policy.request(cell(0),0);policy.update(.18);
  const before=policy.update(.8);policy.request(cell(1),.8);const after=policy.update(.8);
  assert.deepEqual(before,after,'a new input does not instantaneously delete or change an existing wave');
  const middle=policy.update(.92);assert.equal(middle[0].gain,1,'old wave does not vanish while waiting for the next');
  policy.request(cell(2),.93);assert.equal(policy.update(1.04).length,1);
  const last=policy.update(1.11);assert.equal(last.length,2);assert.equal(last[1].row,2);assert.equal(last[1].gain,0);
  assert.ok(1.11-last[1].time>.4,'replacement inherits a live phase rather than restarting its rise');
  const blend=policy.update(1.23);assert.ok(Math.abs(blend[0].gain+blend[1].gain-1)<1e-12);
  policy.request(cell(3),1.25);
  const remaining=policy.update(1.351);assert.equal(remaining.length,1);assert.equal(remaining[0].row,2,'further input does not restart the old fade');
});

test('natural expiry reaches zero smoothly rather than truncating a nonzero wave',()=>{
  const policy=new MusicSelectionRipples();policy.request(cell(0),0);policy.update(.18);
  const near=policy.update(.18+3.2-1e-4);assert.equal(near.length,1);assert.ok(near[0].gain<1e-9);
  assert.equal(policy.update(.18+3.2).length,0);
});

test('sustained clicking keeps bounded work, including just over the quiet threshold',()=>{
  for(const rate of [2,4,5,5.5,8,12,60]){
    const policy=new MusicSelectionRipples();let next=0;
    for(let frame=0;frame<120*6;frame++){
      const time=frame/120;
      while(next/rate<=time){policy.request(cell(next),time);next++;}
      const list=policy.update(time);assert.ok(list.length<=2);assert.ok(list.every(p=>p.gain>=0&&p.gain<=1));
    }
    assert.ok(policy.snapshot().peakActive<=2);
  }
});

test('entering another mode cancels pending work and never replays a delayed ghost wave',()=>{
  const policy=new MusicSelectionRipples();policy.request(cell(9),0);assert.equal(policy.update(.2,false).length,0);
  assert.equal(policy.update(.3,true).length,0);assert.equal(policy.hasPending,false);
  policy.request(cell(10),1);assert.equal(policy.update(20).length,0,'a window returning from a long stall skips stale input');
  policy.request(cell(11),21);policy.update(21.18);policy.update(21.3,false);assert.equal(policy.update(21.55,false).length,0);
});

test('loop coordinate rebasing preserves the field and the final queued cell',()=>{
  const policy=new MusicSelectionRipples();policy.request({row:140,lane:10},0);policy.update(.18);
  const before=policy.update(.6);policy.request({row:141,lane:11},.6);
  const shift={row:96,lane:9};policy.rebase(shift);const after=policy.update(.6);
  for(let row=120;row<160;row++)assert.ok(Math.abs(field(before,row,.6,10)-field(after,row-shift.row,.6,10-shift.lane))<1e-12);
  const queued=policy.update(.78);assert.ok(queued.some(p=>p.row===45&&p.lane===2));
  policy.reset();assert.equal(policy.hasPending,false);assert.equal(policy.update(100).length,0);
});

const source=fs.readFileSync(new URL('../src/scene.ts',import.meta.url),'utf8');
const tree=ts.createSourceFile('scene.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const sceneClass=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='ArchiveScene');
const method=name=>sceneClass.members.find(node=>ts.isMethodDeclaration(node)&&node.name.getText(tree)===name);
const compile=(body,deps)=>new Function(...Object.keys(deps),ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)(...Object.values(deps));
const emit=musicLibrary=>compile(`return function(cell) ${method('emitPulse').body.getText(tree)}`,{musicLibrary});
const update=method('update').body.statements.find(node=>ts.isIfStatement(node)&&node.getText(tree).includes('this.musicRipples.update(time'));
assert.ok(update,'production update uses the scheduler');
const advance=compile(`return function(time,cinematic) { ${update.getText(tree)} }`,{musicLibrary:true});
const actualField=compile(`return function(row,lane,time) ${method('musicRealColumnField').body.getText(tree)}`,{musicLibrary:true,records:[{}],THREE,musicSelectionWave,settlingWave,idleWave,rippleEnvelope});

test('production scene emission, frame update and real-column field consume the same policy',()=>{
  const host={clock:0,pulses:[],fieldCache:{invalidate(){}},musicRipples:new MusicSelectionRipples(),
    reduced:false,targetDetail:0,targetReveal:1,musicOverview:{active:false,value:0},
    idleGain:0,pulseGain:1,deferSelectionPulse:false,musicRealColumns:{activity:()=>1,row:()=>12}};
  emit(true).call(host,cell(12));assert.equal(host.pulses.length,0);advance.call(host,.18);assert.equal(host.pulses.length,1);
  advance.call(host,.5);
  for(let row=7;row<=18;row++){
    const expected=settlingWave(row-12,26.56)+field(host.pulses,row,.5);
    assert.ok(Math.abs(actualField.call(host,row,2,.5)-expected)<1e-12);
  }
  host.clock=.5;emit(true).call(host,cell(13));advance.call(host,.62);assert.equal(host.pulses[0].gain,1);
  advance.call(host,.69);assert.ok(host.pulses.some(p=>p.row===13));
  host.targetDetail=1;advance.call(host,.7);advance.call(host,.95);assert.equal(host.pulses.length,0);
});

test('original non-music demo keeps its existing pulse behavior',()=>{
  const host={clock:0,pulses:[],fieldCache:{invalidate(){}}};
  for(let row=0;row<10;row++)emit(false).call(host,cell(row));
  assert.equal(host.pulses.length,6);assert.equal(host.pulses[0].row,4);
});

// Immutable previous preview supplies the control algorithm, not a rewrite of it.
const priorSource=execFileSync('git',['show','03a65f3:src/music-selection-ripples.ts'],{encoding:'utf8'});
const PriorPolicy=compile(`${priorSource.replace(/^import[^\r\n]*\r?\n/m,'').replace('export interface','interface').replace('export class','class')}\nreturn MusicSelectionRipples;`,{smooth});
function secondSwitch(Policy){
  const policy=new Policy(),frames=[];let delivered=0;
  for(let frame=0;frame<=180;frame++){
    const time=frame/120;
    while(delivered<2&&[0,.45][delivered]<=time+1e-9){policy.request(cell(delivered),time);delivered++;}
    const waves=policy.update(time);let amplitude=0;
    for(let row=-20;row<40;row+=.25)amplitude=Math.max(amplitude,Math.abs(field(waves,row,time)));
    frames.push({time,amplitude,waves});
  }
  const handoff=frames.filter(frame=>frame.time>=.65&&frame.time<=.85);
  return {minimumAmplitude:Math.min(...handoff.map(frame=>frame.amplitude)),
    weakFrames:handoff.filter(frame=>frame.amplitude<.005).length,frames};
}
test('two actual switches at 0 and 450ms no longer fade into a nearly motionless gap',()=>{
  const old=secondSwitch(PriorPolicy),current=secondSwitch(MusicSelectionRipples);
  assert.ok(old.weakFrames>0,'the previous policy reproduces the low-motion handoff');
  assert.equal(current.weakFrames,0);assert.ok(current.minimumAmplitude>old.minimumAmplitude*10);
  fs.mkdirSync('artifacts/ripple-handoff',{recursive:true});
  fs.writeFileSync('artifacts/ripple-handoff/second-switch.json',JSON.stringify({
    scope:'Source scalar animation only. Peak wave displacement is not frame time or visual acceptance.',
    inputTimesSeconds:[0,.45],comparisonWindowSeconds:[.65,.85],sampleHz:120,
    before:{minimumAmplitude:old.minimumAmplitude,weakFrames:old.weakFrames},
    after:{minimumAmplitude:current.minimumAmplitude,weakFrames:current.weakFrames},
    frames:current.frames,
  },null,2));
});

test('rapid retargeting during a handoff preserves positions and never adds full-strength waves',()=>{
  const policy=new MusicSelectionRipples();let next=0;
  for(let frame=0;frame<120*6;frame++){
    const time=frame/120;
    if(next/4<=time+1e-9){
      const before=policy.update(time);policy.request(cell(next++),time);const after=policy.update(time);
      for(let row=-20;row<50;row++)assert.ok(Math.abs(field(before,row,time)-field(after,row,time))<1e-12);
    }
    const waves=policy.update(time);
    assert.ok(waves.reduce((sum,p)=>sum+p.gain,0)<=1+1e-12,'crossfade weights never amplify overlap');
  }
});

test('matched fixed-time input removes the measured truncation jump and high overlap',()=>{
  const results=[];
  for(const rate of [2,4,8,12]){
    const policy=new MusicSelectionRipples(),old=[];let next=0,oldJump=0,newJump=0,oldPeak=0,newPeak=0;
    for(let frame=0;frame<(11/rate+3.5)*120;frame++){
      const time=frame/120;
      while(next<12&&next/rate<=time+1e-9){
        const oldBefore=old.slice(),newBefore=policy.update(time);
        old.push({...cell(next),time});if(old.length>6)old.shift();policy.request(cell(next),time);
        const newAfter=policy.update(time);
        for(let row=-20;row<36;row+=.5){
          oldJump=Math.max(oldJump,Math.abs(field(old,row,time)-field(oldBefore,row,time)));
          newJump=Math.max(newJump,Math.abs(field(newAfter,row,time)-field(newBefore,row,time)));
        }
        next++;
      }
      const current=policy.update(time);oldPeak=Math.max(oldPeak,old.length);newPeak=Math.max(newPeak,current.length);
    }
    assert.ok(oldJump>.001);assert.ok(newJump<1e-12);assert.ok(newPeak<=2);
    results.push({inputsPerSecond:rate,inputs:12,oldMaxInputJump:oldJump,newMaxInputJump:newJump,oldMaxActive:oldPeak,newMaxActive:newPeak,emitted:policy.snapshot().emitted,coalesced:policy.snapshot().coalesced});
  }
  fs.mkdirSync('artifacts/ripple-policy',{recursive:true});fs.writeFileSync('artifacts/ripple-policy/comparison.json',JSON.stringify(results,null,2));
});
