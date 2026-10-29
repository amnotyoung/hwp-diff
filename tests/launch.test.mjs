import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/launch-guard.js', import.meta.url), 'utf8');

function runGuard(protocol) {
  const elements = { 'launch-help': { hidden: false }, 'app-shell': { hidden: true } };
  const scripts = [];
  vm.runInNewContext(source, { location: { protocol }, document: {
    getElementById: id => elements[id], createElement: () => ({}), head: { append: script => scripts.push(script) },
  } });
  return { elements, scripts };
}

test('direct-file entry retains launch instructions without loading the application', () => {
  const { elements, scripts } = runGuard('file:');
  assert.equal(elements['launch-help'].hidden, false);
  assert.equal(elements['app-shell'].hidden, true);
  assert.equal(scripts.length, 0);
});

test('HTTP entry reveals the app and loads its module', () => {
  const { elements, scripts } = runGuard('http:');
  assert.equal(elements['launch-help'].hidden, true);
  assert.equal(elements['app-shell'].hidden, false);
  assert.equal(scripts[0].type, 'module'); assert.equal(scripts[0].src, './app.js');
});

test('entry HTML loads local styling and guard with relative paths', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /href="\.\/style.css"/); assert.match(html, /src="\.\/launch-guard.js"/);
  assert.match(html, /id="app-shell" hidden/); assert.ok(!html.includes('type="module"'));
});
