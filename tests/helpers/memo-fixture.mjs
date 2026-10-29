import JSZip from 'jszip';
import { markdownToHwpx } from 'kordoc';

export const memoXml = (id, text) => `<hp:ctrl><hp:fieldBegin id="${id}" type="MEMO"><hp:parameters><hp:stringParam name="ID">memo${id}</hp:stringParam><hp:stringParam name="Author">검토자</hp:stringParam><hp:stringParam name="CreateDateTime">2026-10-29T01:00:00Z</hp:stringParam></hp:parameters><hp:subList><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList></hp:fieldBegin></hp:ctrl>`;

export async function memoFixture(paragraphCount = 1, memoIndex = 0) {
  const lines = Array.from({ length: paragraphCount }, (_, i) => paragraphCount === 1 ? '검토 문장입니다.' : `검토 문장 ${i}입니다. 이 사업의 현장 운영 결과를 확인합니다.`);
  const oldBytes = new Uint8Array(await markdownToHwpx('# 검토용 문서\n\n' + lines.join('\n\n')));
  const zip = await JSZip.loadAsync(oldBytes);
  const section = await zip.file('Contents/section0.xml').async('string');
  const target = `<hp:t>${lines[memoIndex]}</hp:t>`;
  if (!section.includes(target)) throw new Error('Test fixture paragraph missing');
  zip.file('Contents/section0.xml', section.replace(target, `${memoXml('123', '근거 자료를 추가해 주세요.')}${target}<hp:ctrl><hp:fieldEnd beginIDRef="123"/></hp:ctrl>`));
  return [{ name: 'old.hwpx', bytes: oldBytes }, { name: 'new.hwpx', bytes: await zip.generateAsync({ type: 'uint8array' }) }];
}
