import type { MusicTrack } from "./music-types";

/** Playback order: what happens when a track ends or the user steps forward.
 * Queue order itself is owned by the caller — shuffle rearranges the queue once
 * and then behaves like a wrap-around list, so no listener has to re-derive it. */
export type MusicPlaybackOrder = "sequential" | "loopAll" | "loopOne" | "shuffle";

export const musicPlaybackOrders: readonly {
  id: MusicPlaybackOrder;
  label: string;
  hint: string;
}[] = [
  { id: "sequential", label: "顺序", hint: "顺序播放：按队列顺序播放，最后一首播完停止" },
  { id: "loopAll", label: "循环", hint: "循环播放：最后一首播完回到第一首继续" },
  { id: "loopOne", label: "单曲", hint: "单曲循环：反复播放当前这一首" },
  { id: "shuffle", label: "随机", hint: "随机播放：随机顺序，一轮之内不重复" },
];

export const DEFAULT_PLAYBACK_ORDER: MusicPlaybackOrder = "sequential";
const orderIds = musicPlaybackOrders.map((entry) => entry.id);

export function normalizePlaybackOrder(value: unknown): MusicPlaybackOrder {
  return orderIds.includes(value as MusicPlaybackOrder)
    ? (value as MusicPlaybackOrder)
    : DEFAULT_PLAYBACK_ORDER;
}

export const musicPlaybackOrderLabel = (order: MusicPlaybackOrder) =>
  musicPlaybackOrders.find((entry) => entry.id === order)?.label ?? "";

/** The queue index to play after `index`, or null when playback should stop.
 * `auto` marks the end of a track, which is the only place 单曲循环 repeats:
 * pressing next still moves on, as other players do. */
export function successorIndex(
  order: MusicPlaybackOrder,
  index: number,
  length: number,
  auto: boolean,
): number | null {
  if (index < 0 || index >= length) return null;
  if (order === "loopOne" && auto) return index;
  if (index + 1 < length) return index + 1;
  if (order === "loopAll" || order === "shuffle") return length > 1 ? 0 : index;
  return null;
}

/** The queue index a backward step lands on; boundaries wrap only when looping. */
export function predecessorIndex(
  order: MusicPlaybackOrder,
  index: number,
  length: number,
): number | null {
  if (index < 0 || index >= length) return null;
  if (index > 0) return index - 1;
  return order === "loopAll" || order === "shuffle" ? length - 1 : 0;
}

/** One round of a shuffled queue. The playing track stays first so the current
 * song is never interrupted or duplicated, and every following track appears
 * exactly once. */
export function shuffledQueue(
  queue: readonly MusicTrack[],
  currentId: string | undefined,
  random: () => number = Math.random,
) {
  const rest = queue.filter((track) => track.id !== currentId);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const current = queue.find((track) => track.id === currentId);
  return current ? [current, ...rest] : rest;
}

/** Restores the authored order after leaving shuffle without dropping tracks
 * that arrived while shuffling (a playlist may extend the queue mid-round). */
export function restoreQueueOrder(
  queue: readonly MusicTrack[],
  authored: readonly MusicTrack[],
) {
  const byId = new Map(queue.map((track) => [track.id, track]));
  const restored: MusicTrack[] = [];
  for (const track of authored) {
    const match = byId.get(track.id);
    if (match) {
      restored.push(match);
      byId.delete(track.id);
    }
  }
  return [...restored, ...queue.filter((track) => byId.has(track.id))];
}

export function playbackOrderMarkup() {
  return musicPlaybackOrders
    .map(
      (entry) =>
        `<button type="button" data-playback-order="${entry.id}" aria-pressed="false" aria-label="${entry.hint}" title="${entry.hint}">${playbackOrderIcon(entry.id)}</button>`,
    )
    .join("");
}

export function syncPlaybackOrderUi(root: ParentNode, order: MusicPlaybackOrder) {
  for (const button of root.querySelectorAll<HTMLElement>("[data-playback-order]")) {
    const active = button.dataset.playbackOrder === order;
    button.setAttribute("aria-pressed", String(active));
    if (active) button.setAttribute("aria-checked", "true");
    else button.removeAttribute("aria-checked");
  }
}

/** Icons follow the app's existing language: 24 viewBox, stroke-only, 1.6 width. */
export function playbackOrderIcon(order: MusicPlaybackOrder) {
  const paths: Record<MusicPlaybackOrder, string> = {
    sequential: '<path d="M4 7h11M4 12h8M4 17h11"/><path d="M17 9v6l4-3z"/>',
    loopAll:
      '<path d="M6 8h10a3 3 0 0 1 3 3v1"/><path d="M18 16H8a3 3 0 0 1-3-3v-1"/><path d="M16 5.4 18.6 8 16 10.6"/><path d="M8 13.4 5.4 16 8 18.6"/>',
    loopOne:
      '<path d="M6 8h10a3 3 0 0 1 3 3v1"/><path d="M18 16H8a3 3 0 0 1-3-3v-1"/><path d="M16 5.4 18.6 8 16 10.6"/><path d="M8 13.4 5.4 16 8 18.6"/><path d="M11.4 10.6h1.2v3"/>',
    shuffle:
      '<path d="M4 7h3l3.2 4.2L13 15h4"/><path d="M4 17h3l2-2.6"/><path d="M17 9.6 19.4 12 17 14.4"/><path d="M15 4.6 17.4 7 15 9.4"/>',
  };
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[order]}</svg>`;
}
