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

// Longest chain of anchor pairs whose positions increase in both versions.
function increasingChain(pairs) {
  const tails = [], previous = new Array(pairs.length);
  pairs.forEach(([, j], index) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < j) lo = mid + 1; else hi = mid; }
    previous[index] = lo ? tails[lo - 1] : -1; tails[lo] = index;
  });
  const chain = [];
  for (let k = tails.at(-1) ?? -1; k >= 0; k = previous[k]) chain.push(pairs[k]);
  return chain.reverse();
}
// Kordoc's alignment checks every pair of blocks, which took 15 seconds for
// two 150-page reports. Blocks identical in both versions and occurring once
// in each are fixed first; Kordoc then aligns only the gaps between them.
export function alignBlocks(a, b) {
  const keyA = a.map(block => JSON.stringify(block)), keyB = b.map(block => JSON.stringify(block));
  const count = keys => keys.reduce((counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1), new Map());
  const countA = count(keyA), countB = count(keyB), positionB = new Map(keyB.map((key, j) => [key, j]));
  const anchors = increasingChain(keyA.flatMap((key, i) => countA.get(key) === 1 && countB.get(key) === 1 ? [[i, positionB.get(key)]] : []));
  const diffs = [];
  let ai = 0, bi = 0;
  for (const [i, j] of [...anchors, [a.length, b.length]]) {
    if (i > ai || j > bi) diffs.push(...diffBlocks(a.slice(ai, i), b.slice(bi, j)).diffs);
    if (i < a.length) diffs.push({ before: a[i], after: b[j] });
    ai = i + 1; bi = j + 1;
  }
  return { diffs };
}

// Alignment keeps document order, so two swapped sections are paired with
// each other's places and look rewritten. After alignment, a changed block is
// re-linked to a clearly better partner of the same kind; a re-linked pair
// that crosses another pair is reported as a move.
const MOVE_SIMILARITY = 0.4, MOVE_MARGIN = 0.15, MOVE_PAIR_LIMIT = 250_000, MOVE_MIN_CHARS = 20;
const similarityText = block => [block.text, block.footnoteText, ...(block.children ?? []).map(similarityText),
  ...(block.table?.cells ?? []).flat().filter(Boolean).map(cell => cell.text)].filter(Boolean).join('\n');
