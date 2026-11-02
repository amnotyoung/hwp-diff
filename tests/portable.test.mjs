import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { launchPortable } from '../src/portable.mjs';

test('portable launcher chooses a local port and exposes managed controls', async () => {
  let opened;
  const app = await launchPortable({ openBrowser: async url => { opened = url; } });
  try {
    assert.equal(opened, app.url); assert.match(app.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await (await fetch(app.url + '/api/app')).json()).portable, true);
    assert.equal((await fetch(app.url + '/api/exit', { method: 'POST' })).status, 403);
    assert.equal((await fetch(app.url + '/api/session', { headers: { Origin: 'https://example.com' } })).status, 403);
    const closed = once(app.server, 'close');
    assert.equal((await fetch(app.url + '/api/exit', { method: 'POST', headers: { 'X-Hwp-Diff': '1' } })).status, 200);
    await closed;
  } finally { app.stop(); }
});

test('closing the final session stops the portable app after a reload grace period', async () => {
  const app = await launchPortable({ openBrowser: async () => {}, closeDelay: 150, startupTimeout: 2000 });
  try {
    const a = new AbortController(), first = await fetch(app.url + '/api/session', { signal: a.signal });
    await first.body.getReader().read(); a.abort();
    const b = new AbortController(), second = await fetch(app.url + '/api/session', { signal: b.signal });
    await second.body.getReader().read();
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.equal((await fetch(app.url + '/api/health')).status, 200);
    const closed = once(app.server, 'close'); b.abort(); await closed;
  } finally { app.stop(); }
});

test('a browser launch failure keeps the URL available for manual connection', async () => {
  const events = [];
  const app = await launchPortable({ openBrowser: async () => { throw new Error('launch failed'); }, report: (stage, details) => events.push({ stage, ...details }) });
  try {
    assert.equal((await fetch(app.url + '/api/health')).status, 200);
    assert.ok(events.some(e => e.stage === 'browser-open-failed' && e.url === app.url));
    assert.ok(!events.some(e => e.stage === 'browser-connected' || e.stage === 'browser-requested'));
  } finally { app.stop(); }
});

test('accepted browser request is distinct from connection and expires without a session', async () => {
  const events = [];
  const app = await launchPortable({ openBrowser: async () => {}, startupTimeout: 100, report: (stage, details) => events.push({ stage, ...details }) });
  await once(app.server, 'close');
  assert.ok(events.some(e => e.stage === 'browser-requested'));
  assert.ok(!events.some(e => e.stage === 'browser-connected'));
  assert.ok(events.some(e => e.stage === 'stopped' && e.reason === 'no-browser-connection'));
});
