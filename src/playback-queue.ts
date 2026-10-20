import type { MusicTrack } from './music-types';

export type PlaybackOrigin =
  | { type: 'playlist'; id: string; name: string; position: number; provider: import('./music-platform').MusicProvider }
  | { type: 'search'; name: string; provider: import('./music-platform').MusicProvider }
  | { type: 'album'; id: string; name: string };
export type QueueEntry = { id: string; temporary: true; replacement?: boolean; origin?: PlaybackOrigin };
export const queueEntryKey = (track?: MusicTrack | null): string => track?.queueEntry?.id ?? track?.id ?? '';
let serial = 0;
// Session-local identity. Audio requests, metadata and cover URLs retain track.id.
export function temporaryTrack(track: MusicTrack, origin?: PlaybackOrigin): MusicTrack {
  return { ...track, queueEntry: { id: `queue-entry-${++serial}`, temporary: true, origin: origin ?? track.queueOrigin } };
}
export function uniqueQueue(tracks: readonly MusicTrack[]): MusicTrack[] {
  const seen = new Set<string>();
  return tracks.filter(track => { const key = queueEntryKey(track); if (seen.has(key)) return false; seen.add(key); return true; });
}
/** A library page refresh must not evict a temporary current song or pending inserts. */
export function refreshPlaybackQueue(incoming: readonly MusicTrack[], previous: readonly MusicTrack[], current: MusicTrack | null, _nextUp: readonly string[]): MusicTrack[] {
  if (!previous.some(track => track.queueEntry)) return uniqueQueue(incoming);
  // An explicit insert/edit already contains the complete ordered queue. Do
  // not rebuild it around the current song and silently discard old inserts.
  if (incoming.some(track => track.queueEntry)) return uniqueQueue(incoming);
  const merged = uniqueQueue(incoming);
  // A paged source refresh supplies only original songs. Keep manual entries
  // at their neighbouring queue positions, even after playback wraps to zero.
  for (let index = 0; index < previous.length; index++) {
    const track = previous[index];
    if (!track.queueEntry || merged.some(item => queueEntryKey(item) === queueEntryKey(track))) continue;
    let insertion = -1;
    for (let before = index - 1; before >= 0; before--) {
      const anchor = merged.findIndex(item => queueEntryKey(item) === queueEntryKey(previous[before]));
      if (anchor >= 0) { insertion = anchor + 1; break; }
    }
    if (insertion < 0) for (let after = index + 1; after < previous.length; after++) {
      const anchor = merged.findIndex(item => queueEntryKey(item) === queueEntryKey(previous[after]));
      if (anchor >= 0) { insertion = anchor; break; }
    }
    merged.splice(insertion < 0 ? merged.length : insertion, 0, track);
  }
  // Preserve the active original song when its source page leaves the window.
  if (current && !current.queueEntry && !merged.some(track => queueEntryKey(track) === queueEntryKey(current))) merged.unshift(current);
  return merged;
}
