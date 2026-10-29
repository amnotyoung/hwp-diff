import { findOccurrences } from './text-diff.js';

// Mark text nodes, never parse user text as markup. A match spanning diff marks
// remains one logical search hit even when it uses multiple DOM fragments.
export function markSearch(root, query) {
  for (const mark of root.querySelectorAll('mark.search-hit')) mark.replaceWith(document.createTextNode(mark.textContent));
  const hits = []; let truncated = false;
  if (!query) return { hits, truncated };
  for (const container of root.querySelectorAll('.cell-value, .block-text, .memo-text')) {
    if (container.closest('.full-context, .cell-context')) continue;
    container.normalize();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT), nodes = [];
    let node, text = '';
    while ((node = walker.nextNode())) { nodes.push({ node, start: text.length }); text += node.nodeValue; }
    const matches = findOccurrences(text, query);
    const ranges = matches.slice(0, 1000 - hits.length).map(([start, end]) => {
      const hit = { id: hits.length, elements: [] }; hits.push(hit); return { start, end, hit };
    });
    if (ranges.length < matches.length) truncated = true;
    for (const { node, start } of nodes) {
      const value = node.nodeValue, relevant = ranges.filter(r => r.start < start + value.length && r.end > start);
      if (!relevant.length) continue;
      const fragment = document.createDocumentFragment(); let offset = 0;
      for (const r of relevant) {
        const from = Math.max(0, r.start - start), to = Math.min(value.length, r.end - start);
        fragment.append(document.createTextNode(value.slice(offset, from)));
        const mark = document.createElement('mark'); mark.className = 'search-hit'; mark.dataset.searchHit = String(r.hit.id); mark.textContent = value.slice(from, to);
        fragment.append(mark); r.hit.elements.push(mark); offset = to;
      }
      fragment.append(document.createTextNode(value.slice(offset))); node.replaceWith(fragment);
    }
    if (hits.length >= 1000) break;
  }
  return { hits, truncated };
}
