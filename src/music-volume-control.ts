import './music-volume-control.css';

export function transportVolumeMarkup(volume: number) {
  const level = Math.round(Math.max(0, Math.min(1, volume)) * 100);
  return `<div class="transport-volume" id="transport-volume" data-transport-volume>
    <button type="button" class="transport-volume-button" data-volume-toggle aria-label="音量" title="调节音量" aria-expanded="false" aria-controls="transport-volume-popover"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><g class="volume-waves"><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></g><path class="volume-muted" d="m16 9 6 6m0-6-6 6"/></svg></button>
    <div class="transport-volume-popover" id="transport-volume-popover" role="group" aria-label="歌曲音量" hidden><input data-volume-slider type="range" min="0" max="100" step="1" value="${level}" aria-label="歌曲音量"><output data-volume-value>${level}%</output></div>
  </div>`;
}

/** Reuse the player's existing volume API; native range supports drag/touch. */
export function mountTransportVolume(root: HTMLElement, initial: number, change: (volume: number) => void) {
  const events = new AbortController(), signal = events.signal;
  const button = root.querySelector<HTMLButtonElement>('[data-volume-toggle]')!;
  const popover = root.querySelector<HTMLElement>('#transport-volume-popover')!;
  const slider = root.querySelector<HTMLInputElement>('[data-volume-slider]')!;
  const output = root.querySelector<HTMLOutputElement>('[data-volume-value]')!;
  const setOpen = (open: boolean) => {
    popover.hidden = !open; button.setAttribute('aria-expanded', String(open));
  };
  const update = (volume: number) => {
    const level = Math.round(Math.max(0, Math.min(1, volume)) * 100);
    slider.value = String(level); slider.setAttribute('aria-valuetext', `${level}%`);
    output.value = `${level}%`; button.title = `音量 ${level}%`;
    button.setAttribute('aria-label', `调节音量，当前 ${level}%`);
    root.dataset.muted = String(level === 0);
    const settingsSlider = document.querySelector<HTMLInputElement>('#volume');
    if (settingsSlider) settingsSlider.value = String(level);
  };
  button.addEventListener('click', event => {
    event.stopPropagation(); setOpen(popover.hidden);
  }, {signal});
  slider.addEventListener('input', () => {
    const volume = Number(slider.value) / 100;
    update(volume); change(volume);
  }, {signal});
  document.addEventListener('pointerdown', event => {
    if (!root.contains(event.target as Node)) setOpen(false);
  }, {signal});
  document.addEventListener('keydown', event => {
    if (!popover.hidden && event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); setOpen(false);
    }
  }, {capture: true, signal});
  window.addEventListener('blur', () => setOpen(false), {signal});
  update(initial);
  return {update, dispose() { events.abort(); setOpen(false); }};
}
