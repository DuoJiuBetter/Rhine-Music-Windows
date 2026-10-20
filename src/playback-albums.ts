import { musicPlatforms } from './music-platform.ts';
import { queueEntryKey } from './playback-queue.ts';
import type { MusicAlbum, MusicTrack } from './music-types';
/** Each song owns a display slot, including consecutive songs on one album. */
export function playbackAlbums(queue: readonly MusicTrack[], library: readonly MusicAlbum[]) {
  const local = new Map(library.map(album => [album.id, album]));
  return queue.map(track => {
    const source = track.onlineSource, original = local.get(track.albumId);
    let coverUrl = source?.coverUrl || original?.coverUrl;
    if (source?.provider === "netease" && coverUrl) { const url = new URL(coverUrl); url.searchParams.set('param', '512y512'); coverUrl = url.href; }
    return { ...original, id: `playback-${queueEntryKey(track)}`, title: source?.albumTitle || original?.title || track.title,
      artist: original?.artist || track.artist, genreId: 'playback', rawGenres: source ? [musicPlatforms[source.provider]] : original?.rawGenres || [],
      folder: source ? `${musicPlatforms[source.provider]} · 当前播放队列` : original?.folder || '', coverUrl, tracks: [track], producers: original?.producers || [],
      offline: original?.offline || false, online: source ? { status: 'matched' as const, sourceUrl: source.pageUrl } : original?.online,
      playback: { trackId: track.id, albumId: track.albumId, songTitle: track.title, entryId: queueEntryKey(track) } } satisfies MusicAlbum;
  });
}
export function queueShelfAlbums(queue: readonly MusicTrack[], library: readonly MusicAlbum[]) {
  return playbackAlbums(queue, library).map(album => ({ ...album, id: `queue-${album.id}`,
    playback: { ...album.playback, queueShelf: true } }));
}
