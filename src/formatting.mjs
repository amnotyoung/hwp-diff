import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { diffBlocks } from 'kordoc';
import { textParts } from '../public/text-diff.js';

export const FORMAT_LABELS = { color: '글자색', font: '글꼴', spacing: '자간', ratio: '장평' };
const local = n => n.localName ?? n.nodeName?.split(':').pop();
const children = n => Array.from(n?.childNodes ?? []).filter(c => c.nodeType === 1);
const child = (n, name) => children(n).find(c => local(c) === name);
const elements = (doc, name) => Array.from(doc.getElementsByTagName('*')).filter(n => local(n) === name);
const isMemo = n => local(n) === 'fieldBegin' && n.getAttribute('type') === 'MEMO';
function ancestor(n, name) { for (let p = n.parentNode; p; p = p.parentNode) if (local(p) === name) return p; return null; }

// Character slots follow the pinned Kordoc renderer's HWP script selection.
// Compare stored font names, not OS fallback fonts or numeric font IDs.
export function scriptSlot(character) {
  const cp = character.codePointAt(0);
  if (cp < 0x250 || cp >= 0x1e00 && cp < 0x2000 || cp >= 0x2018 && cp < 0x2020) return 'latin';
  if (cp >= 0x1100 && cp < 0x1200 || cp >= 0x3130 && cp < 0x3190 || cp >= 0xa960 && cp < 0xa980 || cp >= 0xac00 && cp < 0xd800) return 'hangul';
  if (cp >= 0x3400 && cp < 0x4dc0 || cp >= 0x4e00 && cp < 0xa000 || cp >= 0xf900 && cp < 0xfb00 || cp >= 0x20000 && cp < 0x30000) return 'hanja';
  if (cp >= 0x3040 && cp < 0x3100 || cp >= 0x31f0 && cp < 0x3200 || cp === 0x3012) return 'japanese';
  if (cp >= 0xe000 && cp < 0xf900 || cp >= 0xf0000) return 'hangul';
  return 'symbol';
}

