// CPU-only startup failures and scheduler ownership; no WebGL or accounts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MusicStartup, prepareStartupExtras, yieldStartupFrame } from '../src/music-startup.ts';

test('startup records independent phases and freezes elapsed time on completion', async () => {
  const startup = new MusicStartup();
  assert.equal(await startup.run('library', async signal => { assert.equal(signal.aborted, false); return 12; }, 1000), 12);
  await startup.run('model', async () => {}, 1000);
  startup.complete();
  const first = startup.snapshot();
  assert.equal(first.phase, 'ready');
  assert.deepEqual(first.steps.map(s => [s.phase, s.outcome]), [['library', 'completed'], ['model', 'completed']]);
  assert.equal(startup.snapshot().milliseconds, first.milliseconds);
});
test('rejected resources propagate an actionable failure instead of reporting ready', async () => {
  const startup = new MusicStartup();
  await assert.rejects(startup.run('model', async () => { throw Error('missing model'); }, 1000), /missing model/);
  startup.fail();
  assert.equal(startup.snapshot().phase, 'error');
  assert.equal(startup.snapshot().steps[0].outcome, 'failed');
});
test('stalled startup times out, aborts its request and blocks later stages', async () => {
  const startup = new MusicStartup(); let signal, finish, nextCalls = 0;
  await assert.rejects(startup.run('renderer', s => { signal = s; return new Promise(resolve => { finish = resolve; }); }, 5), /renderer.*超时/);
  assert.equal(signal.aborted, true);
  await assert.rejects(startup.run('next', async () => { nextCalls++; }, 1000), /超时/);
  finish(); await Promise.resolve();
  assert.equal(nextCalls, 0);
  assert.equal(startup.snapshot().steps.length, 1, 'late completion cannot create another phase');
});
test('closing the page immediately cancels a pending phase', async () => {
  const startup = new MusicStartup();
  const pending = startup.run('model', () => new Promise(() => {}), 1000);
  startup.cancel();
  await assert.rejects(pending, { name: 'AbortError' });
});
test('startup yields on RAF or a timer fallback, cleaning both continuations', async () => {
  const keys = ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'];
  const originals = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  try {
    for (const winner of ['frame', 'timer']) {
      const frames = new Map(), timers = new Map(); let id = 0;
      Object.assign(globalThis, {
        requestAnimationFrame: fn => { const handle = ++id; frames.set(handle, fn); return handle; },
        cancelAnimationFrame: handle => frames.delete(handle),
        setTimeout: (fn, ms) => { assert.equal(ms, 50); const handle = ++id; timers.set(handle, fn); return handle; },
        clearTimeout: handle => timers.delete(handle),
      });
      const pending = yieldStartupFrame();
      (winner === 'frame' ? frames : timers).values().next().value();
      await pending;
      assert.equal(frames.size, 0); assert.equal(timers.size, 0);
    }
  } finally {
    keys.forEach((key, i) => originals[i] ? Object.defineProperty(globalThis, key, originals[i]) : delete globalThis[key]);
  }
});
test('optional service-worker and font failures are contained', async () => {
  const originals = ['navigator', 'document'].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  let fonts = 0;
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistrations: async () => { throw Error('storage denied'); } } } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { fonts: { load: async () => { fonts++; throw Error('font unavailable'); } } } });
    await prepareStartupExtras(); assert.equal(fonts, 2);
  } finally {
    ['navigator', 'document'].forEach((key, i) => originals[i] ? Object.defineProperty(globalThis, key, originals[i]) : delete globalThis[key]);
  }
});
