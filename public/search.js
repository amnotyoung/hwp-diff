import { findOccurrences } from './text-diff.js';

const searchable = new Set(['cell-value', 'block-text', 'memo-text', 'cell-text', 'caption-text', 'footnote-text', 'format-excerpt']);
const classes = node => (node.getAttribute?.('class') ?? '').split(/\s+/);
function visit(node, callback) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (callback(child) !== false) visit(child, callback);
  }
}
function textNodes(container) {
  const nodes = []; let text = '';
  visit(container, node => {
    if (node.nodeType === 3) { nodes.push({ node, start: text.length }); text += node.nodeValue; }
  });
  return { nodes, text };
}

// Index and highlights share the same text; folded duplicate copies are excluded.
export function searchMatches(root, query) {
  const matches = [];
  if (!query) return matches;
  visit(root, node => {
    const names = classes(node);
    if (names.includes('full-context') || names.includes('cell-context')) return false;
    if (names.some(name => searchable.has(name))) {
      const { nodes, text } = textNodes(node), ranges = findOccurrences(text, query);
      if (ranges.length) matches.push({ nodes, ranges });
      return false;
    }
  });
  return matches;
}

export function buildSearchIndex(diffs, query, renderRoot) {
  const hits = [], offsets = new Map();
  if (!query) return { hits, offsets };
  for (const diff of diffs) {
    offsets.set(diff.id, hits.length);
    for (const match of searchMatches(renderRoot(diff), query)) for (const range of match.ranges) {
      hits.push({ id: hits.length, diffId: diff.id, range });
    }
  }
  return { hits, offsets };
}

// A match spanning diff marks remains one logical hit with one stable global ID.
export function markSearch(root, query, startId = 0) {
  const doc = root.ownerDocument, oldMarks = [];
  visit(root, node => { if (classes(node).includes('search-hit')) oldMarks.push(node); });
  for (const mark of oldMarks) mark.parentNode.replaceChild(doc.createTextNode(mark.textContent), mark);
  root.normalize();
  const hits = [];
  for (const match of searchMatches(root, query)) {
    const ranges = match.ranges.map(([start, end]) => {
      const hit = { id: startId + hits.length, elements: [] }; hits.push(hit);
      return { start, end, hit };
    });
    for (const { node, start } of match.nodes) {
      const value = node.nodeValue, relevant = ranges.filter(r => r.start < start + value.length && r.end > start);
      if (!relevant.length) continue;
      const fragment = doc.createDocumentFragment(); let offset = 0;
      for (const r of relevant) {
        const from = Math.max(0, r.start - start), to = Math.min(value.length, r.end - start);
        fragment.appendChild(doc.createTextNode(value.slice(offset, from)));
        const mark = doc.createElement('mark'); mark.setAttribute('class', 'search-hit'); mark.setAttribute('data-search-hit', String(r.hit.id));
        mark.appendChild(doc.createTextNode(value.slice(from, to)));
        fragment.appendChild(mark); r.hit.elements.push(mark); offset = to;
      }
      fragment.appendChild(doc.createTextNode(value.slice(offset))); node.parentNode.replaceChild(fragment, node);
    }
  }
  return { hits };
}
