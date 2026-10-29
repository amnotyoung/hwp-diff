import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { markdownToHwpx } from 'kordoc';
import { readHwpxMemos, compareMemos, compareAnnotations } from '../src/annotations.mjs';
import { compareDocuments } from '../src/engine.mjs';
import { annotationsHtml, exportHtml } from '../public/report.js';

const memoXml = (id, text) => `<hp:ctrl><hp:fieldBegin id="${id}" type="MEMO"><hp:parameters><hp:stringParam name="ID">memo${id}</hp:stringParam><hp:stringParam name="Author">검토자</hp:stringParam><hp:stringParam name="CreateDateTime">2026-10-29T01:00:00Z</hp:stringParam></hp:parameters><hp:subList><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList></hp:fieldBegin></hp:ctrl>`;
async function fixture() {
  const oldBytes = new Uint8Array(await markdownToHwpx('# 검토용 문서\n\n검토 문장입니다.'));
  const zip = await JSZip.loadAsync(oldBytes);
  const section = await zip.file('Contents/section0.xml').async('string');
  assert.ok(section.includes('<hp:t>검토 문장입니다.</hp:t>'));
  zip.file('Contents/section0.xml', section.replace('<hp:t>검토 문장입니다.</hp:t>', `${memoXml('123', '근거 자료를 추가해 주세요.')}<hp:t>검토 문장입니다.</hp:t><hp:ctrl><hp:fieldEnd beginIDRef="123"/></hp:ctrl>`));
  return [{ name: 'old.hwpx', bytes: oldBytes }, { name: 'new.hwpx', bytes: await zip.generateAsync({ type: 'uint8array' }) }];
}

test('HWPX memo body, author, timestamp and associated text are extracted separately', async () => {
  const [, file] = await fixture(); const notes = await readHwpxMemos(file.bytes);
  assert.equal(notes.length, 1); assert.equal(notes[0].text, '근거 자료를 추가해 주세요.');
  assert.equal(notes[0].author, '검토자'); assert.equal(notes[0].anchorText, '검토 문장입니다.');
  assert.equal(notes[0].createdAt, '2026-10-29T01:00:00Z');
});

test('memo-only edits leave body unchanged and appear in exported comparison', async () => {
  const result = await compareDocuments(...await fixture());
  assert.equal(result.stats.modified + result.stats.added + result.stats.removed, 0);
  assert.deepEqual(result.annotations.stats, { added: 1, removed: 0, modified: 0, unchanged: 0 });
  assert.match(exportHtml(result), /근거 자료를 추가해 주세요/);
  assert.match(annotationsHtml(result.annotations), /메모 추가/);
});

test('memo editing, deletion and regenerated IDs do not become false additions', () => {
  const a = { sourceId: 'memo1', text: '원래 의견', author: '검토자', anchorText: '본문', context: '주변 문장' };
  const b = { ...a, text: '수정 의견' };
  assert.equal(compareMemos([a], [b]).stats.modified, 1);
  assert.equal(compareMemos([a], []).stats.removed, 1);
  assert.equal(compareMemos([a], [{ ...a, sourceId: 'new-id', context: '주변 문장 변경' }]).stats.unchanged, 1);
});

test('HWP and extraction failures cannot be reported as zero comments', async () => {
  const files = await fixture();
  assert.equal((await compareAnnotations(...files, ['hwp', 'hwpx'])).available, false);
  const zip = await JSZip.loadAsync(files[1].bytes);
  const xml = await zip.file('Contents/section0.xml').async('string');
  zip.file('Contents/section0.xml', xml.replace('<hp:fieldEnd beginIDRef="123"/>', ''));
  files[1].bytes = await zip.generateAsync({ type: 'uint8array' });
  assert.equal((await compareAnnotations(...files, ['hwpx', 'hwpx'])).available, false);
});

test('memo strings and author IDs are escaped in the UI and report', () => {
  const result = compareMemos([], [{ sourceId: '1', text: '<script>alert(1)</script>', author: '<img>', anchorText: '본문', context: '' }]);
  const html = annotationsHtml(result);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img>'));
  assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img&gt;/);
});