export async function readHwpxFormatting(bytes) {
  const zip = await JSZip.loadAsync(bytes); let total = 0;
  async function xml(name) {
    const entry = zip.file(name); if (!entry) throw new Error('서식 정보가 없습니다.');
    const data = await entry.async('uint8array'); total += data.length;
    if (data.length > 32 * 1024 * 1024 || total > 64 * 1024 * 1024) throw new Error('서식 추출 용량을 넘었습니다.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('지원하지 않는 XML 선언입니다.');
    return new DOMParser({ onError: level => { if (level !== 'warning') throw new Error('서식 XML 오류'); } }).parseFromString(text, 'application/xml');
  }
  const header = await xml('Contents/header.xml');
  const fonts = new Map(elements(header, 'fontface').map(face => [face.getAttribute('lang').toLowerCase(),
    new Map(children(face).filter(n => local(n) === 'font').map(n => [n.getAttribute('id'), n.getAttribute('face')?.normalize('NFC').trim()]))]));
  const properties = new Map(elements(header, 'charPr').map(n => [n.getAttribute('id'), n]));
  const styles = new Map(elements(header, 'style').map(n => [n.getAttribute('id'), n.getAttribute('charPrIDRef')]));
  const resolved = new Map();
  function effective(id, character) {
    const language = scriptSlot(character), space = character === ' ' || character === '\u00a0';
    const key = `${id}:${language}:${space}`; if (resolved.has(key)) return resolved.get(key);
    const pr = properties.get(id); if (!pr) throw new Error('글자 서식 참조를 확인하지 못했습니다.');
    const rawColor = pr.getAttribute('textColor') || '#000000';
    let color = rawColor.toUpperCase();
    if (color === 'NONE' || color === 'AUTO') color = 'AUTO';
    else if (/^#[\da-f]{3}$/i.test(color)) color = '#' + color.slice(1).split('').map(c => c + c).join('');
    else if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('지원하지 않는 글자색 값입니다.');
    const fontLanguage = space ? 'hangul' : language;
    const ref = child(pr, 'fontRef')?.getAttribute(fontLanguage);
    const font = fonts.get(fontLanguage)?.get(ref);
    if (!font) throw new Error('글꼴 참조를 확인하지 못했습니다.');
    function percent(name, slot, fallback) {
      const raw = child(pr, name)?.getAttribute(slot);
      const value = raw == null || raw === '' ? fallback : Number(raw);
      if (!Number.isFinite(value)) throw new Error('서식 수치를 확인하지 못했습니다.');
      return value;
    }
    const value = { color, font, spacing: percent('spacing', language, 0), ratio: percent('ratio', fontLanguage, 100) };
    resolved.set(key, value); return value;
  }
  const paragraphs = [];
  const names = Object.keys(zip.files).filter(n => /^Contents\/section\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!names.length) throw new Error('본문 구역이 없습니다.');
  for (const name of names) {
    const doc = await xml(name); let ordinal = 0;
    function visit(n) {
      if (isMemo(n)) return;
      if (local(n) === 'p') {
        ordinal++;
        const paragraph = { type: 'paragraph', text: '', spans: [], location: { section: name, paragraph: ordinal } };
        const cell = ancestor(n, 'tc'), address = child(cell, 'cellAddr');
        if (address) { paragraph.location.row = Number(address.getAttribute('rowAddr')) + 1; paragraph.location.col = Number(address.getAttribute('colAddr')) + 1; }
        paragraph.location.tableSourceId = ancestor(n, 'tbl')?.getAttribute('id') || null;
        const styleId = n.getAttribute('styleIDRef');
        const baseId = styleId ? styles.get(styleId) : properties.has('0') ? '0' : undefined;
        function append(text, id) {
          for (const character of text) {
            const start = paragraph.text.length; paragraph.text += character;
            if (character === '\n' || character === '\t' || character === '\r') continue;
            const values = effective(id, character), last = paragraph.spans.at(-1);
            if (last && last.end === start && JSON.stringify(last.values) === JSON.stringify(values)) last.end = paragraph.text.length;
            else paragraph.spans.push({ start, end: paragraph.text.length, values });
          }
        }
        function own(node, id, inText = false) {
          if (isMemo(node) || node !== n && local(node) === 'p') return;
          if (node.nodeType === 3 || node.nodeType === 4) { if (inText) append(node.nodeValue, id); return; }
          if (local(node) === 'run') id = node.getAttribute('charPrIDRef') || baseId;
          if (local(node) === 'lineBreak' && inText) { append('\n', id); return; }
          if (local(node) === 'tab' && inText) { append('\t', id); return; }
          for (const sub of Array.from(node.childNodes ?? [])) own(sub, id, inText || local(node) === 't');
        }
        own(n, baseId);
        if (paragraph.text.length) paragraphs.push(paragraph);
      }
      for (const sub of children(n)) visit(sub);
    }
    visit(doc.documentElement);
  }
  return paragraphs;
}

export function compareFormattingParagraphs(before, after) {
  if (before.length * after.length > 2_000_000) throw new Error('서식 비교 문단 한도를 넘었습니다.');
  const aligned = diffBlocks(before, after), diffs = [];
  let comparedCharacters = 0, unmatchedParagraphs = 0;
  for (const pair of aligned.diffs) {
    const a = pair.before, b = pair.after;
    if (!a || !b) { unmatchedParagraphs++; continue; }
    let ai = 0, bi = 0, last = null;
    for (const part of textParts(a.text, b.text)) {
      if (part.type !== 'equal') { last = null; continue; }
      let offset = 0;
      while (offset < part.text.length) {
        const oldAt = part.beforeStart + offset, newAt = part.afterStart + offset;
        while (ai < a.spans.length && a.spans[ai].end <= oldAt) ai++;
        while (bi < b.spans.length && b.spans[bi].end <= newAt) bi++;
        const oldSpan = a.spans[ai], newSpan = b.spans[bi];
        if (!oldSpan || !newSpan) break;
        if (oldSpan.start > oldAt || newSpan.start > newAt) { offset += Math.max(oldSpan.start - oldAt, newSpan.start - newAt, 1); last = null; continue; }
        const length = Math.min(oldSpan.end - oldAt, newSpan.end - newAt, part.text.length - offset);
        const changes = Object.keys(FORMAT_LABELS).filter(k => oldSpan.values[k] !== newSpan.values[k]).map(property => ({ property, label: FORMAT_LABELS[property], before: oldSpan.values[property], after: newSpan.values[property] }));
        comparedCharacters += length;
        if (changes.length) {
          if (last && last.before.end === oldAt && last.after.end === newAt && JSON.stringify(last.changes) === JSON.stringify(changes)) {
            last.text += a.text.slice(oldAt, oldAt + length); last.before.end += length; last.after.end += length;
          } else {
            last = { id: `format-${diffs.length + 1}`, text: a.text.slice(oldAt, oldAt + length), changes,
              before: { start: oldAt, end: oldAt + length, paragraphText: a.text, location: a.location },
              after: { start: newAt, end: newAt + length, paragraphText: b.text, location: b.location } };
            diffs.push(last);
            if (diffs.length > 5000) throw new Error('서식 변경 표시 한도를 넘었습니다.');
          }
        } else last = null;
        offset += length;
      }
    }
  }
  const properties = Object.fromEntries(Object.keys(FORMAT_LABELS).map(k => [k, diffs.filter(d => d.changes.some(c => c.property === k)).length]));
  return { available: true, diffs, stats: { changedRanges: diffs.length, properties }, comparedCharacters, unmatchedParagraphs };
}

export async function compareFormatting(oldFile, newFile, formats) {
  if (formats.some(f => f !== 'hwpx')) return { available: false, message: '글자 서식 비교는 HWPX끼리 비교할 때 지원합니다. HWP의 서식은 한컴에서 확인해 주세요.' };
  try { return compareFormattingParagraphs(await readHwpxFormatting(oldFile.bytes), await readHwpxFormatting(newFile.bytes)); }
  catch { return { available: false, message: '글자 서식을 완전히 읽거나 대응시키지 못했습니다. 서식 변경 없음으로 판정할 수 없습니다.' }; }
}
