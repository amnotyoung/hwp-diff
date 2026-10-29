import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { buildSearchIndex, markSearch, searchMatches } from '../public/search.js';
import { renderDiff } from '../public/report.js';
const root = html => new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').documentElement;
const docs = { before: {}, after: {} };
const diff = (id, before, after) => ({ id, type: 'modified', before: { text: before }, after: { text: after }, cells: [] });

test('full search indexes unloaded results and keeps global highlight IDs across pagination', () => {
  const diffs = Array.from({ length: 74 }, (_, i) => diff(i + 1, `데이터 ${i} 120명`, `데이터 ${i} 180명`));
  const render = d => root(renderDiff(d, docs, true, '데이터'));
  const index = buildSearchIndex(diffs, '데이터', render);
  assert.equal(index.hits.length, 148);
  assert.equal(index.hits[100].diffId, 51);
  const hits = markSearch(render(diffs[50]), '데이터', index.offsets.get(51)).hits;
  assert.deepEqual(hits.map(h => h.id), [100, 101]);
  assert.equal(hits[0].elements.map(e => e.textContent).join(''), '데이터');
  assert.equal(index.hits.at(-1).diffId, 74);
});

test('search spans diff markup, clears safely, and does not count folded duplicate text', () => {
  const card = root('<div class="block-text">데<mark class="added">이</mark>터 데이터</div><details class="full-context"><div class="block-text">데이터</div></details>');
  const result = markSearch(card, '데이터');
  assert.equal(result.hits.length, 2); assert.equal(result.hits[0].elements.length, 3);
  assert.equal(markSearch(card, '').hits.length, 0);
  assert.equal(searchMatches(card, '데이터')[0].ranges.length, 2);
});

test('search includes captions, unchanged table cells and footnotes even in a modified table', () => {
  const block = { text: '', footnoteText: '데이터 주석', table: { rows: 1, cols: 1, caption: '데이터 표 제목', cells: [[{ text: '데이터 값', rowSpan: 1, colSpan: 1 }]] } };
  const entry = { id: 1, type: 'modified', before: block, after: block, cells: [{ row: 1, col: 1, before: block.table.cells[0][0], after: block.table.cells[0][0] }] };
  const indexed = buildSearchIndex([entry], '데이터', d => root(renderDiff(d, docs, true, '데이터')));
  assert.equal(indexed.hits.length, 6);
});

test('full search has no former 1000-hit cap and treats literal queries as text', () => {
  const d = diff(1, 'a[b '.repeat(600), 'a[b '.repeat(601));
  const r = root(renderDiff(d, docs, true, 'a[b'));
  const indexed = buildSearchIndex([d], 'a[b', () => r);
  assert.equal(indexed.hits.length, 1201);
  assert.equal(markSearch(r, 'a[b').hits.length, 1201);
});
