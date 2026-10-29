import { DOMParser } from '@xmldom/xmldom';
import { normalizeText } from '../public/text-diff.js';

const normalize = text => (text ?? '').normalize('NFC').replace(/\\\$/g, '$').replace(/\s+/gu, '');
const textOf = block => [block.text, ...(block.table?.cells ?? []).flat().filter(Boolean).map(c => c.text)].filter(Boolean).join('');

// Read only the renderer's own group IDs and text. Never execute document markup.
export function locateChanges(scene, pageSvgs, targets, search = '') {
  const byId = new Map(scene.regions.map(r => [r.id, { ...r, text: '', fragments: [] }]));
  for (const [page, svg] of pageSvgs) {
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml');
    for (const group of Array.from(root.getElementsByTagName('g'))) {
      const region = byId.get(group.getAttribute('data-kordoc-id'));
      if (!region) continue;
      const text = Array.from(group.getElementsByTagName('text')).map(el => el.textContent).join('');
      region.fragments.push({ page, text }); region.text += text;
    }
  }
  const regions = [...byId.values()];
  function parentTable(region) {
    let parent = byId.get(region.parentId);
    while (parent) {
      if (parent.type === 'table') return parent.id;
      parent = byId.get(parent.parentId);
    }
    return null;
  }
  function findRegion(target) {
    const table = target.block.table;
    const candidates = regions.filter(r => r.type === (table ? 'table' : 'paragraph') && !parentTable(r));
    if (table && target.anchor?.sourceId) {
      const exact = candidates.filter(r => r.sourceId === target.anchor.sourceId);
      if (exact.length === 1) return exact[0];
    }
    const needle = normalize(textOf(target.block));
    if (!needle) return null;
    const exact = candidates.filter(r => normalize(r.text) === needle);
    if (exact.length) {
      if (table) return exact.length === 1 ? exact[0] : null;
      if (target.anchor?.count != null && exact.length !== target.anchor.count) return null;
      if (exact.length > 1 && target.anchor?.count == null) return null;
      return exact[target.anchor?.occurrence ?? 0] ?? null;
    }
    // Numbering may be added by the renderer. Only accept an unambiguous match.
    const containing = candidates.filter(r => needle.length >= 8 && normalize(r.text).includes(needle));
    return containing.length === 1 ? containing[0] : null;
  }
  function cellRegions(table, region) {
    const paragraphs = regions.filter(r => r.type === 'paragraph' && parentTable(r) === region.id && normalize(r.text));
    let cursor = 0;
    const mapped = new Map();
    for (let r = 0; r < table.cells.length; r++) {
      for (let c = 0; c < table.cells[r].length; c++) {
        const cell = table.cells[r][c];
        if (!cell || cell.rowSpan === 0 || cell.colSpan === 0) continue;
        const needle = normalize(cell.text);
        if (!needle) continue;
        let text = '', matches = [];
        while (cursor < paragraphs.length && text.length < needle.length) {
          const p = paragraphs[cursor++]; text += normalize(p.text); matches.push(p);
        }
        // Do not guess a row when repeated values or a missing object break alignment.
        if (text !== needle) return null;
        mapped.set(`${r + 1}:${c + 1}`, matches);
      }
    }
    return cursor === paragraphs.length ? mapped : null;
  }
  function anchorBoxes(anchors, candidates) {
    const found = []; let missing = 0;
    for (const anchor of anchors) {
      const context = normalizeText(anchor.context); if (!context) { missing++; continue; }
      let matches = candidates.filter(r => normalize(r.text) === context);
      if (!matches.length && context.length >= 8) matches = candidates.filter(r => normalize(r.text).includes(context));
      if (matches.length !== 1) { missing++; continue; }
      const region = matches[0], text = normalize(region.text), at = text.indexOf(context);
      if (text.lastIndexOf(context) !== at) { missing++; continue; }
      const start = at + anchor.start, end = at + anchor.end;
      let offset = 0, matched = false;
      for (const fragment of region.fragments) {
        const length = normalize(fragment.text).length;
        if (start < offset + length && end > offset) {
          found.push(...region.regions.filter(b => b.page === fragment.page)); matched = true;
        }
        offset += length;
      }
      if (!matched) missing++;
    }
    return { boxes: [...new Map(found.map(b => [JSON.stringify(b), b])).values()], missing };
  }
  function findMemoParts(memo) {
    const parts = memo.anchorParts?.length ? memo.anchorParts : [{ text: memo.anchorText || memo.context, context: memo.context, tableSourceId: memo.tableSourceId }];
    const found = new Map(); let missing = 0;
    for (const part of parts) {
      let candidates = regions.filter(r => r.type === 'paragraph' && normalize(r.text));
      if (part.tableSourceId) candidates = candidates.filter(r => {
        for (let p = byId.get(r.parentId); p; p = byId.get(p.parentId)) if (p.type === 'table' && p.sourceId === part.tableSourceId) return true;
        return false;
      });
      const context = normalize(part.context), needle = normalize(part.text);
      // Use the full containing paragraph first, scoped to the source table.
      // This avoids jumping to the first occurrence of a short repeated label.
      let matches = context ? candidates.filter(r => normalize(r.text) === context) : [];
      if (!matches.length && context.length >= 8) matches = candidates.filter(r => normalize(r.text).includes(context));
      if (!matches.length && needle) matches = candidates.filter(r => normalize(r.text) === needle);
      if (!matches.length && needle.length >= 8) matches = candidates.filter(r => normalize(r.text).includes(needle));
      if (matches.length === 1) found.set(matches[0].id, matches[0]);
      else missing++;
    }
    return { found: [...found.values()], missing };
  }
  const boxes = list => list.flatMap(r => r.regions).filter(b => {
    const page = scene.pages.find(p => p.page === b.page);
    return page && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0 && b.y < page.height && b.x < page.width;
  }).map(b => {
    const page = scene.pages.find(p => p.page === b.page);
    const x = Math.max(0, b.x), y = Math.max(0, b.y);
    return { page: b.page, x, y, width: Math.min(page.width, b.x + b.width) - x, height: Math.min(page.height, b.y + b.height) - y };
  }).filter(b => b.width > 0 && b.height > 0);
  const locations = targets.map(target => {
    const base = { id: target.id, type: target.type };
    if (target.category === 'memo') {
      const memoBase = { ...base, category: 'memo' };
      if (!target.memo) return { ...memoBase, boxes: [], status: 'absent', message: '이 버전에는 해당 메모가 없습니다.' };
      const { found, missing } = findMemoParts(target.memo);
      const located = boxes(found).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
      return { ...memoBase, boxes: located, status: !located.length ? 'unresolved' : missing ? 'partial' : 'memo', message: !located.length
        ? '메모가 연결된 위치를 정확히 찾지 못했습니다. 옆의 연결 문구와 원본을 확인해 주세요.'
        : missing ? '메모가 연결된 문단 중 위치를 확인한 부분만 표시했습니다. 전체 연결 문구는 옆에서 확인해 주세요.'
        : '메모가 연결된 문단을 보라색으로 표시했습니다.' };
    }
    if (!target.block) return { ...base, boxes: [], status: 'absent', message: '이 버전에는 해당 내용이 없습니다.' };
    const region = findRegion(target);
    if (!region) return { ...base, boxes: [], status: 'unresolved', message: '정확한 위치를 찾지 못했습니다. 옆의 변경 문구와 원본을 함께 확인해 주세요.' };
    let found = [region], status = 'paragraph', message = '변경된 문단을 표시했습니다.';
    const anchors = target.block.table ? (target.cells ?? []).flatMap(c => c.anchors ?? []) : target.textAnchors ?? [];
    if (anchors.length) {
      const cells = target.block.table ? cellRegions(target.block.table, region) : null;
      const scoped = target.block.table ? regions.filter(r => {
        if (r.type !== 'paragraph') return false;
        for (let p = byId.get(r.parentId); p; p = byId.get(p.parentId)) if (p.id === region.id) return true;
        return false;
      }) : [region];
      let located = [], missing = 0;
      if (target.block.table) for (const cell of target.cells ?? []) {
        const match = anchorBoxes(cell.anchors ?? [], cells?.get(`${cell.row}:${cell.col}`) ?? scoped);
        located.push(...match.boxes); missing += match.missing;
      } else { const match = anchorBoxes(anchors, scoped); located = match.boxes; missing = match.missing; }
      if (located.length) {
        const contextOnly = anchors.every(a => a.contextOnly);
        return { ...base, boxes: located.sort((a, b) => a.page - b.page || a.y - b.y), status: contextOnly ? 'context' : missing ? 'partial-text' : target.block.table ? 'cells' : 'paragraph',
          navigationLabel: contextOnly ? '주변 문맥 보기' : '변경 위치 보기',
          message: contextOnly ? '이 버전에는 해당 변경 문구가 없어 주변 문맥을 표시했습니다.' : missing ? '위치를 확인한 변경 문구만 표시했습니다.' : '변경 문구가 있는 문단을 표시했습니다.' };
      }
    }
    if (target.block.table) {
      status = 'table'; message = '변경된 표 영역을 표시했습니다.';
      if (target.cells?.length) {
        const cells = cellRegions(target.block.table, region);
        const matches = target.cells.map(c => cells?.get(`${c.row}:${c.col}`));
        if (matches.every(m => m?.length)) {
          found = matches.flat(); status = 'cells'; message = '변경된 셀의 내용을 표시했습니다.';
        } else message = '셀 위치를 정확히 연결하지 못해 표 영역을 표시했습니다. 옆의 행·열 번호를 확인해 주세요.';
      }
    }
    const located = boxes(found);
    return { ...base, boxes: located, status: located.length ? status : 'unresolved', navigationLabel: status === 'table' ? '표 시작 쪽 보기' : '변경 셀 보기', message: located.length ? message : '표시 가능한 위치를 찾지 못했습니다. 변경 문구를 확인해 주세요.' };
  });
  if (search) {
    const needle = normalize(search).toLocaleLowerCase();
    const searchMatches = regions.filter(r => r.type === 'paragraph').flatMap(r => r.fragments.filter(f => normalize(f.text).toLocaleLowerCase().includes(needle)).flatMap(f =>
      r.regions.filter(b => b.page === f.page).map(b => ({ ...b, id: `${r.id}:${f.page}`, text: f.text.slice(0, 200) }))));
    return { locations, searchMatches };
  }
  return locations;
}

export function friendlyWarnings(warnings) {
  return [...new Set(warnings.map(text => /분할|region|걸친 표/.test(text)
    ? '여러 쪽에 걸친 표는 표시할 수 있는 영역으로 이동합니다. 이어지는 내용은 다음 쪽도 확인해 주세요.'
    : /수식/.test(text) ? '일부 수식은 미리보기에 표시되지 않을 수 있습니다.'
    : /글꼴|폰트/.test(text) ? '원본 글꼴이 없어 글자 모양이나 줄바꿈이 달라질 수 있습니다.'
    : '일부 내용의 모양이나 위치가 원본과 다를 수 있습니다. 원본 문서와 함께 확인해 주세요.'))];
}
