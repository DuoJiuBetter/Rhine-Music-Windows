/** Yield to input/paint without hanging startup when a hidden WebView stops RAF. */
export function yieldStartupFrame(): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      resolve();
    };
    const frame = requestAnimationFrame(finish);
    const timer = setTimeout(finish, 50);
  });
}

/** A failed optional font/cache job must never hold the interactive shell. */
export async function prepareStartupExtras() {
  await Promise.allSettled([
    Promise.resolve().then(async () => {
      if (!("serviceWorker" in navigator)) return;
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(registrations.map(registration => registration.unregister()));
    }),
    Promise.resolve().then(() => document.fonts.load("400 20px MiSans")),
    Promise.resolve().then(() => document.fonts.load("600 20px MiSans")),
  ]);
}

export class MusicStartup {
  private phase = "pending";
  private started = performance.now();
  private finished: number | undefined;
  private steps: { phase: string; milliseconds: number; outcome: string }[] = [];
  private controller = new AbortController();

  async run<T>(phase: string, task: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
    this.controller.signal.throwIfAborted();
    this.phase = phase;
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    let outcome = "completed";
    try {
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(this.controller.signal.reason);
        this.controller.signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => this.controller.abort(new Error(`启动阶段 ${phase} 超时，请重试或在设置中检查配置。`)), timeoutMs);
      });
      return await Promise.race([Promise.resolve().then(() => {
        this.controller.signal.throwIfAborted();
        return task(this.controller.signal);
      }), cancelled]);
    } catch (error) {
      outcome = this.controller.signal.aborted ? "cancelled-or-timeout" : "failed";
      throw error;
    } finally {
      clearTimeout(timer);
      this.controller.signal.removeEventListener("abort", abort);
      this.steps.push({ phase, milliseconds: Math.round(performance.now() - started), outcome });
    }
  }

  complete() { this.phase = "ready"; this.finished = performance.now(); }
  fail() { this.phase = "error"; this.finished = performance.now(); }
  cancel() { this.controller.abort(new DOMException("页面已关闭", "AbortError")); }
  snapshot() { return { phase: this.phase, milliseconds: Math.round((this.finished ?? performance.now()) - this.started), steps: [...this.steps] }; }
}
