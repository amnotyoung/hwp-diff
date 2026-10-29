import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

const NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
const local = node => node.localName ?? node.nodeName?.split(':').pop();
const children = node => Array.from(node?.childNodes ?? []).filter(n => n.nodeType === 1);
const isMemo = node => local(node) === 'fieldBegin' && node.getAttribute('type') === 'MEMO';
function ancestor(node, tag) {
  for (let p = node.parentNode; p; p = p.parentNode) if (local(p) === tag) return p;
  return null;
}
function bodyText(node) {
  if (isMemo(node)) return '';
  if (local(node) === 't') return node.textContent;
  return children(node).map(bodyText).join('');
}

// Read the HWPX MEMO fields separately; Kordoc's body IR deliberately omits them.
export async function readHwpxMemos(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter(n => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!names.length) throw new Error('본문 구역을 찾을 수 없습니다.');
  const records = [];
  let totalBytes = 0;
  for (const name of names) {
    const data = await zip.file(name).async('uint8array');
    totalBytes += data.length;
    if (data.length > 32 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) throw new Error('메모 추출 용량을 넘었습니다.');
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('지원하지 않는 XML 선언입니다.');
    const doc = new DOMParser({ onError: level => { if (level !== 'warning') throw new Error('본문 XML을 읽지 못했습니다.'); } }).parseFromString(xml, 'application/xml');
    const active = new Map();
    function visit(node) {
      if (isMemo(node)) {
        const parameters = children(node).find(n => local(n) === 'parameters');
        const params = Object.fromEntries(children(parameters).map(n => [n.getAttribute('name'), n.textContent]));
        const subList = children(node).find(n => local(n) === 'subList');
        if (!subList) throw new Error('내용을 읽을 수 없는 메모가 있습니다.');
        const paragraphs = Array.from(subList.getElementsByTagNameNS(NS, 'p'));
        const paragraph = ancestor(node, 'p'), cell = ancestor(node, 'tc');
        const address = cell && children(cell).find(n => local(n) === 'cellAddr');
        const record = {
          sourceId: params.ID || node.getAttribute('id') || '',
          text: paragraphs.map(bodyText).join('\n'), author: params.Author ?? '',
          createdAt: params.CreateDateTime ?? '', anchorText: '',
          context: paragraph ? bodyText(paragraph).trim().slice(0, 240) : '',
          section: name, row: address ? Number(address.getAttribute('rowAddr')) + 1 : null,
          col: address ? Number(address.getAttribute('colAddr')) + 1 : null,
        };
        records.push(record); active.set(node.getAttribute('id'), record);
        return; // Memo text must not become the anchor text of another memo.
      }
      if (local(node) === 'fieldEnd') { active.delete(node.getAttribute('beginIDRef')); return; }
      if (local(node) === 't') for (const record of active.values()) record.anchorText += node.textContent;
      for (const child of children(node)) visit(child);
    }
    visit(doc.documentElement);
    if (active.size) throw new Error('메모의 연결 끝 위치를 찾지 못했습니다.');
  }
  return records.map(r => ({ ...r, anchorText: r.anchorText.trim() }));
}

export function compareMemos(before, after) {
  const signature = memo => JSON.stringify([memo.text, memo.author, memo.anchorText || memo.context]);
  const remainingOld = new Set(before.map((_, i) => i)), remainingNew = new Set(after.map((_, i) => i));
  const matches = [];
  function pair(i, j) { remainingOld.delete(i); remainingNew.delete(j); matches.push([i, j]); }
  // Exact content first: regenerated IDs and reordered comments are not edits.
  for (const i of [...remainingOld]) {
    const j = [...remainingNew].find(j => signature(before[i]) === signature(after[j]));
    if (j !== undefined) pair(i, j);
  }
  for (const key of [m => m.sourceId, m => m.anchorText ? JSON.stringify([m.author, m.anchorText]) : '']) {
    for (const i of [...remainingOld]) {
      const value = key(before[i]); if (!value) continue;
      const a = [...remainingOld].filter(k => key(before[k]) === value);
      const b = [...remainingNew].filter(k => key(after[k]) === value);
      if (a.length === 1 && b.length === 1) pair(i, b[0]);
    }
  }
  const entries = [
    ...matches.map(([i, j]) => ({ before: before[i], after: after[j], type: signature(before[i]) === signature(after[j]) ? 'unchanged' : 'modified' })),
    ...[...remainingOld].map(i => ({ before: before[i], after: null, type: 'removed' })),
    ...[...remainingNew].map(j => ({ before: null, after: after[j], type: 'added' })),
  ];
  const stats = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  const diffs = entries.map((entry, i) => { stats[entry.type]++; return { ...entry, id: `memo-${i + 1}` }; });
  return { available: true, stats, diffs, counts: { before: before.length, after: after.length } };
}

export async function compareAnnotations(oldFile, newFile, formats) {
  if (formats.some(f => f !== 'hwpx')) return { available: false, message: '메모 비교는 HWPX끼리 비교할 때 지원합니다. HWP 문서의 메모는 한컴에서 확인해 주세요.' };
  try {
    return compareMemos(await readHwpxMemos(oldFile.bytes), await readHwpxMemos(newFile.bytes));
  } catch {
    return { available: false, message: '메모를 완전히 읽지 못해 메모 비교 결과를 제공하지 못했습니다. 한컴에서 메모를 확인해 주세요.' };
  }
}
