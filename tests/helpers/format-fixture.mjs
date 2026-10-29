import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { markdownToHwpx } from 'kordoc';
const HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
const all = (doc, name) => Array.from(doc.getElementsByTagName('*')).filter(n => n.localName === name);
const parse = text => new DOMParser().parseFromString(text, 'application/xml');
export async function editHwpx(bytes, edit) {
  const zip = await JSZip.loadAsync(bytes), header = parse(await zip.file('Contents/header.xml').async('string')), section = parse(await zip.file('Contents/section0.xml').async('string'));
  await edit(header, section);
  const serializer = new XMLSerializer();
  zip.file('Contents/header.xml', serializer.serializeToString(header)); zip.file('Contents/section0.xml', serializer.serializeToString(section));
  return zip.generateAsync({ type: 'uint8array' });
}
export function cloneStyle(header, section, text, changes, range) {
  const t = all(section, 't').find(n => n.textContent === text); if (!t) throw new Error('Test text missing');
  const run = t.parentNode, id = String(100 + all(header, 'charPr').length);
  const pr = all(header, 'charPr').find(n => n.getAttribute('id') === run.getAttribute('charPrIDRef')).cloneNode(true);
  pr.setAttribute('id', id);
  if (changes.color) pr.setAttribute('textColor', changes.color);
  for (const [key, tag] of [['font', 'fontRef'], ['spacing', 'spacing'], ['ratio', 'ratio']]) if (changes[key] !== undefined) {
    const node = all(pr, tag)[0];
    for (const language of ['hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user']) node.setAttribute(language, String(changes[key]));
  }
  const collection = all(header, 'charProperties')[0]; collection.appendChild(pr); collection.setAttribute('itemCnt', String(all(header, 'charPr').length));
  if (!range) run.setAttribute('charPrIDRef', id);
  else {
    const [from, to] = range;
    for (const [part, changed] of [[text.slice(0, from), false], [text.slice(from, to), true], [text.slice(to), false]]) {
      if (!part) continue;
      const r = run.cloneNode(false), tt = section.createElementNS(HP, 'hp:t'); tt.textContent = part; r.appendChild(tt);
      if (changed) r.setAttribute('charPrIDRef', id);
      run.parentNode.insertBefore(r, run);
    }
    run.parentNode.removeChild(run);
  }
  return { pr, run, id };
}
export async function formatSamples() {
  const before = new Uint8Array(await markdownToHwpx('# 서식 비교\n\n글자색 변경 대상\n\n글꼴 변경 대상\n\n자간 변경 대상\n\n장평 변경 대상\n\n| 항목 | 내용 |\n| --- | --- |\n| 표 안 서식 | 일부 글자만 변경합니다 |'));
  const after = await editHwpx(before, (header, section) => {
    cloneStyle(header, section, '글자색 변경 대상', { color: '#FF0000' });
    cloneStyle(header, section, '글꼴 변경 대상', { font: 1 });
    cloneStyle(header, section, '자간 변경 대상', { spacing: -5 });
    cloneStyle(header, section, '장평 변경 대상', { ratio: 95 });
    cloneStyle(header, section, '일부 글자만 변경합니다', { color: '#0000FF', spacing: 5 }, [3, 6]);
  });
  return [{ name: '서식비교_구버전.hwpx', bytes: before }, { name: '서식비교_신버전.hwpx', bytes: after }];
}
export { all };
