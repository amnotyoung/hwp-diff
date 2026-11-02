import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStartupReporter, startDiagnostic } from '../src/diagnostic-start.mjs';

test('startup log survives shutdown and distinguishes a real browser connection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwp-diff-diagnostic-'));
  const logPath = join(dir, 'startup.log');
  const lines = [];
  let app;
  try {
    app = await startDiagnostic({ logPath, openBrowser: async () => {}, output: line => lines.push(line) });
    assert.ok(lines.some(line => line.includes('server-ready') && line.includes(app.url)));
    assert.ok(!lines.some(line => line.includes('browser-connected')));
    const controller = new AbortController();
    const response = await fetch(app.url + '/api/session', { signal: controller.signal });
    await response.body.getReader().read();
    controller.abort();
    app.stop();
    const log = await readFile(logPath, 'utf8');
    for (const stage of ['runtime-started', 'modules-loaded', 'server-starting', 'server-ready', 'browser-requested', 'browser-connected', 'stopped']) {
      assert.ok(log.includes(stage), stage);
    }
    assert.equal(log.trim().split('\n').length, lines.length);
  } finally { app?.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('an unwritable log does not prevent startup diagnostics on screen', () => {
  const lines = [];
  const report = createStartupReporter(tmpdir(), line => lines.push(line));
  report('first'); report('second');
  assert.equal(lines.filter(line => line.startsWith('log-write-failed')).length, 1);
  assert.ok(lines.some(line => line.includes('second')));
});
