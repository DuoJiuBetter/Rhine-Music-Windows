import content from "../content/archives.json" with { type: "json" };
import type { MusicAlbum, MusicGenre } from "./music-types";
import { musicArtistKey, orderMusicAlbums, type MusicSortMode } from "./music-order.ts";
export { orderMusicAlbums, type MusicSortMode } from "./music-order.ts";

export interface ArchiveRecord {
  id: string;
  title: string;
  en: string;
  department: string;
  category: string;
  date: string;
  lead: string;
  clearance: string;
  abstract: string;
  findings: string[];
  source: string;
  album?: MusicAlbum;
}

export let records: ArchiveRecord[] = content.records;
export let categories = ["全部档案", ...content.categories];
export let archiveColumns = content.columns;
export let musicLibrary = false;
/** Display repetition only; independent from the audio playback mode. */
export let modelLooping = true;
export function setModelLooping(enabled: boolean) { modelLooping = enabled; }
export let slotStride = 32;
export let playlistRows: string[] = [];
export let queueShelfLane = -1;
export let queueShelfStart = -1;
let baseColumns: string[] = [];
let baseFiles: number[][] = [];
let baseSlotStride = 32;
export const shelfColumnPeriod = () => playlistRows.length ? playlistRows.length + Number(queueShelfLane >= 0) : archiveColumns.length;
export function isQueueShelfLane(lane: number) {
  return queueShelfLane >= 0 && lane === queueShelfLane;
}
export function isQueueShelfAlias(lane: number) {
  if (queueShelfLane < 0) return false;
  if (!modelLooping) return isQueueShelfLane(lane);
  const origin = playlistRows.length ? 2 : 0, period = shelfColumnPeriod();
  return ((lane - origin) % period + period) % period + origin === queueShelfLane;
}
export function queueShelfFile(lane: number, row: number) {
  // The column period reserves every queue occurrence, so every occurrence
  // must resolve to the same logical queue rather than leaving an empty lane.
  if (!Number.isInteger(lane) || !isQueueShelfAlias(lane) || !Number.isInteger(row)) return -1;
  const files = columnFiles(queueShelfLane);
  if (!modelLooping) return files[row - 12] ?? -1;
  return files.length ? files[((row - 12) % files.length + files.length) % files.length] : -1;
}
/** Append one logical queue; display repetitions share its existing entries. */
export function setQueueShelfAlbums(queue: readonly MusicAlbum[]) {
  if (queueShelfLane >= 0) {
    records = records.slice(0, queueShelfStart);
    archiveColumns = baseColumns;
    filesByColumn = baseFiles;
    slotStride = baseSlotStride;
  }
  queueShelfLane = queueShelfStart = -1;
  if (!queue.length) return;
  baseColumns = archiveColumns; baseFiles = filesByColumn; baseSlotStride = slotStride;
  // Search shelves have spare empty columns; put the queue beside real content.
  const lastUsed = filesByColumn.reduce((last, files, index) => files.length ? index : last, -1);
  const columns = playlistRows.length ? archiveColumns.length : records.length ? lastUsed + 1 : 2;
  archiveColumns = Array.from({ length: columns }, (_, index) => baseColumns[index] ?? '');
  filesByColumn = Array.from({ length: columns }, (_, index) => baseFiles[index] ?? []);
  queueShelfLane = archiveColumns.length; queueShelfStart = records.length;
  archiveColumns = [...archiveColumns, '播放列表'];
  filesByColumn = [...filesByColumn, queue.map((_, index) => queueShelfStart + index)];
  records = [...records, ...queue.map(album => ({ id: album.id, title: album.title, en: album.artist,
    department: album.artist, category: '播放列表', date: '', lead: album.artist, clearance: '播放列表',
    abstract: album.folder, findings: album.rawGenres, source: album.online?.sourceUrl ?? '播放列表', album }))];
  slotStride = Math.max(slotStride, queue.length + 24);
}
let playlistCells = new Map<string, number>();
let playlistLengths: number[] = [];
let filesByColumn = archiveColumns.map((name) => records.flatMap((record, index) => record.category === name ? [index] : []));

