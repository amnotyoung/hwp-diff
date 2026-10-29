import test from 'node:test';
import assert from 'node:assert/strict';
import { paragraphPairs, textParts } from '../public/text-diff.js';
import { comparisonSegments, renderDiff, previewTargets, textSummary } from '../public/report.js';
import { compareBlocks } from '../src/engine.mjs';

const oldText = '1) 계획\n- (문제 정의) ' + '기존 업무 환경의 문제를 설명합니다. '.repeat(25) + '\n- (해결 방안) ' + '기존 방안을 설명합니다. '.repeat(25);
const newText = '1) 계획\n- (문제 정의) ' + '개정한 업무 환경의 문제를 설명합니다. '.repeat(25) + '\n- (해결 방안)\n1. 새 방안을 설명합니다.\n2. 추가 검토를 수행합니다.';
const cell = text => ({ text, rowSpan: 1, colSpan: 1, blocks: [] });
const entry = { id: 40, type: 'modified', before: null, after: null, cells: [{ row: 2, col: 1, before: cell(oldText), after: cell(newText) }] };

test('long translated cells split at shared headings and preserve one-to-many paragraphs', () => {
  const pairs = paragraphPairs(oldText, newText);
  assert.equal(pairs.map(p => p.before).join(''), oldText);
  assert.equal(pairs.map(p => p.after).join(''), newText);
  const segments = comparisonSegments(entry);
  assert.equal(segments.length, 2);
  assert.match(segments[1].after, /1\. 새 방안/); assert.match(segments[1].after, /2\. 추가 검토/);
  assert.equal(textSummary(entry), '문단 구간 2곳 변경');
});

test('long text preserves common words and reconstructs both versions exactly', () => {
  const a = ('original project data and review ').repeat(60), b = ('updated project data and planning ').repeat(60);
  const parts = textParts(a, b);
  assert.equal(parts.filter(p => p.type !== 'added').map(p => p.text).join(''), a);
  assert.equal(parts.filter(p => p.type !== 'removed').map(p => p.text).join(''), b);
  assert.ok(parts.filter(p => p.type === 'equal').map(p => p.text).join('').includes('project data'));
});

test('interactive segment navigation is omitted from the saved report and targets keep segment anchors', () => {
  const docs = { before: {}, after: {} };
  const d = { ...entry, before: { type: 'table', table: { rows: 2, cols: 1, cells: [[cell('제목')], [cell(oldText)]] } }, after: { type: 'table', table: { rows: 2, cols: 1, cells: [[cell('제목')], [cell(newText)]] } } };
  const interactive = renderDiff(d, docs, true), exported = renderDiff(d, docs);
  assert.match(interactive, /다음 구간/); assert.match(interactive, /data-segment-index="1" hidden/);
  assert.ok(!exported.includes('data-segment-step')); assert.ok(!exported.includes('data-segment-index="1" hidden'));
  const targets = previewTargets({ diffs: [d] }, 'new');
  assert.equal(targets[0].segments.length, 2); assert.equal(targets[0].segments[1].row, 2);
});

test('same-heading candidates preserve addition/deletion counts and ambiguous duplicates stay unpaired', () => {
  const a = { type: 'paragraph', text: '- Problem Definition: ' + 'AAA '.repeat(120) };
  const b = { type: 'paragraph', text: '- Problem Definition: ' + 'ZZZ '.repeat(120) };
  const result = compareBlocks([a], [b]);
  assert.equal(result.stats.removed, 1); assert.equal(result.stats.added, 1);
  assert.equal(result.diffs[0].counterpart.id, result.diffs[1].id);
  assert.equal(result.diffs[1].counterpart.label, 'Problem Definition');
  const ambiguous = compareBlocks([a, { ...a, text: a.text + 'different' }], [b]);
  assert.ok(ambiguous.diffs.every(d => !d.counterpart));
});
