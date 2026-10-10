import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fixtureLibrary, silentWav } from './windows-fixture.mjs';
import { spawn } from 'node:child_process';

const output = path.resolve('artifacts/desktop-ui'); await fs.mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.RHINE_CDP || 'http://127.0.0.1:9227');
const page = browser.contexts()[0].pages()[0];
const report = { errors: [], checks: [], snapshots: [] };
page.on('pageerror', error => report.errors.push(error.message));
const origin = new URL(page.url()).origin;
try {
  const restore = async () => {
    const child = spawn(path.resolve(process.env.RHINE_DESKTOP_EXE || 'src-tauri/target/release/rhine-music-windows.exe'), [], { windowsHide: true });
    await new Promise(resolve => child.once('exit', resolve)); await page.waitForTimeout(1500);
  };
  await restore();
  const session = await page.context().newCDPSession(page); await session.send('Emulation.clearDeviceMetricsOverride');
  await page.route('**/api/library', route => route.fulfill({ json: fixtureLibrary() }));
  await page.route('**/fixture.wav', route => route.fulfill({ contentType: 'audio/wav', body: silentWav(120) }));
  await page.addInitScript(() => {
    localStorage.setItem('rhine-music-preferences', JSON.stringify({ bgm: false, sound: false, volume: 0, quality: 'original' }));
    window.addEventListener('rhine-desktop-visibility', event => { window.rhineNativeHidden = event.detail.hidden; });
  });
  await page.goto(`${origin}/?desktop=1&scene=archive&lab=0`);
  await page.waitForFunction(() => window.rhineMusic?.stats()?.loaded && !document.querySelector('#music-loading'), null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('.desktop-chrome').count(), 1);
  const chrome = await page.evaluate(() => {
    const root = document.querySelector('.desktop-chrome'), viewport = document.querySelector('#viewport');
    return { background: getComputedStyle(root).backgroundColor, border: getComputedStyle(root).borderBottomWidth,
      viewportTop: viewport.getBoundingClientRect().top, viewportHeight: viewport.getBoundingClientRect().height, height: innerHeight,
      buttons: [...root.querySelectorAll('button')].map(button => ({ action: button.dataset.window, background: getComputedStyle(button).backgroundColor })) };
  });
  assert.equal(chrome.background, 'rgba(0, 0, 0, 0)');
  assert.equal(chrome.border, '0px'); assert.equal(chrome.viewportTop, 0);
  assert.ok(Math.abs(chrome.viewportHeight - chrome.height) < 1);
  assert.deepEqual(chrome.buttons.map(button => button.action), ['minimize', 'maximize', 'close']);
  assert.ok(chrome.buttons.every(button => button.background === 'rgba(0, 0, 0, 0)'));
  report.checks.push('Transparent window controls do not paint a strip or offset the viewport');
  const invoke = (action) => page.evaluate(action => window.__TAURI__.core.invoke('desktop_window_action', { action }), action);
  const stateNow = () => page.evaluate(() => window.__TAURI__.core.invoke('desktop_window_state'));
  const checkWorkArea = async () => {
    const state = await stateNow(); assert.equal(state.fullscreen, false); assert.equal(state.maximized, true);
    const bounds = await page.evaluate(() => ({ x: screenX, y: screenY, width: outerWidth, height: outerHeight,
      workArea: { x: screen.availLeft, y: screen.availTop, width: screen.availWidth, height: screen.availHeight }, dpr: devicePixelRatio }));
    // Windows includes invisible resize borders in the outer window bounds.
    const border = 16;
    assert.ok(Math.abs(bounds.x - bounds.workArea.x) <= border, JSON.stringify(bounds));
    assert.ok(Math.abs(bounds.y - bounds.workArea.y) <= border, JSON.stringify(bounds));
    assert.ok(Math.abs(bounds.width - bounds.workArea.width) <= border, JSON.stringify(bounds));
    assert.ok(Math.abs(bounds.height - bounds.workArea.height) <= border, JSON.stringify(bounds));
    report.snapshots.push({ name: 'maximized work area', ...state, ...bounds });
  };
  await invoke('restore'); await page.waitForTimeout(800);
  // Send the second mousedown directly: CDP cannot reliably release an OS drag.
  // The first mousedown/native drag is reserved for manual pointer verification.
  assert.equal(await page.locator('.desktop-drag').getAttribute('data-tauri-drag-region'), '');
  const doubleClickTop = () => page.locator('.desktop-drag').evaluate(element => element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 2 })));
  await doubleClickTop(); await page.waitForTimeout(800); await checkWorkArea();
  await doubleClickTop(); await page.waitForTimeout(800); assert.equal((await stateNow()).maximized, false);
  report.checks.push('Native top double-click maximizes and restores');
  await page.locator('[data-window="maximize"]').click(); await page.waitForTimeout(800);
  await checkWorkArea();
  assert.equal(await page.locator('[data-window="maximize"]').getAttribute('aria-label'), '还原');
  await page.locator('[data-window="maximize"]').click(); await page.waitForTimeout(800);
  assert.equal((await stateNow()).maximized, false); report.checks.push('Native maximize and restore through visible buttons');
  await page.keyboard.press('F11'); await page.waitForTimeout(800); await checkWorkArea();
  await page.keyboard.press('F11'); await page.waitForTimeout(800); assert.equal((await stateNow()).maximized, false);
  await page.keyboard.press('F11'); await page.waitForTimeout(1500); await checkWorkArea();
  assert.equal(await page.locator('html').evaluate(element => element.classList.contains('desktop-maximized')), true);
  report.checks.push('F11 toggles work-area maximize without entering native fullscreen');
  await page.screenshot({ path: path.join(output, 'maximized-day.png'), timeout: 15000 });
  const capture = async name => {
    const item = await page.evaluate(() => {
      const canvas = document.querySelector('#three-scene canvas'), gl = canvas.getContext('webgl2');
      const ext = gl.getExtension('WEBGL_debug_renderer_info'), host = document.querySelector('#three-scene');
      return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        frame: JSON.parse(host.dataset.frameTiming || '{}'), stats: window.rhineMusic.stats(), player: window.rhineMusic.player };
    });
    report.snapshots.push({ name, ...item }); console.log(name, JSON.stringify({ gpu: item.gpu, viewport: item.viewport, frame: item.frame, optimization: item.stats.optimization }));
  };
  await capture('maximized archive');
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(1500);
  await page.locator('[data-action="open"]').click();
  await page.waitForFunction(() => window.rhineMusic.presentation.phase === 'detail', null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(output, 'detail-day.png'), timeout: 15000 });
  report.checks.push('Album navigation and detail transition');
  await page.locator('[data-theme="night"]').click(); await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(output, 'detail-night.png'), timeout: 15000 });
  await page.keyboard.press('Escape'); await page.waitForTimeout(2500);
  await checkWorkArea();
  assert.equal(await page.evaluate(() => window.rhineMusic.presentation.phase), 'archive');
  report.checks.push('Escape in detail returns to archive while preserving maximize');
  await page.keyboard.press('Escape'); await page.waitForTimeout(800); assert.equal((await stateNow()).maximized, false);
  await page.keyboard.press('F11'); await page.waitForTimeout(800); await checkWorkArea();
  report.checks.push('Escape in archive restores the window');
  await page.keyboard.press('v'); await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(output, 'overview-night.png'), timeout: 15000 });
  report.checks.push('Day/night themes and overview');
  await page.keyboard.press('v'); await page.waitForTimeout(2000);
  await page.locator('[data-action="open"]').click();
  await page.waitForFunction(() => window.rhineMusic.presentation.phase === 'detail');
  await page.locator('.track-row').first().click();
  await page.waitForFunction(() => window.rhineMusic.player.playing && window.rhineMusic.player.currentTime > .5);
  assert.equal(await page.evaluate(() => window.rhineMusic.player.volume), 0);
  const before = await page.evaluate(() => window.rhineMusic.player.currentTime);
  await page.locator('[data-window="minimize"]').click(); await page.waitForTimeout(2000);
  const suspended = await page.evaluate(() => ({ hidden: document.hidden, nativeHidden: window.rhineNativeHidden, visibility: document.visibilityState, time: window.rhineMusic.player.currentTime, timing: document.querySelector('#three-scene').dataset.frameTiming }));
  assert.equal(suspended.nativeHidden, true);
  assert.ok(suspended.time > before + 1);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => document.querySelector('#three-scene').dataset.frameTiming), suspended.timing);
  report.snapshots.push({ name: 'minimized', ...suspended });
  report.checks.push('Minimize stops render diagnostics while zero-volume audio advances');
  await restore(); assert.equal(await page.evaluate(() => document.hidden), false);
  await page.waitForTimeout(2000);
  assert.notEqual(await page.evaluate(() => document.querySelector('#three-scene').dataset.frameTiming), suspended.timing);
  report.checks.push('Single instance restores window and rendering');
  // Leave the service alive for subsequent benchmarks; exit cleanup is separate.
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
assert.deepEqual(report.errors, []);
