/** Keep wheel input in the current column and reuse the ordinary album motion. */
export type MusicWheelInput = Pick<
  WheelEvent,
  "deltaMode" | "deltaX" | "deltaY" | "ctrlKey" | "shiftKey"
>;

const PIXELS_PER_ALBUM = 48;
const GESTURE_GAP_MS = 200;

export function musicWheelDelta(event: MusicWheelInput, pageHeight: number) {
  // Read deltaMode before the deltas: some browsers adapt their units when
  // callers inspect it. Pinch-to-zoom and horizontal gestures keep their owner.
  const unit =
    event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? Math.max(1, pageHeight)
        : 1;
  if (
    event.ctrlKey ||
    event.shiftKey ||
    !Number.isFinite(event.deltaY) ||
    !Number.isFinite(event.deltaX) ||
    Math.abs(event.deltaX) >= Math.abs(event.deltaY)
  )
    return 0;
  return event.deltaY * unit;
}

export class MusicWheelSteps {
  private remainder = 0;
  private direction = 0;
  private lastTime = -Infinity;

  reset() {
    this.remainder = 0;
    this.direction = 0;
    this.lastTime = -Infinity;
  }

  consume(delta: number, now: number) {
    if (!Number.isFinite(delta) || !delta) return 0;
    const direction = Math.sign(delta);
    if (
      now - this.lastTime > GESTURE_GAP_MS ||
      now < this.lastTime ||
      direction !== this.direction
    ) {
      this.remainder = 0;
    }
    this.lastTime = now;
    this.direction = direction;
    // Keep small trackpad deltas, but treat a mouse notch/page event as one
    // adjacent album regardless of the Windows scroll-distance setting.
    this.remainder +=
      Math.min(Math.abs(delta), PIXELS_PER_ALBUM) *
      direction;
    const steps = Math.trunc(this.remainder / PIXELS_PER_ALBUM);
    this.remainder -= steps * PIXELS_PER_ALBUM;
    return steps || 0;
  }
}

/** Coalesce a burst into one adjacent step; never accumulate multi-album jumps. */
export class MusicWheelDispatch {
  private pending = 0;
  private lastTime = -Infinity;
  private lastDirection = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private navigate: (steps: number) => void;
  constructor(navigate: (steps: number) => void) { this.navigate = navigate; }
  push(steps: number, now = performance.now()) {
    if (!Number.isFinite(steps) || !steps) return;
    const direction = Math.sign(steps);
    if (direction !== this.lastDirection || now < this.lastTime) this.reset();
    this.lastDirection = direction;
    // Even several notches within this window commit only an adjacent target.
    // Do not replay a queue after the user's wheel has stopped.
    this.pending = direction;
    if (now - this.lastTime >= 80) this.flush(now);
    else if (this.timer === undefined) this.timer = setTimeout(() => this.flush(performance.now()), 80 - (now - this.lastTime));
  }
  private flush(now: number) {
    clearTimeout(this.timer); this.timer = undefined;
    const steps = this.pending; this.pending = 0;
    if (steps) { this.lastTime = now; this.navigate(steps); }
  }
  reset() {
    clearTimeout(this.timer); this.timer = undefined;
    this.pending = 0; this.lastTime = -Infinity; this.lastDirection = 0;
  }
}

type MusicWheelOptions = {
  enabled: () => boolean;
  navigate: (direction: number) => void;
  /** A column identity, so a partial gesture cannot leak into another singer. */
  context?: () => string | number;
};

const NATIVE_WHEEL_TARGETS = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  "[contenteditable]:not([contenteditable=false])",
  "dialog",
  "[role=dialog]",
  "[role=slider]",
  ".music-panel-scrim",
  "#music-detail",
  ".lighting-lab",
  ".animation-lab",
  "[data-developer-panel]",
].join(",");

function keepsNativeWheel(target: EventTarget | null, stage: HTMLElement) {
  if (!(target instanceof Element)) return true;
  if (target.closest(NATIVE_WHEEL_TARGETS)) return true;
  // Keep native scroll ownership even at a pane's top/bottom boundary. This
  // also protects future scrollable content without a special class name.
  for (
    let element: Element | null = target;
    element && element !== stage;
    element = element.parentElement
  ) {
    if (element.scrollHeight <= element.clientHeight + 1) continue;
    const overflow = getComputedStyle(element).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay")
      return true;
  }
  return false;
}

export function mountMusicWheelNavigation(
  stage: HTMLElement,
  options: MusicWheelOptions,
) {
  const steps = new MusicWheelSteps();
  let context: string | number | undefined;
  const dispatch = new MusicWheelDispatch(direction => {
    if (options.enabled() && options.context?.() === context) options.navigate(direction);
  });
  const reset = () => { steps.reset(); dispatch.reset(); };
  const onWheel = (event: WheelEvent) => {
    if (
      event.defaultPrevented ||
      !options.enabled() ||
      keepsNativeWheel(event.target, stage)
    ) {
      reset();
      return;
    }
    const delta = musicWheelDelta(event, stage.clientHeight);
    if (!delta) {
      reset();
      return;
    }
    const nextContext = options.context?.();
    if (nextContext !== context) reset();
    context = nextContext;
    event.preventDefault();
    const direction = steps.consume(delta, performance.now());
    if (direction) dispatch.push(direction);
  };
  // Bubble only: controls can retain wheel ownership with stopPropagation.
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("pointerdown", reset, { passive: true });
  stage.addEventListener("keydown", reset);
  window.addEventListener("blur", reset);
  const owner = stage.ownerDocument;
  const onHidden = () => { if (owner.hidden) reset(); };
  owner?.addEventListener("visibilitychange", onHidden);
  return {
    reset,
    dispose() {
      reset();
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", reset);
      stage.removeEventListener("keydown", reset);
      window.removeEventListener("blur", reset);
      owner?.removeEventListener("visibilitychange", onHidden);
    },
  };
}
