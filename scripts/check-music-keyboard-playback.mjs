import test from 'node:test';
import assert from 'node:assert/strict';
import {KeyboardPlaybackNavigation,keyboardMusicDirection} from '../src/music-keyboard-playback.ts';

test('disabled keyboard sync still moves the model but never changes the playing song',async()=>{
  let selected=0,playing=0,enabled=false;
  const navigation=new KeyboardPlaybackNavigation(()=>enabled,async index=>{playing=index;});
  await navigation.run(async()=>{selected=1;return selected;});
  assert.equal(selected,1);assert.equal(playing,0);
  enabled=true;await navigation.run(async()=>{selected=2;return selected;});
  assert.equal(selected,2);assert.equal(playing,2);
  enabled=false;await navigation.run(async()=>{selected=3;return selected;});
  assert.equal(selected,3);assert.equal(playing,2);
});
test('slow playlist selection plays only after its model is ready',async()=>{
  let release,selected=0;const played=[];
  const navigation=new KeyboardPlaybackNavigation(()=>true,async index=>played.push(index));
  const pending=navigation.run(()=>new Promise(resolve=>{release=()=>{selected=7;resolve(selected);};}));
  assert.deepEqual(played,[]);release();await pending;assert.deepEqual(played,[7]);
});
test('a newer keyboard selection prevents stale asynchronous selection from starting audio',async()=>{
  let release;const played=[];
  const navigation=new KeyboardPlaybackNavigation(()=>true,async index=>played.push(index));
  const old=navigation.run(()=>new Promise(resolve=>{release=resolve;}));
  await navigation.run(async()=>2);release(1);await old;assert.deepEqual(played,[2]);
});
test('changing setting or disposing cancels pending playback; invalid target does not play',async()=>{
  let release;const played=[];
  const navigation=new KeyboardPlaybackNavigation(()=>true,async index=>played.push(index));
  const pending=navigation.run(()=>new Promise(resolve=>{release=resolve;}));
  navigation.cancel();release(1);await pending;await navigation.run(async()=>undefined);assert.deepEqual(played,[]);
});


test('vertical keys navigate playlists and horizontal keys navigate songs',()=>{
 assert.deepEqual(keyboardMusicDirection('ArrowUp'),{axis:'lane',direction:-1});
 assert.deepEqual(keyboardMusicDirection('ArrowDown'),{axis:'lane',direction:1});
 assert.deepEqual(keyboardMusicDirection('ArrowLeft'),{axis:'row',direction:-1});
 assert.deepEqual(keyboardMusicDirection('ArrowRight'),{axis:'row',direction:1});
 assert.equal(keyboardMusicDirection('Home'),undefined);
});
