import { labels, escapeHtml, blockText, renderDiff, warningsHtml, exportHtml, fileLabel, previewTargets, annotationsHtml, memoCardHtml, textSummary } from './report.js';
import { markSearch } from './search.js';

const $ = selector => document.querySelector(selector);
let files = { old: null, new: null }, result = null, filter = 'changes', shown = 50, controller = null;
let isDemo = false, previewPages = { old: 1, new: 1 }, previewCache = new Map();
let selectedId = null, contentScroll = 0, contentSelectedId = null;
let contentPositionSaved = false;
let previewLocations = { old: [], new: [] }, previewData = { old: null, new: null };
let selectedMemoId = null, memoScroll = 0, memoEntryId = null;
let previewOpened = false;
const previewScrolls = new Map();
let contentHits = [], previewHits = [], searchIndex = -1, searchTimer, previewWindowScroll = 0;
const queryText = () => $('#search').value.trim();
const previewKey = (side, page) => JSON.stringify([side, page, queryText()]);
const compactScreen = matchMedia('(max-width: 560px)');
function applyCompactScreen() { $('#filter-panel').open = !compactScreen.matches; }
compactScreen.addEventListener('change', applyCompactScreen); applyCompactScreen();
document.body.classList.add('preview-side-new');
const activeFocusId = () => selectedMemoId ?? selectedId;
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
  selectedId = null; contentScroll = 0; document.body.classList.remove('has-results', 'edit-files');
  contentPositionSaved = false;
  selectedMemoId = null; memoScroll = 0; memoEntryId = null;
  previewOpened = false; previewScrolls.clear();
  contentHits = []; previewHits = []; searchIndex = -1; clearTimeout(searchTimer);
  previewLocations = { old: [], new: [] }; previewData = { old: null, new: null };
  $('#results').hidden = true; $('#empty-state').hidden = false; $('#status').textContent = '';
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
$('#swap').addEventListener('click', () => { [files.old, files.new] = [files.new, files.old]; clearResults(); updateFiles(); });
$('#reset').addEventListener('click', () => {
  files = { old: null, new: null };
  $('#old-file').value = ''; $('#new-file').value = ''; $('#search').value = '';
  clearResults(); showError(); updateFiles();
});

