export function canvasWidth(page, availableWidth, availableHeight, zoom) {
  if (![page?.width, page?.height, availableWidth, availableHeight].every(Number.isFinite) || page.width <= 0 || page.height <= 0 || availableWidth <= 0 || availableHeight <= 0) return null;
  const width = Math.max(1, availableWidth), height = Math.max(1, availableHeight);
  if (zoom === 'page') return Math.max(1, Math.floor(Math.min(width, height * page.width / page.height)));
  if (zoom === 'fit') return Math.floor(width);
  const percent = Number(zoom);
  return Number.isFinite(percent) && percent > 0 ? Math.floor(page.width * 96 / 72 * percent / 100) : null;
}

export function validatePageInput(value, current, total) {
  const page = Number(value), valid = String(value).trim() !== '' && Number.isSafeInteger(page) && page >= 1 && page <= total;
  return { valid, page: valid ? page : current, message: valid ? '' : `1~${total}쪽을 입력하세요. ${current}쪽으로 되돌렸습니다.` };
}

// Kordoc scene coordinates are page-local points. Never move an invalid box
// to a guessed page: intersect it with its declared page and drop empty areas.
export function clipPageBoxes(boxes, page) {
  const unique = new Map();
  if (!page || !Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0) return [];
  for (const box of boxes ?? []) {
    if (box.page !== page.page || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) continue;
    const x = Math.max(0, box.x), y = Math.max(0, box.y);
    const width = Math.min(page.width, box.x + box.width) - x, height = Math.min(page.height, box.y + box.height) - y;
    if (width <= 0 || height <= 0) continue;
    const key = [x, y, width, height].map(n => n.toFixed(3)).join(':');
    if (!unique.has(key)) unique.set(key, { ...box, x, y, width, height });
  }
  return [...unique.values()];
}

// Show one useful notice, not several descriptions of the same renderer failure.
export function previewNotice(data, location) {
  if (data?.rendering?.unmatchedTextCount || location?.reason === 'text-unmatched') return {
    title: '미리보기에 일부 글이 보이지 않을 수 있습니다.',
    message: '정확한 내용은 원본 파일에서 확인하세요.',
  };
  if (data?.rendering?.invalidBoxCount || ['partial', 'partial-text'].includes(location?.status)) return {
    title: '일부 변경 위치에 색 표시를 하지 못했습니다.',
    message: '내용 비교에서 변경 내용을 확인하세요.',
  };
  if (location?.status === 'unresolved') return {
    title: '이 변경 위치를 찾지 못했습니다.',
    message: '내용 비교에서 바뀐 문구를 확인하세요.',
  };
  if (location?.status === 'table') return {
    title: '변경된 칸을 정확히 찾지 못했습니다.',
    message: '표의 시작 위치를 표시했습니다. 다음 쪽도 확인하세요.',
  };
  const warnings = (data?.warnings ?? []).join(' ');
  if (/수식/.test(warnings)) return { title: '일부 수식이 보이지 않을 수 있습니다.', message: '수식은 원본 파일에서 확인하세요.' };
  if (/글꼴|폰트/.test(warnings)) return { title: '글자 모양이 원본과 다를 수 있습니다.', message: '정확한 모양은 원본 파일에서 확인하세요.' };
  if (/여러 쪽|분할|region/.test(warnings)) return { title: '표가 여러 쪽에 이어집니다.', message: '다음 쪽도 확인하세요.' };
  if (warnings) return { title: '미리보기가 원본과 다를 수 있습니다.', message: '내용이 이상하면 원본 파일에서 확인하세요.' };
  return { title: '', message: '' };
}
