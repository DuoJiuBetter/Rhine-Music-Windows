import { archiveColumns, columnFiles, fileLocation, records, playlistRows, playlistFile, isQueueShelfLane, isQueueShelfAlias, queueShelfFile, queueShelfStart, shelfColumnPeriod, modelLooping, musicLibrary } from "./data.ts";

export type ArchiveCell = { lane: number; row: number };
export type ArchiveNavigation =
  { axis: "row" | "lane"; direction: number;
    /** Explicit physical depth for column browsing with position memory disabled. */
    row?: number } | { cell: ArchiveCell; guided?: boolean };

export const LOOP_COLUMNS = 9;
export const LOOP_ROWS = 32;
export const MUSIC_LOOP_ROWS = 48;
export const COLUMN_SPACING = 5.2;
export const ROW_SPACING = 0.62;
const POOL_LANES = [0, 1, 2, 3, 4, -2, -1, 5, 6];

export function wrap(value: number, count: number) {
  if (count <= 0) return 0;
  return ((value % count) + count) % count;
}

// Choose an occurrence of an item in an unbounded sequence. Directional moves
// use adjacent cells instead, so the last-to-first transition never reverses.
export function nearestOccurrence(
  value: number,
  center: number,
  period: number,
) {
  if (period <= 0) return value;
  return value + Math.floor((center - value + period / 2) / period) * period;
}

export function fileAtCell({ lane, row }: ArchiveCell) {
  if (isQueueShelfAlias(lane)) return queueShelfFile(lane, row);
  if (playlistRows.length) return playlistFile(lane, row);
  if (musicLibrary && !modelLooping) {
    if (!Number.isInteger(lane) || !Number.isInteger(row)) return -1;
    return columnFiles(lane)[row - 12] ?? -1;
  }
  if (records[0]?.album?.playback) {
    const index = (lane - 2) * MUSIC_LOOP_ROWS + row - 12;
    return Number.isInteger(index) && index >= 0 && index < (queueShelfStart >= 0 ? queueShelfStart : records.length) ? index : -1;
  }
  const files = columnFiles(wrap(lane, archiveColumns.length));
  return files[wrap(row - 12, files.length)] ?? -1;
}

export function selectionCell(
  index: number,
  current: ArchiveCell,
  navigation?: ArchiveNavigation,
): ArchiveCell {
  if (musicLibrary && !modelLooping) {
    const next = fileLocation(index);
    return { lane: next.lane, row: next.row };
  }
  if (navigation && "cell" in navigation) return { ...navigation.cell };
  const next = fileLocation(index);
  if (isQueueShelfLane(next.lane)) return {
    // Keep browsing in the nearest displayed queue occurrence, including the
    // occurrence beside the first/last playlist at the looping seam.
    lane: nearestOccurrence(next.lane, current.lane, shelfColumnPeriod()),
    row: navigation && 'axis' in navigation && navigation.axis === 'row'
      ? current.row + navigation.direction
      : nearestOccurrence(next.row, current.row, columnFiles(next.lane).length),
  };
  if (playlistRows.length) {
    const total = Math.max(1, records[index]?.album?.playlistCell?.total || 0);
    return {
      lane: navigation && 'axis' in navigation && navigation.axis === 'lane'
        ? current.lane + navigation.direction : nearestOccurrence(next.lane, current.lane, shelfColumnPeriod()),
      row: navigation && 'axis' in navigation && navigation.axis === 'row'
        ? current.row + navigation.direction : nearestOccurrence(next.row, current.row, total),
    };
  }
  if (records[0]?.album?.playback) {
    const row = nearestOccurrence(next.row, current.row, MUSIC_LOOP_ROWS);
    return { row, lane: 2 + (index - (row - 12)) / MUSIC_LOOP_ROWS };
  }
  const row = nearestOccurrence(
    next.row,
    current.row,
    columnFiles(next.lane).length,
  );
  if (navigation?.axis === "row") {
    return { lane: current.lane, row: current.row + navigation.direction };
  }
  return {
    lane:
      navigation?.axis === "lane"
        ? current.lane + navigation.direction
        : nearestOccurrence(next.lane, current.lane, archiveColumns.length),
    row: navigation?.axis === "lane" && Number.isFinite(navigation.row)
      ? Math.round(navigation.row!) : row,
  };
}

// Default to the original 32-row reference. Larger display pools extend both
// ends without changing logical archive rows or the array's 15.5-row center.
export function poolCell(index: number, rows = LOOP_ROWS): ArchiveCell {
  return {
    lane: POOL_LANES[Math.floor(index / rows)],
    row: index % rows - (rows - LOOP_ROWS) / 2,
  };
}

export function visibleCell(index: number, center: ArchiveCell, rows = LOOP_ROWS): ArchiveCell {
  const cell = poolCell(index, rows);
  return {
    lane: nearestOccurrence(
      cell.lane,
      center.lane,
      LOOP_COLUMNS,
    ),
    row: nearestOccurrence(cell.row, center.row, rows),
  };
}

export function cellKey(cell: ArchiveCell) {
  return `${cell.lane}:${cell.row}`;
}

export function sameCell(a: ArchiveCell, b: ArchiveCell) {
  return a.lane === b.lane && a.row === b.row;
}
