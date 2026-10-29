import { labels, escapeHtml, blockText, renderDiff, warningsHtml, exportHtml, fileLabel } from './report.js';

const $ = selector => document.querySelector(selector);
let files = { old: null, new: null }, result = null, filter = 'changes', shown = 50, controller = null;
let isDemo = false, previewPages = { old: 1, new: 1 }, previewCache = new Map();
let selectedId = null, contentScroll = 0;
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
  $('#results').hidden = true; $('#empty-state').hidden = false; $('#status').textContent = '';
  for (const side of ['old', 'new']) { $(`#${side}-preview`).removeAttribute('src'); $(`#${side}-preview`).hidden = true; }
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
  for (const id of ['demo', 'swap', 'reset', 'old-file', 'new-file', 'view-preview', 'preview-jump', 'old-page', 'new-page', 'old-prev', 'old-next', 'new-prev', 'new-next']) $(`#${id}`).disabled = busy;
  $('#cancel').hidden = !busy;
  $('#compare').innerHTML = busy ? `<span class="spinner"></span> ${preview ? '렌더링 중' : '비교 중'}` : '변경 사항 비교 <span>→</span>';
  $('.upload-panel').setAttribute('aria-busy', String(busy));
  updateFiles();
  if (!busy) updatePageButtons();
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
  $('#result-title').textContent = total ? `${total}개 항목에서 변경을 찾았습니다` : '비교 대상 본문·표의 변경이 없습니다';
  $('#stats').innerHTML = Object.entries(labels).map(([type, label]) => `<div class="stat ${type}"><span>${label}</span><strong>${result.stats[type]}<small>개 블록</small></strong></div>`).join('');
  $('#warnings').innerHTML = warningsHtml(result);
  $('#limitations').innerHTML = result.limitations.map(text => `<li>${escapeHtml(text)}</li>`).join('');
  for (const [side, key] of [['old', 'before'], ['new', 'after']]) {
    for (const suffix of ['column', 'preview-name', 'summary']) $(`#${side}-${suffix}`).innerHTML = `<span>${side === 'old' ? '구버전' : '신버전'} · </span>${fileLabel(result.documents[key].name)}`;
  }
  $('#preview-change').innerHTML = result.diffs.filter(d => d.type !== 'unchanged').map(d => `<option value="${d.id}">${labels[d.type]} · 항목 ${d.id} · ${escapeHtml(blockText(d.after ?? d.before).slice(0, 45))}</option>`).join('') || '<option value="">변경 없음</option>';
  renderList();
  $('#results').scrollIntoView({ block: 'start' });
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
  $('#diff-list').innerHTML = diffs.slice(0, shown).map(d => renderDiff(d, result.documents, true)).join('') || '<div class="no-results">현재 조건에 해당하는 항목이 없습니다.</div>';
  $('#load-more').hidden = diffs.length <= shown;
  $('#load-more').textContent = `다음 50개 보기 (${Math.min(shown, diffs.length)} / ${diffs.length})`;
  document.querySelectorAll('[data-filter]').forEach(button => { const selected = button.dataset.filter === filter; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  updateNavigator();
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
  selectedId = Number(id); updateNavigator();
  if (!$('#preview-panel').hidden) return jumpToDiff(selectedId);
  const index = filteredDiffs().findIndex(d => d.id === selectedId);
  if (index >= shown) { shown = index + 1; renderList(); }
  const card = $(`#change-${selectedId}`);
  card?.scrollIntoView({ block: 'start' }); card?.focus({ preventScroll: true });
}
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
$('#search').addEventListener('input', () => { shown = 50; renderList(); });
$('#load-more').addEventListener('click', () => { shown += 50; renderList(); });
function download(contents, type, extension) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = `신구대조표_${new Date().toISOString().slice(0, 10)}.${extension}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
$('#export-html').addEventListener('click', () => { if (result) download(exportHtml(result), 'text/html;charset=utf-8', 'html'); });
$('#export-json').addEventListener('click', () => { if (result) download(JSON.stringify(result, null, 2), 'application/json;charset=utf-8', 'json'); });

function setView(preview) {
  const wasPreview = !$('#preview-panel').hidden;
  if (preview && !wasPreview) contentScroll = window.scrollY;
  $('#content-panel').hidden = preview; $('#preview-panel').hidden = !preview;
  for (const [id, active] of [['view-content', !preview], ['view-preview', preview]]) {
    $(`#${id}`).classList.toggle('selected', active); $(`#${id}`).setAttribute('aria-pressed', String(active));
  }
  if (!preview && wasPreview && result) requestAnimationFrame(() => window.scrollTo({ top: contentScroll }));
}
function updatePageButtons() {
  for (const side of ['old', 'new']) {
    const cached = previewCache.get(`${side}:${previewPages[side]}`);
    $(`#${side}-prev`).disabled = !cached || cached.page <= 1;
    $(`#${side}-next`).disabled = !cached || cached.page >= cached.totalPages;
  }
}
async function loadPreview(side, page) {
  const key = `${side}:${page}`;
  const img = $(`#${side}-preview`), message = $(`#${side}-preview-message`);
  img.hidden = true; message.hidden = false; message.textContent = '문서 배치를 렌더링하고 있습니다…';
  $(`#${side}-preview-warnings`).textContent = '';
  try {
    let data = previewCache.get(key);
    if (!data) {
      const form = new FormData(); form.append('page', String(page));
      if (isDemo) { form.append('demo', '1'); form.append('side', side); }
      else form.append('file', files[side]);
      const response = await fetch('/api/preview', { method: 'POST', headers: { 'X-Hwp-Diff': '1' }, body: form, signal: controller.signal });
      data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '미리보기를 만들 수 없습니다.');
      if (previewCache.size >= 8) previewCache.delete(previewCache.keys().next().value);
      previewCache.set(key, data);
    }
    previewPages[side] = data.page;
    img.src = data.image; img.hidden = false; message.hidden = true;
    $(`#${side}-page`).innerHTML = Array.from({ length: data.totalPages }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    $(`#${side}-page`).value = String(data.page);
    $(`#${side}-page-count`).textContent = `/ ${data.totalPages}`;
    $(`#${side}-preview-warnings`).textContent = data.warnings.length ? `렌더링 참고: ${data.warnings.join(' / ')}` : '';
  } catch (error) {
    message.textContent = error.name === 'AbortError' ? '미리보기를 취소했습니다.' : `미리보기 불가: ${error.message} 내용 비교 결과는 계속 확인할 수 있습니다.`;
  }
}
async function showPreview(pages = { ...previewPages }, note = '') {
  if (!result || controller) return;
  setView(true); controller = new AbortController(); setBusy(true, true);
  $('#preview-status').textContent = note || '원본 파일에서 쪽별 미리보기를 만듭니다. 내용 비교 탭에서 정확한 변경 문구를 확인하세요.';
  try {
    for (const [side, page] of Object.entries(pages)) {
      if (controller.signal.aborted) break;
      await loadPreview(side, page);
    }
  } finally { controller = null; setBusy(false); }
}
function jumpToDiff(id) {
  const diff = result?.diffs.find(d => d.id === Number(id));
  if (!diff) return showPreview();
  selectedId = diff.id; updateNavigator();
  const pages = {}; let approximate = false;
  for (const [side, docKey, pageKey] of [['old', 'before', 'oldPage'], ['new', 'after', 'newPage']]) {
    if (result.documents[docKey].pageMode === 'layout' && diff[pageKey]) pages[side] = diff[pageKey];
    else { pages[side] = 1; approximate = true; }
  }
  $('#preview-change').value = String(id);
  showPreview(pages, approximate ? '정확한 쪽 연결 정보가 없는 문서는 첫 쪽을 열었습니다. 쪽 선택으로 위치를 확인해 주세요. 수정 강조는 내용 비교 탭에서 볼 수 있습니다.' : '변경 항목이 있는 쪽을 열었습니다. 수정 강조는 내용 비교 탭에서 볼 수 있습니다.');
}
$('#view-content').addEventListener('click', () => setView(false));
$('#view-preview').addEventListener('click', () => showPreview());
$('#preview-jump').addEventListener('click', () => jumpToDiff($('#preview-change').value));
$('#diff-list').addEventListener('click', event => { const button = event.target.closest('[data-preview-diff]'); if (button) jumpToDiff(button.dataset.previewDiff); });
$('#preview-zoom').addEventListener('change', event => { for (const side of ['old', 'new']) $(`#${side}-viewport`).dataset.zoom = event.target.value; });
for (const side of ['old', 'new']) {
  $(`#${side}-page`).addEventListener('change', event => showPreview({ [side]: Number(event.target.value) }));
  $(`#${side}-prev`).addEventListener('click', () => showPreview({ [side]: previewPages[side] - 1 }));
  $(`#${side}-next`).addEventListener('click', () => showPreview({ [side]: previewPages[side] + 1 }));
}
