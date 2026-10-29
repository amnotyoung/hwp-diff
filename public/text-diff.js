// Shared exact text edits for the comparison UI and original-document locations.
export function textParts(before = '', after = '') {
  const a = Array.from(before), b = Array.from(after);
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a.at(-end - 1) === b.at(-end - 1)) end++;
  let x = a.slice(start, a.length - end), y = b.slice(start, b.length - end);
  const parts = [];
  let workLimit = 250_000;
  function push(type, text) { if (!text) return; const last = parts.at(-1); if (last?.type === type) last.text += text; else parts.push({ type, text }); }
  push('equal', a.slice(0, start).join(''));
  if (x.length * y.length > 250_000) {
    // Preserve common words in long replacements without a quadratic character matrix.
    x = x.join('').match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
    y = y.join('').match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
    workLimit = 1_000_000;
  }
  if (!x.length || !y.length || x.length * y.length > workLimit) {
    push('removed', x.join('')); push('added', y.join(''));
  } else {
    const dp = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) { push('equal', x[i++]); j++; }
      else if (i < x.length && (j === y.length || dp[i + 1][j] >= dp[i][j + 1])) push('removed', x[i++]);
      else push('added', y[j++]);
    }
  }
  push('equal', end ? a.slice(-end).join('') : '');
  let old = 0, fresh = 0;
  return parts.map(p => { const result = { ...p, beforeStart: old, afterStart: fresh }; if (p.type !== 'added') old += p.text.length; if (p.type !== 'removed') fresh += p.text.length; return result; });
}

export function paragraphHeading(text) {
  const line = String(text ?? '').split('\n')[0].trim();
  const match = line.match(/^[-•●]\s*\(([^)\n]{2,70})\)/)
    ?? line.match(/^(?:[-•●]\s*)?([A-Za-z][A-Za-z0-9 /&()'’-]{2,70})\s*:/);
  const label = match?.[1]?.trim();
  return label ? { key: label.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' '), label } : null;
}

// Unique shared headings are explicit structural anchors, not semantic guesses.
export function paragraphPairs(before = '', after = '') {
  const lines = text => { let offset = 0; return text.split('\n').map((line, i, all) => {
    const value = line + (i < all.length - 1 ? '\n' : ''), heading = paragraphHeading(line);
    const row = { text: value, start: offset, heading, key: heading?.key ?? (line.length <= 80 ? `=${line.trim()}` : null) };
    offset += value.length; return row;
  }); };
  const a = lines(before), b = lines(after);
  if (a.length < 2 && b.length < 2) return [{ before, after, label: '문단', type: before === after ? 'unchanged' : !before ? 'added' : !after ? 'removed' : 'modified' }];
  const count = rows => { const m = new Map(); for (const row of rows) if (row.key) m.set(row.key, (m.get(row.key) ?? 0) + 1); return m; };
  const ac = count(a), bc = count(b), anchors = []; let last = -1;
  for (const row of a) {
    if (!row.key || ac.get(row.key) !== 1 || bc.get(row.key) !== 1) continue;
    const j = b.findIndex(r => r.key === row.key);
    if (j <= last) continue;
    anchors.push({ a: row.start, b: b[j].start, label: row.heading?.label ?? row.text.trim() }); last = j;
  }
  if (!anchors.length || anchors[0].a || anchors[0].b) anchors.unshift({ a: 0, b: 0, label: '문단' });
  const pairs = anchors.map((anchor, i) => {
    const old = before.slice(anchor.a, anchors[i + 1]?.a ?? before.length), fresh = after.slice(anchor.b, anchors[i + 1]?.b ?? after.length);
    return { before: old, after: fresh, label: anchor.label, type: old === fresh ? 'unchanged' : !old.trim() ? 'added' : !fresh.trim() ? 'removed' : 'modified' };
  });
  return pairs.filter(p => p.before || p.after);
}

export function textChanges(before = '', after = '') {
  const changes = []; let current = null;
  for (const part of textParts(before, after)) {
    if (part.type === 'equal') { current = null; continue; }
    if (!current) { current = { beforeStart: part.beforeStart, afterStart: part.afterStart, beforeText: '', afterText: '' }; changes.push(current); }
    current[part.type === 'removed' ? 'beforeText' : 'afterText'] += part.text;
  }
  return changes.map(c => ({ ...c, beforeEnd: c.beforeStart + c.beforeText.length, afterEnd: c.afterStart + c.afterText.length,
    type: !c.beforeText ? 'added' : !c.afterText ? 'removed' : 'modified' }));
}

export const normalizeText = text => (text ?? '').normalize('NFC').replace(/\\\$/g, '$').replace(/\s+/gu, '');
export function findOccurrences(text, query) {
  if (!query) return [];
  const source = text.toLocaleLowerCase(), needle = query.toLocaleLowerCase(), ranges = [];
  for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + needle.length)) ranges.push([at, at + needle.length]);
  return ranges;
}

export function changeAnchors(before, after, side) {
  const text = side === 'before' ? before : after;
  return textChanges(before, after).flatMap(change => {
    const start = change[`${side}Start`], end = change[`${side}End`];
    if (start === end) {
      const point = Math.max(0, start - 1), lineStart = text.lastIndexOf('\n', point - 1) + 1;
      const lineEnd = text.indexOf('\n', point);
      const context = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
      return context.trim() ? [{ context, start: 0, end: normalizeText(context).length, contextOnly: true }] : [];
    }
    const anchors = []; let offset = 0;
    for (const line of text.split('\n')) {
      const from = Math.max(start, offset), to = Math.min(end, offset + line.length);
      if (from < to && line.slice(from - offset, to - offset).trim()) anchors.push({ context: line,
        start: normalizeText(line.slice(0, from - offset)).length, end: normalizeText(line.slice(0, to - offset)).length, contextOnly: false });
      offset += line.length + 1;
    }
    return anchors;
  });
}
