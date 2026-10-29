import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareBlocks, compareDocuments, content } from '../src/engine.mjs';
import { sampleFiles } from '../src/sample-data.mjs';
import { diffBlocks, markdownToHwpx } from 'kordoc';
import { escapeHtml, highlight, exportHtml, renderDiff } from '../public/report.js';
import { previewDocument } from '../src/preview.mjs';

const paragraph = text => ({ type: 'paragraph', text });
const cell = text => ({ text, rowSpan: 1, colSpan: 1 });
const table = rows => ({ type: 'table', table: { rows: rows.length, cols: rows[0].length, hasHeader: true, cells: rows.map(row => row.map(cell)) } });

test('regression: one digit in a long paragraph must not be classified unchanged', () => {
  const text = '사업의 수행 결과는 정해진 절차에 따라 검토하고 보고한다. '.repeat(20) + '예산 500만원';
  const a = [paragraph(text)], b = [paragraph(text.replace('500만원', '501만원'))];
  assert.equal(diffBlocks(a, b).stats.unchanged, 1, 'pinned upstream threshold reproduces the bug');
  assert.equal(compareBlocks(a, b).stats.modified, 1);
});

test('same content is unchanged; whitespace changes are retained', () => {
  assert.equal(compareBlocks([paragraph('금액 100')], [paragraph('금액 100')]).stats.unchanged, 1);
  assert.equal(compareBlocks([paragraph('금액 100')], [paragraph('금액  100')]).stats.modified, 1);
});

test('small numeric change in a large table is retained with exact coordinates', () => {
  const a = table(Array.from({ length: 25 }, (_, n) => ['사업 항목 ' + n, '500']));
  const b = structuredClone(a); b.table.cells[20][1].text = '501';
  const result = compareBlocks([a], [b]);
  assert.equal(result.stats.modified, 1);
  assert.equal(result.diffs[0].cells.length, 1);
  assert.equal(result.diffs[0].cells[0].row, 21);
  assert.equal(result.diffs[0].cells[0].col, 2);
});

test('merge-only, caption-only and footnote changes are retained', () => {
  const a = table([['같은 글', '']]); const b = structuredClone(a);
  b.table.cells[0][0].colSpan = 2;
  b.table.cells[0][1].colSpan = 0;
  assert.equal(compareBlocks([a], [b]).stats.modified, 1);
  const c = structuredClone(a); c.table.caption = '표 1';
  assert.equal(compareBlocks([a], [c]).stats.modified, 1);
  assert.equal(compareBlocks([{ ...paragraph('내용'), footnoteText: '주석1' }], [{ ...paragraph('내용'), footnoteText: '주석2' }]).stats.modified, 1);
});

test('insertions/deletions preserve side-specific block indexes', () => {
  const r = compareBlocks([paragraph('기존 첫 문단'), paragraph('공통 문장')], [paragraph('공통 문장'), paragraph('새로운 의무')]);
  assert.deepEqual(r.stats, { added: 1, removed: 1, modified: 0, unchanged: 1 });
  const same = r.diffs.find(d => d.type === 'unchanged');
  assert.equal(same.oldIndex, 2); assert.equal(same.newIndex, 1);
});

test('style and image bytes are deliberately excluded', () => {
  assert.deepEqual(content({ ...paragraph('본문'), style: { bold: true }, imageData: { data: new Uint8Array(20) } }), content(paragraph('본문')));
});

test('complexity guard rejects oversized block alignments', () => {
  assert.throws(() => compareBlocks(Array(1500).fill(paragraph('a')), Array(1500).fill(paragraph('b'))), /처리 한도/);
});

test('real HWPX sample roundtrip: paragraphs, table values, additions and deletion', async () => {
  const f = await sampleFiles();
  const r = await compareDocuments(f.oldFile, f.newFile);
  assert.deepEqual(r.stats, { added: 3, removed: 1, modified: 3, unchanged: 5 });
  assert.equal(r.diffs.find(d => d.before?.table).cells.length, 3);
  assert.equal(r.documents.before.format, 'hwpx');
  assert.equal(process.env.KORDOC_OFFLINE, '1');
  const same = await compareDocuments(f.oldFile, f.oldFile);
  assert.equal(same.stats.modified + same.stats.added + same.stats.removed, 0);
});

test('real HWPX one-digit regression through parser', async () => {
  const text = '문서의 사업비와 보고 기준을 확인하고 현장 점검 결과를 반영한다. '.repeat(15);
  const a = new Uint8Array(await markdownToHwpx(text + '예산 500만원'));
  const b = new Uint8Array(await markdownToHwpx(text + '예산 501만원'));
  const result = await compareDocuments({ bytes: a, name: 'a.hwpx' }, { bytes: b, name: 'b.hwpx' });
  assert.equal(result.stats.modified, 1);
});

test('invalid document is an error, never unchanged', async () => {
  const bad = { name: '손상.hwpx', bytes: new TextEncoder().encode('not a document') };
  await assert.rejects(compareDocuments(bad, bad), /읽을 수 없습니다/);
});

test('original HWPX renders to a standalone SVG image, with accurate page count', async () => {
  const f = await sampleFiles();
  const preview = await previewDocument(f.oldFile);
  assert.equal(preview.page, 1); assert.equal(preview.totalPages, 1);
  assert.ok(preview.image.startsWith('data:image/svg+xml;base64,'));
  const svg = Buffer.from(preview.image.split(',')[1], 'base64').toString();
  assert.match(svg, /<svg/); assert.match(svg, /지역보건/);
  assert.match(svg, /<rect/); assert.match(svg, /300/);
  await assert.rejects(previewDocument(f.oldFile, 0), /쪽 번호/);
  await assert.rejects(previewDocument(f.oldFile, 2));
});

