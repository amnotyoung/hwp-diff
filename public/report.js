export const labels = { added: '추가', removed: '삭제', modified: '수정', unchanged: '동일' };
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fileLabel(name, limit = 42) {
  const chars = Array.from(name);
  const short = chars.length > limit ? `${chars.slice(0, limit - 24).join('')}…${chars.slice(-23).join('')}` : name;
  const version = name.match(/v\d+(?:\.\d+)+(?:[-_][a-z0-9]+)?/i)?.[0];
  return `<span class="file-name" title="${escapeHtml(name)}">${escapeHtml(short)}</span>${version ? `<span class="version-badge">${escapeHtml(version)}</span>` : ''}`;
}

export function previewTargets(result, side) {
  const old = side === 'old';
  const body = result.diffs.filter(d => d.type !== 'unchanged').map(d => ({
    id: d.id, type: d.type, block: old ? d.before : d.after,
    anchor: old ? d.oldAnchor : d.newAnchor,
    cells: d.cells.map(c => ({ row: c.row, col: c.col })),
  }));
  const memos = (result.annotations?.diffs ?? []).map(d => ({ id: d.id, category: 'memo', type: d.type, memo: old ? d.before : d.after }));
  return [...body, ...memos];
}

// Exact character diff for the changed region; bound quadratic work for long paragraphs.
export function highlight(before = '', after = '') {
  const a = Array.from(before), b = Array.from(after);
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
  const x = a.slice(start, a.length - end), y = b.slice(start, b.length - end);
  const prefix = escapeHtml(a.slice(0, start).join('')), suffix = escapeHtml(end ? a.slice(-end).join('') : '');
  const mark = (text, kind) => text ? `<mark class="${kind}">${escapeHtml(text)}</mark>` : '';
  if (!x.length || !y.length || x.length * y.length > 250_000) return {
    before: prefix + mark(x.join(''), 'removed') + suffix,
    after: prefix + mark(y.join(''), 'added') + suffix,
  };
  const dp = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--)
    dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, old = '', fresh = '', removed = '', added = '';
  const flush = () => { old += mark(removed, 'removed'); fresh += mark(added, 'added'); removed = ''; added = ''; };
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      flush(); old += escapeHtml(x[i]); fresh += escapeHtml(y[j]); i++; j++;
    } else if (i < x.length && (j === y.length || dp[i + 1][j] >= dp[i][j + 1])) removed += x[i++];
    else added += y[j++];
  }
  flush();
  return { before: prefix + old + suffix, after: prefix + fresh + suffix };
}

export function blockText(block) {
  if (!block) return '';
  return [block.text, block.footnoteText, ...(block.children ?? []).map(blockText),
    ...(block.footnoteBlocks ?? []).map(blockText), block.table?.caption,
    ...(block.table?.cells ?? []).flat().filter(Boolean).map(c => c.text),
    ...(block.table?.captionBlocks ?? []).map(blockText)].filter(Boolean).join('\n');
}

