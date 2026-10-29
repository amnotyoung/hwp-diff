import test from 'node:test';
import assert from 'node:assert/strict';
import { locateChanges } from '../src/preview-locations.mjs';
import { changeAnchors } from '../public/text-diff.js';

const b = page => ({ page, x: 100, y: 200, width: 300, height: 30 });
const scene = { pages: [9, 10].map(page => ({ page, width: 600, height: 800 })), regions: [
  { id: 'table', type: 'table', sourceId: 'T', regions: [b(9)] },
  { id: 'intro', type: 'paragraph', parentId: 'table', regions: [b(9)] },
  { id: 'tail', type: 'paragraph', parentId: 'table', regions: [b(10)] },
] };
const old = '기존 표의 앞부분', fresh = old + '\n추가한 후속 처리 문장';
const target = { id: 1, type: 'modified', anchor: { sourceId: 'T' }, block: { type: 'table', table: { rows: 1, cols: 1, cells: [[{ text: fresh, rowSpan: 1, colSpan: 1 }]] } }, cells: [{ row: 1, col: 1, anchors: changeAnchors(old, fresh, 'after') }] };
const pages = new Map([[9, '<svg><g data-kordoc-id="intro"><text>기존 표의 앞부분</text></g></svg>'], [10, '<svg><g data-kordoc-id="tail"><text>추가한 후속 처리 문장</text></g></svg>']]);

test('a continuation-table addition maps to page 10 rather than the table start on page 9', () => {
  const [location] = locateChanges(scene, pages, [target]);
  assert.equal(location.status, 'cells'); assert.deepEqual(location.boxes.map(b => b.page), [10]);
  assert.equal(location.navigationLabel, '변경 위치 보기');
});
test('one paragraph split across pages highlights only its changed page fragment', () => {
  const s = { ...scene, regions: [scene.regions[0], { id: 'split', type: 'paragraph', parentId: 'table', regions: [b(9), b(10)] }] };
  const p = new Map([[9, '<svg><g data-kordoc-id="split"><text>기존 표의 앞부분</text></g></svg>'], [10, '<svg><g data-kordoc-id="split"><text>추가한 후속 처리 문장</text></g></svg>']]);
  const a = structuredClone(target); a.cells[0].anchors = changeAnchors(old, old + '추가한 후속 처리 문장', 'after');
  assert.deepEqual(locateChanges(s, p, [a])[0].boxes.map(b => b.page), [10]);
});
test('unresolved text falls back honestly to the table start', () => {
  const t = structuredClone(target); t.block.table.cells[0][0].text = '읽지 못한 셀'; t.cells[0].anchors = [{ context: '없는 문장', start: 0, end: 4 }];
  const [location] = locateChanges(scene, pages, [t]);
  assert.equal(location.status, 'table'); assert.equal(location.navigationLabel, '표 시작 쪽 보기');
});
test('original search keeps locations on the actual matching page', () => {
  const r = locateChanges(scene, pages, [target], '후속');
  assert.equal(r.searchMatches.length, 1); assert.equal(r.searchMatches[0].page, 10);
});
