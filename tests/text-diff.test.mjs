import test from 'node:test';
import assert from 'node:assert/strict';
import { textParts, textChanges, changeAnchors, findOccurrences } from '../public/text-diff.js';
import { focusedText, textSummary } from '../public/report.js';

test('a long unchanged prefix is collapsed and the appended sentence is visible first', () => {
  const a = '같은 앞부분입니다.\n'.repeat(100), b = a + '추가된 후속 조치 문장입니다.';
  const html = focusedText(a, b, 'after');
  assert.ok(html.length < 250); assert.match(html, /data-edit>추가된 후속 조치 문장입니다/);
  assert.equal(textChanges(a, b).length, 1); assert.equal(textChanges(a, b)[0].type, 'added');
  assert.equal(textSummary({ before: null, after: null, cells: [{ before: { text: a }, after: { text: b } }] }), '문구 1곳 추가');
});
test('edit offsets reconstruct Unicode strings and retain separated changes', () => {
  const a = '😀 한글 500 / 120명', b = '😀 한글 501 / 180명';
  const parts = textParts(a, b);
  assert.equal(parts.filter(p => p.type !== 'added').map(p => p.text).join(''), a);
  assert.equal(parts.filter(p => p.type !== 'removed').map(p => p.text).join(''), b);
  assert.equal(textChanges(a, b).length, 2);
});
test('change anchors distinguish inserted text from unchanged old context', () => {
  const a = '기존 문단', b = a + '\n새로운 문단';
  assert.deepEqual(changeAnchors(a, b, 'after'), [{ context: '새로운 문단', start: 0, end: 5, contextOnly: false }]);
  assert.equal(changeAnchors(a, b, 'before')[0].contextOnly, true);
});
test('search windows expose literal metacharacters and distant unchanged text safely', () => {
  assert.deepEqual(findOccurrences('a[b a[b', 'a[b'), [[0, 3], [4, 7]]);
  const a = '앞'.repeat(900) + '후속 확인' + '뒤'.repeat(900);
  const html = focusedText(a, a + '\n추가', 'after', '후속');
  assert.ok(html.length < 250); assert.match(html, /후속 확인/);
  assert.ok(!focusedText('', '<script>', 'after').includes('<script>'));
  assert.match(focusedText('앞'.repeat(900), '후속', 'before', '후속'), /검색어 일치 없음/);
});