export function renderBlock(block, other, side) {
  if (!block) return '<p class="empty-block">해당 내용 없음</p>';
  if (block.type === 'image') return '<p class="empty-block">그림 · 비교 대상에서 제외</p>';
  let html = '';
  if (block.text) html += `<div class="block-text">${highlight(side === 'before' ? block.text : other?.text ?? '', side === 'after' ? block.text : other?.text ?? '')[side]}</div>`;
  if (block.table) {
    const t = block.table;
    const changedShape = other?.table && (t.rows !== other.table.rows || t.cols !== other.table.cols);
    html += `<p class="table-meta">표 · ${t.rows}행 × ${t.cols}열${changedShape ? ' · 크기 변경' : ''}</p>`;
    if (t.caption) html += `<p>${escapeHtml(t.caption)}</p>`;
    html += '<div class="table-scroll"><table class="doc-table"><tbody>';
    t.cells.forEach((row, r) => {
      html += '<tr>';
      row.forEach((cell, c) => {
        if (!cell || cell.rowSpan === 0 || cell.colSpan === 0) return;
        const peer = other?.table?.cells[r]?.[c];
        const changed = JSON.stringify(cell) !== JSON.stringify(peer);
        const text = highlight(side === 'before' ? cell.text : peer?.text ?? '', side === 'after' ? cell.text : peer?.text ?? '')[side];
        html += `<td rowspan="${Math.max(1, Math.min(1000, Number(cell.rowSpan) || 1))}" colspan="${Math.max(1, Math.min(1000, Number(cell.colSpan) || 1))}" class="${changed ? 'cell-' + side : ''}" title="${r + 1}행 ${c + 1}열">`;
        html += cell.blocks?.length ? cell.blocks.map((child, n) => renderBlock(child, peer?.blocks?.[n], side)).join('') : text;
        if (peer && (cell.rowSpan !== peer.rowSpan || cell.colSpan !== peer.colSpan)) html += `<small class="merge-note">병합: ${cell.rowSpan}행 × ${cell.colSpan}열</small>`;
        html += '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += (t.captionBlocks ?? []).map((child, n) => renderBlock(child, other?.table?.captionBlocks?.[n], side)).join('');
  }
  html += (block.children ?? []).map((child, n) => renderBlock(child, other?.children?.[n], side)).join('');
  if (block.footnoteText) html += `<p class="footnote">주석: ${highlight(side === 'before' ? block.footnoteText : other?.footnoteText ?? '', side === 'after' ? block.footnoteText : other?.footnoteText ?? '')[side]}</p>`;
  html += (block.footnoteBlocks ?? []).map((child, n) => renderBlock(child, other?.footnoteBlocks?.[n], side)).join('');
  return html || '<p class="empty-block">빈 문단 / 구분선</p>';
}

function location(index, page, document) {
  if (!index) return '—';
  return `${index}번 블록${page ? ` · ${document?.pageMode === 'layout' ? page + '쪽' : '섹션 근사 ' + page}` : ''}`;
}

export function renderChangedCells(diff) {
  return `<div class="changed-cells">${diff.cells.map(cell => {
    const header = diff.after?.table?.cells[0]?.[cell.col - 1]?.text || diff.before?.table?.cells[0]?.[cell.col - 1]?.text;
    return `<section class="cell-change"><p class="cell-address">${cell.row}행 ${cell.col}열${header ? ` · ${escapeHtml(header.slice(0, 70))}` : ''}</p><div class="diff-columns">${['before', 'after'].map(side => {
      const value = cell[side], other = cell[side === 'before' ? 'after' : 'before'];
      return `<section class="${side}"><span class="cell-side-label">${side === 'before' ? '구버전' : '신버전'}</span><div class="cell-value ${side === 'before' ? 'cell-before' : 'cell-after'}">${value ? highlight(cell.before?.text ?? '', cell.after?.text ?? '')[side] || '(빈 셀)' : '해당 셀 없음'}</div>${value && other && (value.rowSpan !== other.rowSpan || value.colSpan !== other.colSpan) ? `<small>병합: ${value.rowSpan}행 × ${value.colSpan}열</small>` : ''}</section>`;
    }).join('')}</div></section>`;
  }).join('')}</div>`;
}

export function renderDiff(diff, documents, navigation = false) {
  const columns = `<div class="diff-columns"><section class="before"><p class="location"><span class="side-label">구버전 · </span>${location(diff.oldIndex, diff.oldPage, documents.before)}</p>${renderBlock(diff.before, diff.after, 'before')}</section>
    <section class="after"><p class="location"><span class="side-label">신버전 · </span>${location(diff.newIndex, diff.newPage, documents.after)}</p>${renderBlock(diff.after, diff.before, 'after')}</section></div>`;
  const compact = diff.type === 'modified' && diff.cells.length > 0;
  return `<article class="diff-card ${diff.type}" id="change-${diff.id}" tabindex="-1" data-diff-id="${diff.id}">
    <div class="diff-heading"><span class="type-badge ${diff.type}">${labels[diff.type]}</span><span>항목 ${String(diff.id).padStart(2, '0')}${diff.cells.length ? ` · 변경 셀 ${diff.cells.length}개` : ''}</span>${navigation ? `<button class="preview-jump" data-preview-diff="${diff.id}">문서에서 보기 ↗</button>` : ''}</div>
    ${compact ? renderChangedCells(diff) : ''}
    ${compact || diff.type === 'unchanged' ? `<details class="full-context"><summary>${compact ? '전체 표 펼치기 · 동일한 셀 포함' : '동일한 내용 펼치기'}</summary>${columns}</details>` : columns}
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
  if (!annotations?.available) return `<p class="parse-warning">${escapeHtml(annotations?.message ?? '이 결과에는 메모 비교 정보가 없습니다. 다시 비교해 주세요.')}</p>`;
  const { stats, diffs, counts } = annotations;
  const changes = diffs.filter(d => d.type !== 'unchanged');
  const card = d => memoCardHtml(d, diffs.indexOf(d) + 1, navigation);
  return `<section class="memo-results"><h2>메모 변경 ${changes.length}개</h2><p>구버전 메모 ${counts.before}개 → 신버전 메모 ${counts.after}개 · 추가 ${stats.added} / 삭제 ${stats.removed} / 수정 ${stats.modified} / 동일 ${stats.unchanged}</p><p class="memo-scope">검토 메모는 본문과 별도로 비교합니다.${navigation ? ' 원문 위치 보기를 누르면 연결된 문단으로 이동합니다. 원본에서는 보라색 표시로 확인할 수 있습니다.' : ''} 한컴의 메모 풍선 모양 자체는 재현하지 않습니다.</p>
    ${changes.length ? changes.map(card).join('') : '<p class="no-results">메모의 추가·삭제·수정이 없습니다.</p>'}
    ${stats.unchanged ? `<details class="unchanged-memos"><summary>동일한 메모 ${stats.unchanged}개 보기</summary>${diffs.filter(d => d.type === 'unchanged').map(card).join('')}</details>` : ''}</section>`;
}

export function exportHtml(result) {
  const changes = result.diffs.filter(d => d.type !== 'unchanged');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>문서 신구대조표</title><style>
  body{font:15px/1.7 system-ui,sans-serif;color:#202a30;margin:40px auto;max-width:1100px;padding:0 24px}h1{font-size:28px}p{overflow-wrap:anywhere}.diff-card{border:1px solid #ddd;border-radius:8px;margin:20px 0;break-inside:avoid;overflow:hidden}.diff-heading{padding:10px 16px;background:#f7f7f5;display:flex;gap:14px}.diff-columns{display:grid;grid-template-columns:1fr 1fr}.diff-columns section{padding:16px;min-width:0}.before{border-right:1px solid #ddd}.location,.table-meta{font-size:12px;color:#657076}.block-text,td{white-space:pre-wrap;overflow-wrap:anywhere}mark{color:inherit;border-radius:2px}.removed{background:#fbe2df}.added{background:#d6eee4}.type-badge{font-size:12px;padding:1px 8px;border-radius:4px}.modified{background-color:#fffaf0}.diff-card.modified{background:white}.doc-table{width:100%;border-collapse:collapse;font-size:13px}td{border:1px solid #ddd;padding:8px}.cell-before{background:#fff1ef}.cell-after{background:#edf8f2}.merge-note{display:block;color:#8c510d}.empty-block{color:#888}.parse-warning{background:#fff4d8;padding:16px}.table-scroll{overflow:auto}.footnote{font-size:12px}li{margin:5px 0}@media print{body{max-width:none;margin:0;padding:0;font-size:11px}.diff-card{break-inside:auto}mark{-webkit-print-color-adjust:exact;print-color-adjust:exact}thead{display:table-header-group}}@page{size:A4 landscape;margin:12mm}
  .memo-card{border:1px solid #ddd;margin:18px 0;break-inside:avoid}.memo-card section{padding:14px}.memo-text{white-space:pre-wrap;overflow-wrap:anywhere}.memo-context,.memo-meta{padding:10px;font-size:12px}.memo-scope{font-size:12px;color:#657076}
  </style></head><body><h1>문서 신구대조표</h1><p>구버전: ${escapeHtml(result.documents.before.name)}<br>신버전: ${escapeHtml(result.documents.after.name)}</p>
  <p>추가 ${result.stats.added} · 삭제 ${result.stats.removed} · 수정 ${result.stats.modified} · 동일 ${result.stats.unchanged} (블록 기준)</p>
  <p>${escapeHtml(result.engine)} · ${escapeHtml(result.createdAt)} · 실제 내용의 일치 여부로 판정 · LLM 미사용</p>
  ${warningsHtml(result)}<ul>${result.limitations.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
  ${result.annotations ? annotationsHtml(result.annotations) : ''}
  ${changes.length ? changes.map(d => renderDiff(d, result.documents)).join('') : '<p>비교 대상 본문·표에서 변경을 찾지 못했습니다. 문서 전체가 동일하다는 판정은 아닙니다.</p>'}
  <p>동일한 블록 ${result.stats.unchanged}개는 이 대조표에서 생략했습니다.</p></body></html>`;
}
