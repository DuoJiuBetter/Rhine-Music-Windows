// Official node-nim SDK is loaded only in this disposable child process.
// No chat text, credentials, tickets or SDK logs are forwarded to stdout.
import { togetherChatMessage, togetherChatPayload, togetherPlayback } from './together-protocol.mjs';
let chat, room, profile, roomId, connected = false, started = false;
const sends = new Map();
const reply = value => { if (process.connected) process.send(value); };
const failure = (stage, code) => Object.assign(new Error(stage), { code: Number.isSafeInteger(Number(code)) ? Number(code) : undefined });
async function connect(value) {
  reply({ event: 'stage', stage: 'sdk-load' });
  const imported = await import('node-nim'), nim = imported.default || imported;
  const client = new nim.NIMClient(), plugin = new nim.NIMPlugin();
  const appKey = '3a6a3e48f6854dfa4e4464f3bdaec3b4';
  if (!client.init(appKey, value.directory + '/', '', { database_encrypt_key_: appKey, use_https_: true, sdk_log_level_: 2 })) throw failure('init');
  client.initEventHandlers(); plugin.initEventHandlers();
  reply({ event: 'stage', stage: 'login' });
  const [login] = await client.login(appKey, value.credentials.accId, value.credentials.token, null, '');
  if (login?.res_code_ !== 200) throw failure('login', login?.res_code_);
  reply({ event: 'stage', stage: 'ticket' });
  const [code, ticket] = await plugin.chatRoomRequestEnterAsync(Number(value.chatRoomId), null, '');
  if (code !== 200 || !ticket) throw failure('ticket', code);
  reply({ event: 'stage', stage: 'chat-enter' });
  chat = new nim.ChatRoom(); if (!chat.init('', '')) throw failure('chat-init');
  chat.initEventHandlers(); room = Number(value.chatRoomId); profile = value.profile; roomId = value.roomId;
  chat.on('enter', (id, step, code) => {
    reply({ event: 'enter-step', step: Number(step), code: Number(code), matches: Number(id) === room });
    if (Number(id) !== room || Number(step) !== 5) return;
    connected = Number(code) === 200; reply({ event: 'connection', connected, code: Number(code) });
    if (connected) void chat.getMessageHistoryOnlineAsync(room, { start_timetag_: Date.now(), limit_: 50, reverse_: false, msg_types_: [0] }, null, '')
      .then(([, status, messages]) => { if (Number(status) === 200) for (const raw of messages.slice().reverse()) receive(room, raw); else reply({ event: 'history-error' }); })
      .catch(() => reply({ event: 'history-error' }));
  });
  chat.on('receiveMsg', receive);
  chat.on('receiveMsgs', (id, messages) => { for (const raw of messages.slice(0, 100)) receive(id, raw); });
  chat.on('linkCondition', (id, condition) => { if (Number(id) === room) { connected = Number(condition) === 0; reply({ event: 'connection', connected, code: Number(condition) }); } });
  chat.on('exit', (id, _error, code) => { if (Number(id) === room) { connected = false; reply({ event: 'connection', connected: false, code: Number(code) }); } });
  chat.on('sendMsg', (id, code, raw) => {
    const request = sends.get(raw.client_msg_id_); if (Number(id) !== room || !request) return;
    clearTimeout(request.timer); sends.delete(raw.client_msg_id_);
    reply({ requestId: request.id, ok: Number(code) === 200, code: Number(code), message: Number(code) === 200 ? { ...togetherChatMessage(raw), id: raw.client_msg_id_, text: request.text, nickname: profile.nickname || '我', time: Date.now() } : undefined });
  });
  if (!chat.enter(room, ticket, { values_: { nick: profile.nickname || '音乐用户', avatar: profile.avatar || '' } }, '')) throw failure('enter');
}
function receive(id, raw) {
  if (Number(id) !== room) return;
  const playback = togetherPlayback(raw); if (playback) { reply({ event: 'playback', playback }); return; }
  const message = togetherChatMessage(raw); if (message) reply({ event: 'message', message });
}
process.on('message', value => {
  if (value?.action === 'connect' && !started) {
    started = true; void connect(value).catch(error => reply({ event: 'failed', stage: ['init', 'login', 'ticket', 'chat-init', 'enter'].includes(error.message) ? error.message : 'sdk', code: error.code }));
  }
  if (value?.action === 'send' && connected && sends.size < 4) {
    try {
      const payload = togetherChatPayload(value.text, roomId, profile);
      const timer = setTimeout(() => { sends.delete(payload.client_msg_id_); reply({ requestId: value.requestId, ok: false, code: 408 }); }, 10000);
      sends.set(payload.client_msg_id_, { id: value.requestId, text: value.text, timer });
      if (!chat.sendMsg(room, payload, '')) { clearTimeout(timer); sends.delete(payload.client_msg_id_); reply({ requestId: value.requestId, ok: false, code: 503 }); }
    } catch { reply({ requestId: value.requestId, ok: false, code: 400 }); }
  }
});
process.on('disconnect', () => process.exit(0));
