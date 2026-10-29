export function canvasWidth(page, availableWidth, availableHeight, zoom) {
  if (![page?.width, page?.height, availableWidth, availableHeight].every(Number.isFinite) || page.width <= 0 || page.height <= 0 || availableWidth <= 0 || availableHeight <= 0) return null;
  const width = Math.max(1, availableWidth), height = Math.max(1, availableHeight);
  if (zoom === 'page') return Math.max(1, Math.floor(Math.min(width, height * page.width / page.height)));
  if (zoom === 'fit') return Math.floor(width);
  const percent = Number(zoom);
  return Number.isFinite(percent) && percent > 0 ? Math.floor(page.width * 96 / 72 * percent / 100) : null;
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
