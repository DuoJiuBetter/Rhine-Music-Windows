import { createHash, randomUUID, publicEncrypt, constants } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { QQLoginSession, qqLoginUrl } from './qq-login-session.mjs';
import { validBodianCredential } from './bodian-protocol.mjs';

// Protocol references and the KuGou MIT attribution are recorded in
// docs/WINDOWS-PERF11.md and third-party/KuGouMusicApi-LICENSE.txt.
const require = createRequire(import.meta.url);
const failure = (message, status = 502) => Object.assign(new Error(message), { status });
const md5 = text => createHash('md5').update(text).digest('hex');
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) : '';
const readJson = text => { try { return JSON.parse(text); } catch { throw failure('平台响应格式发生变化。'); } };
const hosts = new Set(['open.weixin.qq.com', 'lp.open.weixin.qq.com', 'u.y.qq.com', 'c.y.qq.com', 'c6.y.qq.com', 'ssl.ptlogin2.qq.com', 'ssl.ptlogin2.graph.qq.com', 'ptlogin2.graph.qq.com', 'graph.qq.com', 'login-user.kugou.com', 'gateway.kugou.com', 'lyrics.kugou.com']);
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const kugouKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB\n-----END PUBLIC KEY-----';
const hash33 = (value, seed = 0) => { let result = seed; for (const letter of value) result = (result * 33 + letter.charCodeAt(0)) | 0; return result & 2147483647; };
const cookiesFrom = headers => Object.fromEntries(headers.getSetCookie().slice(0, 32).flatMap(value => {
  const match = /^([A-Za-z0-9_-]{1,64})=([^;\r\n]{0,2048})/.exec(value); return match ? [[match[1], match[2]]] : [];
}));

export function validPlatformCredential(provider, value) {
  if (!value || typeof value !== 'object') return false;
  if (provider === 'bodian') return validBodianCredential(value);
  return provider === 'qq'
    ? /^[1-9]\d{0,19}$/.test(value.musicid) && typeof value.musickey === 'string' && /^[A-Za-z0-9_=-]{8,4096}$/.test(value.musickey) && (value.loginType === undefined || [1, 2].includes(value.loginType))
      && (value.strMusicid === undefined || /^[1-9]\d{0,19}$/.test(value.strMusicid))
      && (value.encryptUin === undefined || /^[A-Za-z0-9_+/=-]{1,256}$/.test(value.encryptUin))
    : provider === 'kugou' && /^[1-9]\d{0,14}$/.test(value.userid) && typeof value.token === 'string' && /^[A-Za-z0-9_-]{8,4096}$/.test(value.token) && /^\d{1,40}$/.test(value.mid) && /^[A-Za-z0-9-]{1,64}$/.test(value.dev);
}

// Preserve the distinct music account IDs. In particular WeChat's string ID
// must never pass through Number (it can exceed JavaScript's safe integers).
export function qqCredential(user, loginType) {
  const numericId = value => typeof value === 'number' ? Number.isSafeInteger(value) && value > 0 ? String(value) : '' : typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : '';
  const strMusicid = numericId(user.str_musicid || user.strMusicid);
  const musicid = numericId(user.musicid) || strMusicid || numericId(user.uin);
  const encrypted = user.encrypt_uin || user.encryptUin;
  return { musicid, musickey: user.musickey || user.music_key, loginType,
    ...(strMusicid ? { strMusicid } : {}),
    ...(typeof encrypted === 'string' && /^[A-Za-z0-9_+/=-]{1,256}$/.test(encrypted) ? { encryptUin: encrypted } : {}) };
}

function qqWebAuth(credential) {
  if (!validPlatformCredential('qq', credential)) throw failure('请重新登录 QQ 音乐。', 401);
  const uin = credential.strMusicid || credential.musicid;
  const loginType = credential.loginType || (credential.musickey.startsWith('W_X') ? 1 : 2);
  return { uin, gtk: hash33(credential.musickey, 5381), loginType,
    cookie: `uin=${uin}; qqmusic_uin=${uin}; ${loginType === 1 ? `wxuin=${uin}; ` : ''}qqmusic_key=${credential.musickey}; qm_keyst=${credential.musickey}; tmeLoginType=${loginType}` };
}

