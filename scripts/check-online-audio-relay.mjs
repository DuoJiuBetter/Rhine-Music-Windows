import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { OnlineAudioRelay } from './online-audio-relay.mjs';

async function fixture(t, fetcher, now) {
  const relay=new OnlineAudioRelay(fetcher,now);
  const server=http.createServer(async(req,res)=>{
    try { await relay.serve(req.url.split('/').pop(),req,res); }
    catch(error){if(!res.headersSent){res.writeHead(error.status||502);res.end('unavailable');}else res.destroy();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{relay.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return {relay,url:`http://127.0.0.1:${server.address().port}`};
}
test('tickets accept only existing provider allowlists, remain bounded and expire',t=>{
  let now=0;const relay=new OnlineAudioRelay(undefined,()=>now);t.after(()=>relay.dispose());
  for(const url of ['http://127.0.0.1/a','file:///a','https://music.126.net.evil.test/a','https://user:password@m7.music.126.net/a'])assert.throws(()=>relay.register('netease',url));
  for(let i=0;i<40;i++)relay.register('netease',`https://m7.music.126.net/${i}`);
  assert.equal(relay.tickets.size,32);
  assert.match(relay.register('qq','https://isure.stream.qqmusic.qq.com/a'),/^\/api\/online\/audio\/[a-f0-9]{48}$/);
  now=5*3600000;relay.register('netease','https://m7.music.126.net/new');assert.equal(relay.tickets.size,1);
});
test('range streaming preserves bytes/status and never forwards browser cookies',async t=>{
  let options;
  const f=await fixture(t,async(_,o)=>{options=o;return new Response(new Uint8Array([2,3,4]),{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 2-4/8','content-length':'3','accept-ranges':'bytes'}});});
  const path=f.relay.register('netease','https://m7.music.126.net/a?signature=synthetic');
  const r=await fetch(f.url+path,{headers:{Range:'bytes=2-4',Cookie:'private=never-forward'}});
  assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 2-4/8');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[2,3,4]);
  assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Range,'bytes=2-4');
  assert.equal(options.redirect,'manual');assert.ok(options.dispatcher);assert.equal(f.relay.active.size,0);
});
test('redirects are validated on every hop and HTML responses are rejected',async t=>{
  const calls=[];const f=await fixture(t,async(url)=>{calls.push(url);return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});});
  const path=f.relay.register('netease','https://m7.music.126.net/a');
  assert.equal((await fetch(f.url+path)).status,502);assert.equal(calls.length,1);
  const other=await fixture(t,async()=>new Response('<html>no</html>',{headers:{'content-type':'text/html'}}));
  assert.equal((await fetch(other.url+other.relay.register('qq','https://isure.stream.qqmusic.qq.com/a'))).status,502);
});
test('HEAD and 416 preserve range metadata without downloading an audio body',async t=>{
  const methods=[];const f=await fixture(t,async(_,o)=>{methods.push(o.method);return new Response(null,{status:o.method==='HEAD'?200:416,headers:{'content-type':'audio/mpeg','content-range':'bytes */12'}});});
  const path=f.relay.register('netease','https://m7.music.126.net/a');
  assert.equal((await fetch(f.url+path,{method:'HEAD'})).status,200);
  const r=await fetch(f.url+path,{headers:{Range:'bytes=999-'}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */12');
  assert.deepEqual(methods,['HEAD','GET']);
});
test('unknown/expired ticket and malformed ranges do not fetch upstream',async t=>{
  let calls=0;let now=0;const f=await fixture(t,async()=>{calls++;throw Error('must not fetch');},()=>now);
  const path=f.relay.register('netease','https://m7.music.126.net/a');
  assert.equal((await fetch(f.url+path,{headers:{Range:'bytes=0-1,5-6'}})).status,416);
  now=5*3600000;assert.equal((await fetch(f.url+path)).status,410);
  assert.equal((await fetch(f.url+'/api/online/audio/missing')).status,410);assert.equal(calls,0);
});
test('first chunk reaches client before remaining bytes are available; disconnect cancels source',async t=>{
  let cancelled=false;
  const f=await fixture(t,async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));},cancel(){cancelled=true;}}),{headers:{'content-type':'audio/mpeg'}}));
  const path=f.relay.register('netease','https://m7.music.126.net/a');
  const controller=new AbortController(),r=await fetch(f.url+path,{signal:controller.signal});
  const reader=r.body.getReader();assert.deepEqual([...(await reader.read()).value],[1,2,3]);
  controller.abort();await reader.cancel().catch(()=>{});
  for(let i=0;i<30&&f.relay.active.size;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.relay.active.size,0);assert.equal(cancelled,true);
});
