import test from 'node:test';
import assert from 'node:assert/strict';
import { memoFixture } from './helpers/memo-fixture.mjs';
import { compareDocuments } from '../src/engine.mjs';
import { previewDocument } from '../src/preview.mjs';
import { locateChanges } from '../src/preview-locations.mjs';
import { previewTargets, annotationsHtml } from '../public/report.js';

test('memo clicks resolve a late paragraph to the actual rendered page', async () => {
  const files = await memoFixture(100, 90), result = await compareDocuments(...files);
  const target = previewTargets(result, 'new').find(t => t.category === 'memo');
  assert.equal(target.memo.anchorParts.length, 1);
  const preview = await previewDocument(files[1], 1, { targets: [target], focusId: target.id, jump: true });
  assert.ok(preview.page > 1); assert.equal(preview.locations[0].status, 'memo');
  assert.equal(preview.locations[0].boxes[0].page, preview.page);
  const old = await previewDocument(files[0], 1, { targets: previewTargets(result, 'old'), focusId: target.id, jump: true });
  assert.equal(old.locations[0].status, 'absent'); assert.equal(old.locations[0].boxes.length, 0);
});

const box = (page, y) => ({ page, x: 20, y, width: 180, height: 12 });
const scene = {
  pages: [1, 2].map(page => ({ page, width: 500, height: 700 })),
  regions: [
    { id: 'table-1', type: 'table', sourceId: 'A', regions: [box(1, 30)] },
    { id: 'table-2', type: 'table', sourceId: 'B', regions: [box(2, 30)] },
    { id: 'paragraph-1', type: 'paragraph', parentId: 'table-1', regions: [box(1, 100)] },
    { id: 'paragraph-2', type: 'paragraph', parentId: 'table-2', regions: [box(2, 200)] },
    { id: 'paragraph-3', type: 'paragraph', parentId: 'table-2', regions: [box(2, 300)] },
  ],
};
const svgs = new Map([
  [1, '<svg><g data-kordoc-id="paragraph-1"><text>성과</text></g></svg>'],
  [2, '<svg><g data-kordoc-id="paragraph-2"><text>성과</text></g><g data-kordoc-id="paragraph-3"><text>다음 검토 문장</text></g></svg>'],
]);
const target = parts => ({ id: 'memo-1', category: 'memo', type: 'added', memo: { anchorParts: parts } });

test('repeated short memo anchors use the source table, not first text match', () => {
  const [location] = locateChanges(scene, svgs, [target([{ text: '성과', context: '성과', tableSourceId: 'B' }])]);
  assert.equal(location.status, 'memo'); assert.equal(location.boxes[0].page, 2); assert.equal(location.boxes[0].y, 200);
});

test('memo ranges may span paragraphs and pages, without duplicate rectangles', () => {
  const partA = { text: '성과', context: '성과', tableSourceId: 'A' };
  const partB = { text: '다음', context: '다음 검토 문장', tableSourceId: 'B' };
  const [location] = locateChanges(scene, svgs, [target([partA, partB, partA])]);
  assert.equal(location.status, 'memo'); assert.deepEqual(location.boxes.map(b => b.page), [1, 2]);
});

test('ambiguous, empty and partial memo ranges are explicitly reported', () => {
  const [ambiguous] = locateChanges(scene, svgs, [target([{ text: '성과', context: '성과' }])]);
  assert.equal(ambiguous.status, 'unresolved'); assert.equal(ambiguous.boxes.length, 0);
  const [empty] = locateChanges(scene, svgs, [target([{ text: '', context: '' }])]);
  assert.equal(empty.status, 'unresolved');
  const [partial] = locateChanges(scene, svgs, [target([{ text: '성과', context: '성과', tableSourceId: 'B' }, { text: '없는 문장', context: '없는 문장' }])]);
  assert.equal(partial.status, 'partial'); assert.equal(partial.boxes.length, 1); assert.match(partial.message, /확인한 부분만/);
});

test('unchanged memos remain navigable but exported reports have no app-only buttons', async () => {
  const [, file] = await memoFixture(); const result = await compareDocuments(file, file);
  assert.equal(result.annotations.stats.unchanged, 1);
  const targets = previewTargets(result, 'new');
  assert.equal(targets.length, 1); assert.equal(targets[0].type, 'unchanged');
  const html = annotationsHtml(result.annotations, true);
  assert.match(html, /동일한 메모 1개 보기/); assert.match(html, /data-preview-memo="memo-1"/);
  assert.ok(!annotationsHtml(result.annotations).includes('data-preview-memo'));
});