function bigrams(text) {
  const chars = Array.from(text.replace(/\s+/gu, '')), counts = new Map();
  for (let i = 0; i < chars.length - 1; i++) { const gram = chars[i] + chars[i + 1]; counts.set(gram, (counts.get(gram) ?? 0) + 1); }
  return { counts, size: Math.max(0, chars.length - 1) };
}
// Dice coefficient of character pairs; `floor` skips pairs that cannot reach it.
function dice(x, y, floor = 0) {
  if (!x.size || !y.size) return x.size === y.size ? 1 : 0;
  if (2 * Math.min(x.size, y.size) / (x.size + y.size) < floor) return 0;
  const [small, large] = x.counts.size <= y.counts.size ? [x, y] : [y, x];
  let common = 0;
  for (const [gram, n] of small.counts) common += Math.min(n, large.counts.get(gram) ?? 0);
  return 2 * common / (x.size + y.size);
}
export function relinkMoves(pairs, olds, news) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const partnerOfOld = new Map(), partnerOfNew = new Map();
  for (const p of pairs) if (p.before && p.after) { partnerOfOld.set(p.before, p.after); partnerOfNew.set(p.after, p.before); }
  const oldCandidates = pairs.filter(p => p.before && (!p.after || !same(p.before, p.after))).map(p => p.before);
  const newCandidates = pairs.filter(p => p.after && (!p.before || !same(p.before, p.after))).map(p => p.after);
  if (!oldCandidates.length || !newCandidates.length || oldCandidates.length * newCandidates.length > MOVE_PAIR_LIMIT) return pairs.map(p => ({ ...p, moved: false }));
  const profiles = new Map([...oldCandidates, ...newCandidates].map(block => [block, bigrams(similarityText(block))]));
  const similarity = (a, b, floor = 0) => !!a.table !== !!b.table ? 0 : dice(profiles.get(a), profiles.get(b), floor);
  // Short repeated labels such as '증빙1-3' say nothing about where a section
  // went. A short block is linked only when identical and unique in both versions.
  const count = blocks => blocks.reduce((counts, block) => { const key = JSON.stringify(block); return counts.set(key, (counts.get(key) ?? 0) + 1); }, new Map());
  const oldCounts = count(olds), newCounts = count(news);
  const linkable = (a, b) => Math.min(profiles.get(a).size, profiles.get(b).size) + 1 >= MOVE_MIN_CHARS
    || (same(a, b) && oldCounts.get(JSON.stringify(a)) === 1 && newCounts.get(JSON.stringify(b)) === 1);
  const scored = [];
  for (const a of oldCandidates) for (const b of newCandidates) {
    if (partnerOfOld.get(a) === b || !linkable(a, b)) continue;
    const score = similarity(a, b, MOVE_SIMILARITY);
    if (score >= MOVE_SIMILARITY) scored.push([score, a, b]);
  }
  scored.sort((x, y) => y[0] - x[0]);
  const relinkedOld = new Map(), relinkedNew = new Map();
  for (const [score, a, b] of scored) {
    if (relinkedOld.has(a) || relinkedNew.has(b)) continue;
    // Only a clearly better partner than each block's aligned partner.
    const currentA = partnerOfOld.get(a), currentB = partnerOfNew.get(b);
    if (currentA && score < similarity(a, currentA) + MOVE_MARGIN) continue;
    if (currentB && score < similarity(currentB, b) + MOVE_MARGIN) continue;
    relinkedOld.set(a, b); relinkedNew.set(b, a);
  }
  if (!relinkedOld.size) return pairs.map(p => ({ ...p, moved: false }));
  // Keep reading order: a re-linked pair appears where its new-version block is.
  const result = [];
  for (const p of pairs) {
    const keep = p.before && p.after && !relinkedOld.has(p.before) && !relinkedNew.has(p.after);
    if (keep) { result.push({ before: p.before, after: p.after, relinked: false }); continue; }
    if (p.before && !relinkedOld.has(p.before)) result.push({ before: p.before, after: null, relinked: false });
    if (p.after) result.push({ before: relinkedNew.get(p.after) ?? null, after: p.after, relinked: relinkedNew.has(p.after) });
  }
  const oldPosition = new Map(olds.map((block, i) => [block, i])), newPosition = new Map(news.map((block, i) => [block, i]));
  const linked = result.filter(p => p.before && p.after);
  return result.map(({ relinked, ...p }) => ({ ...p, moved: relinked && linked.some(q => q !== p && (oldPosition.get(q.before) - oldPosition.get(p.before)) * (newPosition.get(q.after) - newPosition.get(p.after)) < 0) }));
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
  const olds = comparable(before), news = comparable(after);
  const aligned = { diffs: relinkMoves(alignBlocks(olds, news).diffs.map(d => ({ before: d.before ?? null, after: d.after ?? null })), olds, news) };
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
    const type = pair.moved && contentType === 'unchanged' ? 'moved' : contentType === 'unchanged' && structure.length ? 'structure' : contentType;
    stats[contentType]++;
    return {
      id: index + 1, type, contentType, before: a, after: b, structureChanges: structure, moved: !!pair.moved,
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
  // Say where a moved block used to be, by the item that preceded it in the old version.
  for (const d of diffs) if (d.moved) {
    const previous = diffs.filter(x => x.oldIndex != null && x.oldIndex < d.oldIndex).reduce((best, x) => !best || x.oldIndex > best.oldIndex ? x : best, null);
    d.movedAfter = previous?.id ?? null;
  }
  for (const group of candidateGroups.values()) if (group.added.length === 1 && group.removed.length === 1) {
    const old = group.removed[0], fresh = group.added[0];
    old.counterpart = { id: fresh.id, label: group.label }; fresh.counterpart = { id: old.id, label: group.label };
  }
  return { stats, diffs, structureStats: { changed: diffs.filter(d => d.structureChanges.length).length }, moveStats: { moved: diffs.filter(d => d.moved).length }, unsupported: { before: imageInventory(before), after: imageInventory(after) }, ...metadata };
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
