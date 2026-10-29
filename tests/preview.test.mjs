import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHwpx } from 'kordoc';
import { sampleFiles } from '../src/sample-data.mjs';
import { compareDocuments } from '../src/engine.mjs';
import { previewDocument } from '../src/preview.mjs';
import { locateChanges, friendlyWarnings } from '../src/preview-locations.mjs';
import { previewTargets, fileLabel } from '../public/report.js';
import { reviewSamples } from '../scripts/create-review-samples.mjs';

test('sample preview maps paragraph edits and only the three changed table cells', async () => {
  const f = await sampleFiles(), result = await compareDocuments(f.oldFile, f.newFile);
  const preview = await previewDocument(f.oldFile, 1, { targets: previewTargets(result, 'old'), focusId: 6, jump: true });
  const table = preview.locations.find(l => l.id === 6);
  assert.equal(table.status, 'cells'); assert.equal(table.boxes.length, 3);
  assert.ok(table.boxes.every(b => b.x > 150 && b.width < 200));
  assert.equal(preview.locations.find(l => l.id === 3).status, 'paragraph');
  assert.equal(preview.locations.find(l => l.id === 10).status, 'absent');
});

test('reflow document jumps to the actual changed page instead of parser section 1', async () => {
  const lines = Array.from({ length: 100 }, (_, i) => `사업 ${String(i).padStart(3, '0')} 현장 조사 인원은 120명입니다.`);
  const a = { name: 'old.hwpx', bytes: new Uint8Array(await markdownToHwpx(lines.join('\n\n'))) };
  lines[90] = lines[90].replace('120', '180');
  const b = { name: 'new.hwpx', bytes: new Uint8Array(await markdownToHwpx(lines.join('\n\n'))) };
  const result = await compareDocuments(a, b), diff = result.diffs.find(d => d.type === 'modified');
  assert.equal(result.documents.before.pageMode, 'section');
  const preview = await previewDocument(a, 1, { targets: previewTargets(result, 'old'), focusId: diff.id, jump: true });
  assert.ok(preview.page > 1); assert.equal(preview.locations[0].boxes[0].page, preview.page);
});

test('repeated numeric cells resolve by full cell order, not first matching number', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => `| 사업 ${i} | 500 |`);
  const header = '| 항목 | 예산 |\n| --- | --- |\n';
  const a = { name: 'old.hwpx', bytes: new Uint8Array(await markdownToHwpx(header + rows.join('\n'))) };
  rows[17] = rows[17].replace('500', '501');
  const b = { name: 'new.hwpx', bytes: new Uint8Array(await markdownToHwpx(header + rows.join('\n'))) };
  const result = await compareDocuments(a, b);
  const preview = await previewDocument(a, 1, { targets: previewTargets(result, 'old') });
  assert.equal(preview.locations[0].status, 'cells'); assert.equal(preview.locations[0].boxes.length, 1);
  assert.ok(preview.locations[0].boxes[0].y > 300);
});

test('ambiguous and missing matches never invent a highlight; duplicate paragraph occurrence is honored', () => {
  const scene = { pages: [{ page: 1, width: 500, height: 700 }], regions: [1, 2].map(n => ({
    id: `paragraph-${n}`, type: 'paragraph', regions: [{ page: 1, x: 20, y: n * 100, width: 300, height: 20 }],
  })) };
  const svg = new Map([[1, '<svg><g data-kordoc-id="paragraph-1"><text>같은 문장</text></g><g data-kordoc-id="paragraph-2"><text>같은 문장</text></g></svg>']]);
  const locations = locateChanges(scene, svg, [
    { id: 1, type: 'modified', block: { text: '같은 문장' }, anchor: { occurrence: 1, count: 2 } },
    { id: 2, type: 'modified', block: { text: '문서에 없는 내용' } },
    { id: 3, type: 'modified', block: { text: '같은 문장' } },
    { id: 4, type: 'modified', block: { text: '같은 문장' }, anchor: { occurrence: 0, count: 3 } },
  ]);
  assert.equal(locations[0].boxes[0].y, 200);
  assert.equal(locations[1].status, 'unresolved'); assert.equal(locations[1].boxes.length, 0);
  assert.equal(locations[2].status, 'unresolved'); assert.equal(locations[3].status, 'unresolved');
});

test('friendly warnings explain impact; file labels keep suffix, version and escaped tooltip', () => {
  const warning = friendlyWarnings(['페이지에 걸친 표 — 분할 지오메트리가 없어 시작 페이지 영역만 region 으로 기록']);
  assert.match(warning[0], /여러 쪽/); assert.ok(!warning[0].includes('region'));
  const name = '매우긴사업계획서파일명이계속반복되는문서이름_추가협의내용이포함된_최종검토본_수정_v0.7.hwpx';
  const html = fileLabel(name); assert.match(html, /…/); assert.match(html, /v0.7.hwpx/);
  assert.match(html, /class="version-badge">v0.7/); assert.ok(html.includes(`title="${name}"`));
  assert.ok(!fileLabel('<img onerror="alert(1)">_v0.5.hwpx').includes('<img'));
});

test('review regression files: five modifications, two excluded images, one late-table cell', async () => {
  const f = await reviewSamples(), result = await compareDocuments(f.oldFile, f.newFile);
  assert.equal(result.stats.modified, 5); assert.equal(result.stats.added + result.stats.removed, 0);
  assert.equal(result.unsupported.before.length, 2); assert.equal(result.unsupported.after.length, 2);
  const table = result.diffs.find(d => d.before?.table);
  assert.equal(table.cells.length, 1); assert.equal(table.cells[0].row, 66);
  const preview = await previewDocument(f.newFile, 1, { targets: previewTargets(result, 'new'), focusId: table.id, jump: true });
  const located = preview.locations.find(l => l.id === table.id);
  assert.equal(located.status, 'cells'); assert.equal(located.boxes.length, 1);
  assert.equal(preview.page, located.boxes[0].page); assert.ok(preview.page > 1);
});
