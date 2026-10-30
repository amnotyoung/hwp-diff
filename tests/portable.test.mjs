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

test('a browser launch failure releases the server', async () => {
  await assert.rejects(launchPortable({ openBrowser: async () => { throw new Error('launch failed'); } }), /launch failed/);
});
