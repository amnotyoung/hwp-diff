import { labels, escapeHtml, blockText, renderDiff, warningsHtml, exportHtml, fileLabel, previewTargets, annotationsHtml, memoCardHtml, textSummary, formattingHtml, formatCardHtml, previewExplanation, comparisonSegments } from './report.js';
import { markSearch, buildSearchIndex } from './search.js';
import { fittedCanvasWidths, clipPageBoxes, previewNotice, validatePageInput } from './view-layout.js';
import { createReviewState, REVIEW_LABELS, allReviewItems, reviewItems, reviewFilters, reviewItemText, reviewPresence } from './review-state.js';

const $ = selector => document.querySelector(selector);
let files = { old: null, new: null }, result = null, filter = 'changes', shown = 50, controller = null;
let isDemo = false, previewPages = { old: 1, new: 1 }, previewCache = new Map();
let review = createReviewState();
let contentRenderKey = null;
const disclosureStates = new Map();
let previewLocations = { old: [], new: [] }, previewData = { old: null, new: null };
let previewOpened = false;
let demoReversed = false;
const previewScrolls = new Map();
let contentHits = [], previewHits = [], searchIndex = -1, searchTimer;
let searchRevision = 0, searchComposing = false, searchPending = false;
let contentSearchKey = '', contentOffsets = new Map(), visibleSearchHits = new Map();
let previewHighlights = true;
const segmentSelections = new Map(), segmentSides = new Map();
const queryText = () => $('#search').value.trim();
const previewKey = (side, page, query = queryText()) => JSON.stringify([side, page, query]);
const compactScreen = matchMedia('(max-width: 560px)');
const compactToolbar = matchMedia('(max-width: 960px)');
function applyCompactScreen() {
  $('#filter-panel').open = !compactScreen.matches;
  const destination = compactToolbar.matches ? $('#preview-inline-tools') : $('.primary-actions');
  destination.append($('#preview-actions'));
  $('#preview-inline-tools').hidden = !compactToolbar.matches;
}
compactScreen.addEventListener('change', applyCompactScreen); applyCompactScreen();
compactToolbar.addEventListener('change', applyCompactScreen);
document.body.classList.add('preview-side-new');
const activeFocusId = () => review.selections[review.mode];
function updateFiles() {
  for (const side of ['old', 'new']) {
    const file = files[side];
    $(`#${side}-name`).innerHTML = file ? fileLabel(file.name) : (side === 'old' ? '기준이 되는 문서를 선택하세요' : '수정된 문서를 선택하세요');
    $(`#${side}-hint`).textContent = file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · 클릭하여 다른 파일 선택` : '클릭하거나 파일을 여기에 놓으세요';
    $(`#${side}-zone`).classList.toggle('has-file', !!file);
  }
  $('#compare').disabled = !files.old || !files.new || !!controller;
}
function showError(message = '') { $('#error').textContent = message; $('#error').hidden = !message; }
function clearResults() {
  result = null; previewCache.clear(); previewPages = { old: 1, new: 1 };
  review = createReviewState(); contentRenderKey = null; disclosureStates.clear(); filter = 'changes'; shown = 50; $('#search').value = '';
  document.body.classList.remove('has-results', 'edit-files', 'details-open');
  previewOpened = false; previewScrolls.clear();
  contentHits = []; previewHits = []; searchIndex = -1; clearTimeout(searchTimer);
  searchRevision++; searchComposing = false; searchPending = false;
  contentSearchKey = ''; contentOffsets.clear(); visibleSearchHits.clear();
  previewHighlights = true; $('#toggle-highlights').setAttribute('aria-pressed', 'true');
  segmentSelections.clear(); segmentSides.clear(); detailRenderKey = null; detailScrolls.clear(); $('#counterpart-dialog').close();
  previewLocations = { old: [], new: [] }; previewData = { old: null, new: null };
  $('#results').hidden = true; $('#empty-state').hidden = false; $('#status').textContent = '';
  $('#selection-panel').hidden = true; $('#toggle-details').setAttribute('aria-expanded', 'false');
  $('#workbench-menu').open = false; $('#notice-menu').open = false; $('#file-info-menu').open = false;
  document.querySelectorAll('.document-info').forEach(el => { el.open = false; });
  $('#search-panel').hidden = true; $('#toggle-search').setAttribute('aria-expanded', 'false');
  $('#preview-zoom').value = 'page';
  for (const side of ['old', 'new']) {
    $(`#${side}-viewport`).dataset.zoom = 'page';
    $(`#${side}-page`).value = '1'; $(`#${side}-page`).setCustomValidity(''); $(`#${side}-page-error`).hidden = true;
  }
  for (const side of ['old', 'new']) { $(`#${side}-preview`).removeAttribute('src'); $(`#${side}-canvas`).hidden = true; $(`#${side}-overlays`).replaceChildren(); }
  setView(false);
}
function selectFile(side, file) {
  if (!file) return;
  if (!/\.(hwp|hwpx)$/i.test(file.name)) return showError('HWP 또는 HWPX 파일을 선택해 주세요.');
  if (!file.size || file.size > 20 * 1024 * 1024) return showError('빈 파일은 비교할 수 없으며, 파일별 최대 크기는 20MB입니다.');
  files[side] = file; clearResults(); showError(); updateFiles();
}
for (const side of ['old', 'new']) {
  $(`#${side}-file`).addEventListener('change', event => selectFile(side, event.target.files[0]));
  const zone = $(`#${side}-zone`);
  zone.addEventListener('dragover', event => { event.preventDefault(); if (!controller) zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', event => {
    event.preventDefault(); zone.classList.remove('drag-over');
    if (controller) return;
    if (event.dataTransfer.files.length !== 1) return showError('각 영역에 파일을 하나씩 놓아 주세요.');
    selectFile(side, event.dataTransfer.files[0]);
  });
}
function swapFiles(recompare = false) {
  if (controller) return;
  if (recompare && isDemo) return compare(true, !demoReversed);
  [files.old, files.new] = [files.new, files.old];
  $('#old-file').value = ''; $('#new-file').value = '';
  clearResults(); updateFiles();
  if (recompare && files.old && files.new) compare();
}
$('#swap').addEventListener('click', () => swapFiles());
$('#swap-result').addEventListener('click', () => swapFiles(true));
$('#reset').addEventListener('click', () => {
  files = { old: null, new: null };
  $('#old-file').value = ''; $('#new-file').value = ''; $('#search').value = '';
  clearResults(); showError(); updateFiles();
});

function setBusy(busy, preview = false) {
  for (const id of ['view-content', 'view-formats', 'view-memos', 'view-list', 'demo', 'swap', 'swap-result', 'reset', 'old-file', 'new-file', 'view-preview', 'preview-jump', 'old-page', 'new-page', 'old-prev', 'old-next', 'new-prev', 'new-next', 'change-list', 'previous-change', 'next-change']) $(`#${id}`).disabled = busy;
  document.querySelectorAll('[data-preview-diff], [data-preview-memo], [data-preview-format]').forEach(b => { b.disabled = busy; });
  document.querySelectorAll('[data-filter]').forEach(b => { b.disabled = busy; });
  document.querySelectorAll('[data-segment-step], #previous-segment, #next-segment').forEach(b => { b.disabled = busy; });
  $('#cancel').hidden = !busy;
  $('#compare').innerHTML = busy ? `<span class="spinner"></span> ${preview ? '미리보기 준비 중' : '비교 중'}` : '변경 사항 비교 <span>→</span>';
  $('.upload-panel').setAttribute('aria-busy', String(busy));
  updateFiles();
  if (!busy) { updatePageButtons(); if (result) { updateNavigator(); updateVisibleSelection(); } }
  updateSearchControls();
  updateToolbar();
  if (!busy) { restoreSegments($('#diff-list')); restoreSegments($('#selected-change-detail')); updateSegmentControls(); }
}
// The server streams one JSON object per line: stage updates, then the result.
async function readProgressStream(response, onProgress) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '', scanned = 0, outcome = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    // Only scan new text for line ends; a large result arrives in many chunks.
    for (let at = buffer.indexOf('\n', scanned); at >= 0; at = buffer.indexOf('\n', 0)) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.progress) onProgress(message.progress); else outcome = message;
    }
    scanned = buffer.length;
    if (done) break;
  }
  if (outcome?.error) throw new Error(outcome.error);
  if (!outcome?.result) throw new Error('비교 결과를 받지 못했습니다. 다시 비교해 주세요.');
  return outcome.result;
}
let progressTimer = null, progressStarted = 0;
function showProgress({ step = 0, total = 4, label = '비교를 준비하는 중' } = {}) {
  const steps = $('#progress-steps');
  if (steps.children.length !== total) steps.replaceChildren(...Array.from({ length: total }, () => document.createElement('li')));
  [...steps.children].forEach((item, i) => { item.classList.toggle('done', i < step - 1); item.classList.toggle('current', i === step - 1); });
  steps.dataset.step = String(step); steps.dataset.total = String(total);
  if ($('#progress-label').textContent !== label) $('#progress-label').textContent = label;
  updateProgressTime();
}
function updateProgressTime() {
  const seconds = Math.floor((Date.now() - progressStarted) / 1000), steps = $('#progress-steps');
  $('#progress-meta').textContent = `${Number(steps.dataset.step) ? ` · ${steps.dataset.step}/${steps.dataset.total}단계` : ''} · ${seconds}초 경과`;
  $('#progress-hint').hidden = seconds < 10;
}
function startProgress() {
  progressStarted = Date.now(); clearInterval(progressTimer);
  $('#compare-progress').hidden = false; showProgress();
  progressTimer = setInterval(updateProgressTime, 1000);
}
function stopProgress() { clearInterval(progressTimer); progressTimer = null; $('#compare-progress').hidden = true; }
async function compare(demo = false, reverse = false) {
  if (controller) return;
  controller = new AbortController();
  clearResults(); showError(); setBusy(true);
  $('#status').textContent = ''; startProgress();
  try {
    const form = new FormData();
    if (!demo) { form.append('oldFile', files.old); form.append('newFile', files.new); }
    const response = await fetch(demo ? '/api/demo' : '/api/compare', { method: 'POST', headers: { 'X-Hwp-Diff': '1', 'X-Hwp-Progress': '1' }, body: demo ? JSON.stringify({ reverse }) : form, signal: controller.signal });
    let data;
    if (response.ok && response.headers.get('Content-Type')?.startsWith('application/x-ndjson')) data = await readProgressStream(response, showProgress);
    else { data = await response.json(); if (!response.ok) throw new Error(data.error || '비교하지 못했습니다.'); }
    result = data; isDemo = demo; demoReversed = reverse; filter = 'changes'; shown = 50; $('#search').value = '';
    stopProgress();
    showResults();
  } catch (error) {
    $('#status').textContent = error.name === 'AbortError' ? '비교를 취소했습니다.' : '';
    if (error.name !== 'AbortError') showError(error.message);
  } finally { controller = null; stopProgress(); setBusy(false); }
}
$('#compare').addEventListener('click', () => compare());
$('#demo').addEventListener('click', () => compare(true));
$('#cancel').addEventListener('click', () => controller?.abort());

