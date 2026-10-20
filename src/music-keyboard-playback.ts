/** Coordinate asynchronous model selection with optional playback, newest input wins. */
export class KeyboardPlaybackNavigation {
  private epoch = 0;
  private enabled: () => boolean;
  private play: (index: number) => Promise<void>;
  constructor(enabled: () => boolean, play: (index: number) => Promise<void>) {
    this.enabled = enabled; this.play = play;
  }
  async run(browse: () => Promise<number | undefined>): Promise<void> {
    const epoch = ++this.epoch;
    const index = await browse();
    if (epoch === this.epoch && index !== undefined && this.enabled()) await this.play(index);
  }
  cancel(): void { this.epoch++; }
}

/** Keyboard axes match the displayed playlist columns and song rows. */
export function keyboardMusicDirection(key: string): { axis: 'lane' | 'row'; direction: number } | undefined {
  if (key === 'ArrowUp') return { axis: 'lane', direction: -1 };
  if (key === 'ArrowDown') return { axis: 'lane', direction: 1 };
  if (key === 'ArrowLeft') return { axis: 'row', direction: -1 };
  if (key === 'ArrowRight') return { axis: 'row', direction: 1 };
}
