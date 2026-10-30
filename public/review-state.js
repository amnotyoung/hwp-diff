import { blockText } from './report.js';

export const REVIEW_LABELS = { content: '내용', format: '서식', memo: '메모' };
export function createReviewState() {
  return {
    mode: 'content', view: 'list',
    selections: { content: null, format: null, memo: null },
    conditions: {
      content: { filter: 'changes', query: '', shown: 50 },
      format: { filter: 'all', query: '', shown: 50 },
      memo: { filter: 'changes', query: '', shown: 50 },
    },
    listPositions: Object.fromEntries(['content', 'format', 'memo'].map(mode => [mode, { top: 0, id: null, segment: 0 }])),
    searchPositions: Object.fromEntries(['content', 'format', 'memo'].map(mode => [mode, { list: -1, preview: -1 }])),
  };
}
export function allReviewItems(result, mode) {
  return mode === 'format' ? result?.formatting?.diffs ?? [] : mode === 'memo' ? result?.annotations?.diffs ?? [] : result?.diffs ?? [];
}
export function reviewItemText(item, mode) {
  if (mode === 'format') return [item.text, item.before.paragraphText.slice(item.before.start, item.before.end), item.after.paragraphText.slice(item.after.start, item.after.end), ...item.changes.flatMap(c => [c.label, ...[c.before, c.after].map(value => value === 'AUTO' ? '자동' : `${value}${['spacing', 'ratio'].includes(c.property) ? '%' : ''}`)])].join('\n');
  if (mode === 'memo') return [item.before, item.after].filter(Boolean).flatMap(m => [m.text, m.author, m.anchorText, m.context]).filter(Boolean).join('\n');
  return `${blockText(item.before)}\n${blockText(item.after)}`;
}
export function reviewItems(result, mode, condition, navigation = false) {
  const query = condition.query.trim().toLocaleLowerCase();
  return allReviewItems(result, mode).filter(item => {
    const typeMatches = mode === 'format' ? condition.filter === 'all' || item.changes.some(c => c.property === condition.filter)
      : condition.filter === 'all' || (condition.filter === 'changes' ? item.type !== 'unchanged' : condition.filter === 'moved' ? !!item.moved : item.type === condition.filter);
    return typeMatches && (!navigation || mode !== 'content' || item.type !== 'unchanged') && (!query || reviewItemText(item, mode).toLocaleLowerCase().includes(query));
  });
}
export function reviewFilters(result, mode) {
  const definitions = mode === 'format' ? [['all', '전체'], ['color', '글자색'], ['font', '글꼴'], ['spacing', '자간'], ['ratio', '장평']]
    : [['changes', '변경만'], ['all', '전체'], ['added', '추가'], ['removed', '삭제'], ['modified', '수정'], ...(mode === 'content' ? [['structure', '구조']] : []), ...(mode === 'content' && result?.moveStats?.moved ? [['moved', '이동']] : [])];
  return definitions.map(([value, label]) => ({ value, label, count: reviewItems(result, mode, { filter: value, query: '' }).length }));
}

// Page membership and screen visibility are separate. One side can be absent
// (an addition/deletion), while the other side is a valid visible selection.
export function reviewPresence(id, locations, pages, windows = {}, segment = null) {
  let onPage = false, onScreen = false, offscreen = false, unresolved = false, pending = false, presentSides = 0;
  for (const side of ['old', 'new']) {
    if (!locations[side]) { pending = true; continue; }
    const location = locations[side].find(l => l.id === id);
    if (location?.status === 'absent') continue;
    presentSides++;
    const boxes = segment != null && location?.segments?.length ? location.segments.find(s => s.index === segment)?.boxes ?? [] : location?.boxes ?? [];
    if (!boxes.length) { unresolved = true; continue; }
    const here = boxes.filter(box => box.page === pages[side]);
    onPage ||= !!here.length;
    const window = windows[side];
    const visible = here.some(box => !window || box.x < window.x + window.width && box.x + box.width > window.x && box.y < window.y + window.height && box.y + box.height > window.y);
    onScreen ||= visible; offscreen ||= !visible;
  }
  return { onPage, onScreen, offscreen, unresolved: unresolved || !presentSides && !pending, pending };
}
