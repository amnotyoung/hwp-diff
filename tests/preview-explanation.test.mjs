import test from 'node:test';
import assert from 'node:assert/strict';
import { previewExplanation, filterCounts, renderDiff } from '../public/report.js';

const diff = (before, after, extra = {}) => ({ id: 3, type: 'modified', before: { text: before }, after: { text: after }, cells: [], ...extra });

test('preview summary exposes a late change in a long table cell rather than its identical prefix', () => {
  const before = '동일한 앞 문장입니다. '.repeat(150), after = before + '후속 점검을 연 2회 실시한다.';
  const html = previewExplanation(diff('', '', { cells: [{ row: 5, col: 2, before: { text: before }, after: { text: after } }] }));
  assert.match(html, /5행 2열/);
  assert.match(html, /문구 1곳 추가/);
  assert.match(html, /<mark class="added">후속 점검을 연 2회 실시한다\.<\/mark>/);
  // The full text remains a tooltip, but the visible excerpt is bounded.
  const visible = html.replace(/title="[^"]*"/g, '');
  assert.ok(visible.length < 900);
});

test('preview summary distinguishes additions, removals, numeric replacements and structure-only edits', () => {
  assert.match(previewExplanation(diff('', '새 문장', { type: 'added' })), /추가 · 항목 3/);
  assert.match(previewExplanation(diff('삭제 문장', '', { type: 'removed' })), /해당 내용 없음/);
  const numeric = previewExplanation(diff('연간 교육 120명', '연간 교육 180명'));
  assert.match(numeric, /class="removed">2/); assert.match(numeric, /class="added">8/);
  const structure = previewExplanation(diff('IV. 결론', 'IV. 결론', { type: 'structure', structureChanges: [{ before: { type: 'paragraph' }, after: { type: 'heading', level: 1 } }] }));
  assert.match(structure, /본문 동일/); assert.match(structure, /제목 \(1단계\)/);
  assert.ok(!structure.includes('문구 1곳'));
});

test('memo and formatting explanations expose actual changes and escape document text', () => {
  const memo = previewExplanation({ type: 'added', after: { text: '수치 확인 <script>' } }, 'memo');
  assert.match(memo, /메모 추가/); assert.ok(!memo.includes('<script>'));
  const format = previewExplanation({ text: '선택 문구', changes: [{ property: 'spacing', label: '자간', before: 0, after: -5 }, { property: 'color', label: '글자색', before: '#000000', after: '#FF0000' }] }, 'format');
  assert.match(format, /자간 -5%/); assert.match(format, /#FF0000/);
  const metadata = previewExplanation({ type: 'modified', before: { text: '확인', author: '홍길동' }, after: { text: '확인', author: '김철수' } }, 'memo');
  assert.match(metadata, /작성자 또는 연결 위치 변경/);
  assert.match(metadata, /홍길동/); assert.match(metadata, /김철수/);
});

test('filter counts match selectable items, keep structure separate and exclude images', () => {
  const diffs = Object.entries({ added: 3, removed: 1, modified: 5, structure: 2, unchanged: 70 }).flatMap(([type, n]) => Array.from({ length: n }, () => ({ type })));
  assert.deepEqual(filterCounts({ diffs, unsupported: { before: [1, 2], after: [1, 2] } }), { all: 81, changes: 11, added: 3, removed: 1, modified: 5, structure: 2 });
});

test('detail pane shows the edit first without adding a redundant source-navigation button', () => {
  const before = '동일한 문맥입니다. '.repeat(100);
  const html = renderDiff(diff(before, before + '추가한 문장'), { before: {}, after: {} }, false, '', true);
  assert.match(html, /data-edit>추가한 문장/);
  assert.match(html, /문단 전체 내용 보기/);
  assert.ok(!html.includes('data-preview-diff'));
  const excerpts = [...html.matchAll(/<div class="block-text">(.*?)<\/div>/gs)].map(m => m[1]);
  assert.ok(excerpts.every(text => text.length < 300));
});
