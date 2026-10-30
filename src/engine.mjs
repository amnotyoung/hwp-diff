// Set before loading Kordoc, including when this module is used from tests.
process.env.KORDOC_OFFLINE = '1';
process.env.ORT_DISABLE_TELEMETRY = '1';
const { parse, diffBlocks, VERSION } = await import('kordoc');
import { compareAnnotations } from './annotations.mjs';
import { compareFormatting } from './formatting.mjs';
import { paragraphHeading, semanticContent, sameContent, cellDiffers } from '../public/text-diff.js';

export const LIMITATIONS = [
  '본문과 표의 내용·병합 구조를 비교합니다. HWPX의 글자색·글꼴·자간·장평은 서식 탭에서 별도로 비교합니다. 여백·그림·도장과 그림 속 글자는 비교하지 않습니다.',
  '문단 이동은 삭제·추가로 표시될 수 있습니다. 표 셀은 같은 행·열 위치끼리 비교하므로 행 삽입 시 후속 셀도 변경으로 표시될 수 있습니다.',
  '쪽 번호는 문서에 저장된 정보를 사용합니다. 조판 정보가 없으면 쪽 대신 섹션 근사 위치를 표시합니다.',
];

// Keep only the content we actually compare and display. Never forward image bytes or HTML.
export function content(block) {
  if (!block || block.type === 'image') return null;
  const out = { type: block.type, text: block.text ?? '' };
  const children = block.children?.map(content).filter(Boolean);
  if (children?.length) out.children = children;
  if (block.footnoteText) out.footnoteText = block.footnoteText;
  const notes = block.footnoteBlocks?.map(content).filter(Boolean);
  if (notes?.length) out.footnoteBlocks = notes;
  if (block.table) {
    const t = block.table;
    out.table = {
      rows: t.rows, cols: t.cols, caption: t.caption ?? '',
      captionBlocks: t.captionBlocks?.map(content).filter(Boolean) ?? [],
      cells: t.cells.map(row => row.map(cell => cell ? {
        text: cell.blocks?.some(hasImage) ? cell.blocks.map(content).filter(Boolean).map(plainContent).join('\n') : cell.text ?? '',
        rowSpan: cell.rowSpan ?? 1, colSpan: cell.colSpan ?? 1,
        blocks: cell.blocks?.map(content).filter(Boolean) ?? [],
      } : null)),
    };
  }
  return out;
}

function plainContent(block) {
  return [block.text, ...(block.children ?? []).map(plainContent),
    ...(block.table?.cells ?? []).flat().filter(Boolean).map(c => c.text)].filter(Boolean).join('\n');
}

function hasImage(block) {
  return block.type === 'image' || (block.children ?? []).some(hasImage) ||
    (block.table?.cells ?? []).flat().some(c => c?.blocks?.some(hasImage));
}

function imageInventory(blocks) {
  const images = [];
  function visit(block, blockIndex, path) {
    if (block.type === 'image') images.push({ blockIndex, path });
    for (const key of ['children', 'footnoteBlocks']) (block[key] ?? []).forEach((child, i) => visit(child, blockIndex, `${path}/${key}/${i + 1}`));
    (block.table?.captionBlocks ?? []).forEach((child, i) => visit(child, blockIndex, `${path}/caption/${i + 1}`));
    (block.table?.cells ?? []).forEach((row, r) => row.forEach((cell, c) => (cell?.blocks ?? []).forEach((child, i) => visit(child, blockIndex, `${path}/${r + 1}행/${c + 1}열/${i + 1}`))));
  }
  blocks.forEach((block, i) => visit(block, i + 1, `${i + 1}번 항목`));
  return images;
}

function cellChanges(before, after) {
  const changes = [];
  for (let r = 0; r < Math.max(before.rows, after.rows); r++) {
    for (let c = 0; c < Math.max(before.cols, after.cols); c++) {
      const a = before.cells[r]?.[c] ?? null;
      const b = after.cells[r]?.[c] ?? null;
      if (cellDiffers(a, b)) changes.push({
        row: r + 1, col: c + 1, type: !a ? 'added' : !b ? 'removed' : 'modified',
        before: a, after: b,
      });
    }
  }
  return changes;
}

const textKinds = new Set(['paragraph', 'heading', 'list']);
function structureChanges(before, after, path = '본문') {
  if (!before || !after) return [];
  const changes = [];
  const shape = b => ({ type: b.type, ...(b.level != null ? { level: b.level } : {}), ...(b.listType ? { listType: b.listType } : {}) });
  if (textKinds.has(before.type) && textKinds.has(after.type) && before.text === after.text && JSON.stringify(shape(before)) !== JSON.stringify(shape(after))) changes.push({ path, text: before.text ?? '', before: shape(before), after: shape(after) });
  for (const key of ['children', 'footnoteBlocks']) for (let i = 0; i < Math.min(before[key]?.length ?? 0, after[key]?.length ?? 0); i++) changes.push(...structureChanges(before[key][i], after[key][i], `${path} / 문단 ${i + 1}`));
  if (before.table && after.table) for (let r = 0; r < Math.min(before.table.rows, after.table.rows); r++) for (let c = 0; c < Math.min(before.table.cols, after.table.cols); c++) {
    const a = before.table.cells[r]?.[c]?.blocks ?? [], b = after.table.cells[r]?.[c]?.blocks ?? [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) changes.push(...structureChanges(a[i], b[i], `${path} / 표 ${r + 1}행 ${c + 1}열`));
  }
  return changes;
}

