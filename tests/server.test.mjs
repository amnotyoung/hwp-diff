import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createServer } from '../src/server.mjs';
import { sampleFiles } from '../src/sample-data.mjs';
import { compareDocuments } from '../src/engine.mjs';
import { previewTargets } from '../public/report.js';

let server, base, files;
before(async () => {
  server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`; files = await sampleFiles();
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
function post(path, body, headers = {}) { return fetch(base + path, { method: 'POST', body, headers: { 'X-Hwp-Diff': '1', ...headers } }); }
function form(old = files.oldFile, fresh = files.newFile) {
  const data = new FormData();
  data.append('oldFile', new Blob([old.bytes]), old.name);
  data.append('newFile', new Blob([fresh.bytes]), fresh.name);
  return data;
}

test('UI assets and local health served with no-store and restrictive CSP', async () => {
  for (const path of ['/', '/launch-guard.js', '/app.js', '/report.js', '/style.css', '/api/health']) {
    const res = await fetch(base + path); assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    await res.text();
  }
});
test('uploads are parsed by real worker and return expected changes', async () => {
  const res = await post('/api/compare', form());
  assert.equal(res.status, 200); const result = await res.json();
  assert.equal(result.stats.modified, 3); assert.equal(result.documents.before.name, files.oldFile.name);
});
test('sample endpoint uses real HWPX generation and comparison', async () => {
  const res = await post('/api/demo'); assert.equal(res.status, 200);
  assert.equal((await res.json()).stats.added, 3);
});
test('preview endpoint renders selected uploaded document and demo; rejects invalid page', async () => {
  const f = new FormData(); f.append('file', new Blob([files.oldFile.bytes]), files.oldFile.name); f.append('page', '1');
  const response = await post('/api/preview', f);
  assert.equal(response.status, 200); assert.equal((await response.json()).page, 1);
  const demo = new FormData(); demo.append('demo', '1'); demo.append('side', 'new'); demo.append('page', '1');
  assert.equal((await post('/api/preview', demo)).status, 200);
  demo.set('page', '0'); assert.equal((await post('/api/preview', demo)).status, 400);
});
test('preview API carries changed-cell geometry and rejects malformed target lists', async () => {
  const result = await compareDocuments(files.oldFile, files.newFile);
  const f = new FormData(); f.append('file', new Blob([files.newFile.bytes]), files.newFile.name);
  f.append('targets', JSON.stringify(previewTargets(result, 'new'))); f.append('focusId', '6'); f.append('jump', '1');
  const response = await post('/api/preview', f); assert.equal(response.status, 200);
  assert.equal((await response.json()).locations.find(l => l.id === 6).boxes.length, 3);
  f.set('targets', '{bad json'); assert.equal((await post('/api/preview', f)).status, 400);
  f.set('targets', '[{"id":1,"type":"image"}]'); assert.equal((await post('/api/preview', f)).status, 400);
});
test('missing files, unsupported extension, corrupt bytes and oversize request are rejected', async () => {
  assert.equal((await post('/api/compare', new FormData())).status, 400);
  assert.equal((await post('/api/compare', form({ ...files.oldFile, name: 'not.pdf' }))).status, 400);
  const bad = await post('/api/compare', form({ name: 'bad.hwp', bytes: new TextEncoder().encode('bad') }));
  assert.equal(bad.status, 422); assert.ok((await bad.json()).error);
  const big = new Uint8Array(20 * 1024 * 1024 + 1);
  assert.equal((await post('/api/compare', form({ name: 'big.hwpx', bytes: big }))).status, 413);
});
test('foreign origin, rebinding Host and browser simple form requests are rejected', async () => {
  assert.equal((await post('/api/demo', undefined, { Origin: 'https://example.com' })).status, 403);
  // Node fetch rewrites Host; use an actual custom Host on the wire.
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/health', { headers: { Host: 'attacker.example' } }, res => {
      res.resume(); resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(base + '/api/demo', { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/package.json')).status, 404);
});
