import { musicPlatforms } from './music-platform.ts';
import type { MusicAlbum, MusicTrack } from './music-types';
/** Each song owns a display slot, including consecutive songs on one album. */
export function playbackAlbums(queue: readonly MusicTrack[], library: readonly MusicAlbum[]) {
  const local = new Map(library.map(album => [album.id, album]));
  return queue.map(track => {
    const source = track.onlineSource, original = local.get(track.albumId);
    let coverUrl = source?.coverUrl || original?.coverUrl;
    if (source?.provider === "netease" && coverUrl) { const url = new URL(coverUrl); url.searchParams.set('param', '512y512'); coverUrl = url.href; }
    return { ...original, id: `playback-${track.id}`, title: source?.albumTitle || original?.title || track.title,
      artist: original?.artist || track.artist, genreId: 'playback', rawGenres: source ? [musicPlatforms[source.provider]] : original?.rawGenres || [],
      folder: source ? `${musicPlatforms[source.provider]} · 当前播放队列` : original?.folder || '', coverUrl, tracks: [track], producers: original?.producers || [],
      offline: original?.offline || false, online: source ? { status: 'matched' as const, sourceUrl: source.pageUrl } : original?.online,
      playback: { trackId: track.id, albumId: track.albumId, songTitle: track.title } } satisfies MusicAlbum;
  });
}