test('multi-page HWPX preview selects the requested page independently', async () => {
  const bytes = new Uint8Array(await markdownToHwpx(Array.from({ length: 100 }, (_, i) => `문단 ${i} 지역 보건소 운영 현황을 확인합니다.`).join('\n\n')));
  const preview = await previewDocument({ bytes }, 2);
  assert.equal(preview.page, 2); assert.ok(preview.totalPages > 1);
  assert.match(Buffer.from(preview.image.split(',')[1], 'base64').toString(), /data-page="2"/);
});

test('bundled existing Hancom form renders without regenerating the source document', async () => {
  const bytes = new Uint8Array(await readFile(new URL('../node_modules/kordoc/templates/일반기안문_서식.hwpx', import.meta.url)));
  const preview = await previewDocument({ bytes });
  assert.ok(preview.totalPages >= 1);
  assert.ok(preview.image.length > 1000);
});

test('character highlighting preserves separate small edits and escapes document HTML', () => {
  const r = highlight('예산 500만원, 인원 120명', '예산 501만원, 인원 180명');
  assert.match(r.before, /50<mark class="removed">0<\/mark>/);
  assert.match(r.after, /50<mark class="added">1<\/mark>/);
  assert.match(r.after, /1<mark class="added">8<\/mark>0명/);
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
  assert.ok(!highlight('', '<img src=x onerror=alert(1)>').after.includes('<img'));
});

test('export is standalone and escapes file names, document text and parser warnings', async () => {
  const f = await sampleFiles(); const r = await compareDocuments(f.oldFile, f.newFile);
  r.documents.before.name = '<img src=x onerror=alert(1)>.hwpx';
  r.warnings.push({ document: '구버전', code: 'PARTIAL_PARSE', message: '<script>alert(1)</script>' });
  const html = exportHtml(r);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(html.includes('섹션 근사'));
  assert.ok(!html.includes('href="http'));
  const card = renderDiff(r.diffs.find(d => d.before?.table), r.documents);
  assert.ok(card.includes('cell-before')); assert.ok(card.includes('cell-after'));
});

test('unsupported image changes do not inflate five real modifications to seven', () => {
  const a = Array.from({ length: 5 }, (_, i) => paragraph(`사업 항목 ${i} 금액 500만원`));
  const b = a.map(p => paragraph(p.text.replace('500', '501')));
  a.splice(2, 0, { type: 'image', text: 'old-logo.png' }, { type: 'image', text: 'old-stamp.png' });
  b.splice(2, 0, { type: 'image', text: 'new-logo.png' }, { type: 'image', text: 'new-stamp.png' });
  const r = compareBlocks(a, b);
  assert.equal(r.stats.modified, 5); assert.equal(r.diffs.length, 5);
  assert.equal(r.unsupported.before.length, 2); assert.equal(r.unsupported.after.length, 2);
  assert.equal(r.diffs[2].oldIndex, 5);
});

test('added and removed images are unsupported, including images inside cells', () => {
  const image = { type: 'image', text: 'new-image.png' };
  assert.deepEqual(compareBlocks([], [image]).stats, { added: 0, removed: 0, modified: 0, unchanged: 0 });
  assert.equal(compareBlocks([image], []).unsupported.before.length, 1);
  const a = table([['설명']]); const b = structuredClone(a);
  a.table.cells[0][0].blocks = [paragraph('설명'), { ...image, text: 'old.png' }];
  b.table.cells[0][0].blocks = [paragraph('설명'), image];
  a.table.cells[0][0].text = '설명 old.png'; b.table.cells[0][0].text = '설명 new-image.png';
  const r = compareBlocks([a], [b]);
  assert.equal(r.stats.modified, 0); assert.equal(r.diffs[0].cells.length, 0);
  assert.equal(r.unsupported.after.length, 1);
});

test('long tables default to changed cells and keep complete context collapsed', () => {
  const a = table(Array.from({ length: 100 }, (_, i) => [`행 ${i}`, '500']));
  const b = structuredClone(a); b.table.cells[90][1].text = '600';
  const r = compareBlocks([a], [b]);
  const html = renderDiff(r.diffs[0], { before: {}, after: {} });
  const compact = html.split('<details')[0];
  assert.match(compact, /91행 2열/); assert.ok(!compact.includes('행 50'));
  assert.match(html, /<details class="full-context">/); assert.ok(!html.includes('<details open'));
  assert.ok(html.includes('행 50'));
});

test('identical text changing paragraph/heading classification is one structural change, not deletion/addition', () => {
  const r = compareBlocks([{ type: 'paragraph', text: 'IV. 결론' }], [{ type: 'heading', level: 1, text: 'IV. 결론' }]);
  assert.deepEqual(r.stats, { added: 0, removed: 0, modified: 0, unchanged: 1 });
  assert.equal(r.diffs.length, 1); assert.equal(r.diffs[0].type, 'structure'); assert.equal(r.structureStats.changed, 1);
  assert.equal(r.diffs[0].after.type, 'heading');
});

test('heading level changes and nested cell classifications are not content edits', () => {
  const a = { type: 'heading', level: 1, text: '동일 제목' }, b = { ...a, level: 2 };
  assert.equal(compareBlocks([a], [b]).diffs[0].type, 'structure');
  const old = table([['동일 제목']]), fresh = structuredClone(old);
  old.table.cells[0][0].blocks = [a]; fresh.table.cells[0][0].blocks = [b];
  const r = compareBlocks([old], [fresh]); assert.equal(r.stats.modified, 0); assert.equal(r.diffs[0].cells.length, 0); assert.equal(r.structureStats.changed, 1);
});
