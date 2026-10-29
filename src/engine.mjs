// Set before loading Kordoc, including when this module is used from tests.
process.env.KORDOC_OFFLINE = '1';
process.env.ORT_DISABLE_TELEMETRY = '1';
const { parse, diffBlocks, VERSION } = await import('kordoc');

export const LIMITATIONS = [
  '본문과 표의 내용·병합 구조를 비교합니다. 글꼴·색상·여백·그림·도장과 그림 속 글자는 비교하지 않습니다.',
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
  if (block.footnoteBlocks?.length) out.footnoteBlocks = block.footnoteBlocks.map(content);
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
      if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({
        row: r + 1, col: c + 1, type: !a ? 'added' : !b ? 'removed' : 'modified',
        before: a, after: b,
      });
    }
  }
  return changes;
}

export function compareBlocks(before, after, metadata = {}) {
  if (before.length > 2000 || after.length > 2000 || before.length * after.length > 2_000_000) {
    throw new Error('문단 수가 첫 버전의 처리 한도를 넘습니다. 문서를 나누어 비교해 주세요.');
  }
  // Unsupported objects must not participate in alignment or change counts.
  const aligned = diffBlocks(before.filter(b => b.type !== 'image'), after.filter(b => b.type !== 'image'));
  const stats = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  const oldIndexes = new Map(before.map((b, i) => [b, i + 1]));
  const newIndexes = new Map(after.map((b, i) => [b, i + 1]));
  const diffs = aligned.diffs.map((pair, index) => {
    const a = content(pair.before), b = content(pair.after);
    // Kordoc 4.24.18 treats >= .99 similarity as unchanged. Use exact equality
    // AFTER alignment so a one-digit change in a long paragraph is never hidden.
    const type = !a ? 'added' : !b ? 'removed'
      : JSON.stringify(a) === JSON.stringify(b) ? 'unchanged' : 'modified';
    stats[type]++;
    return {
      id: index + 1, type, before: a, after: b,
      oldIndex: oldIndexes.get(pair.before) ?? null, newIndex: newIndexes.get(pair.after) ?? null,
      oldPage: pair.before?.pageNumber ?? null, newPage: pair.after?.pageNumber ?? null,
      cells: a?.table && b?.table ? cellChanges(a.table, b.table) : [],
    };
  });
  return { stats, diffs, unsupported: { before: imageInventory(before), after: imageInventory(after) }, ...metadata };
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

export async function compareDocuments(oldFile, newFile) {
  const a = await readDocument(oldFile.bytes, oldFile.name);
  const b = await readDocument(newFile.bytes, newFile.name);
  const document = (result, file) => ({
    name: file.name, size: file.bytes.length, format: result.fileType,
    pageMode: result.metadata?.pageMode ?? 'section', blocks: result.blocks.length,
  });
  return compareBlocks(a.blocks, b.blocks, {
    engine: `kordoc ${VERSION}`, createdAt: new Date().toISOString(),
    documents: { before: document(a, oldFile), after: document(b, newFile) },
    warnings: [
      ...(a.warnings ?? []).map(w => ({ ...w, document: '구버전' })),
      ...(b.warnings ?? []).map(w => ({ ...w, document: '신버전' })),
    ],
    limitations: LIMITATIONS,
  });
}