function showResults() {
  document.body.classList.add('has-results'); document.body.classList.remove('edit-files');
  $('#empty-state').hidden = true; $('#results').hidden = false;
  const total = result.stats.added + result.stats.removed + result.stats.modified;
  const memoStats = result.annotations?.stats;
  const memoChanges = memoStats ? memoStats.added + memoStats.removed + memoStats.modified : 0;
  const formats = result.formatting?.diffs ?? [], formatCount = formats.length;
  $('#result-title').textContent = memoChanges ? `내용 변경 항목 ${total}개 · 메모 변경 ${memoChanges}개` : total ? `${total}개 항목에서 변경을 찾았습니다` : result.diffs.length ? '비교 대상 본문·표의 변경이 없습니다' : '비교 가능한 본문·표가 없습니다';
  const changed = result.diffs.filter(d => d.type !== 'unchanged');
  if (formatCount) $('#result-title').textContent = `내용 변경 항목 ${total}개 · 서식 변경 구간 ${formatCount}개${memoChanges ? ` · 메모 변경 ${memoChanges}개` : ''}`;
  if (changed.length === 1 && !memoChanges && !formatCount) $('#result-title').textContent = `${changed[0].before?.table || changed[0].after?.table ? '표' : '문단'} 1개 변경${textSummary(changed[0]) ? ' · ' + textSummary(changed[0]) : ''}`;
  if (result.structureStats?.changed) $('#result-title').textContent = `내용 변경 항목 ${total}개 · 구조 변경 ${result.structureStats.changed}개${formatCount ? ` · 서식 변경 구간 ${formatCount}개` : ''}${memoChanges ? ` · 메모 변경 ${memoChanges}개` : ''}`;
  if (result.moveStats?.moved) $('#result-title').textContent += ` · 위치 이동 ${result.moveStats.moved}개`;
  if (isDemo) $('#result-title').textContent += ' (샘플)';
  $('#result-title').title = $('#result-title').textContent;
  renderFilters();
  $('#view-memos').textContent = result.annotations?.available ? `메모 ${memoChanges}` : '메모 미검사';
  $('#memo-panel').innerHTML = annotationsHtml(result.annotations, true);
  $('#view-formats').textContent = result.formatting?.available ? `서식 ${formatCount}` : '서식 미검사';
  $('#format-panel').innerHTML = formattingHtml(result.formatting, true);
  $('#preview-jump').hidden = !result.diffs.some(d => d.type !== 'unchanged');
  $('#warnings').innerHTML = warningsHtml(result);
  $('#critical-notices').replaceChildren();
  if (result.formatting?.available === false) $('#critical-notices').insertAdjacentHTML('beforeend', `<p class="${result.formatting.reason === 'unsupported-format' ? 'comparison-notice' : 'parse-warning'}" role="note">${escapeHtml(result.formatting.message)}</p>`);
  if (result.formatting?.incompleteRanges || result.formatting?.uncertainMappings?.length) $('#critical-notices').insertAdjacentHTML('beforeend', '<p class="parse-warning">서식을 비교하지 못한 구간이 있습니다. 서식 탭에서 확인하세요.</p>');
  $('#notice-label').textContent = result.formatting?.reason === 'unsupported-format' ? '서식 미검사' : result.warnings.length || result.formatting?.incompleteRanges || result.formatting?.uncertainMappings?.length ? '주의사항' : '안내';
  $('#menu-file-info').innerHTML = `<p><strong>구버전</strong><br>${escapeHtml(result.documents.before.name)}</p><p><strong>신버전</strong><br>${escapeHtml(result.documents.after.name)}</p>`;
  $('#limitations').innerHTML = result.limitations.map(text => `<li>${escapeHtml(text)}</li>`).join('');
  for (const [side, key] of [['old', 'before'], ['new', 'after']]) {
    for (const suffix of ['column', 'preview-name', 'summary']) $(`#${side}-${suffix}`).innerHTML = `${suffix === 'summary' ? '' : `<span>${side === 'old' ? '구버전' : '신버전'} · </span>`}${fileLabel(result.documents[key].name)}`;
  }
  renderList();
  if (!total && memoChanges) activateMode('memo');
  else if (!total && formatCount) activateMode('format');
  $('#results').scrollIntoView({ block: 'start' });
  rememberContentPosition();
}
function currentCondition(mode = review.mode) {
  return mode === review.mode ? { filter, query: $('#search').value, shown } : review.conditions[mode];
}
function modeAvailable(mode = review.mode) {
  return mode === 'content' || (mode === 'format' ? result?.formatting?.available : result?.annotations?.available) === true;
}
function panelFor(mode = review.mode) { return $(`#${mode === 'format' ? 'format' : mode === 'memo' ? 'memo' : 'content'}-panel`); }
function selectedItem() { return allReviewItems(result, review.mode).find(item => item.id === activeFocusId()); }
function filteredDiffs() { return result ? reviewItems(result, 'content', currentCondition('content')) : []; }
function currentItems(navigation = false) {
  return reviewItems(result, review.mode, currentCondition(), navigation && !(review.mode === 'content' && filter === 'all'));
}
function disclosureKey(node, root) {
  const owner = node.closest('article[id]') ?? root;
  const kind = node.tagName === 'DETAILS' ? 'details' : node.className;
  return `${owner.id}:${kind}:${[...owner.querySelectorAll(node.tagName === 'DETAILS' ? 'details' : '.table-scroll,.cell-value,.context-text,.full-context>.diff-columns')].indexOf(node)}`;
}
function saveDisclosure(root, key) {
  if (!key) return;
  disclosureStates.set(key, new Map([...root.querySelectorAll('details,.table-scroll,.cell-value,.context-text,.full-context>.diff-columns')].map(node => [disclosureKey(node, root), { open: node.open, top: node.scrollTop, left: node.scrollLeft }])));
}
function restoreDisclosure(root, key) {
  const saved = disclosureStates.get(key); if (!saved) return;
  for (const node of root.querySelectorAll('details,.table-scroll,.cell-value,.context-text,.full-context>.diff-columns')) {
    const state = saved.get(disclosureKey(node, root)); if (!state) continue;
    if (node.tagName === 'DETAILS') node.open = state.open;
    node.scrollTop = state.top; node.scrollLeft = state.left;
  }
}
function rememberContentPosition() {
  if (!result || review.view !== 'list') return;
  review.listPositions[review.mode] = { top: window.scrollY, id: activeFocusId(), segment: segmentSelections.get(activeFocusId()) ?? 0 };
  saveDisclosure(panelFor(), `${review.mode}:${JSON.stringify(currentCondition())}`);
}
function rememberMode() {
  rememberContentPosition();
  review.conditions[review.mode] = currentCondition();
  review.searchPositions[review.mode][review.view] = searchIndex;
}
function restoreListPosition() {
  const saved = review.listPositions[review.mode], id = activeFocusId();
  restoreDisclosure(panelFor(), `${review.mode}:${JSON.stringify(currentCondition())}`);
  if (saved.id === id && saved.segment === (segmentSelections.get(id) ?? 0)) window.scrollTo({ top: saved.top, behavior: 'instant' });
  else if (id != null) {
    const card = document.getElementById(review.mode === 'content' ? `change-${id}` : id), segment = segmentSelections.get(id) ?? 0;
    for (let node = card?.parentElement; node && node !== panelFor(); node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
    (card?.querySelector(`[data-segment-index="${segment}"],[data-content-segment-index="${segment}"]`) ?? card)?.scrollIntoView({ block: 'start' });
  }
  else window.scrollTo({ top: saved.top, behavior: 'instant' });
}
function renderFilters() {
  const container = $('#filters');
  container.setAttribute('aria-label', `${REVIEW_LABELS[review.mode]} 탐색 조건`);
  if (!modeAvailable()) { container.innerHTML = `<span class="filter-unavailable">${REVIEW_LABELS[review.mode]} 미검사</span>`; return; }
  container.innerHTML = reviewFilters(result, review.mode).map(({ value, label, count }) => `<button type="button" data-filter="${value}" class="${filter === value ? 'selected' : ''}" aria-pressed="${filter === value}" aria-label="${label} ${count}${review.mode === 'format' ? '구간' : '항목'}"><span class="filter-label">${label}</span><span class="filter-count">${count}${['changes', 'all'].includes(value) ? `<span class="filter-unit">${review.mode === 'format' ? '구간' : '항목'}</span>` : ''}</span></button>`).join('');
}
function renderList() {
  if (!result) return;
  review.conditions[review.mode] = currentCondition();
  if (review.mode !== 'content') {
    const items = currentItems(), visible = new Set(items.map(d => d.id)), root = panelFor();
    for (const card of root.querySelectorAll('.memo-card,.format-card')) card.hidden = !visible.has(card.id);
    const unchanged = root.querySelector('.unchanged-memos');
    if (unchanged) { unchanged.hidden = !items.some(d => d.type === 'unchanged'); if (queryText() && !unchanged.hidden) unchanged.open = true; }
    let empty = root.querySelector('.filter-empty');
    if (!empty) { empty = document.createElement('p'); empty.className = 'no-results filter-empty'; root.append(empty); }
    empty.hidden = !!items.length || !allReviewItems(result, review.mode).length;
    empty.textContent = `현재 조건에 맞는 ${REVIEW_LABELS[review.mode]} 변경이 없습니다.`;
    for (const card of root.querySelectorAll('.memo-card,.format-card')) markSearch(card, queryText());
  } else {
    const diffs = filteredDiffs(), key = JSON.stringify([filter, queryText()]);
    if (contentSearchKey !== key) {
      const template = document.createElement('template');
      const indexed = buildSearchIndex(diffs, queryText(), diff => { template.innerHTML = renderDiff(diff, result.documents, true, queryText()); return template.content; });
      contentHits = indexed.hits; contentOffsets = indexed.offsets; contentSearchKey = key;
      if (review.view === 'list') searchIndex = -1;
    }
    const renderKey = JSON.stringify([filter, queryText(), shown]);
    if (contentRenderKey !== renderKey) {
      saveDisclosure($('#content-panel'), `content-render:${contentRenderKey}`);
      $('#diff-list').innerHTML = diffs.slice(0, shown).map(d => renderDiff(d, result.documents, true, queryText())).join('') || '<div class="no-results">현재 조건에 해당하는 항목이 없습니다.</div>';
      contentRenderKey = renderKey;
      restoreDisclosure($('#content-panel'), `content-render:${renderKey}`);
      visibleSearchHits = new Map();
      for (const card of $('#diff-list').querySelectorAll('[data-diff-id]')) {
        const hits = markSearch(card, queryText(), contentOffsets.get(Number(card.dataset.diffId)) ?? 0).hits;
        for (const hit of hits) visibleSearchHits.set(hit.id, hit.elements);
      }
    }
    restoreSegments($('#diff-list'));
    $('#load-more').hidden = diffs.length <= shown;
    $('#load-more').textContent = `다음 50개 보기 (${Math.min(shown, diffs.length)} / ${diffs.length})`;
  }
  document.querySelectorAll('[data-filter]').forEach(button => { const selected = button.dataset.filter === filter; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  updateNavigator();
  if (review.view === 'preview') { showSelectedDetail(); for (const side of ['old', 'new']) drawOverlays(side); }
  else if (review.mode === 'content') for (const el of visibleSearchHits.get(searchIndex) ?? []) el.classList.add('current-search-hit');
  updateSearchControls(); updateToolbar();
}
function navigationContext() { return { category: review.mode, items: currentItems(true), id: activeFocusId() }; }
function currentWindows() {
  const windows = {};
  if (review.view !== 'preview') return windows;
  for (const side of ['old', 'new']) {
    const data = previewData[side], canvas = $(`#${side}-canvas`), viewport = $(`#${side}-viewport`);
    if (!data || canvas.hidden || !viewport.clientWidth) continue;
    const c = canvas.getBoundingClientRect(), v = viewport.getBoundingClientRect(), scale = c.width / data.width;
    if (scale > 0) windows[side] = { x: (v.left - c.left) / scale, y: (v.top - c.top) / scale, width: v.width / scale, height: v.height / scale };
  }
  return windows;
}
function presence(id, selected = false) {
  return reviewPresence(id, { old: previewData.old?.locations, new: previewData.new?.locations }, previewPages, selected ? currentWindows() : {}, selected && review.mode === 'content' ? segmentSelections.get(id) ?? 0 : null);
}
function emptyReviewMessage() {
  const mode = REVIEW_LABELS[review.mode];
  if (!modeAvailable()) return `${mode}은 검사하지 못했습니다. 목록에서 안내를 확인하세요.`;
  const items = currentItems(true), total = reviewItems(result, review.mode, { filter: review.mode === 'format' || filter === 'all' ? 'all' : 'changes', query: '' }, review.mode === 'content' && filter !== 'all').length;
  if (!items.length && total && queryText()) return `검색어가 포함된 ${mode} 변경은 없습니다. 검색을 지우면 ${mode} 변경 ${total}개를 볼 수 있습니다.`;
  if (!items.length) return total ? `현재 조건에 맞는 ${mode} 변경이 없습니다.` : `문서 전체에 ${mode} 변경이 없습니다.`;
  if (!previewOpened) return `${mode} 변경 ${items.length}개 중 항목을 선택하세요.`;
  const onPage = items.filter(item => presence(item.id).onPage).length, unknown = items.filter(item => presence(item.id).unresolved || presence(item.id).pending).length;
  return `${onPage ? `이 쪽에서 확인한 ${mode} 변경 ${onPage}개` : `이 쪽에서 확인한 ${mode} 변경은 없습니다`}. 전체 목록에는 ${items.length}개가 있습니다.${unknown ? ` ${unknown}개는 위치 미확인입니다.` : ''} 항목을 선택하면 이동합니다.`;
}
function updateNavigator() {
  const { category, items, id } = navigationContext();
  const active = items.some(d => d.id === id) ? id : null;
  review.selections[category] = active;
  const position = items.findIndex(d => d.id === active), scope = `${queryText() ? '검색어 포함 ' : ''}${category === 'format' ? '서식 변경' : category === 'memo' ? '메모 변경' : filter === 'all' ? '내용 항목' : '내용 변경'}`;
  const description = d => category === 'format' ? `${d.changes.map(c => c.label).join('·')} · ${d.text}` : category === 'memo' ? `${labels[d.type]} · ${(d.after ?? d.before).text}` : `${labels[d.type]} · 항목 ${d.id} · ${blockText(d.after ?? d.before)}`;
  const placeholder = !modeAvailable() ? `${REVIEW_LABELS[category]} 미검사` : items.length ? `${scope} ${items.length}개 · 항목 선택` : `${scope} 없음`;
  $('#change-list').innerHTML = `<option value=""${items.length ? ' disabled' : ''}>${placeholder}</option>` + items.map((d, i) => {
    const p = presence(d.id, d.id === active), flag = review.view === 'preview' && d.id === active && p.offscreen ? '현재 화면 밖의 선택 · ' : previewOpened && p.unresolved ? '위치 미확인 · ' : '';
    return `<option value="${escapeHtml(d.id)}">${flag}${scope} ${i + 1}/${items.length} · ${escapeHtml(description(d).slice(0, 75))}</option>`;
  }).join('');
  $('#change-list').value = active ?? '';
  $('#change-position').textContent = active != null ? `${scope} ${position + 1}/${items.length}` : placeholder;
  $('#change-list').setAttribute('aria-label', `${scope} 선택`);
  $('#change-list').title = active != null ? $('#change-list').selectedOptions[0].textContent : emptyReviewMessage();
  $('#change-list').disabled = !!controller || !items.length;
  $('#previous-change').disabled = !!controller || position <= 0;
  $('#next-change').disabled = !!controller || !items.length || position >= items.length - 1;
  document.querySelectorAll('[data-diff-id]').forEach(el => el.classList.toggle('selected-change', category === 'content' && Number(el.dataset.diffId) === active));
  document.querySelectorAll('#memo-panel .memo-card, #format-panel .format-card').forEach(el => el.classList.toggle('selected-change', el.id === active));
  restoreSegments($('#diff-list'));
}
function selectNavigation(id) {
  if (controller || !id) return;
  if (review.mode === 'content') return selectChange(id);
  if (review.view === 'preview') return review.mode === 'memo' ? jumpToMemo(id) : jumpToFormat(id);
  review.selections[review.mode] = id; updateNavigator();
  const card = document.getElementById(id); for (let node = card?.parentElement; node && node !== panelFor(); node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
  card?.scrollIntoView({ block: 'start' }); rememberContentPosition();
}
function selectChange(id) {
  if (controller) return;
  review.selections.content = Number(id); updateNavigator();
  if (!$('#preview-panel').hidden) return jumpToDiff(review.selections.content);
  const index = filteredDiffs().findIndex(d => d.id === review.selections.content);
  if (index >= shown) { shown = index + 1; renderList(); }
  const card = $(`#change-${review.selections.content}`);
  card?.scrollIntoView({ block: 'start' }); card?.focus({ preventScroll: true });
  rememberContentPosition();
}

// Remember deliberate reading movement, not focus/scrollIntoView side effects of tab controls.
for (const event of ['wheel', 'touchmove']) window.addEventListener(event, () => requestAnimationFrame(rememberContentPosition), { passive: true });
window.addEventListener('keydown', e => { if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(e.key)) requestAnimationFrame(rememberContentPosition); });
window.addEventListener('pointerup', e => { if (e.clientX >= document.documentElement.clientWidth - 16) rememberContentPosition(); });
$('#change-list').addEventListener('change', e => selectNavigation(e.target.value));
for (const [button, delta] of [['previous-change', -1], ['next-change', 1]]) $(`#${button}`).addEventListener('click', () => {
  const { items, id } = navigationContext();
  const next = items[items.findIndex(d => d.id === id) + delta];
  if (next) selectNavigation(next.id);
});
$('#edit-files').addEventListener('click', () => {
  $('#workbench-menu').open = false;
  if (!$('#preview-panel').hidden) setView(false);
  const expanded = document.body.classList.toggle('edit-files');
  $('#edit-files').setAttribute('aria-expanded', String(expanded));
  if (expanded) $('.upload-panel').scrollIntoView({ block: 'start' });
});
$('#filters').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]'); if (!button || button.disabled || controller) return;
  rememberContentPosition(); filter = button.dataset.filter; shown = 50; searchIndex = -1; renderList(); updateToolbar();
});
$('#search').addEventListener('input', event => {
  searchRevision++; searchPending = true; clearTimeout(searchTimer); updateSearchControls();
  if (!searchComposing && !event.isComposing) searchTimer = setTimeout(applySearch, 220);
});
$('#search').addEventListener('compositionstart', () => { searchComposing = true; clearTimeout(searchTimer); });
$('#search').addEventListener('compositionend', () => { searchComposing = false; searchRevision++; clearTimeout(searchTimer); searchTimer = setTimeout(applySearch, 220); });
$('#load-more').addEventListener('click', () => { shown += 50; renderList(); });
function download(contents, type, extension) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = `신구대조표_${new Date().toISOString().slice(0, 10)}.${extension}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
$('#export-html').addEventListener('click', () => { if (result) download(exportHtml(result), 'text/html;charset=utf-8', 'html'); });
$('#export-json').addEventListener('click', () => { if (result) download(JSON.stringify(result, null, 2), 'application/json;charset=utf-8', 'json'); });

function paintView() {
  const preview = review.view === 'preview';
  document.body.classList.toggle('preview-mode', preview);
  $('#preview-panel').hidden = !preview;
  for (const mode of ['content', 'format', 'memo']) panelFor(mode).hidden = preview || review.mode !== mode;
  for (const [id, mode] of [['view-content', 'content'], ['view-formats', 'format'], ['view-memos', 'memo']]) {
    $(`#${id}`).classList.toggle('selected', review.mode === mode); $(`#${id}`).setAttribute('aria-pressed', String(review.mode === mode));
  }
  for (const [id, active] of [['view-list', !preview], ['view-preview', preview]]) {
    $(`#${id}`).classList.toggle('selected', active); $(`#${id}`).setAttribute('aria-pressed', String(active));
  }
  updateToolbar();
}
function hideSearchPopover() { $('#search-panel').hidden = true; $('#toggle-search').setAttribute('aria-expanded', 'false'); }
function setView(preview) {
  const next = preview ? 'preview' : 'list';
  if (next === review.view) { paintView(); return; }
  rememberMode(); hideSearchPopover();
  if (review.view === 'preview') for (const side of ['old', 'new']) savePreviewScroll(side);
  review.view = next; searchIndex = review.searchPositions[review.mode][next];
  if (!preview && review.mode === 'content') {
    const index = filteredDiffs().findIndex(d => d.id === activeFocusId());
    if (index >= shown) shown = Math.ceil((index + 1) / 50) * 50;
  }
  paintView(); renderList();
  if (preview) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => { fitPreviewPages(); for (const side of ['old', 'new']) restorePreviewScroll(side); updateVisibleSelection(); updateNavigator(); });
  } else requestAnimationFrame(restoreListPosition);
}
function activateMode(mode, selection) {
  if (mode !== review.mode) {
    rememberMode(); hideSearchPopover(); clearTimeout(searchTimer); searchRevision++; searchPending = false;
    review.mode = mode;
    const saved = review.conditions[mode]; filter = saved.filter; shown = saved.shown; $('#search').value = saved.query;
    searchIndex = review.searchPositions[mode][review.view];
  }
  if (selection != null) {
    review.selections[mode] = selection;
    if (!currentItems().some(item => item.id === selection)) {
      filter = 'all'; $('#search').value = ''; searchRevision++; searchPending = false;
      review.conditions[mode] = currentCondition();
    }
  }
  paintView(); renderFilters(); renderList();
}
async function switchMode(mode) {
  if (!result || controller || mode === review.mode) return;
  const query = queryText();
  activateMode(mode);
  if (review.view === 'list') requestAnimationFrame(restoreListPosition);
  else if (query !== queryText()) await showPreview({ ...previewPages });
  else { updateVisibleSelection(); updateNavigator(); }
}
function updateToolbar() {
  const preview = review.view === 'preview';
  document.querySelectorAll('[data-filter]').forEach(el => { el.disabled = !!controller || !modeAvailable(); });
  for (const id of ['search', 'toggle-search']) $(`#${id}`).disabled = !result || !modeAvailable();
  $('#preview-zoom').disabled = !preview;
  $('#toggle-details').disabled = !preview;
  $('#toggle-highlights').disabled = !preview;
}
function updatePageButtons() {
  for (const side of ['old', 'new']) {
    const cached = previewCache.get(previewKey(side, previewPages[side]));
    $(`#${side}-prev`).disabled = !cached || cached.page <= 1;
    $(`#${side}-next`).disabled = !cached || cached.page >= cached.totalPages;
  }
}
async function loadPreview(side, page, jump = false, searchQuery = queryText(), focusId = activeFocusId()) {
  if (previewOpened) savePreviewScroll(side);
  const location = previewLocations[side].find(l => l.id === focusId);
  if (jump && location?.boxes.length) page = location.boxes[0].page;
  const key = previewKey(side, page, searchQuery);
  const img = $(`#${side}-preview`), message = $(`#${side}-preview-message`);
  $(`#${side}-canvas`).hidden = true; message.hidden = false; message.textContent = '미리보기를 준비하고 있습니다…';
  const started = Date.now(), elapsed = setInterval(() => { if (!message.hidden) message.textContent = `미리보기를 준비하고 있습니다… ${Math.floor((Date.now() - started) / 1000)}초 경과`; }, 1000);
  $(`#${side}-preview-warnings`).textContent = '';
  delete $(`#${side}-preview-warnings`).dataset.noticeKey;
  $(`#${side}-render-notice`).hidden = true;
  const previousInfo = $(`#${side}-preview-warnings`).closest('.document-info');
  previousInfo.open = false; previousInfo.hidden = true;
  try {
    let data = previewCache.get(key);
    if (focusId != null && data && !data.locations?.some(location => location.id === focusId)) data = null;
    if (!data) {
      const form = new FormData(); form.append('page', String(page));
      form.append('search', searchQuery);
      form.append('targets', JSON.stringify(previewTargets(result, side, focusId)));
      if (focusId) form.append('focusId', String(focusId));
      if (jump) form.append('jump', '1');
      if (isDemo) { form.append('demo', '1'); form.append('side', side); if (demoReversed) form.append('reverse', '1'); }
      else form.append('file', files[side]);
      const response = await fetch('/api/preview', { method: 'POST', headers: { 'X-Hwp-Diff': '1' }, body: form, signal: controller.signal });
      data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '미리보기를 만들 수 없습니다.');
      if (previewCache.size >= 8) previewCache.delete(previewCache.keys().next().value);
      previewCache.set(previewKey(side, data.page, searchQuery), data);
    }
    if (searchQuery !== queryText()) return;
    previewLocations[side] = data.locations ?? []; previewData[side] = data;
    previewPages[side] = data.page;
    img.src = data.image; $(`#${side}-canvas`).hidden = false; message.hidden = true;
    $(`#${side}-page`).max = String(data.totalPages);
    $(`#${side}-page`).setCustomValidity(''); clearPageError(side);
    $(`#${side}-page`).value = String(data.page);
    $(`#${side}-page-count`).textContent = `/ ${data.totalPages}`;
    updatePreviewNotice(side);
    drawOverlays(side);
    await img.decode().catch(() => {});
    fitPreviewPages();
    if (jump) scrollToRegion(side);
    else restorePreviewScroll(side);
    updateVisibleSelection();
  } catch (error) {
    message.textContent = error.name === 'AbortError' ? '미리보기를 취소했습니다.' : `미리보기 불가: ${error.message} 내용 비교 결과는 계속 확인할 수 있습니다.`;
    previewData[side] = null;
    $(`#${side}-page`).value = String(previewPages[side]);
  } finally { clearInterval(elapsed); }
}
// A page-number error describes one rejected input. Any later page movement
// on that side, or selecting another change, makes it stale.
function clearPageError(side) { const error = $(`#${side}-page-error`); error.hidden = true; error.textContent = ''; }
async function showPreview(pages = { ...previewPages }, note = '', jump = false) {
  if (!result || controller) return;
  if (jump) for (const side of ['old', 'new']) clearPageError(side);
  setView(true); controller = new AbortController(); setBusy(true, true);
  const requestedQuery = queryText(), requestedFocus = activeFocusId();
  showSelectedDetail();
  $('#preview-status').textContent = note || '색칠된 영역은 변경된 문단·셀입니다. 선택한 변경은 진한 테두리로 표시합니다.';
  try {
    for (const [side, page] of Object.entries(pages)) {
      if (controller.signal.aborted || requestedQuery !== queryText()) break;
      await loadPreview(side, page, jump, requestedQuery, requestedFocus);
    }
  } finally { controller = null; setBusy(false); }
  if (requestedQuery !== queryText()) return;
  previewOpened = true;
  previewHits = ['new', 'old'].flatMap(side => (previewData[side]?.searchQuery === queryText() ? previewData[side]?.searchMatches ?? [] : []).map(hit => ({ ...hit, side })));
  updateSearchControls();
  updateNavigator(); showSelectedDetail();
}
function jumpToDiff(id) {
  if (controller) return;
  const diff = result?.diffs.find(d => d.id === Number(id));
  if (!diff) return showPreview();
  activateMode('content', diff.id); rememberContentPosition();
  const pages = {};
  for (const [side, docKey, pageKey] of [['old', 'before', 'oldPage'], ['new', 'after', 'newPage']]) {
    if (result.documents[docKey].pageMode === 'layout' && diff[pageKey]) pages[side] = diff[pageKey];
    else pages[side] = 1;
  }
  return showPreview(pages, '변경 항목을 원문에서 찾아 이동합니다. 위치를 찾지 못한 경우 각 문서 아래에 안내합니다.', true).then(moveToActiveSegment);
}
function jumpToMemo(id) {
  if (!result || controller || !result.annotations?.diffs.some(m => m.id === id)) return;
  activateMode('memo', id); rememberContentPosition();
  showPreview({ ...previewPages }, '보라색은 메모가 연결된 문단입니다. 선택한 메모로 이동하며, 일부만 확인된 범위는 문서 아래에 안내합니다.', true);
}
function jumpToFormat(id) {
  if (!result || controller || !result.formatting?.diffs?.some(d => d.id === id)) return;
  activateMode('format', id); rememberContentPosition();
  showPreview({ ...previewPages }, '파란색은 서식 변경 문단입니다. 정확한 변경 값은 옆 패널에서 확인하세요.', true);
}
for (const [id, mode] of [['view-content', 'content'], ['view-formats', 'format'], ['view-memos', 'memo']]) $(`#${id}`).addEventListener('click', () => switchMode(mode));
$('#view-list').addEventListener('click', () => { if (!controller) setView(false); });
$('#view-preview').addEventListener('click', async () => {
  if (controller || !result) return;
  setView(true);
  if (!previewOpened || ['old', 'new'].some(side => previewData[side]?.searchQuery !== queryText())) await showPreview({ ...previewPages });
  else { showSelectedDetail(); fitPreviewPages(); for (const side of ['old', 'new']) { drawOverlays(side); restorePreviewScroll(side); } updateVisibleSelection(); updateNavigator(); }
});
$('#memo-panel').addEventListener('click', event => { const button = event.target.closest('[data-preview-memo]'); if (button) jumpToMemo(button.dataset.previewMemo); });
$('#format-panel').addEventListener('click', event => { const button = event.target.closest('[data-preview-format]'); if (button) jumpToFormat(button.dataset.previewFormat); });
$('#preview-jump').addEventListener('click', async () => {
  if ($('#preview-jump').dataset.retry === 'true') {
    previewCache.clear(); previewLocations = { old: [], new: [] };
    await showPreview({ ...previewPages }, '', true);
  }
  await moveToActiveSegment();
});
$('#preview-go-selection').addEventListener('click', () => $('#preview-jump').click());
function returnToComparison() { setView(false); }
$('#return-comparison').addEventListener('click', returnToComparison);
$('#diff-list').addEventListener('click', event => { const button = event.target.closest('[data-preview-diff]'); if (button) jumpToDiff(button.dataset.previewDiff); });
$('#preview-zoom').addEventListener('change', event => { for (const side of ['old', 'new']) $(`#${side}-viewport`).dataset.zoom = event.target.value; fitPreviewPages(); });
for (const side of ['old', 'new']) {
  const input = $(`#${side}-page`);
  let edited = false;
  const go = () => {
    if (controller || !edited) return;
    edited = false;
    const checked = validatePageInput(input.value, previewPages[side], previewData[side]?.totalPages ?? 1), error = $(`#${side}-page-error`);
    input.value = String(checked.page); input.setCustomValidity('');
    error.textContent = checked.message; error.hidden = checked.valid;
    if (!checked.valid || checked.page === previewPages[side]) return;
    showPreview({ [side]: checked.page });
  };
  input.addEventListener('input', () => { edited = true; input.setCustomValidity(''); clearPageError(side); });
  input.addEventListener('change', go);
  input.addEventListener('blur', go);
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); go(); } });
  $(`#${side}-prev`).addEventListener('click', () => { clearPageError(side); showPreview({ [side]: previewPages[side] - 1 }); });
  $(`#${side}-next`).addEventListener('click', () => { clearPageError(side); showPreview({ [side]: previewPages[side] + 1 }); });
}

