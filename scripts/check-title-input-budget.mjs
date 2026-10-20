import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { CoverWorkBudget } from '../src/cover-work-budget.ts';
import { RapidSwitchBudget } from '../src/rapid-switch-budget.ts';

const source=fs.readFileSync(new URL('../src/scene.ts',import.meta.url),'utf8');
const tree=ts.createSourceFile('scene.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const scene=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='ArchiveScene');
const getter=scene.members.find(n=>ts.isGetAccessor(n)&&n.name.getText(tree)==='rapidSelectionActive');
assert.ok(getter?.body);
function fixture(musicLibrary=true){
 let now=0;
 const read=new Function('musicLibrary','performance',`return function() ${getter.body.getText(tree)}`)(musicLibrary,{now:()=>now});
 const host={optimize:true,rapidEffectsEnabled:true,targetDetail:0,musicOverview:{active:false},dragging:false,coverWork:new CoverWorkBudget()};
 return {host,read:()=>read.call(host),time:value=>{now=value}};
}

test('the first and second selection defer glyph layout without reducing the first GPU frame',()=>{
 const f=fixture(),gpu=new RapidSwitchBudget();assert.equal(f.read(),false);
 for(const now of [0,100]){
  f.time(now);f.host.coverWork.selection(now);assert.equal(f.read(),true);
  assert.equal(f.host.coverWork.plan(now).phase,'input');
  assert.equal(gpu.update(f.host.coverWork.plan(now).phase==='burst',true,.016),0,
   'UI deferral must not move the GPU effect threshold or change model appearance');
 }
 f.time(200);f.host.coverWork.selection(200);
 assert.equal(gpu.update(f.host.coverWork.plan(200).phase==='burst',true,.016),1,'Original third-input GPU policy remains');
});

test('continuous input keeps title geometry deferred and quiet time restores full title layout',()=>{
 const f=fixture();
 for(let i=0;i<100;i++){f.time(i*100);f.host.coverWork.selection(i*100);assert.equal(f.read(),true)}
 f.time(10079);assert.equal(f.read(),true);f.time(10080);assert.equal(f.read(),false);
 f.host.dragging=true;assert.equal(f.read(),true);f.host.dragging=false;assert.equal(f.read(),false);
});

test('detail, overview, reference mode and disabled optimization retain their current UI path',()=>{
 const f=fixture();f.host.coverWork.selection(0);
 for(const [key,value] of [['targetDetail',1],['optimize',false],['rapidEffectsEnabled',false]]){
  const previous=f.host[key];f.host[key]=value;assert.equal(f.read(),false);f.host[key]=previous;
 }
 f.host.musicOverview.active=true;assert.equal(f.read(),false);
 const reference=fixture(false);reference.host.coverWork.selection(0);assert.equal(reference.read(),false);
});

test('production selection tail never re-enables all reels during the input budget',()=>{
 const app=fs.readFileSync(new URL('../src/music-app.ts',import.meta.url),'utf8');
 const appTree=ts.createSourceFile('music-app.ts',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const update=appTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='updateSelection');
 const tail=[...update.body.statements].reverse().find(n=>ts.isIfStatement(n)&&n.getText(appTree).includes('syncSelectionMotion()'));
 assert.ok(tail);let calls=0;
 const run=new Function('syncSelectionMotion',`return function(animated,rapid){${tail.getText(appTree)}}`)(()=>calls++);
 for(let i=0;i<100;i++)run(false,true);assert.equal(calls,0,'No static/animated flip on the second, third or later input');
 run(false,false);assert.equal(calls,1,'Hidden initial layout preparation retains its existing path');
 run(true,false);assert.equal(calls,1);
});
