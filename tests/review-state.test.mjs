import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewState, reviewItems, reviewFilters, reviewPresence } from '../public/review-state.js';

const format = (id, property, text, after) => ({ id, text, before: { paragraphText: text, start: 0, end: text.length }, after: { paragraphText: text, start: 0, end: text.length }, changes: [{ property, label: property === 'ratio' ? '장평' : '자간', before: 100, after }] });
const result = {
  diffs: [{ id: 1, type: 'modified', before: { text: '내용' }, after: { text: '내용 변경' } }, { id: 2, type: 'unchanged', before: { text: '동일' }, after: { text: '동일' } }],
  formatting: { available: true, diffs: [format('format-1', 'ratio', '장평 대상', 95), format('format-2', 'spacing', '자간 대상', -5)] },
  annotations: { available: true, diffs: [{ id: 'memo-1', type: 'added', after: { text: '검토 메모', author: '검토자' } }, { id: 'memo-2', type: 'unchanged', after: { text: '기존 메모' } }] },
};
test('each review mode keeps independent filters and search conditions', () => {
  const state = createReviewState(); state.conditions.content = { filter: 'removed', query: '내용', shown: 50 };
  assert.equal(reviewItems(result, 'content', state.conditions.content).length, 0);
  assert.equal(reviewItems(result, 'format', state.conditions.format).length, 2);
  assert.equal(reviewItems(result, 'memo', state.conditions.memo).length, 1);
  state.conditions.format = { filter: 'ratio', query: '95%', shown: 50 };
  assert.deepEqual(reviewItems(result, 'format', state.conditions.format).map(d => d.id), ['format-1']);
  assert.equal(state.conditions.content.filter, 'removed');
  assert.equal(state.selections.format, null, 'restoring conditions does not auto-select the first item');
});
test('filter counts describe their own category without inheriting a content filter', () => {
  assert.deepEqual(reviewFilters(result, 'memo').map(f => [f.value, f.count]), [['changes', 1], ['all', 2], ['added', 1], ['removed', 0], ['modified', 0]]);
  assert.equal(reviewFilters(result, 'format').find(f => f.value === 'ratio').count, 1);
});
const box = (page, y = 100) => ({ page, x: 20, y, width: 100, height: 30 });
test('an off-page remembered selection is not represented as being on the current page', () => {
  const locations = { old: [{ id: 'format-1', boxes: [box(9)], status: 'format' }], new: [{ id: 'format-1', boxes: [box(9)], status: 'format' }] };
  const p = reviewPresence('format-1', locations, { old: 4, new: 4 });
  assert.equal(p.onPage, false); assert.equal(p.offscreen, true); assert.equal(p.unresolved, false);
});
test('same-page selection can still be outside a zoomed viewport', () => {
  const locations = { old: [{ id: 1, boxes: [box(4, 600)], status: 'paragraph' }], new: [{ id: 1, boxes: [], status: 'absent' }] };
  const p = reviewPresence(1, locations, { old: 4, new: 4 }, { old: { x: 0, y: 0, width: 500, height: 300 } });
  assert.equal(p.onPage, true); assert.equal(p.onScreen, false); assert.equal(p.offscreen, true); assert.equal(p.unresolved, false);
});
test('unresolved locations remain selectable and are distinct from no changes', () => {
  const items = reviewItems(result, 'format', { filter: 'all', query: '' });
  const locations = { old: [{ id: 'format-1', boxes: [], status: 'unresolved' }], new: [{ id: 'format-1', boxes: [], status: 'unresolved' }] };
  assert.equal(items.length, 2);
  assert.equal(reviewPresence(items[0].id, locations, { old: 1, new: 1 }).unresolved, true);
  assert.equal(reviewPresence(items[0].id, {}, { old: 1, new: 1 }).pending, true);
});
test('the selected inner segment determines placement rather than the containing table', () => {
  const location = { id: 6, status: 'cells', boxes: [box(4), box(9)], segments: [{ index: 0, boxes: [box(4)] }, { index: 1, boxes: [box(9)] }] };
  const p = reviewPresence(6, { old: [location], new: [location] }, { old: 4, new: 4 }, {}, 1);
  assert.equal(p.offscreen, true); assert.equal(p.onPage, false);
});

test('the move filter appears only when moves exist and keeps moved edits and pure moves', () => {
  assert.ok(!reviewFilters(result, 'content').some(f => f.value === 'moved'));
  const moved = { ...result, moveStats: { moved: 2 }, diffs: [...result.diffs, { id: 3, type: 'moved', moved: true, before: { text: 'A' }, after: { text: 'A' } }, { id: 4, type: 'modified', moved: true, before: { text: 'B' }, after: { text: 'B2' } }] };
  assert.deepEqual(reviewFilters(moved, 'content').find(f => f.value === 'moved'), { value: 'moved', label: '이동', count: 2 });
  assert.deepEqual(reviewItems(moved, 'content', { filter: 'changes', query: '' }).map(d => d.id), [1, 3, 4]);
  assert.deepEqual(reviewItems(moved, 'content', { filter: 'modified', query: '' }).map(d => d.id), [1, 4]);
  assert.ok(!reviewFilters(moved, 'format').some(f => f.value === 'moved'));
});