let detailRenderKey = null;
const detailScrolls = new Map();
function showSelectedDetail() {
  const item = selectedItem(), id = activeFocusId(), segment = review.mode === 'content' ? segmentSelections.get(id) ?? 0 : 0;
  $('#preview-explanation-text').innerHTML = item ? previewExplanation(item, review.mode, segment) : `<p>${escapeHtml(emptyReviewMessage())}</p>`;
  // With nothing selected there is no detail to open; a disabled button would
  // only cover the guidance text on narrow screens.
  $('#expand-explanation').disabled = !item; $('#expand-explanation').hidden = !item;
  updateSegmentControls();
  const key = `${review.mode}:${id}:${segment}:${item ? '' : emptyReviewMessage()}`;
  if (detailRenderKey !== key) {
    if (detailRenderKey) { saveDisclosure($('#selected-change-detail'), `detail:${detailRenderKey}`); detailScrolls.set(detailRenderKey, $('#selection-panel').scrollTop); }
    if (!item) {
      $('#selection-title').textContent = `${REVIEW_LABELS[review.mode]} 항목 선택`;
      $('#selected-change-detail').innerHTML = `<p class="review-empty">${escapeHtml(emptyReviewMessage())}</p>`;
    } else if (review.mode === 'format') {
      const index = result.formatting.diffs.indexOf(item);
      $('#selection-title').textContent = `서식 변경 구간 ${index + 1}`;
      $('#selected-change-detail').innerHTML = formatCardHtml(item, index + 1, false, 'selected-');
    } else if (review.mode === 'memo') {
      const index = result.annotations.diffs.indexOf(item);
      $('#selection-title').textContent = `메모 ${index + 1}`;
      $('#selected-change-detail').innerHTML = memoCardHtml(item, index + 1, false, 'selected-');
    } else {
      $('#selection-title').textContent = `${labels[item.type]} · 항목 ${item.id}`;
      $('#selected-change-detail').innerHTML = renderDiff(item, result.documents, false, '', true).replace(`id="change-${item.id}"`, `id="selected-${item.id}"`);
    }
    detailRenderKey = key; restoreDisclosure($('#selected-change-detail'), `detail:${key}`);
    requestAnimationFrame(() => { $('#selection-panel').scrollTop = detailScrolls.get(key) ?? 0; });
  }
  restoreSegments($('#selected-change-detail')); updateVisibleSelection();
}
function focusLocation(side) {
  const location = previewData[side]?.locations.find(l => l.id === activeFocusId());
  if (!location || review.mode !== 'content' || !location.segments?.length) return location;
  const segment = location.segments.find(s => s.index === (segmentSelections.get(review.selections.content) ?? 0));
  if (!segment) return location;
  return { ...location, boxes: segment.boxes, status: segment.boxes.length ? location.status : 'unresolved',
    message: segment.boxes.length ? location.message : '현재 구간의 원본 위치를 확인하지 못했습니다. 내용 비교와 원본 파일에서 확인해 주세요.' };
}
function updatePreviewNotice(side) {
  const data = previewData[side]; if (!data) return;
  const notice = previewNotice(data, null);
  const button = $(`#${side}-render-notice`), info = $(`#${side}-preview-warnings`).closest('.document-info');
  button.hidden = !notice.title; info.hidden = !notice.title;
  button.textContent = notice.title ? `${notice.title} ⓘ` : '';
  button.removeAttribute('title');
  const html = notice.title ? `<p>${escapeHtml(notice.title)}</p><p>${escapeHtml(notice.message)}</p><button type="button" class="button secondary" data-return-comparison>목록에서 확인</button>` : '';
  const warnings = $(`#${side}-preview-warnings`), key = JSON.stringify(notice);
  if (warnings.dataset.noticeKey !== key) { warnings.innerHTML = html; warnings.dataset.noticeKey = key; }
  if (!notice.title) info.open = false;
}
function updateSegmentControls() {
  const diff = result?.diffs.find(d => d.id === review.selections.content), segments = diff && review.mode === 'content' ? comparisonSegments(diff) : [];
  const current = segmentSelections.get(review.selections.content) ?? 0;
  $('#preview-segment-controls').hidden = segments.length <= 1;
  $('#preview-explanation').classList.toggle('has-segments', segments.length > 1);
  $('#segment-position').textContent = `${current + 1} / ${segments.length}`;
  $('#previous-segment').disabled = !!controller || current <= 0;
  $('#next-segment').disabled = !!controller || current >= segments.length - 1;
}
function restoreSegments(root) {
  for (const element of root.querySelectorAll('[data-content-segment-index]')) {
    const id = Number(element.closest('[data-diff-id]').dataset.diffId);
    element.classList.toggle('selected-segment', review.mode === 'content' && id === activeFocusId() && Number(element.dataset.contentSegmentIndex) === (segmentSelections.get(id) ?? 0));
  }
  for (const element of root.querySelectorAll('.segmented-change')) {
    const id = Number(element.closest('[data-diff-id]').dataset.diffId), current = segmentSelections.get(id) ?? 0;
    const parts = element.querySelectorAll('[data-segment-index]');
    parts.forEach(part => { part.hidden = Number(part.dataset.segmentIndex) !== current; });
    const side = segmentSides.get(id) ?? 'after'; element.dataset.readingSide = side;
    element.querySelectorAll('[data-segment-side]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.segmentSide === side)));
    const previous = element.querySelector('[data-segment-step="-1"]'), next = element.querySelector('[data-segment-step="1"]');
    if (previous) previous.disabled = !!controller || current <= 0;
    if (next) next.disabled = !!controller || current >= parts.length - 1;
    const label = parts[current]?.querySelector('.cell-address')?.textContent.replace(/^구간 \d+ · /, '') ?? '';
    const count = element.querySelector('[data-segment-position]'); if (count) count.textContent = `구간 ${current + 1} / ${parts.length} · ${label}`;
  }
}
async function selectSegment(id, index) {
  if (controller) return;
  const diff = result?.diffs.find(d => d.id === id), segments = diff ? comparisonSegments(diff) : [];
  if (!segments.length) return;
  activateMode('content', id);
  segmentSelections.set(id, Math.max(0, Math.min(index, segments.length - 1)));
  updateNavigator(); restoreSegments($('#diff-list'));
  if (!$('#preview-panel').hidden) {
    showSelectedDetail();
    $('#selection-panel').scrollTop = 0;
    await moveToActiveSegment();
  }
}
async function moveToActiveSegment() {
  if ($('#preview-panel').hidden || controller) return;
  const pages = {};
  for (const side of ['old', 'new']) { const page = focusLocation(side)?.boxes[0]?.page; if (page && page !== previewPages[side]) pages[side] = page; }
  if (Object.keys(pages).length) await showPreview(pages);
  for (const side of ['old', 'new']) { drawOverlays(side); scrollToRegion(side); }
  updateVisibleSelection();
}
for (const [id, step] of [['previous-segment', -1], ['next-segment', 1]]) $(`#${id}`).addEventListener('click', () => selectSegment(review.selections.content, (segmentSelections.get(review.selections.content) ?? 0) + step));
document.addEventListener('click', event => {
  const step = event.target.closest('[data-segment-step]'), side = event.target.closest('[data-segment-side]');
  if (step || side) {
    const id = Number((step || side).closest('[data-diff-id]').dataset.diffId);
    if (step) {
      const inDetail = !!step.closest('#selected-change-detail'), direction = step.dataset.segmentStep;
      selectSegment(id, (segmentSelections.get(id) ?? 0) + Number(direction)).then(() => {
        if (inDetail) {
          const next = $(`#selected-change-detail [data-segment-step="${direction}"]:not(:disabled)`) ?? $('#selected-change-detail [data-segment-step]:not(:disabled)');
          next?.focus({ preventScroll: true });
        }
      });
    }
    else { segmentSides.set(id, side.dataset.segmentSide); restoreSegments($('#diff-list')); restoreSegments($('#selected-change-detail')); }
  }
  const pair = event.target.closest('[data-compare-counterpart]');
  if (pair) {
    const entry = result?.diffs.find(d => d.id === Number(pair.dataset.compareCounterpart)), peer = result?.diffs.find(d => d.id === entry?.counterpart?.id);
    if (!entry || !peer) return;
    const old = entry.type === 'removed' ? entry : peer, fresh = entry.type === 'added' ? entry : peer;
    $('#counterpart-title').textContent = `대응 문단 후보 · ${entry.counterpart.label}`;
    $('#counterpart-body').innerHTML = renderDiff({ ...old, id: 'candidate', type: 'modified', counterpart: null, after: fresh.after, newIndex: fresh.newIndex, newPage: fresh.newPage }, result.documents, false, '', true);
    $('#counterpart-dialog').showModal();
  }
});
$('#close-counterpart').addEventListener('click', () => $('#counterpart-dialog').close());
function updateVisibleSelection() {
  if (!result) return;
  $('#return-comparison').textContent = `${REVIEW_LABELS[review.mode]} 목록으로`;
  const id = activeFocusId();
  if (!id) {
    $('#preview-selection-status').textContent = emptyReviewMessage();
    $('#preview-explanation-text').innerHTML = `<p>${escapeHtml(emptyReviewMessage())}</p>`;
    const empty = $('#selected-change-detail .review-empty'); if (empty) empty.textContent = emptyReviewMessage();
    $('#preview-go-selection').hidden = true; $('#expand-explanation').hidden = true;
    $('#preview-jump').disabled = true; $('#preview-location-details').hidden = true;
    for (const side of ['old', 'new']) { $(`#${side}-position-note`).hidden = true; updatePreviewNotice(side); }
    return;
  }
  const label = review.mode === 'memo' ? `메모 ${String(id).slice(5)}` : review.mode === 'format' ? `서식 구간 ${String(id).slice(7)}` : `${labels[result.diffs.find(d => d.id === id)?.type] ?? ''} · 항목 ${id}`;
  const statuses = ['old', 'new'].map(side => {
    const location = focusLocation(side), pages = [...new Set(location?.boxes.map(b => b.page) ?? [])];
    const note = $(`#${side}-position-note`), onPage = pages.includes(previewPages[side]);
    // Placement state is shown in the fixed footer, without resizing the pages.
    note.hidden = true;
    note.disabled = location?.status === 'absent' || !!controller;
    note.textContent = pages.length ? `선택 항목: 미리보기 ${pages.join(', ')}쪽 →` : location?.status === 'absent' ? '이 버전에는 선택 항목 없음' : '위치 미확인 · 비교 내용으로 돌아가기 →';
    const prefix = side === 'old' ? '구버전' : '신버전';
    if (pages.includes(previewPages[side])) return `${prefix}: 미리보기 ${previewPages[side]}쪽에 위치`;
    if (pages.length) return `${prefix}: 미리보기 ${pages.join(', ')}쪽에 위치 (현재 ${previewPages[side]}쪽)`;
    return `${prefix}: ${location?.status === 'absent' ? '해당 항목 없음' : '위치 미확인'}`;
  });
  $('#preview-selection-status').textContent = `${label} — ${statuses.join(' / ')}`;
  const placement = presence(id, true);
  let indicator = $('#selection-placement');
  const heading = $('#preview-explanation-text .explanation-heading');
  if (heading && !indicator) { indicator = document.createElement('span'); indicator.id = 'selection-placement'; indicator.className = 'selection-placement'; heading.prepend(indicator); }
  const placementText = placement.pending ? '위치 확인 전' : placement.offscreen ? '현재 화면 밖의 선택' : placement.unresolved ? '위치 미확인' : '';
  const located = ['old', 'new'].map(side => ({ side, location: focusLocation(side) }));
  const failed = located.filter(({ location }) => !location || location.status === 'unresolved');
  const partial = located.filter(({ location }) => location && ['partial', 'partial-text', 'table'].includes(location.status));
  // Missing highlights must be visible on the original itself, not only in the
  // closed detail panel, so nobody reviews just the colored part and stops.
  const coverage = placement.pending || !partial.length ? null : partial.some(({ location }) => location.status === 'table')
    ? { label: '변경 칸 위치 미확인', help: '변경된 칸을 찾지 못해 표 시작 위치만 표시했습니다. 아래 변경 문구로 확인하세요.' }
    : { label: '일부 위치 색 표시 안 됨', help: '일부 변경 위치에 색 표시를 하지 못했습니다. 아래 변경 문구나 상세 보기에서 모든 변경을 확인하세요.' };
  if (indicator) {
    indicator.textContent = [placementText, coverage?.label].filter(Boolean).join(' · ');
    indicator.title = [placementText && statuses.join('\n'), coverage?.help].filter(Boolean).join('\n');
    indicator.hidden = !indicator.textContent;
  }
  $('#preview-go-selection').hidden = !placementText;
  $('#preview-go-selection').disabled = !!controller;
  $('#preview-go-selection').textContent = placement.offscreen ? '선택 위치로 이동' : '위치 다시 찾기';
  $('#toggle-details').title = label;
  $('#preview-jump').hidden = false;
  $('#preview-jump').dataset.retry = String(!!failed.length);
  $('#preview-jump').disabled = !!controller || located.every(({ location }) => location?.status === 'absent');
  $('#preview-jump').textContent = failed.length ? '위치 다시 찾기' : partial.length ? '확인된 영역 보기' : '변경 위치 보기';
  const help = [...new Set([...failed, ...partial].map(({ side, location }) => previewNotice(previewData[side], location).message).filter(Boolean))];
  $('#preview-location-details').hidden = !help.length;
  $('#preview-location-summary').textContent = failed.length ? '이 변경 위치를 찾지 못했습니다.' : '일부 변경 위치에 색 표시를 하지 못했습니다.';
  $('#preview-location-help').textContent = help.join('\n');
  if (placement.offscreen) {
    $('#preview-location-details').hidden = false;
    $('#preview-location-summary').textContent = coverage ? `현재 화면 밖의 선택 · ${coverage.label}` : '현재 화면 밖의 선택';
    $('#preview-location-help').textContent = [...statuses, ...(coverage ? [coverage.help] : [])].join('\n');
    $('#preview-jump').textContent = '선택 위치로 이동';
  }
  for (const side of ['old', 'new']) updatePreviewNotice(side);
}
function drawOverlays(side) {
  const data = previewData[side], svg = $(`#${side}-overlays`);
  svg.toggleAttribute('hidden', !previewHighlights);
  svg.replaceChildren(); if (!data) return;
  svg.setAttribute('viewBox', `0 0 ${data.width} ${data.height}`);
  const visibleIds = new Set([...(result?.diffs ?? []).filter(d => d.type !== 'unchanged' || d.id === activeFocusId()).map(d => d.id), ...(result?.annotations?.diffs ?? []).map(m => m.id), ...(result?.formatting?.diffs ?? []).map(d => d.id)]);
  const modeIds = new Set(currentItems(true).map(item => item.id));
  const priority = location => location.id === activeFocusId() ? 2 : (location.category === 'format' ? 'format' : location.category === 'memo' ? 'memo' : 'content') === review.mode ? 1 : 0;
  for (const location of (data.locations ?? []).filter(l => visibleIds.has(l.id)).sort((a, b) => priority(a) - priority(b))) {
    const boxes = clipPageBoxes(location.boxes, data);
    const boxKey = box => [box.page, box.x, box.y, box.width, box.height].map(n => Number(n).toFixed(3)).join(':');
    const activeBoxes = new Set(clipPageBoxes(focusLocation(side)?.boxes, data).map(boxKey));
    if (!boxes.length) continue;
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('tabindex', '0'); group.setAttribute('role', 'button'); group.setAttribute('data-change-id', String(location.id));
    const isMemo = location.category === 'memo', isFormat = location.category === 'format';
    group.setAttribute('aria-label', isFormat ? `서식 구간 ${String(location.id).slice(7)} 선택` : isMemo ? `메모 ${String(location.id).slice(5)} 선택` : `${labels[location.type]} 항목 ${location.id} 선택`);
    const select = () => isFormat ? jumpToFormat(location.id) : isMemo ? jumpToMemo(location.id) : jumpToDiff(location.id);
    group.addEventListener('click', select);
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    for (const box of boxes) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const prop of ['x', 'y', 'width', 'height']) rect.setAttribute(prop, String(box[prop]));
    const isMemo = location.category === 'memo';
    const isFormat = location.category === 'format';
    const active = location.id === activeFocusId() && activeBoxes.has(boxKey(box));
    const currentMode = modeIds.has(location.id) && (location.id !== activeFocusId() || !location.segments?.length);
    rect.setAttribute('class', `region-box ${location.type}${isMemo ? ' memo-region' : ''}${isFormat ? ' format-region' : ''}${location.category === 'structure' ? ' structure-region' : ''}${location.status === 'context' || location.status === 'table' ? ' context-region' : ''}${active ? ' selected-region' : currentMode ? ' mode-region' : ' secondary-region'}`);
    rect.setAttribute('data-change-id', String(location.id));
    group.append(rect);
    }
    svg.append(group);
  }
  const active = previewHits[searchIndex];
  if (active?.side === side && clipPageBoxes([active], data).length && queryText()) {
    const box = clipPageBoxes([active], data)[0];
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const key of ['x', 'y', 'width', 'height']) rect.setAttribute(key, String(box[key]));
    rect.setAttribute('class', 'search-region'); svg.append(rect);
  }
}
function scrollToRegion(side) {
  if ($('#preview-zoom').value === 'page') { $(`#${side}-viewport`).scrollTo(0, 0); return; }
  const data = previewData[side], viewport = $(`#${side}-viewport`), canvas = $(`#${side}-canvas`);
  const box = focusLocation(side)?.boxes.find(b => b.page === data.page);
  if (!box) return;
  const scale = canvas.getBoundingClientRect().width / data.width;
  viewport.scrollTo({ top: Math.max(0, box.y * scale - 65), left: Math.max(0, box.x * scale - 35), behavior: 'instant' });
  if (compactScreen.matches && document.body.classList.contains(`preview-side-${side}`) && $('#preview-zoom').value === 'fit') $(`#${side}-overlays .selected-region`)?.scrollIntoView({ block: 'center' });
}
function savePreviewScroll(side) {
  const viewport = $(`#${side}-viewport`);
  if (!$('#preview-panel').hidden && !$(`#${side}-canvas`).hidden) previewScrolls.set(`${side}:${previewPages[side]}`, { top: viewport.scrollTop, left: viewport.scrollLeft });
}
function restorePreviewScroll(side) {
  if ($('#preview-zoom').value === 'page') { $(`#${side}-viewport`).scrollTo(0, 0); return; }
  const saved = previewScrolls.get(`${side}:${previewPages[side]}`) ?? { top: 0, left: 0 };
  $(`#${side}-viewport`).scrollTo(saved.left, saved.top);
}

