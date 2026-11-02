import { diffBlocks } from 'kordoc';

export const ALIGNMENT_BATCH_CELLS = 250_000;
const MAX_CELLS = 25_000_000;
const textOf = block => block.text !== undefined ? block.text : block.table?.cells.flat().map(cell => cell?.text ?? '').join(' ') ?? '';
const normalized = block => textOf(block).replace(/\s+/g, ' ').trim();

// A whole paragraph, including its nested tables/footnotes, is an indivisible
// item. Only computation is partitioned; no synthetic document is parsed.
export function assertCoverage(diffs, before, after) {
  for (const [key, input] of [['before', before], ['after', after]]) {
    const counts = new Map();
    for (const item of input) counts.set(item, (counts.get(item) ?? 0) + 1);
    for (const pair of diffs) if (pair[key]) {
      const left = counts.get(pair[key]) ?? 0;
      if (!left) throw new Error('자동 분할 결과에 중복되거나 알 수 없는 문단이 있습니다. 비교를 완료하지 않았습니다.');
      counts.set(pair[key], left - 1);
    }
    if ([...counts.values()].some(Boolean)) throw new Error('자동 분할 결과에서 일부 문단을 확인하지 못했습니다. 비교를 완료하지 않았습니다.');
  }
}

// Weighted LCS with two score rows and packed traceback (2 bits per cell).
// Matching eligibility comes from the official one-pair Kordoc API. The weight
// and tie ordering match the pinned Kordoc 4.24.21 global alignment, so batches
// do not introduce independent chunk boundaries or lose cross-batch matches.
export function boundedDiff(before, after, { maxBatchCells = ALIGNMENT_BATCH_CELLS, onBatch = () => {} } = {}) {
  const m = before.length, n = after.length;
  if (!m || !n) return { diffs: [...before.map(b => ({ before:b })), ...after.map(b => ({ after:b }))] };
  if (m * n <= maxBatchCells) return diffBlocks(before, after);
  const a = before.map(normalized), b = after.map(normalized);
  const count = values => values.reduce((map,value)=>map.set(value,(map.get(value)??0)+1),new Map());
  const ca=count(a), cb=count(b);
  const fixed=(i,j)=>before[i].type===after[j].type && a[i]===b[j] && ca.get(a[i])===1 && cb.get(b[j])===1;
  let head=0, tail=0;
  while(head<Math.min(m,n) && fixed(head,head))head++;
  while(tail<Math.min(m,n)-head && fixed(m-tail-1,n-tail-1))tail++;
  if(head||tail){
    const middle=boundedDiff(before.slice(head,m-tail),after.slice(head,n-tail),{maxBatchCells,onBatch}).diffs;
    const diffs=[...before.slice(0,head).map((x,i)=>({before:x,after:after[i]})),...middle,
      ...before.slice(m-tail).map((x,i)=>({before:x,after:after[n-tail+i]}))];
    assertCoverage(diffs,before,after);onBatch({completed:m,total:m});return {diffs};
  }
  if (m * n > MAX_CELLS) throw new Error('문서 전체의 대응 관계를 안전하게 계산할 수 있는 한도를 넘었습니다. 불완전한 비교 결과는 표시하지 않습니다.');
  const trace = new Uint8Array(Math.ceil(m * n / 4));
  let previous = new Int32Array(n + 1), current = new Int32Array(n + 1);
  const weight = Math.min(m, n) + 1;
  const key = block => JSON.stringify({type:block.type, text:block.text, table:block.table});
  const keys = new Map();
  const intern = value => { if (!keys.has(value)) keys.set(value, keys.size); return keys.get(value); };
  const ka = before.map(x => intern(key(x))), kb = after.map(x => intern(key(x)));
  const eligibility = new Map();
  const matches = (i, j) => {
    if (before[i].type !== after[j].type) return false;
    const k = `${ka[i]}:${kb[j]}`;
    if (eligibility.has(k)) return eligibility.get(k);
    const pass = diffBlocks([before[i]], [after[j]]).diffs.some(pair => pair.before && pair.after);
    // A bounded memo cache helps repeated paragraphs without retaining m*n data.
    if (eligibility.size >= 20_000) eligibility.clear();
    eligibility.set(k, pass); return pass;
  };
  const rowsPerBatch = Math.max(1, Math.floor(maxBatchCells / n));
  for (let i = 1; i <= m; i++) {
    current[0] = 0;
    for (let j = 1; j <= n; j++) {
      const up = previous[j], left = current[j - 1];
      const diagonal = matches(i - 1, j - 1) ? previous[j - 1] + weight + (a[i - 1] === b[j - 1] ? 1 : 0) : -1;
      const direction = diagonal >= up && diagonal >= left ? 1 : up >= left ? 2 : 3;
      current[j] = direction === 1 ? diagonal : direction === 2 ? up : left;
      const at = (i - 1) * n + j - 1;
      trace[at >> 2] |= direction << ((at & 3) * 2);
    }
    [previous, current] = [current, previous];
    if (i % rowsPerBatch === 0 || i === m) onBatch({completed:i,total:m});
  }
  const links = [];
  let i = m, j = n;
  while (i && j) {
    const at = (i - 1) * n + j - 1, direction = trace[at >> 2] >> ((at & 3) * 2) & 3;
    if (direction === 1) { links.push([--i, --j]); }
    else if (direction === 2) i--; else j--;
  }
  links.reverse();
  const diffs = []; let ai = 0, bi = 0;
  for (const [x, y] of [...links, [m, n]]) {
    while (ai < x) diffs.push({before:before[ai++]});
    while (bi < y) diffs.push({after:after[bi++]});
    if (x < m) diffs.push({before:before[ai++],after:after[bi++]});
  }
  assertCoverage(diffs,before,after);
  return {diffs};
}
