import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHwpx } from 'kordoc';
import { readHwpxFormatting, compareFormatting, compareFormattingParagraphs } from '../src/formatting.mjs';
import { compareDocuments } from '../src/engine.mjs';
import { editHwpx, cloneStyle, formatSamples, all } from './helpers/format-fixture.mjs';
import { memoFixture } from './helpers/memo-fixture.mjs';
import { formattingHtml, exportHtml, previewTargets } from '../public/report.js';
import { previewDocument } from '../src/preview.mjs';
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

test('HWP comparison explicitly reports unchecked formatting rather than zero changes', async () => {
  const result = await compareFormatting(file(new Uint8Array()), file(new Uint8Array()), ['hwp', 'hwpx']);
  assert.equal(result.reason, 'unsupported-format');
  assert.match(result.message, /글자색·글꼴·자간·장평 변경은 검사하지 않았습니다/);
  assert.match(result.message, /HWPX로 저장/);
  const html = formattingHtml(result);
  assert.ok(!html.includes('서식 변경 0곳'));
  assert.ok(html.includes('검사하지 않았습니다'));
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

test('formatting changed only on a replaced digit is still detected', async () => {
  const a = new Uint8Array(await markdownToHwpx('총 120명입니다'));
  const b = await editHwpx(a, (h, s) => {
    all(s, 't').find(t => t.textContent === '총 120명입니다').textContent = '총 180명입니다';
    cloneStyle(h, s, '총 180명입니다', { color: '#FF0000' }, [3, 4]);
  });
  const r = await compareDocuments(file(a), file(b));
  assert.equal(r.stats.modified, 1); assert.equal(r.formatting.stats.changedRanges, 1);
  assert.equal(r.formatting.diffs[0].text, '2'); assert.equal(r.formatting.diffs[0].after.paragraphText.slice(r.formatting.diffs[0].after.start, r.formatting.diffs[0].after.end), '8');
  assert.equal(r.formatting.diffs[0].mapping, 'replacement');
});

const styledParagraph = (text, spacing = 0, start = 0, end = text.length) => {
  const values = value => ({ color: '#000000', font: '맑은 고딕', spacing: value, ratio: 100 });
  const spans = [];
  if (start) spans.push({ start: 0, end: start, values: values(0) });
  spans.push({ start, end, values: values(spacing) });
  if (end < text.length) spans.push({ start: end, end: text.length, values: values(0) });
  return { type: 'paragraph', text, spans, location: { section: 'Contents/section0.xml', paragraph: 1, row: 7, col: 2, tableSourceId: 'test-table' } };
};

test('different labeled paragraphs are excluded instead of pairing analysis text with selection text', () => {
  const a = styledParagraph(' o (분석 계획) 데이터 분석·정리 결과를 직원들에게 공유합니다.');
  const b = styledParagraph(' o (사례집 제작) 선정 사례 결과를 직원들에게 공유합니다.', -4);
  for (const [old, fresh] of [[a, b], [b, a]]) {
    const result = compareFormattingParagraphs([old], [fresh]);
    assert.equal(result.stats.changedRanges, 0);
    assert.equal(result.uncertainMappings.length, 1);
    assert.equal(result.uncertainMappings[0].reason, 'different-heading');
    assert.match(formattingHtml(result), /서식 집계에서 제외한 문구 1쌍/);
  }
});

test('incidental equal letters inside a rewritten phrase do not become confirmed format matches', () => {
  const a = styledParagraph('담당 업무는 데이터 분석·정리 후 완료합니다.');
  const text = '담당 업무는 선정 후 완료합니다.', at = text.indexOf('선정');
  const b = styledParagraph(text, -4, at, at + 2);
  const result = compareFormattingParagraphs([a], [b]);
  assert.equal(result.diffs.length, 0);
  assert.ok(result.uncertainMappings.some(item => item.after.text === '선정'));
});

test('unchanged body formatting remains comparable when a heading is renamed', () => {
  const a = styledParagraph(' o (기존 제목) 이 본문은 그대로 유지합니다.');
  const b = styledParagraph(' o (새 제목) 이 본문은 그대로 유지합니다.', -4);
  const result = compareFormattingParagraphs([a], [b]);
  assert.ok(result.diffs.some(d => d.text.includes('이 본문은 그대로 유지합니다.')));
});

test('rewritten paragraphs with identical uniform styles do not generate unnecessary format warnings', () => {
  const a = styledParagraph(' o (분석 계획) 데이터 분석 결과를 직원들에게 공유합니다.');
  const b = styledParagraph(' o (사례집 제작) 선정 사례 결과를 직원들에게 공유합니다.');
  const result = compareFormattingParagraphs([a], [b]);
  assert.equal(result.diffs.length, 0); assert.equal(result.uncertainMappings.length, 0);
  const uncertain = { ...result, uncertainMappings: [{ reason: 'rewritten-text', before: { text: '<script>x</script>' }, after: { text: '문구' } }] };
  assert.ok(!formattingHtml(uncertain).includes('<script>')); assert.match(formattingHtml(uncertain), /&lt;script&gt;/);
});

test('uniform formatting is compared across replacements of different lengths', async () => {
  const a = new Uint8Array(await markdownToHwpx('사업 담당은 박수입니다'));
  const b = await editHwpx(a, (h, s) => {
    all(s, 't').find(t => t.textContent === '사업 담당은 박수입니다').textContent = '사업 담당은 최민호입니다';
    cloneStyle(h, s, '사업 담당은 최민호입니다', { color: '#FF0000' }, [7, 10]);
  });
  const r = await compareDocuments(file(a), file(b));
  assert.equal(r.stats.modified, 1); assert.equal(r.formatting.stats.changedRanges, 1); assert.equal(r.formatting.incompleteRanges, 0);
});

test('ambiguous mixed styles in a length-changing replacement are explicitly marked incomplete', async () => {
  const a = new Uint8Array(await markdownToHwpx('사업 담당은 박수입니다'));
  const b = await editHwpx(a, (h, s) => {
    all(s, 't').find(t => t.textContent === '사업 담당은 박수입니다').textContent = '사업 담당은 최민호입니다';
    cloneStyle(h, s, '사업 담당은 최민호입니다', { color: '#FF0000' }, [7, 9]);
  });
  const result = await compare(a, b);
  assert.equal(result.incompleteRanges, 1); assert.match(formattingHtml(result), /정확히 대응하지 못했습니다/);
});

test('formatting report shows before/after values, escapes names and contains no app-only export buttons', async () => {
  const r = await compareDocuments(...await formatSamples());
  const html = formattingHtml(r.formatting, true);
  for (const expected of ['글자색', '글꼴', '자간', '장평', '#FF0000', '-5%', '95%', 'data-preview-format']) assert.ok(html.includes(expected));
  assert.ok(exportHtml(r).includes('서식 변경 5구간'));
  assert.ok(!exportHtml(r).includes('data-preview-format'));
  r.formatting.diffs[0].changes[0].after = '<img src=x onerror=alert(1)>';
  assert.ok(!formattingHtml(r.formatting).includes('<img')); assert.ok(formattingHtml(r.formatting).includes('&lt;img'));
});

test('formatting locations resolve paragraphs and partial text inside table cells', async () => {
  const docs = await formatSamples(), result = await compareDocuments(...docs);
  const targets = previewTargets(result, 'new');
  assert.equal(targets.filter(t => t.category === 'format').length, 5);
  const p = await previewDocument(docs[1], 1, { targets, focusId: 'format-5', jump: true });
  assert.ok(p.locations.filter(l => l.category === 'format').every(l => l.status === 'format' && l.boxes.length));
});