function searchHits() { return review.view === 'preview' ? previewHits : review.mode === 'content' ? contentHits : currentItems(); }
function updateSearchControls() {
  const preview = review.view === 'preview', hits = searchHits();
  const query = queryText();
  const total = currentItems().length;
  // In the original view one query does two separate things: it finds text in
  // the whole document and it narrows the current review list. Name both.
  $('#search-count').textContent = query ? searchPending ? '검색 중…' : preview
    ? `원본 찾기: ${hits.length}개 문단 일치 · 이동 ${searchIndex >= 0 ? searchIndex + 1 : 0}/${hits.length}\n${REVIEW_LABELS[review.mode]} 목록: ${total ? `검색어 포함 ${total}개만 표시` : '검색어 포함 항목 없음 · 검색을 지우면 전체 표시'}`
    : review.mode === 'content' ? `전체 검색 결과 ${total}개 항목 · ${hits.length}곳 일치 · 이동 ${searchIndex >= 0 ? searchIndex + 1 : 0}/${hits.length}`
      : `${REVIEW_LABELS[review.mode]} 검색 결과 ${hits.length}개 · 이동 ${searchIndex >= 0 ? searchIndex + 1 : 0}/${hits.length}` : '';
  $('#search-count').title = preview ? '이전·다음은 원본 전체 문서의 일치 문단으로 이동합니다. 변경 목록은 검색어가 포함된 항목만 표시합니다.' : '선택한 변경 유형의 전체 결과를 검색합니다. 아직 표시되지 않은 항목도 자동으로 불러와 이동합니다.';
  $('#search').placeholder = preview ? '원본에서 찾기' : `${REVIEW_LABELS[review.mode]} 목록에서 찾기`;
  $('#previous-match').setAttribute('aria-label', preview ? '원본의 이전 일치' : '이전 일치');
  $('#next-match').setAttribute('aria-label', preview ? '원본의 다음 일치' : '다음 일치');
  $('#previous-match').disabled = !query || !hits.length || !!controller || searchPending;
  $('#next-match').disabled = !query || !hits.length || !!controller || searchPending;
  $('#toggle-search').classList.toggle('has-query', !!query);
  $('.search-anchor').classList.toggle('has-query', !!query);
  $('#toggle-search').textContent = query ? `검색: ${query}` : '검색';
  $('#toggle-search').setAttribute('aria-label', query ? `${REVIEW_LABELS[review.mode]} 검색 조건: ${query}` : '검색');
  $('#toggle-search').title = query ? `검색: ${query}` : '검색';
  review.searchPositions[review.mode][review.view] = searchIndex;
}
async function applySearch() {
  if (!result) return;
  if (controller) { searchTimer = setTimeout(applySearch, 120); return; }
  const revision = searchRevision, query = queryText();
  const preview = !$('#preview-panel').hidden;
  shown = 50; renderList(); searchIndex = -1;
  if (preview) {
    await showPreview({ ...previewPages }, queryText() ? '원본 전체에서 검색합니다.' : '', false);
    if (revision !== searchRevision || query !== queryText() || $('#preview-panel').hidden) return;
    // Typing or restoring conditions never changes the current original page.
  } else if (review.mode === 'content' && queryText() && contentHits.length) await focusMatch(0);
  if (revision === searchRevision && query === queryText()) searchPending = false;
  updateSearchControls();
}
async function focusMatch(index) {
  if (controller) return;
  const query = queryText(), revision = searchRevision;
  const preview = review.view === 'preview', hits = searchHits();
  if (!hits.length) return;
  searchIndex = (index + hits.length) % hits.length;
  if (!preview && review.mode !== 'content') {
    selectNavigation(hits[searchIndex].id);
  } else if (!preview) {
    const hit = hits[searchIndex], diffs = filteredDiffs(), at = diffs.findIndex(d => d.id === hit.diffId);
    if (at >= shown) { shown = Math.ceil((at + 1) / 50) * 50; renderList(); }
    $('#diff-list').querySelectorAll('.current-search-hit').forEach(e => e.classList.remove('current-search-hit'));
    const elements = visibleSearchHits.get(hit.id) ?? [];
    elements.forEach(e => e.classList.add('current-search-hit'));
    review.selections.content = hit.diffId; updateNavigator();
    elements[0]?.scrollIntoView({ block: 'center' }); rememberContentPosition();
  } else {
    const hit = hits[searchIndex];
    if (previewPages[hit.side] !== hit.page) await showPreview({ [hit.side]: hit.page }, '원본 검색 결과', false);
    if (query !== queryText() || revision !== searchRevision || $('#preview-panel').hidden) return;
    setPreviewSide(hit.side);
    for (const side of ['old', 'new']) drawOverlays(side);
    const data = previewData[hit.side], canvas = $(`#${hit.side}-canvas`), viewport = $(`#${hit.side}-viewport`);
    if (!data || data.page !== hit.page || data.searchQuery !== query) return;
    const scale = canvas.getBoundingClientRect().width / data.width;
    if ($('#preview-zoom').value !== 'page') viewport.scrollTo({ top: Math.max(0, hit.y * scale - 60), left: Math.max(0, hit.x * scale - 30) });
    if (compactScreen.matches && $('#preview-zoom').value === 'fit') $(`#${hit.side}-overlays .search-region`)?.scrollIntoView({ block: 'center' });
    $('#preview-status').textContent = `${hit.side === 'new' ? '신버전' : '구버전'} 미리보기 ${hit.page}쪽 · ${hit.text.slice(0, 100)}`;
  }
  updateSearchControls();
}
$('#previous-match').addEventListener('click', () => focusMatch(searchIndex - 1));
$('#next-match').addEventListener('click', () => focusMatch(searchIndex + 1));
function setPreviewSide(side) {
  document.body.classList.toggle('preview-side-old', side === 'old'); document.body.classList.toggle('preview-side-new', side === 'new');
  document.querySelectorAll('[data-preview-side]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.previewSide === side)));
  requestAnimationFrame(fitPreviewPages);
}
document.querySelectorAll('[data-preview-side]').forEach(b => b.addEventListener('click', () => setPreviewSide(b.dataset.previewSide)));

function fitPreviewPages() {
  if ($('#preview-panel').hidden) return;
  const zoom = $('#preview-zoom').value, sides = [];
  for (const side of ['old', 'new']) {
    const data = previewData[side], viewport = $(`#${side}-viewport`);
    if (!data || !viewport.clientWidth || !viewport.clientHeight) continue;
    const style = getComputedStyle(viewport);
    sides.push({ side, viewport, page: data, availableWidth: viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), availableHeight: viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) });
  }
  fittedCanvasWidths(sides, zoom).forEach((width, i) => {
    if (width !== null) $(`#${sides[i].side}-canvas`).style.setProperty('--canvas-width', `${width}px`);
    if (zoom === 'page') sides[i].viewport.scrollTo(0, 0);
  });
}
const previewResize = new ResizeObserver(() => fitPreviewPages());
let placementFrame = null, placementKey = '';
for (const side of ['old', 'new']) {
  previewResize.observe($(`#${side}-viewport`));
  $(`#${side}-viewport`).addEventListener('scroll', () => {
    if (review.view !== 'preview') return;
    savePreviewScroll(side);
    if (placementFrame != null) return;
    placementFrame = requestAnimationFrame(() => {
      placementFrame = null;
      const key = JSON.stringify([review.mode, activeFocusId(), activeFocusId() == null ? null : presence(activeFocusId(), true)]);
      updateVisibleSelection();
      if (key !== placementKey) { placementKey = key; updateNavigator(); }
    });
  }, { passive: true });
  const info = $(`#${side}-preview-warnings`).closest('.document-info');
  info.id = `${side}-preview-info`;
  $(`#${side}-render-notice`).setAttribute('aria-controls', info.id);
  info.addEventListener('toggle', () => $(`#${side}-render-notice`).setAttribute('aria-expanded', String(info.open)));
  $(`#${side}-position-note`).addEventListener('click', () => {
    const location = focusLocation(side);
    if (location?.boxes.length) showPreview({ [side]: location.boxes[0].page }, '', false);
    else returnToComparison();
  });
  $(`#${side}-render-notice`).addEventListener('click', () => {
    const popover = $(`#${side}-preview-warnings`).closest('.document-info');
    popoverOpeners.set(popover, $(`#${side}-render-notice`));
    popover.open = !popover.open;
    if (popover.open) popover.querySelector('[data-close-popover]')?.focus({ preventScroll: true });
  });
}
function setDetails(open) {
  document.body.classList.toggle('details-open', open);
  $('#selection-panel').hidden = !open; $('#toggle-details').setAttribute('aria-expanded', String(open));
  if (open) { $('#workbench-menu').open = false; showSelectedDetail(); $('#close-details').focus(); }
  else $('#toggle-details').focus();
  requestAnimationFrame(fitPreviewPages);
}
$('#toggle-details').addEventListener('click', () => setDetails($('#selection-panel').hidden));
$('#toggle-highlights').addEventListener('click', () => {
  previewHighlights = !previewHighlights; $('#toggle-highlights').setAttribute('aria-pressed', String(previewHighlights));
  for (const side of ['old', 'new']) drawOverlays(side);
});
$('#expand-explanation').addEventListener('click', () => setDetails(true));
$('#close-details').addEventListener('click', () => setDetails(false));
function setSearch(open, restoreFocus = true) {
  $('#search-panel').hidden = !open; $('#toggle-search').setAttribute('aria-expanded', String(open));
  if (open) $('#search').focus();
  else { clearSearch(); if (restoreFocus) $('#toggle-search').focus(); }
}
function clearSearch() {
  if (!$('#search').value) return;
  searchRevision++;
  searchPending = false;
  clearTimeout(searchTimer);
  $('#search').value = ''; searchIndex = -1; previewHits = [];
  // Restore content immediately even if an in-flight preview must finish first.
  shown = 50; renderList();
  for (const side of ['old', 'new']) drawOverlays(side);
  updateSearchControls();
  // Defer refresh: this may run while a memo/format jump is entering preview.
  if (!$('#preview-panel').hidden) searchTimer = setTimeout(applySearch, 0);
}
$('#toggle-search').addEventListener('click', () => setSearch($('#search-panel').hidden));
$('#close-search').addEventListener('click', () => setSearch(false));
const popoverOpeners = new Map();
const popovers = () => [...document.querySelectorAll('.workbench-popover, .document-info')];
function closePopover(popover, restoreFocus = false) {
  popover.open = false;
  if (restoreFocus) (popoverOpeners.get(popover) ?? popover.querySelector('summary'))?.focus({ preventScroll: true });
}
for (const popover of popovers()) {
  popover.querySelector('summary').addEventListener('click', () => popoverOpeners.set(popover, popover.querySelector('summary')));
  popover.addEventListener('toggle', () => {
    if (popover.open) for (const other of popovers()) if (other !== popover && other.open) closePopover(other);
  });
}
document.addEventListener('click', event => {
  const dismiss = event.target.closest('[data-close-popover]');
  if (dismiss) closePopover(dismiss.closest('.workbench-popover, .document-info'), true);
  if (event.target.closest('[data-return-comparison]')) { for (const popover of popovers()) closePopover(popover); returnToComparison(); }
  const notice = event.target.closest('.rendering-notice');
  const openedByNotice = notice ? $(`#${notice.id.replace('-render-notice', '')}-preview-warnings`).closest('.document-info') : null;
  for (const popover of popovers()) if (popover.open && !popover.contains(event.target) && popover !== openedByNotice) closePopover(popover);
  if (!$('#search-panel').hidden && !event.target.closest('.search-anchor')) hideSearchPopover();
});
$('#counterpart-dialog').addEventListener('click', event => {
  const rect = $('#counterpart-dialog').getBoundingClientRect();
  if (event.target === $('#counterpart-dialog') && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) $('#counterpart-dialog').close();
});
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if ($('#counterpart-dialog').open) { $('#counterpart-dialog').close(); event.preventDefault(); return; }
  const opened = popovers().filter(popover => popover.open);
  if (opened.length) { opened.forEach(popover => closePopover(popover, true)); event.preventDefault(); return; }
  if (!$('#search-panel').hidden) setSearch(false);
  else if (!$('#selection-panel').hidden) setDetails(false);
});

