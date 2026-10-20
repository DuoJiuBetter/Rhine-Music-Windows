import test from 'node:test';
import assert from 'node:assert/strict';
import {MusicWheelDispatch} from '../src/music-wheel-navigation.ts';
import {CoverWorkBudget} from '../src/cover-work-budget.ts';
function clock(t){
 const oldNow=Object.getOwnPropertyDescriptor(performance,'now'),oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;
 let now=0,id=0;const timers=new Map();
 Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
 globalThis.setTimeout=(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 t.after(()=>{globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;if(oldNow)Object.defineProperty(performance,'now',oldNow);else delete performance.now;});
 return{timers,advance(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;}};
}
test('dense wheel events commit only adjacent models without a delayed backlog',t=>{
 const c=clock(t),moves=[],dispatch=new MusicWheelDispatch(n=>moves.push(n));
 for(let i=0;i<120;i++){dispatch.push(1);c.advance(8);}
 c.advance(80);
 assert.ok(moves.every(n=>n===1),'The coalescer must never undo one-step input by summing notches');
 assert.ok(moves.length>=12,'Sustained scrolling still advances repeatedly');
 assert.ok(moves.length<=14,`Expected at most 14 switches, got ${moves.length}`);
 assert.equal(c.timers.size,0);
 console.log(JSON.stringify({scenario:'120 wheel steps at 8ms spacing',inputSteps:120,selectionCalls:moves.length,totalSteps:moves.reduce((a,b)=>a+b,0),maxStep:Math.max(...moves),applicationFpsMeasured:false}));
});
test('oversized bursts are bounded and reversing discards obsolete pending travel',t=>{
 const c=clock(t),moves=[],dispatch=new MusicWheelDispatch(n=>moves.push(n));
 dispatch.push(3);for(let i=0;i<30;i++)dispatch.push(3);c.advance(20);dispatch.push(-1);c.advance(100);
 assert.deepEqual(moves,[1,-1]);
 dispatch.push(-3);for(let i=0;i<30;i++)dispatch.push(-3);c.advance(80);
 assert.ok(moves.every(n=>Math.abs(n)===1));dispatch.reset();assert.equal(c.timers.size,0);
});
test('two notches inside a coalescing window cannot become a two-model jump',t=>{
 const c=clock(t),moves=[],dispatch=new MusicWheelDispatch(n=>moves.push(n));
 dispatch.push(1);c.advance(20);dispatch.push(1);c.advance(20);dispatch.push(1);
 c.advance(40);assert.deepEqual(moves,[1,1]);
 c.advance(500);assert.deepEqual(moves,[1,1],'No queued travel after scrolling stops');
});
test('pointer/key/context reset cancels pending work; slow scrolling stays immediate',t=>{
 const c=clock(t),moves=[],dispatch=new MusicWheelDispatch(n=>moves.push(n));
 dispatch.push(1);dispatch.push(1);dispatch.reset();c.advance(100);assert.deepEqual(moves,[1]);
 dispatch.push(1);assert.deepEqual(moves,[1,1]);c.advance(120);dispatch.push(1);assert.deepEqual(moves,[1,1,1]);dispatch.reset();
});
test('rapid wheel cover work is limited only until input quiets, not until all springs settle',()=>{
 const budget=new CoverWorkBudget();budget.wheel(0);budget.wheel(40);budget.wheel(80);
 assert.equal(budget.plan(80).phase,'burst');assert.equal(budget.plan(80).uploadIntervalMs,80);assert.equal(budget.plan(80).uploadTiles,1);
 assert.equal(budget.plan(259).phase,'burst');assert.equal(budget.plan(260).phase,'quiet');assert.equal(budget.plan(260).uploadIntervalMs,0);
 budget.wheel(1000);assert.equal(budget.plan(1000).phase,'input');
});

test('rapid actual model selections enter the same burst budget, including slower stalled inputs',()=>{
 const budget=new CoverWorkBudget();
 for(const now of [0,120,240])budget.selection(now);
 assert.equal(budget.plan(240).phase,'burst','list clicks and keyboard selection receive wheel-equivalent resource budgeting');
 assert.equal(budget.plan(419).phase,'burst');assert.equal(budget.plan(420).phase,'quiet');
 budget.selection(NaN);budget.selection(100);assert.equal(budget.plan(420).phase,'quiet');
 budget.selection(1000);assert.equal(budget.plan(1000).phase,'input','isolated selections remain immediate');
});