function qqResponse(result, block, operation) {
  const codes = [result?.code, block?.code].filter(code => code !== undefined);
  const code = codes.find(code => !Number.isFinite(Number(code)) || Number(code) !== 0);
  if (code !== undefined) {
    const safeCode = Number.isSafeInteger(Number(code)) ? Number(code) : '格式异常';
    throw Object.assign(failure(`QQ 音乐${operation}未成功（错误码 ${safeCode}），请重新登录或稍后重试。`), { businessCode: safeCode });
  }
  if (!block?.data || typeof block.data !== 'object') throw failure(`QQ 音乐${operation}响应格式发生变化。`);
  return block.data;
}

/** Fixed HTTPS endpoints only; no evaluation of upstream callback JavaScript. */
export class PlatformLoginProtocols {
  constructor(provider, fetcher = fetch) { this.provider = provider; this.fetcher = fetcher; this.active = 0; }
  async request(url, { signal, method = 'GET', body, headers = {}, image = false, maxBytes = 524288, withHeaders = false, manual = false } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw failure('不支持的登录服务地址。');
    if (this.active >= (this.limit || 2)) throw failure('平台服务正忙，请稍后重试。', 429);
    this.active++;
    try {
      const response = await this.fetcher(parsed, { method, body, headers: { 'User-Agent': userAgent, ...headers }, redirect: manual ? 'manual' : 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
      if (!(response.ok || manual && [301,302,303,307,308].includes(response.status))) throw failure(
        response.status === 401 ? '平台未授权本次请求，请检查登录状态。' : response.status === 403 ? '平台拒绝了本次请求。' : response.status === 429 ? '平台请求过于频繁，请稍后重试。' : '平台服务暂时不可用。',
        response.status >= 400 && response.status < 500 ? response.status : 502,
      );
      if (Number(response.headers.get('content-length') || 0) > maxBytes) throw failure('平台响应过大。');
      const chunks = []; let size = 0;
      for await (const chunk of response.body || []) { size += chunk.length; if (size > maxBytes) throw failure('平台响应过大。'); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      if (!image) return withHeaders ? { text: bytes.toString('utf8'), headers: response.headers, status: response.status } : bytes.toString('utf8');
      const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : bytes[0] === 255 && bytes[1] === 216 ? 'jpeg' : '';
      if (!mime || bytes.length > 96000) throw failure('平台二维码格式发生变化。');
      const value = `data:image/${mime};base64,${bytes.toString('base64')}`;
      return withHeaders ? { image: value, headers: response.headers } : value;
    } catch (error) {
      if (error.status) throw error;
      const catalog = ['u.y.qq.com', 'c.y.qq.com', 'gateway.kugou.com', 'lyrics.kugou.com'].includes(parsed.hostname);
      throw Object.assign(failure(catalog ? '平台音源或曲库请求失败或超时，请稍后重试。' : '平台登录请求失败或超时，请稍后重试。'), { retryable: true, cause: error });
    } finally { this.active--; }
  }
  async qqRpc(module, method, param, credential, signal, loginType = credential?.loginType || (credential?.musickey?.startsWith('W_X') ? 1 : 2)) {
    const auth = credential ? qqWebAuth(credential) : undefined;
    // Login code exchange retains its own protocol. Catalog calls use the Web
    // channel, rather than an Android envelope without its device identifiers.
    const comm = auth ? { ct: 24, cv: 4747474, platform: 'yqq.json', format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, needNewCode: 1,
      uin: auth.uin, g_tk: auth.gtk, g_tk_new_20200303: auth.gtk, authst: credential.musickey, tmeLoginType: String(auth.loginType) }
      : { cv: 13020508, v: 13020508, ct: '11', tmeAppID: 'qqmusic', format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', uid: '0', tmeLoginType: String(loginType) };
    const search = module === 'music.search.SearchCgiService' && method === 'DoSearchForQQMusicDesktop';
    const playback = module === 'vkey.GetVkeyServer' && method === 'CgiGetVkey';
    const key = search ? module : playback ? 'req_0' : 'req';
    // QQ's official portal Web player uses req_0 with ct 24 / cv 0. Account
    // and login calls retain their own envelopes and authenticated cookies.
    const envelope = { ...(search ? {} : { comm: playback && auth ? { uin: auth.uin, format: 'json', ct: 24, cv: 0 } : comm }), [key]: { module, method, param } };
    for (let attempt = 0; ; attempt++) {
      const raw = await this.request('https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', body: JSON.stringify(envelope), headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com', ...(auth ? { Cookie: auth.cookie } : {}) }, signal, maxBytes: 2097152 });
      const result = readJson(raw);
      try { return qqResponse(result, result?.[key], search ? '搜索' : '请求'); }
      catch (error) {
        if (!search || error.businessCode !== 2001 || attempt >= 2) throw error;
        await delay(250, undefined, { signal });
      }
    }
  }
  async qqHttp(path, params, credential, signal) {
    // Fixed account routes only: callers cannot select an arbitrary URL.
    if (!['/rsc/fcgi-bin/fcg_user_created_diss', '/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', '/rsc/fcgi-bin/fcg_get_profile_homepage.fcg'].includes(path)) throw failure('不支持的 QQ 音乐账号接口。', 400);
    const auth = qqWebAuth(credential);
    const query = new URLSearchParams({ format: 'json', inCharset: 'utf8', outCharset: 'utf-8', notice: '0', platform: 'yqq.json', needNewCode: '0', ...params, g_tk: String(auth.gtk), loginUin: auth.uin });
    const result = readJson(await this.request(`https://c.y.qq.com${path}?${query}`, { signal, headers: { Referer: 'https://y.qq.com/portal/profile.html', Cookie: auth.cookie }, maxBytes: 2097152 }));
    return qqResponse(result, result, '账号资料');
  }
  async kugou(path, values, { credential, device, body, signal, router, android = false, base: requestedBase, clearDefault = false, keyHash, full = false, dfid = '-', headers = {} } = {}) {
    const params = { ...(clearDefault ? {} : { dfid, mid: credential?.mid || device?.mid || '0', uuid: '-', appid: 1005, clientver: 20489, clienttime: Math.floor(Date.now() / 1000), ...(credential ? { token: credential.token, userid: credential.userid } : {}) }), ...values };
    if (keyHash) params.key = md5(`${keyHash}57ae12eb6890223e355ccfcb74edf70d${params.appid}${params.mid}${params.userid || 0}`);
    const salt = android || body ? 'OIlwieks28dk2k092lksi2UIkp' : 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
    const serialized = body ? JSON.stringify(body) : '';
    params.signature = md5(salt + Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('') + serialized + salt);
    const base = requestedBase || (android || body ? 'https://gateway.kugou.com' : 'https://login-user.kugou.com');
    const result = readJson(await this.request(`${base}${path}?${new URLSearchParams(params)}`, { method: body ? 'POST' : 'GET', body: serialized || undefined, headers: { dfid, mid: String(params.mid || '0'), clienttime: String(params.clienttime || Math.floor(Date.now() / 1000)), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(router || body ? { 'x-router': router || 'usercenter.kugou.com' } : {}), ...headers }, signal, maxBytes: 2097152 }));
    if (result.status === 0 || (result.error_code && result.error_code !== 0) || (result.errcode && result.errcode !== 0)) throw failure('酷狗音乐请求未成功，可能需要重新登录或当前账号没有权限。');
    return full ? result : result.data;
  }
  async start(signal, method = 'qq') {
    if (this.provider === 'qq') {
      if (method !== 'wechat') {
        const params = new URLSearchParams({ appid: '716027609', e: '2', l: 'M', s: '3', d: '72', v: '4', t: String(Date.now()), daid: '383', pt_3rd_aid: '100497308' });
        const result = await this.request(`https://ssl.ptlogin2.qq.com/ptqrshow?${params}`, { image: true, withHeaders: true, signal, headers: { Referer: 'https://xui.ptlogin2.qq.com/' } });
        const key = cookiesFrom(result.headers).qrsig;
        if (!key || !/^[A-Za-z0-9*_.+/%=-]{8,2048}$/.test(key)) throw failure('QQ 登录二维码没有返回有效会话。');
        const cookies = new QQLoginSession();
        cookies.collect(`https://ssl.ptlogin2.qq.com/ptqrshow?${params}`, result.headers);
        return { key, cookies, method: 'qq', image: result.image };
      }
      const params = new URLSearchParams({ appid: 'wx48db31d50e334801', redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/', response_type: 'code', scope: 'snsapi_login', state: randomUUID() });
      const html = await this.request(`https://open.weixin.qq.com/connect/qrconnect?${params}`, { signal });
      const key = /(?:uuid=|\/connect\/qrcode\/)([A-Za-z0-9_-]{8,128})/.exec(html)?.[1];
      if (!key) throw failure('QQ 音乐二维码暂时无法生成。');
      return { key, method: 'wechat', image: await this.request(`https://open.weixin.qq.com/connect/qrcode/${key}`, { signal, image: true }) };
    }
    const dev = randomUUID(), device = { dev, mid: BigInt(`0x${md5(dev)}`).toString() };
    const data = await this.kugou('/v2/qrcode', { appid: 1001, type: 1, plat: 4, qrcode_txt: 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1005&', srcappid: 2919 }, { device, signal });
    const key = data?.qrcode;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,256}$/.test(key)) throw failure('酷狗音乐二维码暂时无法生成。');
    const QRCode = require('qrcode'); // Already supplied by the locked NetEase SDK.
    return { key, device, image: await QRCode.toDataURL(`https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${key}`, { width: 192, margin: 2 }) };
  }
  async poll(challenge, signal) {
    if (this.provider === 'qq') {
      if (challenge.method === 'qq') return this.pollQQ(challenge, signal);
      const raw = await this.request(`https://lp.open.weixin.qq.com/connect/l/qrconnect?${new URLSearchParams({ uuid: challenge.key, _: String(Date.now()) })}`, { signal, headers: { Referer: 'https://open.weixin.qq.com/' } });
      const code = /wx_errcode\s*=\s*(\d+)/.exec(raw)?.[1];
      if (code === '403' || code === '402') return { state: 'expired' };
      if (code === '404') return { state: 'scanned' };
      if (code === '408') return { state: 'waiting' };
      const authorization = /wx_code\s*=\s*['"]([A-Za-z0-9_-]{1,256})['"]/.exec(raw)?.[1];
      if (code !== '405' || !authorization) throw failure('QQ 音乐扫码状态暂时不可用。');
      const user = await this.qqRpc('music.login.LoginServer', 'Login', { code: authorization, strAppid: 'wx48db31d50e334801' }, undefined, signal, 1);
      const credential = qqCredential(user, 1);
      if (!validPlatformCredential('qq', credential)) throw failure('QQ 音乐未返回有效登录信息。');
      return { state: 'authorized', credential, profile: { userId: credential.musicid, nickname: clean(user.nick || user.nickname) || 'QQ 音乐用户' } };
    }
    const data = await this.kugou('/v2/get_userinfo_qrcode', { plat: 4, srcappid: 2919, qrcode: challenge.key, dev: challenge.device.dev }, { device: challenge.device, signal });
    if (data?.status === 0) return { state: 'expired' };
    if (data?.status === 1) return { state: 'waiting' };
    if (data?.status === 2) return { state: 'scanned' };
    if (data?.status !== 4) throw failure('酷狗音乐扫码状态暂时不可用。');
    const credential = { userid: String(data.userid || ''), token: data.token, ...challenge.device };
    if (!validPlatformCredential('kugou', credential)) throw failure('酷狗音乐未返回有效登录信息。');
    return { state: 'authorized', credential, profile: { userId: credential.userid, nickname: clean(data.nickname || data.nick_name) || '酷狗音乐用户' } };
  }
  async pollQQ(challenge, signal) {
    const cookies = challenge.cookies ||= new QQLoginSession();
    // QQ's confirmation and music authorization are different stages. Preserve
    // response cookies and the confirmed callback when a later request retries.
    if (!challenge.callbackUrl) {
      const params = new URLSearchParams({ u1: 'https://graph.qq.com/oauth2.0/login_jump', ptqrtoken: String(hash33(challenge.key)), ptredirect: '0', h: '1', t: '1', g: '1', from_ui: '1', ptlang: '2052', action: `0-0-${Date.now()}`, js_ver: '20102616', js_type: '1', pt_uistyle: '40', aid: '716027609', daid: '383', pt_3rd_aid: '100497308', has_onekey: '1' });
      const url = `https://ssl.ptlogin2.qq.com/ptqrlogin?${params}`;
      const response = await this.request(url, { signal, withHeaders: true, headers: { Cookie: cookies.header(url) || `qrsig=${challenge.key}`, Referer: 'https://xui.ptlogin2.qq.com/' } });
      cookies.collect(url, response.headers);
      const callback = /^\s*ptuiCB\((.*?)\);?\s*$/s.exec(response.text)?.[1];
      if (!callback) throw failure('QQ 扫码结果格式发生变化。');
      const args = [...callback.matchAll(/'((?:\\.|[^'])*)'/g)].map(match => match[1].replace(/\\x([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\(['\\/])/g, '$1'));
      if (args[0] === '65') return { state: 'expired' };
      if (args[0] === '66') return { state: 'waiting' };
      if (args[0] === '67') return { state: 'scanned' };
      if (args[0] !== '0') throw failure('QQ 暂时无法确认扫码结果。');
      const callbackUrl = qqLoginUrl(args[2]);
      if (callbackUrl.pathname !== '/check_sig' || !/^\d{1,16}$/.test(callbackUrl.searchParams.get('uin')) || !/^[A-Za-z0-9_*.+/%=-]{1,512}$/.test(callbackUrl.searchParams.get('ptsigx')))
        throw Object.assign(failure('QQ 扫码会话格式发生变化，请重新扫码。'), { loginExpired: true });
      // Use QQ's returned URL without reconstructing or dropping query fields.
      challenge.callbackUrl = callbackUrl.href;
    }
    if (!challenge.oauthCode) {
      const authorizeUrl = 'https://graph.qq.com/oauth2.0/authorize';
      let skey = cookies.value(authorizeUrl, ['p_skey', 'p-skey', 'pskey', 'skey']);
      if (!skey) {
        await cookies.follow(this, challenge.callbackUrl, signal);
        skey = cookies.value(authorizeUrl, ['p_skey', 'p-skey', 'pskey', 'skey']);
      }
      if (!skey) throw Object.assign(failure('QQ 已确认扫码，但未取得音乐授权会话。请刷新二维码后重试。'), { loginExpired: true });
      const state = challenge.oauthState ||= randomUUID();
      const body = new URLSearchParams({ response_type: 'code', client_id: '100497308', redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/', scope: 'get_user_info,get_app_friends', state, switch: '', from_ptlogin: '1', src: '1', update_auth: '1', openapi: '1010_1030', g_tk: String(hash33(skey, 5381)), auth_time: String(Date.now()), ui: randomUUID() });
      const authorization = await this.request(authorizeUrl, { signal, manual: true, withHeaders: true, method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://xui.ptlogin2.qq.com/', Cookie: cookies.header(authorizeUrl) } });
      cookies.collect(authorizeUrl, authorization.headers);
      let redirect; try { redirect = new URL(authorization.headers.get('location')); } catch { throw Object.assign(failure('QQ 音乐没有返回授权结果，请重新扫码。'), { loginExpired: true }); }
      const code = redirect.searchParams.get('code');
      if (redirect.protocol !== 'https:' || redirect.hostname !== 'y.qq.com' || redirect.port || redirect.username || redirect.password || redirect.pathname !== '/portal/wx_redirect.html' || !/^[A-Za-z0-9_-]{1,256}$/.test(code) || redirect.searchParams.get('state') !== state)
        throw Object.assign(failure('QQ 音乐授权结果无效，请重新扫码。'), { loginExpired: true });
      challenge.oauthCode = code;
    }
    let user;
    try { user = await this.qqRpc('QQConnectLogin.LoginServer', 'QQLogin', { code: challenge.oauthCode }, undefined, signal, 2); }
    catch (error) { if (!error.retryable) error.loginExpired = true; throw error; }
    const credential = qqCredential(user, 2);
    if (!validPlatformCredential('qq', credential)) throw Object.assign(failure('QQ 音乐未返回有效登录信息，请重新扫码。'), { loginExpired: true });
    return { state: 'authorized', credential, profile: { userId: credential.musicid, nickname: clean(user.nick || user.nickname) || 'QQ 音乐用户' } };
  }
  async profile(credential, signal) {
    if (this.provider === 'qq') {
      const user = await this.qqRpc('music.UserInfo.userInfoServer', 'GetLoginUserInfo', {}, credential, signal);
      return { userId: credential.musicid, nickname: clean(user.nick || user.nickname || user.info?.nick) || 'QQ 音乐用户' };
    }
    const input = Buffer.from(JSON.stringify({ token: credential.token, clienttime: Math.floor(Date.now() / 1000) }));
    if (input.length > 128) throw failure('酷狗登录信息格式发生变化，请重新扫码。');
    const padded = Buffer.alloc(128); input.copy(padded);
    const p = publicEncrypt({ key: kugouKey, padding: constants.RSA_NO_PADDING }, padded).toString('hex').toUpperCase();
    const user = await this.kugou('/v3/get_my_info', { plat: 1 }, { credential, signal, body: { visit_time: Math.floor(Date.now() / 1000), usertype: 1, p, userid: Number(credential.userid) } });
    return { userId: credential.userid, nickname: clean(user?.nickname || user?.nick_name) || '酷狗音乐用户' };
  }
}
