import { textParts, textChanges, changeAnchors, findOccurrences } from './text-diff.js';
export const labels = { added: '추가', removed: '삭제', modified: '수정', unchanged: '동일', structure: '구조 변경' };
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fileLabel(name, limit = 42) {
  const chars = Array.from(name.normalize('NFC'));
  const short = chars.length > limit ? `<span class="file-name-start">${escapeHtml(chars.slice(0, limit - 18).join(''))}…</span><span class="file-name-end"><bdi>${escapeHtml(chars.slice(-17).join(''))}</bdi></span>` : escapeHtml(name);
  const version = name.match(/v\d+(?:\.\d+)+(?:[-_][a-z0-9]+)?/i)?.[0];
  return `<span class="file-name" title="${escapeHtml(name)}">${short}</span>${version ? `<span class="version-badge">${escapeHtml(version)}</span>` : ''}`;
}

export function previewTargets(result, side) {
  const old = side === 'old';
  const body = result.diffs.filter(d => d.type !== 'unchanged').map(d => ({
    id: d.id, type: d.type === 'structure' ? 'modified' : d.type, category: d.type === 'structure' ? 'structure' : 'content', block: old ? d.before : d.after,
    anchor: old ? d.oldAnchor : d.newAnchor,
    cells: d.cells.map(c => ({ row: c.row, col: c.col, anchors: changeAnchors(c.before?.text ?? '', c.after?.text ?? '', old ? 'before' : 'after') })),
    textAnchors: d.cells.length ? [] : changeAnchors(blockText(d.before), blockText(d.after), old ? 'before' : 'after'),
  }));
  const memos = (result.annotations?.diffs ?? []).map(d => ({ id: d.id, category: 'memo', type: d.type, memo: old ? d.before : d.after }));
  const formatting = (result.formatting?.diffs ?? []).map(d => ({ id: d.id, category: 'format', type: 'modified', range: old ? d.before : d.after }));
  return [...body, ...memos, ...formatting];
}

export function highlight(before = '', after = '') {
  const out = { before: '', after: '' };
  for (const part of textParts(before, after)) {
    const html = part.type === 'equal' ? escapeHtml(part.text) : `<mark class="${part.type}">${escapeHtml(part.text)}</mark>`;
    if (part.type !== 'added') out.before += html;
    if (part.type !== 'removed') out.after += html;
  }
  return out;
}

export function textSummary(diff) {
  const pairs = diff.cells.length ? diff.cells.map(c => [c.before?.text ?? '', c.after?.text ?? '']) : [[blockText(diff.before), blockText(diff.after)]];
  const counts = { added: 0, removed: 0, modified: 0 };
  for (const [a, b] of pairs) for (const change of textChanges(a, b)) counts[change.type]++;
  return Object.entries(counts).filter(([, n]) => n).map(([type, n]) => `문구 ${n}곳 ${labels[type]}`).join(' · ');
}

// Keep the first actual edit visible, even when it occurs at the end of a long cell.
function briefEdit(before, after, side) {
  const text = side === 'before' ? before : after;
  if (!text) return '<span class="empty-block">해당 내용 없음</span>';
  const change = textChanges(before, after)[0];
  const at = change?.[`${side}Start`] ?? 0, endAt = change?.[`${side}End`] ?? 0;
  const start = Math.max(0, at - 12), end = Math.min(text.length, Math.max(at + 72, Math.min(endAt + 24, at + 120)));
  let html = start ? '…' : '';
  for (const p of textParts(before, after)) {
    if (side === 'before' ? p.type === 'added' : p.type === 'removed') continue;
    const from = Math.max(start, p[`${side}Start`]), to = Math.min(end, p[`${side}Start`] + p.text.length);
    if (to <= from) continue;
    const chunk = escapeHtml(p.text.slice(from - p[`${side}Start`], to - p[`${side}Start`]));
    html += p.type === 'equal' ? chunk : `<mark class="${p.type}">${chunk}</mark>`;
  }
  return html + (end < text.length ? '…' : '');
}

