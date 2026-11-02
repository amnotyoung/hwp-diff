import { compareDocuments } from '../src/engine.mjs';
import { previewDocument } from '../src/preview.mjs';
import { preflight } from './preflight.js';
import { validateFile, MAX_RESULT_BYTES } from './limits.js';
import demoFiles from 'embedded-demo';

const progress = value => self.postMessage({ progress: value });
async function read(file) {
  validateFile(file);
  let bytes;
  try { bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(await file.arrayBuffer()); }
  catch { throw new Error('파일을 읽지 못했습니다. 접근 권한과 파일 상태를 확인하고 다시 선택하세요.'); }
  const result = { name: file.name.split(/[\\/]/).pop().slice(0, 240), bytes };
  return preflight(result, {automatic:true,onProgress:progress});
}
function demoPair(reverse) {
  const pair = demoFiles.map(file => ({ name: file.name, bytes: Uint8Array.from(atob(file.base64), char => char.charCodeAt(0)) }));
  return reverse ? pair.reverse() : pair;
}
self.onmessage = async ({ data }) => {
  try {
    if (data.operation === 'probe') { self.postMessage({ result: true }); return; }
    progress({ label: '파일을 읽고 처리 한도를 확인하는 중' });
    let result;
    if (data.operation === 'compare') {
      const [oldFile, newFile] = data.demo ? demoPair(data.reverse) : [await read(data.oldFile), await read(data.newFile)];
      result = await compareDocuments(oldFile, newFile, progress);
      for (const [document,file] of [['구버전',oldFile],['신버전',newFile]]) if(file.automaticImagesOmitted) result.warnings.push({document,code:'PICTURES_OMITTED',message:'그림 용량이 커서 내부 처리본에서 그림을 제외했습니다. 본문·표·서식·메모는 계속 비교하며 원본 파일은 바꾸지 않습니다.'});
    } else if (data.operation === 'preview') {
      const file = data.demo ? demoPair(data.reverse)[data.side === 'old' ? 0 : 1] : await read(data.file);
      result = await previewDocument(file, data.page, data.options);
      if(file.automaticImagesOmitted){result.rendering.imagesOmitted=true;result.warnings.unshift('그림 용량이 커서 그림을 제외하고 표시합니다. 원본 파일은 바꾸지 않았습니다.');}
    } else throw new Error('지원하지 않는 작업입니다.');
    if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_RESULT_BYTES) throw new Error('처리 결과가 자동 처리 한도를 넘었습니다. 불완전한 비교 결과는 표시하지 않습니다.');
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message || '문서 처리 중 오류가 발생했습니다. 다시 시도하세요.' });
  }
};
self.postMessage({ ready: true });
