import { DOMParser } from '@xmldom/xmldom';

const normalize = text => (text ?? '').normalize('NFC').replace(/\\\$/g, '$').replace(/\s+/gu, '');
const textOf = block => [block.text, ...(block.table?.cells ?? []).flat().filter(Boolean).map(c => c.text)].filter(Boolean).join('');

// Read only the renderer's own group IDs and text. Never execute document markup.
export function locateChanges(scene, pageSvgs, targets) {
  const byId = new Map(scene.regions.map(r => [r.id, { ...r, text: '' }]));
  for (const svg of pageSvgs.values()) {
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml');
    for (const group of Array.from(root.getElementsByTagName('g'))) {
      const region = byId.get(group.getAttribute('data-kordoc-id'));
      if (!region) continue;
      region.text += Array.from(group.getElementsByTagName('text')).map(el => el.textContent).join('');
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
  const boxes = list => list.flatMap(r => r.regions).filter(b => {
    const page = scene.pages.find(p => p.page === b.page);
    return page && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0 && b.y < page.height && b.x < page.width;
  }).map(b => {
    const page = scene.pages.find(p => p.page === b.page);
    const x = Math.max(0, b.x), y = Math.max(0, b.y);
    return { page: b.page, x, y, width: Math.min(page.width, b.x + b.width) - x, height: Math.min(page.height, b.y + b.height) - y };
  }).filter(b => b.width > 0 && b.height > 0);
  return targets.map(target => {
    const base = { id: target.id, type: target.type };
    if (!target.block) return { ...base, boxes: [], status: 'absent', message: '이 버전에는 해당 내용이 없습니다.' };
    const region = findRegion(target);
    if (!region) return { ...base, boxes: [], status: 'unresolved', message: '정확한 위치를 찾지 못했습니다. 옆의 변경 문구와 원본을 함께 확인해 주세요.' };
    let found = [region], status = 'paragraph', message = '변경된 문단을 표시했습니다.';
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
    return { ...base, boxes: located, status: located.length ? status : 'unresolved', message: located.length ? message : '표시 가능한 위치를 찾지 못했습니다. 변경 문구를 확인해 주세요.' };
  });
}

export function friendlyWarnings(warnings) {
  return [...new Set(warnings.map(text => /분할|region|걸친 표/.test(text)
    ? '여러 쪽에 걸친 표는 표시할 수 있는 영역으로 이동합니다. 이어지는 내용은 다음 쪽도 확인해 주세요.'
    : /수식/.test(text) ? '일부 수식은 미리보기에 표시되지 않을 수 있습니다.'
    : /글꼴|폰트/.test(text) ? '원본 글꼴이 없어 글자 모양이나 줄바꿈이 달라질 수 있습니다.'
    : '일부 내용의 모양이나 위치가 원본과 다를 수 있습니다. 원본 문서와 함께 확인해 주세요.'))];
}
