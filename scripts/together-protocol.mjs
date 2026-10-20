import { randomUUID } from 'node:crypto';
export const togetherRoomId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 2000) : '';
export function togetherInvite(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'st.music.163.com' || !url.pathname.startsWith('/listen-together/share/') || url.username || url.password || url.port) throw Error();
    const roomId = url.searchParams.get('roomId'), inviterId = url.searchParams.get('inviterId');
    if (!togetherRoomId(roomId) || !/^[1-9]\d{0,15}$/.test(inviterId || '')) throw Error();
    return { roomId, inviterId };
  } catch { throw Object.assign(new Error('请粘贴有效的网易云一起听邀请链接。'), { status: 400 }); }
}
export function togetherChatMessage(raw) {
  if (raw?.msg_type_ !== 0) return undefined;
  const text = clean(raw.msg_body_) || clean(raw.msg_attach_);
  if (!text.trim()) return undefined;
  return { id: clean(raw.client_msg_id_) || randomUUID(), nickname: clean(raw.from_nick_) || '一起听成员',
    userId: clean(raw.from_id_), text, time: Number.isFinite(raw.timetag_) ? raw.timetag_ : Date.now() };
}
export function togetherPlayback(raw, depth = 0) {
  if (depth > 6) return;
  if (typeof raw === 'string' && raw.length <= 65536) { try { return togetherPlayback(JSON.parse(raw), depth + 1); } catch { return; } }
  if (!raw || typeof raw !== 'object') return;
  if (/^[1-9]\d{0,15}$/.test(String(raw.targetSongId)) && ['PLAY', 'PAUSE'].includes(raw.playStatus)) {
    return { songId: String(raw.targetSongId), status: raw.playStatus,
      progressMs: Math.min(86400000, Math.max(0, Number(raw.progress) || 0)),
      serverSeq: Number.isSafeInteger(raw.serverSeq) ? raw.serverSeq : undefined,
      clientSeq: Number.isSafeInteger(raw.clientSeq) ? raw.clientSeq : undefined, observedAt: Date.now() };
  }
  for (const key of ['playCommand', 'commandInfo', 'data', 'content', 'body', 'msg', 'payload', 'msg_attach_', 'msg_body_']) {
    const command = togetherPlayback(raw[key], depth + 1); if (command) return command;
  }
}
export function togetherChatPayload(text, roomId, profile = {}, id = randomUUID()) {
  text = typeof text === 'string' ? text.trim() : '';
  if (!text || text.length > 500 || /\0/.test(text)) throw Object.assign(new Error('聊天消息须为 1 至 500 个字符。'), { status: 400 });
  return { msg_type_: 0, msg_attach_: text, msg_body_: '', client_msg_id_: id, sub_type_: 0,
    msg_setting_: { history_save_: true, route_enabled_: true, anti_spam_using_yidun_: 1,
      ext_: JSON.stringify({ appName: 'music',
        ...(profile.userId && profile.nickname && profile.avatar ? { serverExt: { userId: Number(profile.userId), nickname: profile.nickname, avatarUrl: profile.avatar,
          msgId: Number(BigInt('0x' + id.replaceAll('-', '').slice(0, 12)) % 90000000000n + 10000000000n) } } : {}),
        clientExt: { bizType: 'listenTogether', ltType: 'FRIEND', roomId, clientMsgId: id } }),
    } };
}
