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
  await preflight(result);
  return result;
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
    } else if (data.operation === 'preview') {
      const file = data.demo ? demoPair(data.reverse)[data.side === 'old' ? 0 : 1] : await read(data.file);
      result = await previewDocument(file, data.page, data.options);
    } else throw new Error('지원하지 않는 작업입니다.');
    if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_RESULT_BYTES) throw new Error('처리 결과가 너무 큽니다. 문서를 나누어 다시 비교해 주세요.');
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message || '문서 처리 중 오류가 발생했습니다. 다시 시도하세요.' });
  }
};
self.postMessage({ ready: true });