export function compareBlocks(before, after, metadata = {}) {
  if (before.length > 2000 || after.length > 2000 || before.length * after.length > 2_000_000) {
    throw new Error('문단 수가 첫 버전의 처리 한도를 넘습니다. 문서를 나누어 비교해 주세요.');
  }
  // Unsupported objects must not participate in alignment or change counts.
  const originals = new Map();
  const comparable = blocks => blocks.filter(b => b.type !== 'image').map(raw => {
    const projected = semanticContent(content(raw));
    // Leave table.text absent: Kordoc otherwise matches every table as empty text.
    const alignment = { ...projected, text: raw.type === 'table' ? undefined : projected.text };
    originals.set(alignment, raw); return alignment;
  });
  const aligned = diffBlocks(comparable(before), comparable(after));
  const stats = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  const oldIndexes = new Map(before.map((b, i) => [b, i + 1]));
  const newIndexes = new Map(after.map((b, i) => [b, i + 1]));
  const anchors = blocks => {
    const counts = new Map();
    const entries = blocks.map(block => {
      const key = (block.text ?? '').replace(/\s+/gu, '');
      const occurrence = counts.get(key) ?? 0; counts.set(key, occurrence + 1);
      return [block, { sourceId: block.table?.sourceId ?? null, occurrence }];
    });
    for (const [block, anchor] of entries) anchor.count = counts.get((block.text ?? '').replace(/\s+/gu, ''));
    return new Map(entries);
  };
  const oldAnchors = anchors(before), newAnchors = anchors(after);
  const diffs = aligned.diffs.map((pair, index) => {
    const rawA = originals.get(pair.before), rawB = originals.get(pair.after);
    const a = content(rawA), b = content(rawB), structure = structureChanges(rawA, rawB);
    // Kordoc 4.24.18 treats >= .99 similarity as unchanged. Use exact equality
    // AFTER alignment so a one-digit change in a long paragraph is never hidden.
    const contentType = !a ? 'added' : !b ? 'removed' : sameContent(a, b) ? 'unchanged' : 'modified';
    const type = contentType === 'unchanged' && structure.length ? 'structure' : contentType;
    stats[contentType]++;
    return {
      id: index + 1, type, contentType, before: a, after: b, structureChanges: structure,
      oldIndex: oldIndexes.get(originals.get(pair.before)) ?? null, newIndex: newIndexes.get(originals.get(pair.after)) ?? null,
      oldPage: originals.get(pair.before)?.pageNumber ?? null, newPage: originals.get(pair.after)?.pageNumber ?? null,
      oldAnchor: oldAnchors.get(originals.get(pair.before)) ?? null, newAnchor: newAnchors.get(originals.get(pair.after)) ?? null,
      cells: a?.table && b?.table ? cellChanges(a.table, b.table) : [],
    };
  });
  const candidateGroups = new Map();
  for (const d of diffs) {
    if (!['added', 'removed'].includes(d.type) || (d.before ?? d.after)?.table) continue;
    const heading = paragraphHeading((d.before ?? d.after)?.text);
    if (!heading) continue;
    const group = candidateGroups.get(heading.key) ?? { label: heading.label, added: [], removed: [] };
    group[d.type].push(d); candidateGroups.set(heading.key, group);
  }
  for (const group of candidateGroups.values()) if (group.added.length === 1 && group.removed.length === 1) {
    const old = group.removed[0], fresh = group.added[0];
    old.counterpart = { id: fresh.id, label: group.label }; fresh.counterpart = { id: old.id, label: group.label };
  }
  return { stats, diffs, structureStats: { changed: diffs.filter(d => d.structureChanges.length).length }, unsupported: { before: imageInventory(before), after: imageInventory(after) }, ...metadata };
}

async function readDocument(bytes, name) {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = await parse(data, { ocr: false, images: false, layoutTables: 'keep' });
  if (!result.success) throw new Error(`${name}: 문서를 읽을 수 없습니다. ${result.error}`);
  if (!['hwp', 'hwp3', 'hwpml', 'hwpx'].includes(result.fileType)) {
    throw new Error(`${name}: 실제 파일 형식이 HWP·HWPX가 아닙니다.`);
  }
  if (!result.blocks.length) throw new Error(`${name}: 비교할 본문이나 표를 추출하지 못했습니다.`);
  return result;
}

export const COMPARE_STEPS = ['구버전 문서를 읽는 중', '신버전 문서를 읽는 중', '문단과 표를 맞추어 비교하는 중', '메모와 서식을 비교하는 중'];
// onProgress reports the stage that is about to run, so a waiting user can
// tell slow work from a stalled screen.
export async function compareDocuments(oldFile, newFile, onProgress = () => {}) {
  const step = index => onProgress({ step: index + 1, total: COMPARE_STEPS.length, label: COMPARE_STEPS[index] });
  step(0); const a = await readDocument(oldFile.bytes, oldFile.name);
  step(1); const b = await readDocument(newFile.bytes, newFile.name);
  const document = (result, file) => ({
    name: file.name, size: file.bytes.length, format: result.fileType,
    pageMode: result.metadata?.pageMode ?? 'section', blocks: result.blocks.length,
  });
  step(2); const compared = compareBlocks(a.blocks, b.blocks);
  step(3);
  return {
    ...compared,
    engine: `kordoc ${VERSION}`, createdAt: new Date().toISOString(),
    documents: { before: document(a, oldFile), after: document(b, newFile) },
    warnings: [
      ...(a.warnings ?? []).map(w => ({ ...w, document: '구버전' })),
      ...(b.warnings ?? []).map(w => ({ ...w, document: '신버전' })),
    ],
    annotations: await compareAnnotations(oldFile, newFile, [a.fileType, b.fileType]),
    formatting: await compareFormatting(oldFile, newFile, [a.fileType, b.fileType]),
    limitations: LIMITATIONS,
  };
}
