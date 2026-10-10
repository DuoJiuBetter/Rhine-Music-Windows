import test from 'node:test';
import assert from 'node:assert/strict';
import { QQLoginSession, qqLoginUrl } from './qq-login-session.mjs';
import { PlatformLoginProtocols } from './platform-login-protocols.mjs';
import { PlatformAuth } from './platform-auth.mjs';

// Synthetic responses only. This file is authored for later regression runs;
// Perf12 validation deliberately checks syntax without running account flows.
test('cookies retain domain/path scope, deletion and a bounded challenge lifetime', () => {
  const jar = new QQLoginSession();
  const url = 'https://ssl.ptlogin2.qq.com/ptqrlogin';
  const headers = new Headers();
  headers.append('set-cookie', 'uin=o123; Domain=.qq.com; Path=/');
  headers.append('set-cookie', 'local=private; Path=/');
  headers.append('set-cookie', 'foreign=private; Domain=evil.example; Path=/');
  jar.collect(url, headers);
  assert.match(jar.header('https://graph.qq.com/oauth2.0/authorize'), /uin=o123/);
  assert.doesNotMatch(jar.header('https://graph.qq.com/oauth2.0/authorize'), /local|foreign/);
  jar.collect(url, new Headers({ 'set-cookie': 'uin=deleted; Domain=.qq.com; Path=/; Max-Age=0' }));
  assert.doesNotMatch(jar.header('https://graph.qq.com/oauth2.0/authorize'), /uin/);
  for (let index = 0; index < 100; index++) jar.collect(url, new Headers({ 'set-cookie': `c${index}=value; Path=/` }));
  assert.equal(jar.cookies.size, 64);
  assert.throws(() => qqLoginUrl('https://graph.qq.com.evil.example/oauth2.0/authorize'));
  assert.throws(() => qqLoginUrl('https://graph.qq.com/other'));
});

test('QQ confirmation preserves cookies and callback fields across check_sig redirects', async () => {
  const visits = [], callback = 'https://ssl.ptlogin2.graph.qq.com/check_sig?uin=123&ptsigx=synthetic_sig&service=ptqrlogin&extra=keep';
  let musicAttempts = 0;
  const protocol = new PlatformLoginProtocols('qq', async (input, init) => {
    const url = new URL(input); visits.push(url.pathname);
    assert.equal(init.redirect === 'manual' || init.redirect === 'error', true);
    if (url.pathname === '/ptqrshow') return new Response(Buffer.from([137,80,78,71,13,10,26,10,0]), { headers: { 'set-cookie': 'qrsig=synthetic_qrsig; Path=/; Domain=.ptlogin2.qq.com' } });
    if (url.pathname === '/ptqrlogin') {
      assert.match(init.headers.Cookie, /qrsig=synthetic_qrsig/);
      return new Response(`ptuiCB('0','0','${callback}','0','成功','Synthetic');`, { headers: { 'set-cookie': 'uin=o123; Path=/; Domain=.qq.com' } });
    }
    if (url.pathname === '/check_sig') {
      assert.equal(url.searchParams.get('extra'), 'keep');
      assert.match(init.headers.Cookie, /uin=o123/);
      return new Response('', { status: 302, headers: { location: 'https://graph.qq.com/oauth2.0/login_jump', 'set-cookie': 'pt4_token=synthetic_token; Domain=.qq.com; Path=/' } });
    }
    if (url.pathname === '/oauth2.0/login_jump') {
      assert.match(init.headers.Cookie, /pt4_token=synthetic_token/);
      return new Response('', { headers: { 'set-cookie': 'p_skey=synthetic_pskey; Domain=.graph.qq.com; Path=/' } });
    }
    if (url.pathname === '/oauth2.0/authorize') {
      assert.match(init.headers.Cookie, /uin=o123/); assert.match(init.headers.Cookie, /p_skey=synthetic_pskey/);
      const state = new URLSearchParams(init.body).get('state');
      return new Response('', { status: 302, headers: { location: `https://y.qq.com/portal/wx_redirect.html?code=synthetic_code&state=${state}` } });
    }
    if (url.pathname === '/cgi-bin/musicu.fcg') {
      assert.equal(JSON.parse(init.body).req.param.code, 'synthetic_code');
      if (++musicAttempts === 1) throw new Error('synthetic temporary network error');
      return Response.json({ code: 0, req: { code: 0, data: { musicid: '123', musickey: 'synthetic_key_123', nick: 'Synthetic' } } });
    }
    throw new Error('Unexpected endpoint');
  });
  const challenge = await protocol.start();
  await assert.rejects(protocol.poll(challenge), /请求失败/);
  const result = await protocol.poll(challenge);
  assert.equal(result.state, 'authorized'); assert.equal(result.credential.musicid, '123');
  for (const path of ['/ptqrlogin', '/check_sig', '/oauth2.0/authorize']) assert.equal(visits.filter(value => value === path).length, 1);
});

test('missing music authorization ends a challenge instead of retrying the confirmed QR forever', async () => {
  let polls = 0;
  const auth = new PlatformAuth({ provider: 'qq', store: { load: async () => ({}), save: async () => assert.fail('must not save'), clear: async () => {} }, transport: {
    start: async () => ({ image: 'data:image/png;base64,iVBORw0KGgo=' }),
    poll: async () => { polls++; throw Object.assign(new Error('请刷新二维码后重试。'), { loginExpired: true }); },
  } });
  const challenge = await auth.start();
  assert.deepEqual(await auth.poll(challenge.id), { state: 'expired', message: '请刷新二维码后重试。' });
  assert.equal((await auth.poll(challenge.id)).state, 'expired'); assert.equal(polls, 1);
  assert.equal(auth.snapshot().loggedIn, false);
});

test('foreign and looping authorization redirects never receive session cookies', async () => {
  for (const location of ['https://localhost/private', 'https://graph.qq.com/oauth2.0/login_jump']) {
    const jar = new QQLoginSession(); let requests = 0;
    await assert.rejects(jar.follow({ request: async () => { requests++; return { status: 302, headers: new Headers({ location }) }; } }, 'https://graph.qq.com/oauth2.0/login_jump'), error => error.loginExpired);
    assert.equal(requests, 1);
  }
});
