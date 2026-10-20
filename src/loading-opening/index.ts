import "./style.css";
import { BootSequence } from "./boot";
import { logo } from "./brand";

/** RhineLabUI's original film runs while the host, library and WebGL prepare. */
export class LoadingOpening {
  readonly root: HTMLElement;
  private stage: HTMLElement;
  private film: BootSequence;
  private status: HTMLElement;
  private retryButton: HTMLButtonElement;
  private frame = 0;
  private elapsed = 0;
  private lastTime: number | undefined;
  private ready = false;
  private finished = false;
  private disposed = false;
  private suspended = false;
  private previousInert = false;
  private opener: HTMLElement | null = null;
  private waiters: (() => void)[] = [];
  private observer: ResizeObserver;

  constructor(private content: HTMLElement) {
    this.root = document.createElement("section");
    this.root.className = "rhine-loading";
    this.root.dataset.state = "playing";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "Rhine Music 正在载入音乐库");
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <div class="opening-stage" data-mode="boot" aria-hidden="true">
        <div id="boot-background" class="boot-background"><svg viewBox="0 0 1920 1080" preserveAspectRatio="none"><g fill="none" stroke="#fff" stroke-width="3"><path d="M-210 705C-45 705 182 704 247 567C337 377 99 306 4 435S27 680 169 631C309 584 227 314 279 111S568-113 568-113"/><path d="M1560-80C1374 114 1671 168 1601 323S1371 367 1431 480S1692 666 1559 787S1329 886 1498 1130"/><circle cx="1450" cy="648" r="346"/><circle cx="1450" cy="648" r="348"/></g></svg></div>
        <header class="brand"><h1>RHINE MUSIC</h1><div>PERSONAL MUSIC ARCHIVE</div><p>MUSIC <b>OS</b></p></header>
        <div class="powered">RHINE MUSIC <b>WINDOWS</b><i></i></div>
        <section class="boot">
          <div class="access-text"></div>
          <div class="boot-logo">${logo}</div>
          <div class="auth-status"><span>▪</span><span id="auth-message"></span><i></i></div>
          <div class="scan"><svg viewBox="0 0 1920 1080"><g fill="none" stroke="#080a08" stroke-width="2" stroke-linecap="round"><path/><path stroke="#fff"/><path/><path/><path/><path/><circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/><circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/><circle class="scan-core" cx="960" cy="540" r="5" fill="#080a08" stroke="none"/></g></svg><span>PREPARING YOUR MUSIC</span></div>
          <div class="welcome"><div class="welcome-panel"></div><div class="welcome-heading">WELCOME TO</div><div class="welcome-company"><strong>RHINE MUSIC</strong><strong class="welcome-highlight">RHINE MUSIC</strong></div><div class="welcome-database">MUSIC ARCHIVE</div><div class="welcome-logo">${logo}</div></div>
          <div class="boot-white"></div>
        </section>
      </div>
      <div class="opening-hold"><strong>RHINE MUSIC</strong><span>MUSIC ARCHIVE</span></div>
      <p class="opening-status" role="status">正在准备音乐库…</p>
      <button type="button" class="opening-skip">跳过开场 ↗</button>
      <button type="button" class="opening-retry" hidden>重新加载</button>`;
    this.content.parentElement!.append(this.root);
    this.stage = this.root.querySelector(".opening-stage")!;
    this.status = this.root.querySelector(".opening-status")!;
    this.retryButton = this.root.querySelector(".opening-retry")!;
    this.film = new BootSequence(this.stage);
    this.retryButton.addEventListener("click", () => location.reload());
    this.root.querySelector('.opening-skip')!.addEventListener('click', () => this.skip());
    this.root.addEventListener("click", event => event.stopPropagation());
    this.root.addEventListener("keydown", event => {
      event.stopPropagation();
      if ((event.key === "Enter" || event.key === "Escape") && this.root.dataset.state !== "error") {
        event.preventDefault();
        this.skip();
      } else if (event.key === "Tab") {
        event.preventDefault();
        (this.retryButton.hidden ? this.root : this.retryButton).focus({ preventScroll: true });
      }
    });
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this.root);
    document.addEventListener("visibilitychange", this.resetClock);
    this.begin();
    // Preserve the existing direct-to-archive review URL.
    if (new URLSearchParams(location.search).get("scene") === "archive") this.skip();
  }

  get active() { return !this.root.hidden && !this.disposed; }

  private begin() {
    if (this.disposed) return;
    this.previousInert = this.content.inert;
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.content.inert = true;
    this.root.hidden = false;
    this.root.dataset.state = "playing";
    this.retryButton.hidden = true;
    this.elapsed = 0;
    this.lastTime = undefined;
    this.finished = false;
    this.ready = false;
    this.fit();
    this.film.update(0);
    this.root.focus({ preventScroll: true });
    this.frame = requestAnimationFrame(this.tick);
  }

  private fit() {
    const { width, height } = this.root.getBoundingClientRect();
    const scale = Math.min(height / 1080, width / 1280) || 1;
    this.stage.style.width = `${width / scale}px`;
    this.stage.style.height = `${height / scale}px`;
    this.stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    this.stage.style.setProperty("--opening-width", `${width / scale}px`);
    this.stage.style.setProperty("--opening-height", `${height / scale}px`);
    this.stage.style.setProperty("--scan-scale", String(Math.min(1, width / scale / 1920)));
    this.stage.dataset.portrait = String(width < height);
  }

  private tick = (now: number) => {
    this.frame = 0;
    if (this.disposed || this.finished || this.suspended || this.root.dataset.state === "error") return;
    // Hidden tabs pause the film instead of consuming unseen source frames.
    if (!document.hidden && this.lastTime !== undefined)
      this.elapsed += Math.min(.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.film.update(Math.min(this.elapsed, 21.92));
    if (this.elapsed >= 21.92) { this.endFilm(); return; }
    this.frame = requestAnimationFrame(this.tick);
  };

  private resetClock = () => { this.lastTime = undefined; };

  setHidden(hidden: boolean) {
    this.suspended = hidden;
    this.lastTime = undefined;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (!hidden && !this.finished && !this.disposed && this.root.dataset.state !== "error")
      this.frame = requestAnimationFrame(this.tick);
  }

  setStatus(text: string) { this.status.textContent = text; }

  /** Retain the music interface's explicit reduced-motion preference. */
  setReduced(reduced: boolean) { if (reduced && this.active) this.skip(); }

  skip() {
    if (this.disposed || this.root.dataset.state === "error") return;
    this.endFilm();
  }

  private endFilm() {
    this.finished = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.root.querySelector<HTMLButtonElement>('.opening-skip')!.hidden = true;
    if (this.ready) this.release();
    else {
      this.root.dataset.state = "waiting";
      this.root.focus({ preventScroll: true });
    }
  }

  completeLoading(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.ready = true;
    // The loading gate still waits for the film, but the ready state is silent.
    this.setStatus("");
    const completion = new Promise<void>(resolve => this.waiters.push(resolve));
    if (this.finished) this.release();
    return completion;
  }

  replay(reduced: boolean): Promise<void> {
    if (this.active || this.disposed) return Promise.resolve();
    this.begin();
    this.setReduced(reduced);
    return this.completeLoading();
  }

  private release() {
    this.root.hidden = true;
    this.content.inert = this.previousInert;
    if (this.opener?.isConnected && !this.opener.closest("[inert], [hidden]"))
      this.opener.focus({ preventScroll: true });
    this.opener = null;
    this.waiters.splice(0).forEach(resolve => resolve());
  }

  fail(error: unknown) {
    if (this.disposed) return;
    if (this.root.hidden) {
      this.previousInert = this.content.inert;
      this.content.inert = true;
      this.root.hidden = false;
    }
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.root.dataset.state = "error";
    this.setStatus(`音乐库加载失败：${error instanceof Error ? error.message : String(error)}`);
    this.retryButton.hidden = false;
    this.retryButton.focus({ preventScroll: true });
  }

  dispose() {
    if (this.disposed) return;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.resetClock);
    this.release();
    this.root.remove();
    this.disposed = true;
  }
}