/** Replace the view model atomically; audio files and their metadata stay intact. */
export function setMusicAlbums(albums: MusicAlbum[], genres: MusicGenre[] = [], sortMode: MusicSortMode = "genre") {
  musicLibrary = true;
  queueShelfLane = queueShelfStart = -1;
  playlistRows = []; playlistLengths = []; playlistCells.clear();
  const ordered = orderMusicAlbums(albums, sortMode);
  const usedGenres = new Set(ordered.map((album) => album.genreId));
  const names = new Map(genres.map((genre) => [genre.id, genre.name]));
  const genreIds = [...genres.map((genre) => genre.id).filter((id) => usedGenres.has(id)), ...usedGenres].filter((id, index, all) => all.indexOf(id) === index);
  const genreNames = genreIds.map((id) => names.get(id) ?? id ?? "未分类");
  categories = ["全部专辑", ...genreNames];
  records = ordered.map((album) => ({
    id: album.id, title: album.title, en: album.artist, department: album.artist,
    category: names.get(album.genreId) ?? album.genreId ?? "未分类",
    date: album.year ? String(album.year) : "年份未知", lead: album.artist,
    clearance: album.offline ? "音乐库离线" : `${album.tracks.length} 首歌曲`,
    abstract: album.folder, findings: album.rawGenres,
    source: album.online?.sourceUrl ?? "本地音乐库", album,
  }));
  if (sortMode === "artist") {
    const artists = new Map<string, { name: string; files: number[] }>();
    ordered.forEach((album, index) => {
      const key = musicArtistKey(album);
      let group = artists.get(key);
      if (!group) {
        group = { name: album.artist.trim().replace(/\s+/g, " ") || "未知歌手", files: [] };
        artists.set(key, group);
      }
      group.files.push(index);
    });
    archiveColumns = [...artists.values()].map((group) => group.name);
    filesByColumn = [...artists.values()].map((group) => group.files);
  } else if (sortMode === "album") {
    archiveColumns = [];
    filesByColumn = [];
    for (let start = 0; start < ordered.length; start += 12) {
      const end = Math.min(start + 12, ordered.length);
      archiveColumns.push(`${String(start + 1).padStart(2, "0")}–${String(end).padStart(2, "0")}`);
      filesByColumn.push(Array.from({ length: end - start }, (_, offset) => start + offset));
    }
  } else {
    archiveColumns = genreNames;
    // Use stable genre IDs even when custom genres share a display name.
    filesByColumn = genreIds.map((id) => ordered.flatMap((album, index) => album.genreId === id ? [index] : []));
  }
  slotStride = Math.max(32, ...filesByColumn.map((files) => files.length + 12));
}

/** Finite, contiguous song rows in the existing display pool. Side columns
 * continue the queue in blocks of rows; they never duplicate or wrap songs. */
export function setPlaybackAlbums(albums: MusicAlbum[], rows: number) {
  setMusicAlbums(albums, [{ id: 'playback', name: '播放队列' }]);
  archiveColumns = Array.from({ length: Math.max(5, Math.ceil(albums.length / rows) + 2) }, (_, lane) => lane < 2 ? '' : '播放队列');
  filesByColumn = archiveColumns.map((_, lane) => lane < 2 ? [] : albums.flatMap((_, index) => Math.floor(index / rows) === lane - 2 ? [index] : []));
  slotStride = rows + 12;
}

/** Repeat the finite playlists and each playlist's own songs through the display pool. */
export function setPlaylistAlbums(albums: MusicAlbum[], names: string[]) {
  setMusicAlbums(albums);
  playlistRows = [...names];
  slotStride = Math.max(32, ...albums.map(album => (album.playlistCell?.total || 0) + 24));
  archiveColumns = ['', '', ...names];
  filesByColumn = archiveColumns.map(() => []);
  records.forEach((record, index) => {
    const cell = record.album!.playlistCell!;
    playlistLengths[cell.playlistIndex] = Math.max(0, cell.total);
    const lane = cell.playlistIndex + 2, row = cell.songIndex + 12;
    playlistCells.set(`${lane}:${row}`, index); filesByColumn[lane].push(index);
  });
}
export function playlistFile(lane: number, row: number) {
  if (!playlistRows.length || !Number.isInteger(lane) || !Number.isInteger(row)) return -1;
  if (isQueueShelfAlias(lane)) return queueShelfFile(lane, row);
  if (!modelLooping) {
    if (lane < 2 || lane >= playlistRows.length + 2 || row < 12 || row >= 12 + (playlistLengths[lane - 2] ?? 0)) return -1;
    return playlistCells.get(`${lane}:${row}`) ?? -1;
  }
  const periodColumns = shelfColumnPeriod();
  const playlist = ((lane - 2) % periodColumns + periodColumns) % periodColumns;
  const period = playlistLengths[playlist] || 1;
  const song = ((row - 12) % period + period) % period;
  return playlistCells.get(`${playlist + 2}:${song + 12}`) ?? -1;
}
/** A real playlist position still has its shell before its metadata page arrives. */
export function playlistShellExists(lane: number, row: number) {
  if (!playlistRows.length || !Number.isInteger(lane) || !Number.isInteger(row)) return false;
  if (isQueueShelfAlias(lane)) return queueShelfFile(lane, row) >= 0;
  if (!modelLooping) return lane >= 2 && lane < playlistRows.length + 2 &&
    row >= 12 && row < 12 + (playlistLengths[lane - 2] ?? 0);
  const columns = shelfColumnPeriod();
  const playlist = ((lane - 2) % columns + columns) % columns;
  return (playlistLengths[playlist] ?? 0) > 0;
}

export function columnFiles(lane: number) {
  return filesByColumn[lane] ?? [];
}
export function fileLocation(index: number) {
  const playlist = records[index]?.album?.playlistCell;
  if (playlist) { const lane = playlist.playlistIndex + 2, row = playlist.songIndex + 12; return { lane, row, slot: lane * slotStride + row }; }
  const lane = Math.max(0, filesByColumn.findIndex((files) => files.includes(index)));
  const row = 12 + Math.max(0, columnFiles(lane).indexOf(index));
  return { lane, row, slot: lane * slotStride + row };
}
export function fileAtSlot(slot: number) {
  if (playlistRows.length) return playlistFile(Math.floor(slot / slotStride), slot % slotStride);
  const files = columnFiles(Math.floor(slot / slotStride));
  return files[Math.max(0, Math.min(files.length - 1, (slot % slotStride) - 12))] ?? -1;
}
