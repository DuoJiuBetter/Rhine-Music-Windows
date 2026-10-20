import { escapeHtml as esc } from './html';

export const songActionIcons = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14m6-14v14"/></svg>',
  loading: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 1-8 8"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 6 8 6-8 6zM16 8h6m-3-3v6M15 16h7m-7 4h7"/></svg>',
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 11h9M4 16h7m7-4v9m-4-4h8"/></svg>',
};

export function songActionButton(kind: 'play' | 'next' | 'add', label: string, attributes: Record<string, string | number>, disabled = false) {
  return `<button type="button" class="row-song-action" aria-label="${esc(label)}" title="${esc(label)}" ${Object.entries(attributes).map(([key, value]) => `${key}="${esc(String(value))}"`).join(' ')} ${disabled ? 'disabled' : ''}><i data-song-action-icon="${kind}" aria-hidden="true">${songActionIcons[kind]}</i></button>`;
}