function setBusy(busy, preview = false) {
  for (const id of ['demo', 'swap', 'reset', 'old-file', 'new-file', 'view-preview', 'preview-jump', 'old-page', 'new-page', 'old-prev', 'old-next', 'new-prev', 'new-next', 'change-list', 'previous-change', 'next-change', 'preview-change']) $(`#${id}`).disabled = busy;
  document.querySelectorAll('[data-preview-diff], [data-preview-memo], #preview-memo').forEach(b => { b.disabled = busy; });
  document.querySelectorAll('[data-filter], #search').forEach(b => { b.disabled = busy; });
  $('#cancel').hidden = !busy;
  $('#compare').innerHTML = busy ? `<span class="spinner"></span> ${preview ? '렌더링 중' : '비교 중'}` : '변경 사항 비교 <span>→</span>';
  $('.upload-panel').setAttribute('aria-busy', String(busy));
  updateFiles();
  if (!busy) { updatePageButtons(); if (result) updateNavigator(); }
  updateSearchControls();
}
async function compare(demo = false) {
  if (controller) return;
  controller = new AbortController();
  clearResults(); showError(); setBusy(true);
  $('#status').textContent = demo ? '샘플 HWPX 두 개를 생성하고 실제 비교 엔진으로 처리하고 있습니다…' : '이 PC에서 문서를 읽고 변경 사항을 비교하고 있습니다…';
  try {
    const form = new FormData();
    if (!demo) { form.append('oldFile', files.old); form.append('newFile', files.new); }
    const response = await fetch(demo ? '/api/demo' : '/api/compare', { method: 'POST', headers: { 'X-Hwp-Diff': '1' }, body: demo ? undefined : form, signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '비교하지 못했습니다.');
    result = data; isDemo = demo; filter = 'changes'; shown = 50; $('#search').value = '';
    $('#status').textContent = demo ? '샘플 비교 결과입니다. 실제 문서를 선택해 새 비교를 시작할 수 있습니다.' : '비교가 완료되었습니다. 결과는 이 화면을 닫으면 삭제됩니다. 필요한 경우 신구대조표를 저장하세요.';
    showResults();
  } catch (error) {
    $('#status').textContent = error.name === 'AbortError' ? '비교를 취소했습니다.' : '';
    if (error.name !== 'AbortError') showError(error.message);
  } finally { controller = null; setBusy(false); }
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
  $('#result-title').textContent = memoChanges ? `본문 변경 ${total}개 · 메모 변경 ${memoChanges}개` : total ? `${total}개 항목에서 변경을 찾았습니다` : result.diffs.length ? '비교 대상 본문·표의 변경이 없습니다' : '비교 가능한 본문·표가 없습니다';
  const changed = result.diffs.filter(d => d.type !== 'unchanged');
  if (changed.length === 1 && !memoChanges) $('#result-title').textContent = `${changed[0].before?.table || changed[0].after?.table ? '표' : '문단'} 1개 변경${textSummary(changed[0]) ? ' · ' + textSummary(changed[0]) : ''}`;
  $('#view-memos').textContent = result.annotations?.available ? `메모 ${memoChanges}` : '메모 확인 필요';
  $('#memo-panel').innerHTML = annotationsHtml(result.annotations, true);
  const memos = result.annotations?.diffs ?? [];
  $('#preview-memo').innerHTML = '<option value="">메모 선택</option>' + memos.map((m, i) => `<option value="${escapeHtml(m.id)}">메모 ${i + 1} · ${labels[m.type]} · ${escapeHtml((m.after ?? m.before).text.slice(0, 45))}</option>`).join('');
  $('#preview-memo-control').hidden = !memos.length;
  $('#return-memos').hidden = !memos.length;
  $('#preview-body-control').hidden = !total; $('#preview-jump').hidden = !total;
  $('#stats').innerHTML = Object.entries(labels).map(([type, label]) => `<div class="stat ${type}"><span>${label}</span><strong>${result.stats[type]}<small>개 블록</small></strong></div>`).join('');
  $('#warnings').innerHTML = warningsHtml(result);
  $('#limitations').innerHTML = result.limitations.map(text => `<li>${escapeHtml(text)}</li>`).join('');
  for (const [side, key] of [['old', 'before'], ['new', 'after']]) {
    for (const suffix of ['column', 'preview-name', 'summary']) $(`#${side}-${suffix}`).innerHTML = `<span>${side === 'old' ? '구버전' : '신버전'} · </span>${fileLabel(result.documents[key].name)}`;
  }
  $('#preview-change').innerHTML = result.diffs.filter(d => d.type !== 'unchanged').map(d => `<option value="${d.id}">${labels[d.type]} · 항목 ${d.id} · ${escapeHtml(blockText(d.after ?? d.before).slice(0, 45))}</option>`).join('') || '<option value="">변경 없음</option>';
  renderList();
  if (!total && memoChanges) setView('memos');
  $('#results').scrollIntoView({ block: 'start' });
  rememberContentPosition();
}
function filteredDiffs() {
  if (!result) return [];
  const query = $('#search').value.trim().toLocaleLowerCase();
  return result.diffs.filter(d => (filter === 'all' || (filter === 'changes' ? d.type !== 'unchanged' : d.type === filter)) &&
    (!query || `${blockText(d.before)}\n${blockText(d.after)}`.toLocaleLowerCase().includes(query)));
}
function renderList() {
  if (!result) return;
  const diffs = filteredDiffs();
  $('#diff-list').innerHTML = diffs.slice(0, shown).map(d => renderDiff(d, result.documents, true, $('#search').value.trim())).join('') || '<div class="no-results">현재 조건에 해당하는 항목이 없습니다.</div>';
  $('#load-more').hidden = diffs.length <= shown;
  $('#load-more').textContent = `다음 50개 보기 (${Math.min(shown, diffs.length)} / ${diffs.length})`;
  document.querySelectorAll('[data-filter]').forEach(button => { const selected = button.dataset.filter === filter; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  const priorSelection = selectedId; updateNavigator();
  if (!$('#preview-panel').hidden) {
    showSelectedDetail(); for (const side of ['old', 'new']) drawOverlays(side);
    // Filtering must never navigate away from, or reposition, the current preview.
  }
  contentHits = markSearch($('#diff-list'), queryText()).hits;
  if ($('#preview-panel').hidden) { searchIndex = contentHits.length ? 0 : -1; updateSearchControls(); }
}

function updateNavigator() {
  const changes = filteredDiffs().filter(d => d.type !== 'unchanged');
  if (!changes.some(d => d.id === selectedId)) selectedId = changes[0]?.id ?? null;
  const position = changes.findIndex(d => d.id === selectedId);
  $('#change-list').innerHTML = changes.map(d => `<option value="${d.id}">${labels[d.type]} · 항목 ${d.id} · ${escapeHtml(blockText(d.after ?? d.before).slice(0, 65))}</option>`).join('') || '<option>해당 변경 없음</option>';
  $('#change-list').value = selectedId ?? '';
  $('#change-position').textContent = changes.length ? `${position + 1} / ${changes.length}개 변경` : '해당 변경 없음';
  $('#previous-change').disabled = position <= 0;
  $('#next-change').disabled = position < 0 || position >= changes.length - 1;
  document.querySelectorAll('[data-diff-id]').forEach(el => el.classList.toggle('selected-change', Number(el.dataset.diffId) === selectedId));
}
function selectChange(id) {
  if (controller) return;
  selectedId = Number(id); updateNavigator();
  if (!$('#preview-panel').hidden) return jumpToDiff(selectedId);
  const index = filteredDiffs().findIndex(d => d.id === selectedId);
  if (index >= shown) { shown = index + 1; renderList(); }
  const card = $(`#change-${selectedId}`);
  card?.scrollIntoView({ block: 'start' }); card?.focus({ preventScroll: true });
  rememberContentPosition();
}

function rememberContentPosition() {
  if (!result || $('#content-panel').hidden) return;
  contentScroll = window.scrollY; contentSelectedId = selectedId; contentPositionSaved = true;
}
// Remember deliberate reading movement, not focus/scrollIntoView side effects of tab controls.
for (const event of ['wheel', 'touchmove']) window.addEventListener(event, () => requestAnimationFrame(rememberContentPosition), { passive: true });
window.addEventListener('keydown', e => { if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(e.key)) requestAnimationFrame(rememberContentPosition); });
window.addEventListener('pointerup', e => { if (e.clientX >= document.documentElement.clientWidth - 16) rememberContentPosition(); });
$('#change-list').addEventListener('change', e => selectChange(e.target.value));
for (const [button, delta] of [['previous-change', -1], ['next-change', 1]]) $(`#${button}`).addEventListener('click', () => {
  const changes = filteredDiffs().filter(d => d.type !== 'unchanged');
  const next = changes[changes.findIndex(d => d.id === selectedId) + delta];
  if (next) selectChange(next.id);
});
$('#edit-files').addEventListener('click', () => {
  const expanded = document.body.classList.toggle('edit-files');
  $('#edit-files').setAttribute('aria-expanded', String(expanded));
  if (expanded) $('.upload-panel').scrollIntoView({ block: 'start' });
});
$('#filters').addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) { filter = button.dataset.filter; shown = 50; renderList(); } });
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(applySearch, 220); });
$('#load-more').addEventListener('click', () => { shown += 50; renderList(); });
function download(contents, type, extension) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = `신구대조표_${new Date().toISOString().slice(0, 10)}.${extension}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
$('#export-html').addEventListener('click', () => { if (result) download(exportHtml(result), 'text/html;charset=utf-8', 'html'); });
$('#export-json').addEventListener('click', () => { if (result) download(JSON.stringify(result, null, 2), 'application/json;charset=utf-8', 'json'); });

function setView(preview) {
  const memoView = preview === 'memos'; preview = preview === true;
  const wasPreview = !$('#preview-panel').hidden;
  if (wasPreview && !preview) { previewWindowScroll = window.scrollY; for (const side of ['old', 'new']) savePreviewScroll(side); }
  if (preview && !wasPreview && !contentPositionSaved) rememberContentPosition();
  $('#content-panel').hidden = preview || memoView; $('#preview-panel').hidden = !preview; $('#memo-panel').hidden = !memoView;
  const memoOnlyPreview = preview && result && !result.diffs.some(d => d.type !== 'unchanged');
  $('.results-toolbar').hidden = memoView || memoOnlyPreview; $('.change-navigator').hidden = memoView || memoOnlyPreview;
  for (const [id, active] of [['view-content', !preview && !memoView], ['view-preview', preview], ['view-memos', memoView]]) {
    $(`#${id}`).classList.toggle('selected', active); $(`#${id}`).setAttribute('aria-pressed', String(active));
  }
  if (!preview && !memoView && wasPreview && result) requestAnimationFrame(() => {
    if (selectedId === contentSelectedId) window.scrollTo({ top: contentScroll });
    else $(`#change-${selectedId}`)?.scrollIntoView({ block: 'start' });
  });
  if (memoView && wasPreview && result) requestAnimationFrame(() => {
    if (memoEntryId === selectedMemoId) window.scrollTo({ top: memoScroll });
    else $(`#${selectedMemoId}`)?.scrollIntoView({ block: 'start' });
  });
  updateSearchControls();
}
function updatePageButtons() {
  for (const side of ['old', 'new']) {
    const cached = previewCache.get(previewKey(side, previewPages[side]));
    $(`#${side}-prev`).disabled = !cached || cached.page <= 1;
    $(`#${side}-next`).disabled = !cached || cached.page >= cached.totalPages;
  }
}
async function loadPreview(side, page, jump = false) {
  if (previewOpened) savePreviewScroll(side);
  const location = previewLocations[side].find(l => l.id === activeFocusId());
  if (jump && location?.boxes.length) page = location.boxes[0].page;
  const key = previewKey(side, page);
  const img = $(`#${side}-preview`), message = $(`#${side}-preview-message`);
  $(`#${side}-canvas`).hidden = true; message.hidden = false; message.textContent = '문서 배치를 렌더링하고 있습니다…';
  $(`#${side}-preview-warnings`).textContent = '';
  try {
    let data = previewCache.get(key);
    if (!data) {
      const form = new FormData(); form.append('page', String(page));
      form.append('search', queryText());
      form.append('targets', JSON.stringify(previewTargets(result, side)));
      if (activeFocusId()) form.append('focusId', String(activeFocusId()));
      if (jump) form.append('jump', '1');
      if (isDemo) { form.append('demo', '1'); form.append('side', side); }
      else form.append('file', files[side]);
      const response = await fetch('/api/preview', { method: 'POST', headers: { 'X-Hwp-Diff': '1' }, body: form, signal: controller.signal });
      data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '미리보기를 만들 수 없습니다.');
      if (previewCache.size >= 8) previewCache.delete(previewCache.keys().next().value);
      previewCache.set(previewKey(side, data.page), data);
    }
    previewLocations[side] = data.locations ?? []; previewData[side] = data;
    previewPages[side] = data.page;
    img.src = data.image; $(`#${side}-canvas`).hidden = false; message.hidden = true;
    $(`#${side}-page`).innerHTML = Array.from({ length: data.totalPages }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    $(`#${side}-page`).value = String(data.page);
    $(`#${side}-page-count`).textContent = `/ ${data.totalPages}`;
    const focused = data.locations?.find(l => l.id === activeFocusId());
    if (side === 'new' && !selectedMemoId) $('#preview-jump').textContent = focused?.navigationLabel ?? '변경 위치 보기';
    $(`#${side}-preview-warnings`).innerHTML = `${focused ? `<p>${escapeHtml(focused.message)}</p>` : ''}${data.warnings.map(w => `<p>${escapeHtml(w)}</p>`).join('')}${data.technicalWarnings?.length ? `<details><summary>기술 정보</summary><p>${data.technicalWarnings.map(escapeHtml).join('<br>')}</p></details>` : ''}`;
    drawOverlays(side);
    await img.decode().catch(() => {});
    if (jump) scrollToRegion(side);
    else restorePreviewScroll(side);
  } catch (error) {
    message.textContent = error.name === 'AbortError' ? '미리보기를 취소했습니다.' : `미리보기 불가: ${error.message} 내용 비교 결과는 계속 확인할 수 있습니다.`;
  }
}
async function showPreview(pages = { ...previewPages }, note = '', jump = false) {
  if (!result || controller) return;
  setView(true); controller = new AbortController(); setBusy(true, true);
  showSelectedDetail();
  $('.preview-toolbar').scrollIntoView({ block: 'start' });
  $('#preview-status').textContent = note || '색칠된 영역은 변경된 문단·셀입니다. 선택한 변경은 진한 테두리로 표시합니다.';
  try {
    for (const [side, page] of Object.entries(pages)) {
      if (controller.signal.aborted) break;
      await loadPreview(side, page, jump);
    }
  } finally { controller = null; setBusy(false); }
  previewOpened = true;
  previewHits = ['new', 'old'].flatMap(side => (previewData[side]?.searchQuery === queryText() ? previewData[side]?.searchMatches ?? [] : []).map(hit => ({ ...hit, side })));
  updateSearchControls();
}
function jumpToDiff(id) {
  if (controller) return;
  const diff = result?.diffs.find(d => d.id === Number(id));
  if (!diff) return showPreview();
  selectedMemoId = null; $('#preview-memo').value = '';
  if (!$('#content-panel').hidden && selectedId !== diff.id) { selectedId = diff.id; rememberContentPosition(); }
  selectedId = diff.id; updateNavigator();
  const pages = {};
  for (const [side, docKey, pageKey] of [['old', 'before', 'oldPage'], ['new', 'after', 'newPage']]) {
    if (result.documents[docKey].pageMode === 'layout' && diff[pageKey]) pages[side] = diff[pageKey];
    else pages[side] = 1;
  }
  $('#preview-change').value = String(id);
  showPreview(pages, '변경 항목을 원문에서 찾아 이동합니다. 위치를 찾지 못한 경우 각 문서 아래에 안내합니다.', true);
}
function jumpToMemo(id) {
  if (!result || controller || !result.annotations?.diffs.some(m => m.id === id)) return;
  if (!$('#memo-panel').hidden) { memoScroll = window.scrollY; memoEntryId = id; }
  selectedMemoId = id; $('#preview-memo').value = id;
  showPreview({ ...previewPages }, '보라색은 메모가 연결된 문단입니다. 선택한 메모로 이동하며, 일부만 확인된 범위는 문서 아래에 안내합니다.', true);
}
$('#view-content').addEventListener('click', () => { selectedMemoId = null; setView(false); });
$('#view-memos').addEventListener('click', () => setView('memos'));
$('#view-preview').addEventListener('click', async () => {
  if (previewOpened) {
    setView(true); showSelectedDetail();
    if (['old', 'new'].some(side => previewData[side]?.searchQuery !== queryText())) await showPreview();
    else for (const side of ['old', 'new']) { drawOverlays(side); restorePreviewScroll(side); }
    requestAnimationFrame(() => window.scrollTo({ top: previewWindowScroll }));
    updateSearchControls();
    return;
  }
  const firstMemo = result?.annotations?.diffs?.[0]?.id;
  if (selectedMemoId || (!$('#memo-panel').hidden && firstMemo) || (!selectedId && firstMemo)) jumpToMemo(selectedMemoId ?? firstMemo);
  else selectedId ? jumpToDiff(selectedId) : showPreview();
});
$('#preview-memo').addEventListener('change', event => jumpToMemo(event.target.value));
$('#return-memos').addEventListener('click', () => setView('memos'));
$('#memo-panel').addEventListener('click', event => { const button = event.target.closest('[data-preview-memo]'); if (button) jumpToMemo(button.dataset.previewMemo); });
$('#preview-jump').addEventListener('click', () => jumpToDiff($('#preview-change').value));
$('#preview-change').addEventListener('change', event => jumpToDiff(event.target.value));
$('#diff-list').addEventListener('click', event => { const button = event.target.closest('[data-preview-diff]'); if (button) jumpToDiff(button.dataset.previewDiff); });
$('#preview-zoom').addEventListener('change', event => { for (const side of ['old', 'new']) $(`#${side}-viewport`).dataset.zoom = event.target.value; });
for (const side of ['old', 'new']) {
  $(`#${side}-page`).addEventListener('change', event => showPreview({ [side]: Number(event.target.value) }));
  $(`#${side}-prev`).addEventListener('click', () => showPreview({ [side]: previewPages[side] - 1 }));
  $(`#${side}-next`).addEventListener('click', () => showPreview({ [side]: previewPages[side] + 1 }));
}

