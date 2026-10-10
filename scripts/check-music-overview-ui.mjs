import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const modules = new Map();
async function compiled(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  let { outputText } = ts.transpileModule(await readFile(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  for (const [, specifier] of [...outputText.matchAll(/from\s+["']([^"']+)["']/g)]) {
    const dependency = specifier.startsWith('.')
      ? await compiled(new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, url))
      : import.meta.resolve(specifier);
    outputText = outputText.replaceAll(`"${specifier}"`, JSON.stringify(dependency))
      .replaceAll(`'${specifier}'`, JSON.stringify(dependency));
  }
  const result = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
  modules.set(url.href, result);
  return result;
}
const { MusicOverviewUI } = await import(await compiled(new URL('../src/music-overview-ui.ts', import.meta.url)));
const { setMusicMotionSpeed } = await import(await compiled(new URL('../src/music-motion-settings.ts', import.meta.url)));
const { visibleOverviewLabels, overviewLabelPlacement } = await import(await compiled(new URL('../src/music-overview.ts', import.meta.url)));
const animations = [];
class Animation {
  currentTime = 0; playbackRate = 1; playState = 'running';
  constructor(element, frames, options) {
    Object.assign(this, { element, frames, options });
    this.finished = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.finished.catch(() => {});
    animations.push(this);
  }
  updatePlaybackRate(value) { this.playbackRate = value; }
  cancel() { this.playState = 'idle'; this.reject(new Error('cancelled')); }
  finish() { this.playState = 'finished'; this.currentTime = this.options.duration; this.resolve(); }
}
class Element {
  children = []; style = {}; dataset = {}; attrs = {}; hidden = false; inert = false; listeners = new Map(); keyboardFocus = false;
  constructor(name = 'div', className = '') { this.name = name; this.className = className; }
  append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  set innerHTML(value) {
    this.children = [];
    if (!value) return;
    if (value.includes('overview-playlist-content')) {
      const content = new Element('div', 'overview-playlist-content'), list = new Element('div', 'overview-playlist-tracks');
      list.append(new Element('div', 'overview-playlist-window'));
      content.append(list, new Element('p', 'overview-list-error')); this.append(content); return;
    }
    const card = new Element('div', 'overview-column');
    const label = new Element('button', 'overview-column-label');
    label.append(new Element('strong'), new Element('small'));
    const slot = new Element('span', 'overview-enter-slot');
    const enter = new Element('button', 'overview-enter');
    slot.append(enter);
    const header = new Element('div', 'overview-column-header'), toggleSlot = new Element('span', 'overview-playlist-toggle-slot');
    toggleSlot.append(new Element('button', 'overview-playlist-toggle')); header.append(label, slot, toggleSlot);
    const drawer = new Element('div', 'overview-playlist-drawer'); drawer.append(new Element('div', 'overview-playlist-detail'));
    card.append(header, drawer);
    const morph = new Element('div', 'overview-card-morph'); morph.append(card); this.append(morph);
  }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(type, listener) {
    const items = this.listeners.get(type) || []; items.push(listener); this.listeners.set(type, items);
  }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
  matches(selector) { return selector === ':focus-visible' && this.keyboardFocus; }
  querySelectorAll(selector) {
    const choices = selector.split(',').map(x => x.trim());
    return this.children.flatMap(child => [
      ...(choices.some(x => x.startsWith('.') ? child.className === x.slice(1) : child.name === x) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
  focus() { document.activeElement = this; }
  remove() { this.parent.children = this.parent.children.filter(item => item !== this); }
  animate(frames, options) { return new Animation(this, frames, options); }
  getBoundingClientRect() {
    const expanded = this.querySelector('.overview-column')?.dataset.expanded === 'true';
    return { left: expanded ? 235 : 320, top: expanded ? 120 : 250, width: expanded ? 330 : 160, height: expanded ? 296 : 50 };
  }
}
globalThis.document = { activeElement: null, createElement: name => new Element(name) };
globalThis.getComputedStyle = element => {
  const fade = animations.findLast(a => a.element === element && a.playState !== 'idle' && 'opacity' in a.frames[0]);
  const value = fade ? Number(fade.frames[0].opacity) + (Number(fade.frames[1].opacity) - Number(fade.frames[0].opacity)) * Math.min(1, fade.currentTime / fade.options.duration) : 1;
  return { opacity: String(value), transform: 'translateY(0px)' };
};
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
async function advance(ms) {
  for (const animation of animations) if (animation.playState === 'running') {
    animation.currentTime += ms * animation.playbackRate;
    if (animation.currentTime >= animation.options.duration) animation.finish();
  }
  await flush();
}
function fixture() {
  const surface = new Element(), container = new Element(); surface.hidden = true;
  const chrome = ['overview-heading', 'overview-controls', 'overview-return'].map(name => new Element('div', name));
  surface.append(...chrome, container);
  const ui = new MusicOverviewUI(surface, container, () => chrome[2].focus());
  return { ui, surface, container, chrome };
}
const column = (lane, x) => ({ lane, name: `Artist ${lane}`, count: 3, x, y: 300, selected: lane === 0 });
const update = (f, columns, reduced = false) => f.ui.update(columns, 1280, 720, 1, reduced, '歌手');

{
  const f = fixture(); f.ui.setActive(true, false); update(f, [column(0, 400), column(1, 650)]);
  const first = f.container.children[0], second = f.container.children[1];
  const firstCard = first.querySelector('.overview-column');
  assert.equal(f.ui.canEnter(0), false);
  f.ui.expand(0);
  assert.equal(f.ui.canEnter(0), true);
  assert.equal(first.style.left, '400.00px', 'Expanding an entry must not relocate its projected artist');
  assert.equal(firstCard.dataset.expanded, 'true');
  f.ui.expand(1);
  assert.equal(f.ui.canEnter(0), false); assert.equal(f.ui.canEnter(1), true);
  assert.equal(firstCard.dataset.expanded, 'false');
  assert.equal(second.querySelector('.overview-enter').disabled, false);
  assert.ok(!animations.some(a => a.element === first && a.frames.some(frame => 'transform' in frame)), 'Motion transforms belong to the inner card only');
  await advance(500);
  update(f, [column(1, 700)]);
  assert.equal(f.container.children.length, 2, 'The departing label remains mounted for its exit');
  assert.equal(first.inert, true);
  await advance(80);
  update(f, [column(0, 405), column(1, 700)]);
  await advance(500);
  assert.equal(f.container.children[0], first, 'A reversal reuses the current card, and stale exit callbacks cannot remove it');
  assert.equal(first.style.left, '405.00px');
  f.ui.setActive(false, false);
  assert.equal(f.surface.hidden, false, 'Overview remains mounted throughout its exit');
  await advance(60); f.ui.setActive(true, false); update(f, [column(0, 415)]);
  await advance(600); assert.equal(f.surface.hidden, false, 'An interrupted exit cannot hide the reopened overview');
  f.ui.dispose();
}
{
  const f = fixture(); f.ui.setActive(true, false); update(f, [{ ...column(0, 400), extent: .3 }]);
  const anchor = f.container.children[0];
  assert.equal(anchor.style.opacity, '0.3');
  await advance(500);
  update(f, [{ ...column(0, 420), extent: .04 }]);
  assert.equal(anchor.inert, true, 'A physically vanishing column retires its interactive label');
  assert.equal(anchor.style.left, '420.00px');
  assert.equal(anchor.style.opacity, '0.04');
  assert.ok(!animations.some(a => a.element === anchor && a.frames.some(frame => 'opacity' in frame)), 'Physical opacity cannot be overridden by the UI fade');
  update(f, [{ ...column(0, 430), extent: 0 }]);
  assert.equal(anchor.style.left, '430.00px', 'An exiting label continues following the physical edge');
  assert.equal(anchor.style.opacity, '0', 'The label is fully invisible before a pool slot can recycle');
  await advance(300); assert.equal(f.container.children.length, 0);
  f.ui.dispose();
}
{
  setMusicMotionSpeed(.25);
  const f = fixture(); f.ui.setActive(true, false); update(f, [column(0, 400)]);
  await advance(2000); f.ui.setActive(false, false);
  await advance(600);
  assert.equal(f.surface.hidden, false, 'Slow exits are retained beyond the former fixed wall-clock duration');
  assert.equal(f.container.children.length, 1);
  setMusicMotionSpeed(3); await advance(100);
  assert.equal(f.surface.hidden, true); assert.equal(f.container.children.length, 0);
  f.ui.setActive(true, true); update(f, [column(0, 400)], true);
  assert.equal(f.container.children.length, 1);
  f.ui.setActive(false, true);
  assert.equal(f.surface.hidden, true); assert.equal(f.container.children.length, 0);
  f.ui.dispose(); setMusicMotionSpeed(1);
}
{
  const edge = column(0, 88);
  assert.equal(visibleOverviewLabels([edge], 1280, 720).length, 0);
  assert.equal(visibleOverviewLabels([edge], 1280, 720, new Set([0])).length, 1, 'Retained edge labels have hysteresis');
  assert.equal(visibleOverviewLabels([column(0, 400), column(1, 600)], 1280, 720, new Set(), 0).length, 1, 'An expanded entry owns its extra horizontal space');
  for (const [width, x, labelWidth] of [[1280, 1180, 160], [393, 260, 116]]) {
    assert.equal(visibleOverviewLabels([column(0, x)], width, 720).length, 0, 'A new label must reserve its full right-hand entry before appearing');
    assert.equal(visibleOverviewLabels([column(0, x)], width, 720, new Set([0]), 0).length, 0, 'Exit hysteresis must not retain a clipped entry control');
    const safeX = width - labelWidth / 2 - 76 - 34;
    assert.equal(visibleOverviewLabels([column(0, safeX)], width, 720, new Set(), 0).length, 1);
    assert.ok(safeX + labelWidth / 2 + 76 <= width - 14);
  }
}
{
  const f = fixture(); f.ui.setActive(true, true);
  const playlist = { lane: 2, position: 1, name: '<我的歌单>', playlist: true, count: 1200, x: 400, y: 300, selected: true };
  f.ui.update([playlist], 1280, 720, 1, true, '歌单');
  const label = f.container.children[0].querySelector('.overview-column-label');
  assert.equal(label.querySelector('strong').textContent, '<我的歌单>');
  assert.equal(label.querySelector('small').textContent, '01 / 1200 首歌曲');
  f.ui.update([{ ...playlist, count: 0 }], 1280, 720, 1, true, '歌单');
  assert.equal(label.querySelector('small').textContent, '01 / 0 首歌曲');
  f.ui.expand(2); assert.equal(f.ui.canEnter(2), true, 'empty playlist keeps an entry to its blank model');
  const card = f.container.children[0].querySelector('.overview-column');
  assert.equal(label.hidden, false, 'The original name remains above its drawer');
  assert.equal(card.querySelector('.overview-playlist-drawer').hidden, false);
  assert.equal(card.querySelector('.overview-playlist-detail').inert, false);
  assert.equal(card.querySelector('.overview-playlist-toggle').attrs['aria-expanded'], 'true');
  assert.equal(label.dataset.overviewLane, undefined, 'Only the separate arrow opens a playlist');
  assert.equal(card.querySelector('.overview-enter').disabled, true, 'playlist cards never reveal the old enter arrow');
  f.ui.collapse(); assert.equal(label.hidden, false);
  assert.equal(card.querySelector('.overview-playlist-detail').inert, true, 'Closing disables rows before their visual exit ends');
  f.ui.dispose();
}
{
  const f = fixture(); f.ui.setActive(true, false);
  const playlist = { ...column(2, 400), playlist: true };
  update(f, [playlist]); await advance(500);
  const anchor = f.container.children[0], morph = anchor.querySelector('.overview-card-morph');
  const card = anchor.querySelector('.overview-column'), header = card.querySelector('.overview-column-header');
  const toggle = card.querySelector('.overview-playlist-toggle'), drawer = card.querySelector('.overview-playlist-drawer');
  const label = card.querySelector('.overview-column-label'), details = card.querySelector('.overview-playlist-detail');
  const position = [anchor.style.left, anchor.style.top];
  header.dispatch('pointerenter', { pointerType: 'mouse' });
  assert.equal(card.dataset.extended, 'true'); assert.equal(f.ui.canEnter(2), false, 'Hover reveals the fixed arrow without opening songs');
  const before = animations.length;
  assert.equal(f.ui.togglePlaylist(2), true);
  assert.deepEqual([anchor.style.left, anchor.style.top], position, 'Opening keeps the original header under the pointer');
  assert.equal(toggle.attrs['aria-expanded'], 'true');
  header.dispatch('pointerleave');
  assert.equal(card.dataset.extended, 'false', 'Moving into the drawer hides the arrow without closing songs or changing header width');
  assert.equal(f.ui.canEnter(2), true);
  update(f, [{ ...playlist, x: 405 }]);
  assert.equal(animations.slice(before).filter(a => a.element === morph).length, 0, 'Drawer transitions never scale the text or use per-frame shape animations');
  drawer.dispatch('pointerleave');
  assert.equal(f.ui.canEnter(2), false); assert.equal(card.dataset.extended, 'false');
  assert.equal(toggle.attrs['aria-expanded'], 'false');
  assert.equal(f.ui.togglePlaylist(2), true); assert.equal(f.ui.togglePlaylist(2), false, 'The same arrow reverses an opening drawer');
  header.dispatch('pointerenter', { pointerType: 'touch' });
  assert.equal(card.dataset.extended, 'false', 'Touch does not leave a sticky hover state');
  label.dispatch('pointerdown', { pointerType: 'touch' });
  assert.equal(card.dataset.extended, 'true', 'A touch tap exposes the arrow on hybrid Windows devices');
  f.ui.togglePlaylist(2); card.dispatch('pointerleave', { pointerType: 'touch' }); drawer.dispatch('pointerleave', { pointerType: 'touch' });
  assert.equal(f.ui.canEnter(2), true, 'Touch pointer release cannot immediately close its new drawer');
  f.ui.collapse(); header.dispatch('pointerenter', { pointerType: 'mouse' }); header.dispatch('pointerleave');
  label.keyboardFocus = true; label.focus(); header.dispatch('focusin');
  assert.equal(card.dataset.extended, 'true', 'Keyboard focus exposes the arrow');
  f.ui.togglePlaylist(2); details.focus(); f.ui.collapse();
  assert.equal(document.activeElement, toggle, 'Closing a focused list returns focus to the header');
  label.keyboardFocus = false;
  f.ui.togglePlaylist(2);
  let prevented = false, stopped = false;
  card.dispatch('keydown', { key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
  assert.equal(f.ui.canEnter(2), false); assert.equal(prevented && stopped, true, 'Escape closes only the drawer before leaving overview');
  f.ui.togglePlaylist(2); card.dispatch('pointerleave');
  assert.equal(f.ui.canEnter(2), false); assert.equal(card.dataset.extended, 'false');
  update(f, [playlist], true); const reducedBefore = animations.length;
  f.ui.togglePlaylist(2); f.ui.togglePlaylist(2);
  assert.equal(anchor.dataset.reduced, 'true');
  assert.equal(animations.length, reducedBefore, 'Reduced motion commits both directions without animation');
  f.ui.dispose(); setMusicMotionSpeed(1);
}
{
  const playlist = { ...column(2, 1120), playlist: true, y: 550 };
  for (const [width, height] of [[1280, 720], [393, 650]]) {
    const placed = overviewLabelPlacement({ ...playlist, x: width - 100 }, width, height);
    assert.ok(placed.x - placed.listWidth / 2 >= 24);
    assert.ok(placed.x + placed.listWidth / 2 <= width - 24);
    assert.ok(placed.y + placed.listHeight <= height - 64, 'The fixed header reserves space for its complete drawer');
  }
}
console.log('Overview UI: fixed-header drawers, hover and keyboard states, reversible lifetimes, edge planning, dynamic speed and reduced motion passed.');