export function previewExplanation(diff, category = 'content') {
  if (!diff) return '<p>현재 조건에 해당하는 변경이 없습니다.</p>';
  let title, before = '', after = '', note = '';
  if (category === 'format') {
    title = `서식 변경 · ${diff.text}`;
    const value = (c, side) => `${c.label} ${c[side] === 'AUTO' ? '자동' : c[side]}${['spacing', 'ratio'].includes(c.property) ? '%' : ''}`;
    before = diff.changes.map(c => value(c, 'before')).join(' · ');
    after = diff.changes.map(c => value(c, 'after')).join(' · ');
  } else if (category === 'memo') {
    title = `메모 ${labels[diff.type]}`;
    before = diff.before?.text ?? ''; after = diff.after?.text ?? '';
    if (diff.type === 'modified' && before === after) {
      note = '내용 동일 · 작성자 또는 연결 위치 변경';
      before = `${diff.before.author || '작성자 정보 없음'} · ${diff.before.anchorText || diff.before.context || ''}`;
      after = `${diff.after.author || '작성자 정보 없음'} · ${diff.after.anchorText || diff.after.context || ''}`;
    }
  } else {
    title = `${labels[diff.type]} · 항목 ${diff.id}`;
    const cell = diff.cells?.find(c => (c.before?.text ?? '') !== (c.after?.text ?? '')) ?? diff.cells?.[0];
    before = cell ? cell.before?.text ?? '' : blockText(diff.before);
    after = cell ? cell.after?.text ?? '' : blockText(diff.after);
    note = [cell ? `${cell.row}행 ${cell.col}열 · 변경 셀 ${diff.cells.length}개` : '', textSummary(diff)].filter(Boolean).join(' · ');
    if (diff.type === 'structure') {
      before = (diff.structureChanges ?? []).map(c => structureLabel(c.before)).join(' · ');
      after = (diff.structureChanges ?? []).map(c => structureLabel(c.after)).join(' · ');
      note = '본문 동일 · 제목/문단 분류 변경';
    } else if (before === after && (diff.before?.table || diff.after?.table)) {
      const shape = (block, value) => `${block?.table ? `${block.table.rows}행 × ${block.table.cols}열` : '표 없음'}${value ? ` · 셀 병합 ${value.rowSpan}행 × ${value.colSpan}열` : ''}`;
      before = shape(diff.before, cell?.before); after = shape(diff.after, cell?.after); note = '표 구조 변경';
    }
  }
  return `<div class="explanation-heading"><strong>${escapeHtml(title)}</strong>${note ? `<span>${escapeHtml(note)}</span>` : ''}</div><div class="explanation-values">${[['before', before], ['after', after]].map(([side, text]) => `<p><span class="explanation-side">${side === 'before' ? '구버전' : '신버전'}</span><span class="explanation-excerpt" title="${escapeHtml(text)}">${briefEdit(before, after, side)}</span></p>`).join('')}</div>`;
}

export function changeCounts(result) {
  return [['added', '추가', result.stats.added], ['removed', '삭제', result.stats.removed], ['modified', '수정', result.stats.modified], ['structure', '구조', result.structureStats?.changed ?? 0]]
    .map(([type, label, count]) => `<span class="count-${type}">${label} <strong>${count}</strong></span>`).join('');
}

// Show actual edits (or search matches) first; unchanged context remains available.
export function focusedText(before, after, side, query = '') {
  const text = side === 'before' ? before : after;
  const ranges = query ? findOccurrences(text, query)
    : textChanges(before, after).map(c => [c[`${side}Start`], c[`${side}End`]]);
  if (!ranges.length) return query ? '<span class="empty-block">검색어 일치 없음</span>' : highlight(before, after)[side] || '(빈 셀)';
  const windows = [];
  for (const [a, b] of ranges) {
    const start = Math.max(0, a - 48), end = Math.min(text.length, b + 48), last = windows.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end); else windows.push([start, end]);
  }
  const parts = textParts(before, after).filter(p => side === 'before' ? p.type !== 'added' : p.type !== 'removed');
  return windows.map(([start, end]) => {
    let html = start ? '<span class="context-ellipsis">…</span>' : '';
    for (const p of parts) {
      const at = p[`${side}Start`], from = Math.max(start, at), to = Math.min(end, at + p.text.length);
      if (to > from) { const chunk = escapeHtml(p.text.slice(from - at, to - at)); html += p.type === 'equal' ? chunk : `<mark class="${p.type}" data-edit>${chunk}</mark>`; }
    }
    if (end < text.length) html += '<span class="context-ellipsis">…</span>';
    return `<div class="text-window">${html}</div>`;
  }).join('');
}

