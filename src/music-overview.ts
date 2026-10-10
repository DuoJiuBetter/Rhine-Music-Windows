import * as THREE from "three";
import { damp } from "./motion.ts";

/** A shared transition drives camera framing and real-column centering. */
export class MusicOverviewMotion {
  private progress = { value: 0, velocity: 0 };
  active = false;
  get value() { return THREE.MathUtils.clamp(this.progress.value, 0, 1); }
  update(dt: number, reduced: boolean) {
    if (reduced) this.progress = { value: Number(this.active), velocity: 0 };
    else damp(this.progress, Number(this.active), 6.5, Math.max(0, dt));
    return this.value;
  }
  reset() { this.active = false; this.progress = { value: 0, velocity: 0 }; }
}

export function overviewFraming(width: number, height: number) {
  const aspect = Math.max(1, width) / Math.max(1, height);
  // Show about five columns in landscape and three on narrow portrait screens.
  return { span: Math.max(16.8, 17.5 / aspect), distance: 172, yaw: 28, elevation: 43 };
}

export interface OverviewColumn {
  lane: number;
  name: string;
  count: number;
  x: number;
  y: number;
  selected: boolean;
  /** Shared physical edge visibility; omitted by static projection fixtures. */
  extent?: number;
  playlist?: boolean;
  position?: number;
}

/** A fixed header position leaves room for the complete playlist drawer. */
export function overviewLabelPlacement(column: OverviewColumn, width: number, height: number) {
  const listWidth = Math.min(280, Math.max(0, width - 48));
  const labelWidth = column.playlist ? Math.max(0, listWidth - 40) : width < 600 ? 116 : 160;
  const listHeight = Math.min(260, height * .28, Math.max(50, height - 240));
  const x = column.playlist ? Math.max(listWidth / 2 + 24, Math.min(width - listWidth / 2 - 24, column.x)) : column.x;
  const y = column.playlist ? Math.max(115, Math.min(height - listHeight - 64, column.y)) : column.y;
  return { x, y, labelWidth, listWidth, listHeight };
}

/** Cull labels near screen edges and collisions, prioritising the selected lane. */
export function visibleOverviewLabels(columns: OverviewColumn[], width: number, height: number,
  retained: ReadonlySet<number> = new Set(), expandedLane: number | null = null) {
  const accepted: OverviewColumn[] = [];
  for (const column of [...columns].sort((a, b) => Number(b.lane === expandedLane) - Number(a.lane === expandedLane) ||
    Number(b.selected) - Number(a.selected) ||
    Math.abs(a.x - width / 2) - Math.abs(b.x - width / 2))) {
    if ((column.extent ?? 1) <= (retained.has(column.lane) ? .06 : .12)) continue;
    // A small exit buffer prevents a projected label from chattering at the
    // same edge where it entered. Its retained node still follows the column.
    const edge = retained.has(column.lane) ? -18 : 14;
    // Local entries reserve their button. Playlist headers are placed with
    // enough room for their drawer before the first interaction.
    const rightEdge = retained.has(column.lane) ? 14 : 34;
    const { labelWidth } = overviewLabelPlacement(column, width, height);
    if (column.x < labelWidth / 2 + edge || column.x > width - labelWidth / 2 - (column.playlist ? 0 : 76) - rightEdge ||
      column.y < 115 - (retained.has(column.lane) ? 20 : 0) ||
      column.y > height - 112 + (retained.has(column.lane) ? 20 : 0)) continue;
    const bounds = (value: OverviewColumn) => {
      const placed = overviewLabelPlacement(value, width, height);
      const left = placed.x - (value.playlist ? placed.listWidth : placed.labelWidth) / 2, open = value.lane === expandedLane;
      return { left, right: left + (value.playlist ? placed.listWidth : placed.labelWidth + (open ? 76 : 0)),
        top: placed.y - 62, bottom: placed.y + (open && value.playlist ? placed.listHeight : 0) };
    };
    const box = bounds(column);
    if (accepted.some((other) => {
      const otherBox = bounds(other);
      return box.left < otherBox.right + 10 && box.right + 10 > otherBox.left &&
        box.top < otherBox.bottom && box.bottom > otherBox.top;
    })) continue;
    accepted.push(column);
  }
  return accepted.sort((a, b) => a.x - b.x);
}
