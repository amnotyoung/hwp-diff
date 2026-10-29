export function canvasWidth(page, availableWidth, availableHeight, zoom) {
  if (![page?.width, page?.height, availableWidth, availableHeight].every(Number.isFinite) || page.width <= 0 || page.height <= 0 || availableWidth <= 0 || availableHeight <= 0) return null;
  const width = Math.max(1, availableWidth), height = Math.max(1, availableHeight);
  if (zoom === 'page') return Math.max(1, Math.floor(Math.min(width, height * page.width / page.height)));
  if (zoom === 'fit') return Math.floor(width);
  const percent = Number(zoom);
  return Number.isFinite(percent) && percent > 0 ? Math.floor(page.width * 96 / 72 * percent / 100) : null;
}