export function blockText(block) {
  if (!block) return '';
  return [block.text, block.footnoteText, ...(block.children ?? []).map(blockText),
    ...(block.footnoteBlocks ?? []).map(blockText), block.table?.caption,
    ...(block.table?.cells ?? []).flat().filter(Boolean).map(c => c.text),
    ...(block.table?.captionBlocks ?? []).map(blockText)].filter(Boolean).join('\n');
}

export function renderBlock(block, other, side, focus = false, query = '') {
  if (!block) return '<p class="empty-block">해당 내용 없음</p>';
  if (block.type === 'image') return '<p class="empty-block">그림 · 비교 대상에서 제외</p>';
  let html = '';
  if (block.text) {
    const before = side === 'before' ? block.text : other?.text ?? '', after = side === 'after' ? block.text : other?.text ?? '';
    html += `<div class="block-text">${focus ? focusedText(before, after, side, query) : highlight(before, after)[side]}</div>`;
    if (focus && block.text.length > 160) html += `<details class="cell-context"><summary>문단 전체 내용 보기</summary><div class="context-text">${highlight(before, after)[side]}</div></details>`;
  }
  if (block.table) {
    const t = block.table;
    const changedShape = other?.table && (t.rows !== other.table.rows || t.cols !== other.table.cols);
    html += `<p class="table-meta">표 · ${t.rows}행 × ${t.cols}열${changedShape ? ' · 크기 변경' : ''}</p>`;
    if (t.caption) html += `<p class="caption-text">${escapeHtml(t.caption)}</p>`;
    html += '<div class="table-scroll"><table class="doc-table"><tbody>';
    t.cells.forEach((row, r) => {
      html += '<tr>';
      row.forEach((cell, c) => {
        if (!cell || cell.rowSpan === 0 || cell.colSpan === 0) return;
        const peer = other?.table?.cells[r]?.[c];
        const changed = JSON.stringify(cell) !== JSON.stringify(peer);
        const text = highlight(side === 'before' ? cell.text : peer?.text ?? '', side === 'after' ? cell.text : peer?.text ?? '')[side];
        html += `<td rowspan="${Math.max(1, Math.min(1000, Number(cell.rowSpan) || 1))}" colspan="${Math.max(1, Math.min(1000, Number(cell.colSpan) || 1))}" class="${changed ? 'cell-' + side : ''}" title="${r + 1}행 ${c + 1}열">`;
        html += cell.blocks?.length ? cell.blocks.map((child, n) => renderBlock(child, peer?.blocks?.[n], side)).join('') : `<span class="cell-text">${text}</span>`;
        if (peer && (cell.rowSpan !== peer.rowSpan || cell.colSpan !== peer.colSpan)) html += `<small class="merge-note">병합: ${cell.rowSpan}행 × ${cell.colSpan}열</small>`;
        html += '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += (t.captionBlocks ?? []).map((child, n) => renderBlock(child, other?.table?.captionBlocks?.[n], side)).join('');
  }
  html += (block.children ?? []).map((child, n) => renderBlock(child, other?.children?.[n], side)).join('');
  if (block.footnoteText) html += `<p class="footnote">주석: <span class="footnote-text">${highlight(side === 'before' ? block.footnoteText : other?.footnoteText ?? '', side === 'after' ? block.footnoteText : other?.footnoteText ?? '')[side]}</span></p>`;
  html += (block.footnoteBlocks ?? []).map((child, n) => renderBlock(child, other?.footnoteBlocks?.[n], side)).join('');
  return html || '<p class="empty-block">빈 문단 / 구분선</p>';
}

function location(index, page, document) {
  if (!index) return '—';
  return page ? document?.pageMode === 'layout' ? '원문 저장 쪽 ' + page : '구역 근사 ' + page : '원문 쪽 정보 없음';
}

function structureLabel(shape) {
  return shape.type === 'heading' ? `제목${shape.level ? ` (${shape.level}단계)` : ''}` : shape.type === 'list' ? '목록' : '문단';
}

export function renderChangedCells(diff, query = '') {
  let cells = diff.cells;
  if (query && (diff.before?.table || diff.after?.table)) {
    const a = diff.before?.table, b = diff.after?.table; cells = [];
    for (let r = 0; r < Math.max(a?.rows ?? 0, b?.rows ?? 0); r++) for (let c = 0; c < Math.max(a?.cols ?? 0, b?.cols ?? 0); c++) {
      const old = a?.cells[r]?.[c], fresh = b?.cells[r]?.[c];
      if (`${old?.text ?? ''}\n${fresh?.text ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) cells.push({ row: r + 1, col: c + 1, before: old, after: fresh });
    }
  }
  return `<div class="changed-cells">${cells.map(cell => {
    const header = diff.after?.table?.cells[0]?.[cell.col - 1]?.text || diff.before?.table?.cells[0]?.[cell.col - 1]?.text;
    return `<section class="cell-change"><p class="cell-address">${cell.row}행 ${cell.col}열${header ? ` · ${escapeHtml(header.slice(0, 70))}` : ''}</p><div class="diff-columns">${['before', 'after'].map(side => {
      const value = cell[side], other = cell[side === 'before' ? 'after' : 'before'];
      const before = cell.before?.text ?? '', after = cell.after?.text ?? '';
      return `<section class="${side}"><span class="cell-side-label">${side === 'before' ? '구버전' : '신버전'}</span><div class="cell-value">${value ? focusedText(before, after, side, query) : '해당 셀 없음'}</div>${value && value.text.length > 160 ? `<details class="cell-context"><summary>셀 전체 내용 보기</summary><div class="context-text">${highlight(before, after)[side]}</div></details>` : ''}${value && other && (value.rowSpan !== other.rowSpan || value.colSpan !== other.colSpan) ? `<small>병합: ${value.rowSpan}행 × ${value.colSpan}열</small>` : ''}</section>`;
    }).join('')}</div></section>`;
  }).join('')}</div>`;
}

export function renderDiff(diff, documents, navigation = false, query = '', focus = navigation) {
  const columns = `<div class="diff-columns"><section class="before"><p class="location"><span class="side-label">구버전 · </span>${location(diff.oldIndex, diff.oldPage, documents.before)}</p>${renderBlock(diff.before, diff.after, 'before', focus && !diff.before?.table, query)}</section>
    <section class="after"><p class="location"><span class="side-label">신버전 · </span>${location(diff.newIndex, diff.newPage, documents.after)}</p>${renderBlock(diff.after, diff.before, 'after', focus && !diff.after?.table, query)}</section></div>`;
  // During search expose all searchable fields, including captions and footnotes.
  const compact = !query && diff.type === 'modified' && diff.cells.length > 0;
  return `<article class="diff-card ${diff.type}" id="change-${diff.id}" tabindex="-1" data-diff-id="${diff.id}">
    <div class="diff-heading"><span class="type-badge ${diff.type}">${labels[diff.type]}</span><span>항목 ${String(diff.id).padStart(2, '0')}${diff.cells.length ? ` · 변경 셀 ${diff.cells.length}개` : ''}</span>${navigation ? `<button class="preview-jump" data-preview-diff="${diff.id}">문서에서 보기 ↗</button>` : ''}</div>
    ${(diff.structureChanges ?? []).map(s => `<p class="structure-note">${escapeHtml(s.path)} · ${escapeHtml(structureLabel(s.before))} → ${escapeHtml(structureLabel(s.after))}. 동일한 문구의 분류 변경이며 본문 삭제·추가로 집계하지 않습니다.</p>`).join('')}
    ${textSummary(diff) ? `<p class="edit-summary">${escapeHtml(textSummary(diff))}</p>` : ''}
    ${compact ? renderChangedCells(diff, query) : ''}
    ${compact || diff.type === 'unchanged' && !query ? `<details class="full-context"><summary>${compact ? '전체 표 펼치기 · 동일한 셀 포함' : '동일한 내용 펼치기'}</summary>${columns}</details>` : columns}
  </article>`;
}

export function warningsHtml(result) {
  const excluded = result.unsupported;
  const note = excluded && (excluded.before.length || excluded.after.length)
    ? `<p class="parse-warning">그림 비교 미지원 · 구버전 ${excluded.before.length}개 / 신버전 ${excluded.after.length}개. 그림은 추가·삭제·수정·동일 건수에서 제외했습니다.</p>` : '';
  return note + (result.warnings.length ? `<details class="parse-warning"><summary>일부 내용을 읽지 못했을 수 있습니다 · ${result.warnings.length}건</summary><p>해당 부분은 원본 문서에서 확인해 주세요.</p><details><summary>기술 정보</summary><ul>${result.warnings.map(w => `<li>${escapeHtml(w.document)} · ${escapeHtml(w.code)}: ${escapeHtml(w.message)}</li>`).join('')}</ul></details></details>` : '');
}

export function memoCardHtml(d, number, navigation = false, prefix = '') {
  const memo = d.after ?? d.before;
  return `<article class="memo-card" id="${escapeHtml(prefix + d.id)}"><div class="diff-heading"><span class="type-badge ${d.type}">메모 ${labels[d.type]}</span><strong>메모 ${number}</strong>${navigation ? `<button class="memo-location-button" data-preview-memo="${escapeHtml(d.id)}" aria-label="메모 ${number} 원문 위치 보기">원문 위치 보기 ↗</button>` : ''}</div>
    <p class="memo-context"><strong>연결된 내용:</strong> ${escapeHtml(memo.anchorText || memo.context || '연결 문구를 확인하지 못했습니다.')}</p>${d.type === 'modified' && d.before.text === d.after.text ? '<p class="memo-context">메모 내용은 같고 작성자 또는 연결된 위치 정보가 달라졌습니다.</p>' : ''}
    <div class="diff-columns">${['before', 'after'].map(side => {
      const value = d[side];
      return `<section class="${side}"><p class="cell-side-label">${side === 'before' ? '구버전' : '신버전'}</p>${value ? `<p class="memo-meta">작성자: ${escapeHtml(value.author || '정보 없음')}${value.createdAt ? ` · 작성 시각: ${escapeHtml(value.createdAt)}` : ''}</p><div class="memo-text">${highlight(d.before?.text ?? '', d.after?.text ?? '')[side]}</div>` : '<p class="empty-block">메모 없음</p>'}</section>`;
    }).join('')}</div></article>`;
}

export function annotationsHtml(annotations, navigation = false) {
  if (!annotations?.available) return `<p class="parse-warning"><strong>메모 미검사</strong><br>${escapeHtml(annotations?.message ?? '이 결과에는 메모 비교 정보가 없습니다. 다시 비교해 주세요.')}</p>`;
  const { stats, diffs, counts } = annotations;
  const changes = diffs.filter(d => d.type !== 'unchanged');
  const card = d => memoCardHtml(d, diffs.indexOf(d) + 1, navigation);
  return `<section class="memo-results"><h2>메모 변경 ${changes.length}개</h2><p>구버전 메모 ${counts.before}개 → 신버전 메모 ${counts.after}개 · 추가 ${stats.added} / 삭제 ${stats.removed} / 수정 ${stats.modified} / 동일 ${stats.unchanged}</p><p class="memo-scope">검토 메모는 본문과 별도로 비교합니다.${navigation ? ' 원문 위치 보기를 누르면 연결된 문단으로 이동합니다. 원본에서는 보라색 표시로 확인할 수 있습니다.' : ''} 한컴의 메모 풍선 모양 자체는 재현하지 않습니다.</p>
    ${changes.length ? changes.map(card).join('') : '<p class="no-results">메모의 추가·삭제·수정이 없습니다.</p>'}
    ${stats.unchanged ? `<details class="unchanged-memos"><summary>동일한 메모 ${stats.unchanged}개 보기</summary>${diffs.filter(d => d.type === 'unchanged').map(card).join('')}</details>` : ''}</section>`;
}

export function formatCardHtml(diff, number, navigation = false, prefix = '') {
  const value = (property, v) => `${escapeHtml(v === 'AUTO' ? '자동' : v)}${property === 'spacing' || property === 'ratio' ? '%' : ''}`;
  const swatch = v => /^#[0-9A-F]{6}$/i.test(v) ? `<svg class="color-swatch" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" fill="${escapeHtml(v)}"/></svg>` : '';
  const excerpt = range => `${range.start > 48 ? '…' : ''}${escapeHtml(range.paragraphText.slice(Math.max(0, range.start - 48), range.start))}<mark class="format-text">${escapeHtml(range.paragraphText.slice(range.start, range.end))}</mark>${escapeHtml(range.paragraphText.slice(range.end, range.end + 48))}${range.paragraphText.length > range.end + 48 ? '…' : ''}`;
  const location = loc => `${Number(loc.section.match(/\d+/)?.[0] ?? 0) + 1}구역 · 문단 ${loc.paragraph}${loc.row ? ` · 표 ${loc.row}행 ${loc.col}열` : ''}`;
  return `<article class="format-card" id="${escapeHtml(prefix + diff.id)}"><div class="diff-heading"><span class="type-badge format-badge">서식 변경</span><strong>구간 ${number}</strong>${navigation ? `<button class="format-location-button" data-preview-format="${escapeHtml(diff.id)}" aria-label="서식 구간 ${number} 원문 위치 보기">원문 위치 보기 ↗</button>` : ''}</div>
    <div class="diff-columns">${['before', 'after'].map(side => `<section class="${side}"><p class="cell-side-label">${side === 'before' ? '구버전' : '신버전'} · ${escapeHtml(location(diff[side].location))}</p><p class="format-excerpt">${excerpt(diff[side])}</p></section>`).join('')}</div>
    <table class="format-values"><thead><tr><th scope="col">서식</th><th scope="col">구버전</th><th scope="col">신버전</th></tr></thead><tbody>${diff.changes.map(change => `<tr><th scope="row">${escapeHtml(change.label)}</th><td>${change.property === 'color' ? swatch(change.before) : ''}${value(change.property, change.before)}</td><td>${change.property === 'color' ? swatch(change.after) : ''}${value(change.property, change.after)}</td></tr>`).join('')}</tbody></table></article>`;
}

export function formattingHtml(formatting, navigation = false) {
  if (!formatting?.available) return `<p class="parse-warning">${escapeHtml(formatting?.message ?? '서식 비교 정보가 없습니다. 다시 비교해 주세요.')}</p>`;
  const labels = { color: '글자색', font: '글꼴', spacing: '자간', ratio: '장평' };
  return `<section class="format-results"><h2>서식 변경 ${formatting.stats.changedRanges}곳</h2><p>${Object.entries(formatting.stats.properties).map(([k, n]) => `${labels[k]} ${n}곳`).join(' · ')}</p><p class="format-scope">서로 대응되는 글자 구간의 서식을 비교합니다. 내용과 서식이 함께 바뀌면 각각 집계합니다. 새로 추가·삭제된 문구, 글자 크기·굵기·밑줄·여백은 이 서식 비교에 포함하지 않습니다.</p>${formatting.incompleteRanges ? `<p class="parse-warning">복잡하게 교체된 문구 ${formatting.incompleteRanges}곳의 일부 서식은 정확히 대응하지 못했습니다. 원본에서 확인해 주세요.</p>` : ''}
    ${formatting.diffs.length ? formatting.diffs.map((d, i) => formatCardHtml(d, i + 1, navigation)).join('') : '<p class="no-results">비교한 글자에서 글자색·글꼴·자간·장평 변경이 없습니다.</p>'}</section>`;
}

export function exportHtml(result) {
  const changes = result.diffs.filter(d => d.type !== 'unchanged');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>문서 신구대조표</title><style>
  body{font:16px/1.7 "Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",Arial,sans-serif;color:#19202C;margin:40px auto;max-width:1100px;padding:0 24px}h1{font-size:28px;color:#0A46A5}p{overflow-wrap:anywhere}.diff-card{border:1px solid #DCE2E8;border-radius:8px;margin:20px 0;break-inside:avoid;overflow:hidden}.diff-heading{padding:10px 16px;background:#F5F7F9;display:flex;gap:14px}.diff-columns{display:grid;grid-template-columns:1fr 1fr}.diff-columns section{padding:16px;min-width:0}.before{border-right:1px solid #DCE2E8}.location,.table-meta{font-size:12px;color:#67717C}.block-text,td{white-space:pre-wrap;overflow-wrap:anywhere}mark{color:inherit;border-radius:2px}.removed{background:#F8D5DE}.added{background:#CBF0E8}.type-badge{font-size:12px;padding:1px 8px;border-radius:4px}.modified{background-color:#FFF4D8}.diff-card.modified{background:white}.doc-table{width:100%;border-collapse:collapse;font-size:16px}td{border:1px solid #DCE2E8;padding:8px}.cell-before{background:#FCE9ED}.cell-after{background:#E2F7F3}.merge-note{display:block;color:#8c510d}.empty-block{color:#888}.parse-warning{background:#FFFBF1;padding:16px}.table-scroll{overflow:auto}.footnote{font-size:12px}li{margin:5px 0}@media print{body{max-width:none;margin:0;padding:0;font-size:11px}.diff-card{break-inside:auto}mark{-webkit-print-color-adjust:exact;print-color-adjust:exact}thead{display:table-header-group}}@page{size:A4 landscape;margin:12mm}
  .memo-card,.format-card{border:1px solid #DCE2E8;margin:18px 0;break-inside:avoid}.memo-card section,.format-card section{padding:14px}.memo-text,.format-excerpt{white-space:pre-wrap;overflow-wrap:anywhere}.memo-context,.memo-meta{padding:10px;font-size:12px}.memo-scope,.format-scope{font-size:12px;color:#67717C}.format-values{width:100%;border-collapse:collapse}.format-values th,.format-values td{border:1px solid #DCE2E8;padding:8px;text-align:left}.format-text{background:#DAEBFA}.color-swatch{width:12px;height:12px;margin-right:6px}
  </style></head><body><h1>문서 신구대조표</h1><p>구버전: ${escapeHtml(result.documents.before.name)}<br>신버전: ${escapeHtml(result.documents.after.name)}</p>
  <p>추가 ${result.stats.added} · 삭제 ${result.stats.removed} · 수정 ${result.stats.modified} · 동일 ${result.stats.unchanged} (블록 기준)</p>
  ${result.structureStats?.changed ? `<p>제목·문단 구조 변경 ${result.structureStats.changed}개 · 본문 추가/삭제와 별도 집계</p>` : ''}
  <p>${escapeHtml(result.engine)} · ${escapeHtml(result.createdAt)} · 실제 내용의 일치 여부로 판정</p>
  ${warningsHtml(result)}<ul>${result.limitations.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
  ${result.annotations ? annotationsHtml(result.annotations) : ''}
  ${result.formatting ? formattingHtml(result.formatting) : ''}
  ${changes.length ? changes.map(d => renderDiff(d, result.documents)).join('') : '<p>비교 대상 본문·표에서 변경을 찾지 못했습니다. 문서 전체가 동일하다는 판정은 아닙니다.</p>'}
  <p>내용과 분류가 동일한 항목 ${result.diffs.filter(d => d.type === 'unchanged').length}개는 이 대조표에서 생략했습니다.</p></body></html>`;
}
