import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHwpx } from 'kordoc';
import { sampleFiles } from '../src/sample-data.mjs';
import { compareDocuments } from '../src/engine.mjs';
import { previewDocument } from '../src/preview.mjs';
import { locateChanges, friendlyWarnings } from '../src/preview-locations.mjs';
import { previewTargets, fileLabel } from '../public/report.js';
import { previewNotice } from '../public/view-layout.js';
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

test('missing rendered text is distinguished from an ambiguous location without inventing geometry', () => {
  const text = '원본에서 읽은 긴 문구가 미리보기에서는 완전히 빠진 경우를 확인합니다.';
  const scene = { pages: [{ page: 1, width: 500, height: 700 }], regions: [] };
  const missing = locateChanges(scene, new Map([[1, '<svg><text>제목</text></svg>']]), [{ id: 1, block: { text } }])[0];
  assert.equal(missing.reason, 'text-unmatched'); assert.deepEqual(missing.boxes, []);
  assert.match(missing.message, /렌더링되지 않았을 수/);
  const present = locateChanges(scene, new Map([[1, `<svg><text>${text}</text></svg>`]]), [{ id: 1, block: { text } }])[0];
  assert.equal(present.reason, 'location-unmatched'); assert.deepEqual(present.boxes, []);
});

test('preview reports unverified rendered text near the document instead of assuming completeness', async () => {
  const f = await sampleFiles();
  const data = await previewDocument(f.oldFile, 1, { targets: [{ id: 1, type: 'modified', block: { text: '렌더링 결과에는 존재하지 않는 비교 문구를 전달해 검사 상태를 확인합니다.' }, cells: [] }] });
  assert.equal(data.rendering.unmatchedTextCount, 1);
  assert.match(data.rendering.message, /내용 비교/);
});

test('anchor and search paths never return zero-height or off-page highlights', () => {
  const text = '변경된 문구를 찾았지만 렌더러의 영역 정보가 잘못된 경우입니다.';
  const scene = { pages: [{ page: 3, width: 595, height: 842 }], regions: [{ id: 'p1', type: 'paragraph', regions: [
    { page: 3, x: 20, y: 800, width: 100, height: 20 }, { page: 3, x: 20, y: 850, width: 100, height: 0 }, { page: 3, x: 20, y: 955, width: 100, height: 18 },
  ] }] };
  const svg = new Map([[3, `<svg><g data-kordoc-id="p1"><text>${text}</text></g></svg>`]]);
  const result = locateChanges(scene, svg, [{ id: 1, type: 'modified', block: { text }, textAnchors: [{ context: text, start: 0, end: 5 }] }], '변경');
  assert.equal(result.locations[0].discardedBoxes, 2);
  assert.equal(result.locations[0].boxes.length, 1);
  assert.equal(result.locations[0].status, 'partial-text');
  assert.equal(result.searchMatches.length, 1);
  assert.ok(result.locations[0].boxes.every(b => b.y + b.height <= 842 && b.height > 0));
});

test('paragraph segments retain their own pages within a multi-page table', () => {
  const a = '첫 번째 변경 문단입니다.', b = '두 번째 변경 문단입니다.';
  const box = page => ({ page, x: 20, y: 100, width: 300, height: 30 });
  const scene = { pages: [1, 2].map(page => ({ page, width: 595, height: 842 })), regions: [
    { id: 'table', sourceId: 'source', type: 'table', regions: [box(1), box(2)] },
    { id: 'p1', type: 'paragraph', parentId: 'table', regions: [box(1)] },
    { id: 'p2', type: 'paragraph', parentId: 'table', regions: [box(2)] },
  ] };
  const svgs = new Map([[1, `<svg><g data-kordoc-id="table"><g data-kordoc-id="p1"><text>${a}</text></g></g></svg>`], [2, `<svg><g data-kordoc-id="table"><g data-kordoc-id="p2"><text>${b}</text></g></g></svg>`]]);
  const result = locateChanges(scene, svgs, [{ id: 1, block: { table: { cells: [[{ text: a + '\n' + b }]] } }, anchor: { sourceId: 'source' }, cells: [], segments: [a, b].map((context, index) => ({ index, row: 1, col: 1, anchors: [{ context, start: 0, end: 5 }] })) }]);
  assert.deepEqual(result[0].segments.map(s => s.boxes.map(b => b.page)), [[1], [2]]);
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

test('picture-heavy documents locate changes without pictures and show an oversized page without them', async () => {
  const calls = [];
  const page = n => `<svg xmlns="http://www.w3.org/2000/svg"><g data-kordoc-id="p${n}"><text>${n}쪽 변경 문구입니다</text></g></svg>`;
  const scene = { format: 'hwp', warnings: [], pages: [1, 2].map(n => ({ page: n, width: 595, height: 842 })), regions: [1, 2].map(n => ({ id: `p${n}`, type: 'paragraph', page: n, regions: [{ page: n, x: 50, y: 50, width: 300, height: 20 }] })) };
  const render = async (bytes, options) => {
    calls.push(options);
    const pages = options.pages ?? [1, 2];
    // A page of uncompressed photos: 17MB of base64 picture data when pictures are kept.
    const picture = options.maxImageBytes > 1 ? `<image href="data:image/bmp;base64,${'A'.repeat(17 * 1024 * 1024)}"/>` : '';
    return { scene: { ...scene, warnings: options.maxImageBytes > 1 ? [] : ['이미지 BIN0001.bmp 4.0MB — 한도 초과로 생략'] }, pageSvgs: new Map(pages.map(n => [n, page(n).replace('</svg>', `${picture}</svg>`)])) };
  };
  const target = { id: 7, type: 'modified', block: { text: '2쪽 변경 문구입니다' }, cells: [], textAnchors: [] };
  const data = await previewDocument({ bytes: new Uint8Array() }, 1, { targets: [target], focusId: 7, jump: true }, render);
  assert.equal(calls[0].maxImageBytes, 1, 'locating changes never renders pictures');
  assert.equal(calls[0].pages, undefined);
  assert.equal(data.page, 2);
  assert.deepEqual(calls.slice(1).map(c => [c.pages, c.maxImageBytes > 1]), [[[2], true], [[2], false]]);
  assert.equal(data.rendering.imagesOmitted, true);
  assert.match(data.warnings[0], /그림 용량이 커서 글과 표만 표시/);
  assert.ok(!data.warnings.some(w => /한도 초과/.test(w)));
  assert.equal(data.locations.find(l => l.id === 7).boxes[0].page, 2);
  assert.match(previewNotice(data, null).title, /그림은 표시하지 않았습니다/);
});
