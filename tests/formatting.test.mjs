import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHwpx } from 'kordoc';
import { readHwpxFormatting, compareFormatting } from '../src/formatting.mjs';
import { compareDocuments } from '../src/engine.mjs';
import { editHwpx, cloneStyle, formatSamples, all } from './helpers/format-fixture.mjs';
import { memoFixture } from './helpers/memo-fixture.mjs';
const file = bytes => ({ name: 'test.hwpx', bytes });
const compare = (a, b) => compareFormatting(file(a), file(b), ['hwpx', 'hwpx']);

test('four properties and partial table-cell formatting are separate from body changes', async () => {
  const docs = await formatSamples(), result = await compareDocuments(...docs);
  assert.equal(result.stats.added + result.stats.removed + result.stats.modified, 0);
  assert.equal(result.formatting.available, true);
  assert.equal(result.formatting.stats.changedRanges, 5);
  assert.deepEqual(result.formatting.stats.properties, { color: 2, font: 1, spacing: 2, ratio: 1 });
  const cell = result.formatting.diffs.find(d => d.after.location.row);
  assert.equal(cell.text, '글자만'); assert.equal(cell.after.location.row, 2); assert.equal(cell.after.location.col, 2);
});

test('renumbered char/font IDs and equivalent run splitting are not changes', async () => {
  const a = new Uint8Array(await markdownToHwpx('같은 문장입니다'));
  const b = await editHwpx(a, (h, s) => {
    for (const p of all(h, 'charPr')) p.setAttribute('id', String(Number(p.getAttribute('id')) + 100));
    for (const style of all(h, 'style')) style.setAttribute('charPrIDRef', String(Number(style.getAttribute('charPrIDRef')) + 100));
    for (const r of all(s, 'run')) r.setAttribute('charPrIDRef', String(Number(r.getAttribute('charPrIDRef')) + 100));
    for (const f of all(h, 'font')) f.setAttribute('id', String(Number(f.getAttribute('id')) + 10));
    for (const ref of all(h, 'fontRef')) for (const attr of Array.from(ref.attributes)) ref.setAttribute(attr.name, String(Number(attr.value) + 10));
    const t = all(s, 't').find(n => n.textContent === '같은 문장입니다'), run = t.parentNode, r = run.cloneNode(true);
    t.textContent = '같은 '; all(r, 't')[0].textContent = '문장입니다'; run.parentNode.insertBefore(r, run.nextSibling);
  });
  assert.equal((await compare(a, b)).stats.changedRanges, 0);
});

test('unused styles and unused language slots do not create false positives', async () => {
  const a = new Uint8Array(await markdownToHwpx('한글문장'));
  const b = await editHwpx(a, (h, s) => {
    const id = all(s, 'run').find(r => r.textContent.includes('한글문장')).getAttribute('charPrIDRef');
    const used = all(h, 'charPr').find(p => p.getAttribute('id') === id);
    all(used, 'fontRef')[0].setAttribute('latin', '1'); all(used, 'spacing')[0].setAttribute('latin', '-10');
    all(h, 'charPr').find(p => p.getAttribute('id') !== id).setAttribute('textColor', '#FF0000');
  });
  assert.equal((await compare(a, b)).stats.changedRanges, 0);
});

test('Latin and Korean style values are resolved for the characters actually present', async () => {
  const a = new Uint8Array(await markdownToHwpx('한글ABC'));
  const b = await editHwpx(a, (h, s) => {
    const { pr } = cloneStyle(h, s, '한글ABC', {});
    all(pr, 'fontRef')[0].setAttribute('latin', '1'); all(pr, 'ratio')[0].setAttribute('latin', '90');
  });
  const result = await compare(a, b);
  assert.equal(result.diffs.length, 1); assert.equal(result.diffs[0].text, 'ABC');
  assert.deepEqual(result.diffs[0].changes.map(c => c.property), ['font', 'ratio']);
});

test('paragraph style fallback and normalized color/numeric values are handled', async () => {
  const a = new Uint8Array(await markdownToHwpx('상속 문장'));
  const b = await editHwpx(a, (h, s) => {
    all(s, 'run').forEach(r => r.removeAttribute('charPrIDRef'));
    all(h, 'charPr').find(p => p.getAttribute('id') === '0').setAttribute('textColor', '#000');
    all(h, 'ratio').forEach(r => r.setAttribute('hangul', '100.0'));
  });
  assert.equal((await compare(a, b)).stats.changedRanges, 0);
  const c = await editHwpx(b, h => all(h, 'charPr').find(p => p.getAttribute('id') === '0').setAttribute('textColor', '#ff0000'));
  assert.equal((await compare(a, c)).diffs[0].changes[0].after, '#FF0000');
});

test('inserted text styling is not reported as a modification of pre-existing text', async () => {
  const a = new Uint8Array(await markdownToHwpx('기존 문장'));
  const b = await editHwpx(a, (h, s) => {
    all(s, 't').find(t => t.textContent === '기존 문장').textContent = '기존 문장 추가';
    cloneStyle(h, s, '기존 문장 추가', { color: '#FF0000' }, [5, 8]);
  });
  const r = await compareDocuments(file(a), file(b));
  assert.equal(r.stats.modified, 1); assert.equal(r.formatting.stats.changedRanges, 0);
});

test('memo-only formatting is excluded and invalid used styles are not reported as unchanged', async () => {
  const [, doc] = await memoFixture();
  const b = await editHwpx(doc.bytes, (h, s) => {
    const memoRun = all(s, 'fieldBegin')[0].getElementsByTagName('hp:run')[0];
    memoRun.setAttribute('charPrIDRef', 'missing-memo-style');
  });
  assert.equal((await compare(doc.bytes, b)).stats.changedRanges, 0);
  const broken = await editHwpx(b, (_, s) => all(s, 'run')[0].setAttribute('charPrIDRef', 'missing-body-style'));
  assert.equal((await compare(doc.bytes, broken)).available, false);
  assert.equal((await compareFormatting(doc, doc, ['hwp', 'hwpx'])).available, false);
});

test('text and formatting can change together without conflating their counts', async () => {
  const a = new Uint8Array(await markdownToHwpx('공통 문장 120명'));
  const b = await editHwpx(a, (h, s) => {
    all(s, 't').find(t => t.textContent === '공통 문장 120명').textContent = '공통 문장 180명';
    cloneStyle(h, s, '공통 문장 180명', { color: '#FF0000' });
  });
  const r = await compareDocuments(file(a), file(b));
  assert.equal(r.stats.modified, 1); assert.ok(r.formatting.stats.changedRanges > 0);
  assert.ok(r.formatting.diffs.every(d => d.changes.every(c => c.property === 'color')));
});
