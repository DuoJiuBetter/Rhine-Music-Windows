export type MusicProvider = 'netease' | 'qq' | 'bodian';
export const musicPlatforms: Record<MusicProvider, string> = { netease: '网易云音乐', qq: 'QQ 音乐', bodian: '波点音乐' };
export function musicProvider(value: unknown): MusicProvider { return value === 'qq' || value === 'bodian' ? value : 'netease'; }
