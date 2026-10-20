import test from 'node:test';
import assert from 'node:assert/strict';
import {MusicPlaybackShortcuts} from '../src/music-playback-shortcuts.ts';
import {defaultKeybindings,normalizeKeybindings,swappedKeybindings,keybindingConflict} from '../src/music-keybindings.ts';
import {FRAME_LIMITS,normalizeFrameLimit,RenderScheduler} from '../src/render-scheduler.ts';
function fixture(t) {
  const previousNow=Object.getOwnPropertyDescriptor(performance,'now'),oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;
  let now=0,id=0;const timers=new Map(),calls=[];
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  globalThis.setTimeout=(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  const options={enabled:()=>true,active:()=>true,playing:()=>true,toggle:()=>calls.push('toggle'),navigate:d=>calls.push(['navigate',d]),seek:s=>calls.push(['seek',s]),boost:b=>calls.push(['boost',b])};
  const keys=new MusicPlaybackShortcuts(options);
  t.after(()=>{keys.dispose();globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;if(previousNow)Object.defineProperty(performance,'now',previousNow);else delete performance.now;});
  const advance=ms=>{const end=now+ms;for(;;){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;};
  const event=(key,extra={})=>({key,code:key===' '?'Space':key,repeat:false,preventDefault(){this.prevented=true;},...extra});
  const down=(key,extra)=>{const e=event(key,extra);keys.keydown(e);return e;};
  const up=key=>keys.keyup(event(key));
  return{keys,calls,options,advance,down,up,timers};
}
test('space toggles once; key repeat and modifiers never repeatedly pause',t=>{
  const f=fixture(t);f.down(' ');f.down(' ',{repeat:true});f.up(' ');assert.deepEqual(f.calls,['toggle']);
  f.down(' ',{ctrlKey:true});assert.deepEqual(f.calls,['toggle']);
});
for(const [key,direction] of [['ArrowLeft',-1],['ArrowRight',1]]) {
  test(`${key}: single tap navigates once, double tap seeks 15s without navigating`,t=>{
    const f=fixture(t);f.down(key);f.up(key);f.advance(299);assert.deepEqual(f.calls,[]);f.advance(1);assert.deepEqual(f.calls,[['navigate',direction]]);
    f.calls.length=0;f.down(key);f.up(key);f.advance(120);f.down(key);f.up(key);f.advance(1000);assert.deepEqual(f.calls,[['seek',15*direction]]);
  });
  test(`${key}: holding boosts temporarily and release never navigates or seeks`,t=>{
    const f=fixture(t);f.down(key);f.advance(449);assert.deepEqual(f.calls,[]);f.advance(1);f.down(key,{repeat:true});assert.deepEqual(f.calls,[['boost',true]]);f.up(key);f.advance(1000);assert.deepEqual(f.calls,[['boost',true],['boost',false]]);
  });
}
test('long hold while paused consumes the gesture without starting playback',t=>{
  const f=fixture(t);f.options.playing=()=>false;f.down('ArrowRight');f.advance(600);f.up('ArrowRight');f.advance(400);assert.deepEqual(f.calls,[]);
});
test('blur/disposal cancels boost and pending navigation; editing targets are untouched',t=>{
  const f=fixture(t);f.down('ArrowLeft');f.advance(500);f.keys.cancel();assert.deepEqual(f.calls,[['boost',true],['boost',false]]);
  f.calls.length=0;f.down('ArrowLeft');f.up('ArrowLeft');f.keys.cancel();f.advance(500);assert.deepEqual(f.calls,[]);
  assert.equal(f.down(' ',{target:{closest:()=>({})}}).prevented,undefined);
  f.down('ArrowRight');f.advance(500);f.keys.dispose();assert.deepEqual(f.calls,[['boost',true],['boost',false]]);assert.equal(f.timers.size,0);
});

test('space consumes focused button activation, while typing and IME remain untouched',t=>{
  const f=fixture(t),button={closest:selector=>selector.includes('button')?{}:null};
  assert.equal(f.down(' ',{target:button}).prevented,true);assert.deepEqual(f.calls,['toggle']);
  assert.equal(f.down(' ',{isComposing:true}).prevented,undefined);
  assert.equal(f.down(' ',{target:{closest:selector=>selector.includes('input')?{}:null}}).prevented,undefined);
});
test('swapped scheme moves playlist horizontally and songs/seek/hold vertically',t=>{
  const f=fixture(t);f.options.bindings=()=>swappedKeybindings();f.options.navigatePlaylist=d=>f.calls.push(['playlist',d]);
  f.down('ArrowRight');f.up('ArrowRight');assert.deepEqual(f.calls,[['playlist',1]]);
  f.down('ArrowDown');f.up('ArrowDown');f.advance(300);assert.deepEqual(f.calls.at(-1),['navigate',1]);
  f.down('ArrowUp');f.up('ArrowUp');f.advance(100);f.down('ArrowUp');f.up('ArrowUp');assert.deepEqual(f.calls.at(-1),['seek',-15]);
  f.down('ArrowDown');f.advance(450);f.keys.cancel();assert.deepEqual(f.calls.slice(-2),[['boost',true],['boost',false]]);
});
test('custom independent gesture keys and configuration changes cancel pending work',t=>{
  const f=fixture(t);f.options.bindings=()=>({...defaultKeybindings,songNext:'n',seekForward:'l',boostPrimary:'b'});
  f.down('n');f.up('n');assert.deepEqual(f.calls,[['navigate',1]]);
  f.down('l');f.up('l');f.advance(100);f.down('l');f.up('l');assert.deepEqual(f.calls.at(-1),['seek',15]);
  f.down('b');f.advance(450);f.up('b');assert.deepEqual(f.calls.slice(-2),[['boost',true],['boost',false]]);
  f.down('ArrowLeft');f.up('ArrowLeft');f.keys.cancel();const count=f.calls.length;f.advance(500);assert.equal(f.calls.length,count);
});
test('invalid/reserved/duplicate saved shortcuts recover; cross-gesture sharing is valid',()=>{
  assert.deepEqual(normalizeKeybindings({songPrevious:'Space'}),defaultKeybindings);
  assert.deepEqual(normalizeKeybindings({songNext:'ArrowUp'}),defaultKeybindings);
  assert.equal(normalizeKeybindings({songNext:'N'}).songNext,'n');
  assert.equal(keybindingConflict({...defaultKeybindings}),undefined);
});
test('FPS limits respect 60–240 Hz display clocks, persist valid choices and do not catch up after a stall',()=>{
  assert.equal(normalizeFrameLimit(0),0);assert.equal(normalizeFrameLimit(144),144);assert.equal(normalizeFrameLimit('60'),60);assert.equal(normalizeFrameLimit(-1),60);
  for(const hz of [60,120,144,165,240])for(const cap of FRAME_LIMITS){
    const scheduler=new RenderScheduler();let count=0;
    for(let i=0;i<hz*5;i++)count+=Number(scheduler.shouldRender(i*1000/hz,false,true,cap));
    assert.ok(Math.abs(count-Math.min(hz,cap||hz)*5)<=2,`${hz} Hz / ${cap} FPS: ${count/5}`);
    scheduler.reset();assert.equal(scheduler.shouldRender(90000,true,true,cap),true);
  }
  const scheduler=new RenderScheduler();scheduler.shouldRender(0,false,true,60);scheduler.shouldRender(5000,false,true,60);
  assert.equal(scheduler.shouldRender(5000.01,false,true,60),true);
  assert.equal(scheduler.shouldRender(5000.02,false,true,60),false);
});
