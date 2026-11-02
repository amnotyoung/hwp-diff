import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStartupReporter, formatStartupStatus, startDiagnostic } from '../src/diagnostic-start.mjs';

test('startup log survives shutdown and distinguishes a real browser connection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwp-diff-diagnostic-'));
  const logPath = join(dir, 'startup.log');
  const lines = [];
  let app;
  try {
    app = await startDiagnostic({ logPath, openBrowser: async () => {}, output: line => lines.push(line) });
    assert.equal(lines[lines.indexOf('server-ready') + 1], app.url);
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
    assert.match(log, /\d{4}-\d{2}-\d{2}T.*runtime-started.*"os":/);
    assert.ok(lines.every(line => line.length <= 48));
  } finally { app?.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('long diagnostic values wrap on screen without truncating the saved event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwp-diff-diagnostic-'));
  try {
    const logPath = join(dir, 'startup.log'), lines = [];
    const code = 'LONG_ERROR_'.repeat(20);
    createStartupReporter(logPath, line => lines.push(line))('startup-failed', { code });
    assert.ok(lines.every(line => line.length <= 48));
    assert.equal(lines.slice(1).join(''), `code: ${code}`);
    assert.ok((await readFile(logPath, 'utf8')).includes(JSON.stringify({ code })));
    assert.deepEqual(formatStartupStatus('server-ready', { url: 'http://127.0.0.1:65535' }), ['server-ready', 'http://127.0.0.1:65535']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an unwritable log does not prevent startup diagnostics on screen', () => {
  const lines = [];
  const report = createStartupReporter(tmpdir(), line => lines.push(line));
  report('first'); report('second');
  assert.equal(lines.filter(line => line.startsWith('log-write-failed')).length, 1);
  assert.ok(lines.some(line => line.includes('second')));
});