function showSelectedDetail() {
  if (selectedMemoId) {
    const memos = result?.annotations?.diffs ?? [], index = memos.findIndex(m => m.id === selectedMemoId);
    $('#selection-title').textContent = `선택한 메모 ${index + 1}`;
    $('#selected-change-detail').innerHTML = index >= 0 ? memoCardHtml(memos[index], index + 1, false, 'selected-') : '';
    return;
  }
  $('#selection-title').textContent = '선택한 변경';
  const diff = result?.diffs.find(d => d.id === selectedId);
  $('#selected-change-detail').innerHTML = diff
    ? renderDiff(diff, result.documents).replace(`id="change-${diff.id}"`, `id="selected-${diff.id}"`)
    : '<p>변경 항목을 선택하면 구버전·신버전 문구가 여기에 표시됩니다.</p>';
}
function drawOverlays(side) {
  const data = previewData[side], svg = $(`#${side}-overlays`);
  svg.replaceChildren(); if (!data) return;
  svg.setAttribute('viewBox', `0 0 ${data.width} ${data.height}`);
  const visibleIds = new Set([...filteredDiffs().map(d => d.id), ...(result?.annotations?.diffs ?? []).map(m => m.id)]);
  for (const location of (data.locations ?? []).filter(l => visibleIds.has(l.id))) for (const box of location.boxes.filter(b => b.page === data.page)) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const prop of ['x', 'y', 'width', 'height']) rect.setAttribute(prop, String(box[prop]));
    const isMemo = location.category === 'memo';
    rect.setAttribute('class', `region-box ${location.type}${isMemo ? ' memo-region' : ''}${location.status === 'context' || location.status === 'table' ? ' context-region' : ''}${location.id === activeFocusId() ? ' selected-region' : ''}`);
    rect.setAttribute('data-change-id', String(location.id)); rect.setAttribute('tabindex', '0'); rect.setAttribute('role', 'button');
    rect.setAttribute('aria-label', isMemo ? `메모 ${String(location.id).slice(5)} 선택` : `${labels[location.type]} 항목 ${location.id} 선택`);
    const select = () => isMemo ? jumpToMemo(location.id) : jumpToDiff(location.id);
    rect.addEventListener('click', select);
    rect.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    svg.append(rect);
  }
  const active = previewHits[searchIndex];
  if (active?.side === side && active.page === data.page && queryText()) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const key of ['x', 'y', 'width', 'height']) rect.setAttribute(key, String(active[key]));
    rect.setAttribute('class', 'search-region'); svg.append(rect);
  }
}
function scrollToRegion(side) {
  const data = previewData[side], viewport = $(`#${side}-viewport`), canvas = $(`#${side}-canvas`);
  const box = data?.locations.find(l => l.id === activeFocusId())?.boxes.find(b => b.page === data.page);
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
  const saved = previewScrolls.get(`${side}:${previewPages[side]}`) ?? { top: 0, left: 0 };
  $(`#${side}-viewport`).scrollTo(saved.left, saved.top);
}

