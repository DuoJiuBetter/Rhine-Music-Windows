import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicSpectrum } from '../src/music-spectrum.ts';
import { normalizeVisualizer, spectrumBands, visualizerMarkup } from '../src/music-visualizer.ts';
import { FlowingWave, flowingLevelAt } from '../src/music-flowing-wave.ts';

test('drawing styles sample the same bounded spectrum with preserved peaks and symmetric endpoints',()=>{
  const levels=new Float32Array([0,.4,.9,.4,0]);
  assert.equal(flowingLevelAt(levels,0),0);assert.equal(flowingLevelAt(levels,1),0);
  assert.equal(flowingLevelAt(levels,3/6),levels[2]);
  for(let i=0;i<=100;i++){
    const x=i/100,v=flowingLevelAt(levels,x);
    assert.ok(v>=0 && v<=.9);assert.ok(Math.abs(v-flowingLevelAt(levels,1-x))<1e-6);
  }
  assert.equal(flowingLevelAt(levels,NaN),0);
});

test('flowing wave keeps dynamic contrast, responds to accents and settles without invented motion',()=>{
  const wave=new FlowingWave(),input=new Uint8Array(512);input[8]=160;
  for(let i=0;i<60;i++)wave.update(input,48000,1/60);
  const quiet=Math.max(...wave.levels);
  input[8]=220;
  for(let i=0;i<8;i++)wave.update(input,48000,1/60);
  const attack=Math.max(...wave.levels);
  assert.ok(quiet>.05 && quiet<.6);assert.ok(attack>quiet*1.7 && attack>.7,'accent visibly rises within 134 ms');
  assert.ok(wave.levels.some(v=>v===0),'empty frequency bands stay empty');
  for(let i=0;i<60;i++)wave.update(undefined,48000,1/60);
  assert.ok(wave.levels.every(v=>v===0),'one second of silence stops the motion');
  wave.reset();assert.ok(wave.levels.every(v=>v===0));
});

test('flowing wave remains bounded across frame rates, long stalls and invalid samples',()=>{
  const input=new Uint8Array(512);input[8]=200;
  const histories=[];
  for(const fps of [8,30,60]){
    const wave=new FlowingWave();
    for(let i=0;i<fps;i++)wave.update(input,48000,1/fps);
    histories.push(Math.max(...wave.levels));
    for(const elapsed of [10,NaN,-1,1/60])wave.update(input,48000,elapsed);
    assert.ok(wave.levels.every(v=>Number.isFinite(v)&&v>=0&&v<=.995));
    wave.reset();wave.update(input,NaN,1/60);assert.ok(wave.levels.every(v=>v===0));
  }
  assert.ok(Math.max(...histories)-Math.min(...histories)<.01,'motion depends on elapsed time, not number of frames');
});

test('higher resolution and fractional integration retain distinct low-frequency peaks',()=>{
  const wave=new FlowingWave(),input=new Uint8Array(2048);
  for(let i=0;i<input.length;i++)input[i]=Math.round(150+50*Math.sin(i*(48000/4096)/80));
  for(let i=0;i<60;i++)wave.update(input,48000,1/60);
  const low=Array.from(wave.levels.slice(0,6));
  for(let i=1;i<low.length;i++)assert.ok(Math.abs(low[i]-low[i-1])>1e-5,'neighbouring low bands do not collapse to repeated FFT bins');
});