// Only the packaged app (DMG/EXE) answers portable: true. It stops when the
// user presses 프로그램 종료 or about 10 seconds after the last app tab closes.
(async function connectPortableRuntime() {
  try {
    const response = await fetch('/api/app');
    if (!response.ok || !(await response.json()).portable) return;
    const buttons = [...document.querySelectorAll('.exit-app')];
    buttons.forEach(button => { button.hidden = false; });
    let session = null, exiting = false;
    const connect = () => {
      if (session || exiting) return;
      session = new EventSource('/api/session');
      session.onerror = () => {
        session?.close(); session = null;
        if (!exiting) showError('프로그램 연결이 끊겼습니다. 다시 사용하려면 한컴 diff를 실행하세요.');
      };
    };
    connect();
    window.addEventListener('pagehide', () => { session?.close(); session = null; });
    window.addEventListener('pageshow', connect);
    const exit = async () => {
      buttons.forEach(button => { button.disabled = true; });
      try {
        const stopped = await fetch('/api/exit', { method: 'POST', headers: { 'X-Hwp-Diff': '1' } });
        if (!stopped.ok) throw new Error('exit failed');
        exiting = true; session?.close(); session = null;
        $('#workbench-menu').open = false;
        showError(); $('#status').textContent = '프로그램을 종료했습니다. 이 탭을 닫아도 됩니다.';
      } catch {
        buttons.forEach(button => { button.disabled = false; });
        showError('종료하지 못했습니다. 잠시 후 다시 누르세요.');
      }
    };
    buttons.forEach(button => button.addEventListener('click', exit));
  } catch { /* Development servers have no launcher controls. */ }
})();