function updateSearchControls() {
  const preview = !$('#preview-panel').hidden, hits = preview ? previewHits : contentHits;
  const query = queryText();
  $('#search-count').textContent = query ? hits.length ? `${searchIndex >= 0 ? searchIndex + 1 : '–'}/${hits.length}${preview ? ' 문단' : ' 일치'}` : '0건' : '';
  $('#previous-match').disabled = !query || !hits.length || !!controller;
  $('#next-match').disabled = !query || !hits.length || !!controller;
}
async function applySearch() {
  if (!result) return;
  if (controller) { searchTimer = setTimeout(applySearch, 120); return; }
  const preview = !$('#preview-panel').hidden;
  shown = 50; renderList(); searchIndex = -1;
  if (preview) {
    await showPreview({ ...previewPages }, queryText() ? '원본 전체에서 검색합니다.' : '', false);
    if (queryText() && previewHits.length) {
      const onPage = previewHits.findIndex(h => h.side === 'new' && h.page === previewPages.new);
      await focusMatch(onPage < 0 ? 0 : onPage);
    }
  } else if (queryText() && contentHits.length) await focusMatch(0);
  updateSearchControls();
}
async function focusMatch(index) {
  if (controller) return;
  const preview = !$('#preview-panel').hidden, hits = preview ? previewHits : contentHits;
  if (!hits.length) return;
  searchIndex = (index + hits.length) % hits.length;
  if (!preview) {
    $('#diff-list').querySelectorAll('.current-search-hit').forEach(e => e.classList.remove('current-search-hit'));
    const hit = hits[searchIndex]; hit.elements.forEach(e => e.classList.add('current-search-hit'));
    hit.elements[0].scrollIntoView({ block: 'center' }); rememberContentPosition();
  } else {
    const hit = hits[searchIndex];
    if (previewPages[hit.side] !== hit.page) await showPreview({ [hit.side]: hit.page }, '원본 검색 결과', false);
    setPreviewSide(hit.side);
    for (const side of ['old', 'new']) drawOverlays(side);
    const data = previewData[hit.side], canvas = $(`#${hit.side}-canvas`), viewport = $(`#${hit.side}-viewport`);
    const scale = canvas.getBoundingClientRect().width / data.width;
    viewport.scrollTo({ top: Math.max(0, hit.y * scale - 60), left: Math.max(0, hit.x * scale - 30) });
    if (compactScreen.matches && $('#preview-zoom').value === 'fit') $(`#${hit.side}-overlays .search-region`)?.scrollIntoView({ block: 'center' });
    $('#preview-status').textContent = `${hit.side === 'new' ? '신버전' : '구버전'} ${hit.page}쪽 · ${hit.text.slice(0, 100)}`;
  }
  updateSearchControls();
}
$('#previous-match').addEventListener('click', () => focusMatch(searchIndex - 1));
$('#next-match').addEventListener('click', () => focusMatch(searchIndex + 1));
function setPreviewSide(side) {
  document.body.classList.toggle('preview-side-old', side === 'old'); document.body.classList.toggle('preview-side-new', side === 'new');
  document.querySelectorAll('[data-preview-side]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.previewSide === side)));
}
document.querySelectorAll('[data-preview-side]').forEach(b => b.addEventListener('click', () => setPreviewSide(b.dataset.previewSide)));
