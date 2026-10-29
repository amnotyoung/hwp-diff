import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasWidth, clipPageBoxes, previewNotice } from '../public/view-layout.js';
import { fileLabel } from '../public/report.js';

test('page fit preserves the complete portrait or landscape sheet within both available dimensions', () => {
  for (const page of [{ width: 595.28, height: 841.88 }, { width: 841.88, height: 595.28 }, { width: 420, height: 1000 }]) {
    for (const [width, height] of [[600, 540], [350, 600], [900, 320]]) {
      const fitted = canvasWidth(page, width, height, 'page');
      assert.ok(fitted > 0 && fitted <= width);
      assert.ok(fitted * page.height / page.width <= height);
    }
  }
});
test('width-fit and zoom retain their separate meaning across paper sizes', () => {
  const page = { width: 720, height: 1000 };
  assert.equal(canvasWidth(page, 480, 400, 'fit'), 480);
  assert.equal(canvasWidth(page, 480, 400, '100'), 960);
  assert.equal(canvasWidth(page, 480, 400, '150'), 1440);
});
test('hidden or invalid viewports are not assigned bogus page sizes', () => {
  assert.equal(canvasWidth({ width: 595, height: 842 }, 0, 400, 'page'), null);
  assert.equal(canvasWidth({ width: 0, height: 842 }, 400, 400, 'page'), null);
  assert.equal(canvasWidth({ width: 595, height: 842 }, 400, 400, 'unknown'), null);
});

test('long Korean file names preserve their suffix without splitting decomposed syllables', () => {
  const name = ('긴문서제목'.repeat(12) + '_1007_1600.hwp').normalize('NFD');
  const html = fileLabel(name);
  assert.ok(html.includes('_1007_1600.hwp'));
  assert.match(html, /class="file-name-start">긴문서제목/);
  assert.ok(html.includes('class="file-name-end"'));
});

test('page-local highlights clip edges, discard empty/off-page boxes and deduplicate', () => {
  const page = { page: 3, width: 595, height: 842 };
  const boxes = [{ page: 3, x: 20, y: 850, width: 100, height: 0 }, { page: 3, x: 20, y: 956, width: 100, height: 18 },
    { page: 3, x: -10, y: 830, width: 100, height: 30 }, { page: 3, x: -10, y: 830, width: 100, height: 30 },
    { page: 2, x: 0, y: 10, width: 30, height: 20 }, { page: 3, x: NaN, y: 10, width: 30, height: 20 }];
  assert.deepEqual(clipPageBoxes(boxes, page), [{ page: 3, x: 0, y: 830, width: 90, height: 12 }]);
  assert.deepEqual(clipPageBoxes(boxes, { ...page, page: 4 }), []);
});

test('one reader-facing notice replaces overlapping geometry diagnostics without hiding missing text', () => {
  const data = { rendering: { invalidBoxCount: 8 }, warnings: ['여러 쪽에 걸친 표의 region을 분할하지 못했습니다.'] };
  const notice = previewNotice(data, { status: 'partial-text', message: '페이지 밖 위치 8개 제외' });
  assert.match(notice.title, /색 표시/); assert.match(notice.message, /내용 비교/);
  assert.ok(!JSON.stringify(notice).match(/region|8개|좌표|페이지 밖/));
  const missing = previewNotice({ ...data, rendering: { ...data.rendering, unmatchedTextCount: 2 } }, { status: 'unresolved' });
  assert.match(missing.title, /글이 보이지/); assert.match(missing.message, /원본 파일/);
  assert.deepEqual(previewNotice({ warnings: [] }, { status: 'paragraph' }), { title: '', message: '' });
});