test('only approved styles/positions survive settings normalization',()=>{
  assert.deepEqual(normalizeVisualizer({}),{enabled:true,position:'progress',style:'bars'});
  assert.deepEqual(normalizeVisualizer({enabled:false,position:'bad',style:'ring'}),{enabled:false,position:'progress',style:'bars'});
  assert.deepEqual(normalizeVisualizer({enabled:true,position:'bottom',style:'dots'}),{enabled:true,position:'bottom',style:'dots'});
  assert.equal(normalizeVisualizer({style:'outline'}).style,'outline');
  const markup=visualizerMarkup(normalizeVisualizer({}));
  for(const label of ['进度条上方','窗口底边','细柱频谱','点阵频谱','极简五柱','流动波形'])assert.ok(markup.includes(label));
  for(const label of ['柔和波形','环形音浪','歌词下方'])assert.ok(!markup.includes(label));
});
test('frequency bands derive solely from actual finite bounded samples',()=>{
  const input=new Uint8Array(512),bands=new Float32Array(128);
  spectrumBands(input,bands);assert.ok(bands.every(v=>v===0));
  input.fill(255);spectrumBands(input,bands);assert.ok(bands.every(v=>v===1));
  input.fill(0);input[30]=255;spectrumBands(input,bands);assert.ok(bands.some(v=>v>0));assert.ok(bands.some(v=>v===0));
});
test('musical frequency range follows sample rate and preserves silence in tail bands',()=>{
  for(const sampleRate of [44100,48000,96000]){
    const input=new Uint8Array(512),bands=new Float32Array(384),binHz=sampleRate/1024;
    input[Math.floor(11900/binHz)]=48;spectrumBands(input,bands,sampleRate);
    assert.ok(bands.at(-1)>0,'a real upper musical frequency reaches the tail');
    input.fill(0);input[Math.floor(16000/binHz)]=255;spectrumBands(input,bands,sampleRate);
    assert.ok(bands.every(v=>v===0),'ultrasonic-only content is not remapped into fake musical activity');
    input.fill(8);spectrumBands(input,bands,sampleRate);
    assert.ok(bands.at(-1)>8/255,'weak real detail remains visible');
  }
});
test('one audible route survives disabling; analysis is separate and disposed',t=>{
  const old=globalThis.AudioContext,location=globalThis.location,connections=new Set();let contexts=0,sources=0,closed=0;
  globalThis.location={href:'http://localhost/',origin:'http://localhost'};
  const destination={},analysers=[];
  globalThis.AudioContext=class{
    state='running';destination=destination;
    constructor(){contexts++;}resume(){return Promise.resolve();}close(){closed++;return Promise.resolve();}
    createMediaElementSource(){sources++;return {connect(node){connections.add(node);},disconnect(node){if(node)connections.delete(node);else connections.clear();}};}
    createAnalyser(){const a={getByteFrequencyData(data){data.fill(110);},disconnect(){}};analysers.push(a);return a;}
  };
  t.after(()=>{globalThis.AudioContext=old;globalThis.location=location;});
  const s=new MusicSpectrum(),audio={src:'/api/audio/one'},data=new Uint8Array(512);
  s.attach(audio);assert.equal(contexts,0,'disabled does not create context');
  s.setEnabled(true);s.unlock();s.attach(audio);s.attach(audio);
  assert.equal(sources,1);assert.equal(contexts,1);assert.equal(connections.size,2);
  assert.equal(analysers[0].smoothingTimeConstant,.7);
  s.setEnabled(true,true);assert.equal(analysers[0].smoothingTimeConstant,.25);assert.equal(analysers[0].maxDecibels,-10);assert.equal(analysers[0].fftSize,4096);
  s.setEnabled(true);assert.equal(analysers[0].smoothingTimeConstant,.7);assert.equal(analysers[0].maxDecibels,-30);assert.equal(analysers[0].fftSize,1024);
  assert.equal(sources,1,'changing response never recreates or reconnects the audible source');
  assert.equal(s.read(data),true);assert.equal(data[0],110);
  s.setEnabled(false);assert.equal(connections.has(destination),true);assert.equal(connections.size,1);
  assert.equal(s.read(data),false);assert.ok(data.every(v=>v===0));
  s.setEnabled(true);assert.equal(sources,1);s.release();assert.equal(connections.size,0);
  s.attach({src:'https://example.com/private.mp3'});assert.equal(sources,1,'opaque external audio is never routed');
  s.dispose();assert.equal(closed,1);
});
