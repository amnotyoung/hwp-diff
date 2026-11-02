import { Inflate, deflate, deflateRaw } from 'pako';
import { Buffer } from 'buffer';

// Enforce the limit while inflating, before concatenating the output. Node's
// maxOutputLength must not silently disappear in the browser compatibility layer.
export function boundedInflate(bytes, options = {}, raw = false) {
  const limit = Math.min(options.maxOutputLength ?? Infinity, 64 * 1024 * 1024);
  const inflater = new Inflate({ raw, chunkSize: 64 * 1024 });
  const chunks = [];
  let size = 0;
  inflater.onData = chunk => {
    size += chunk.length;
    if (size > limit) throw new Error('압축 해제 크기가 처리 한도를 넘습니다. 문서를 나누어 확인해 주세요.');
    chunks.push(chunk);
  };
  inflater.push(bytes, true);
  if (inflater.err || !inflater.ended) throw new Error('압축된 문서를 읽을 수 없습니다.');
  return Buffer.concat(chunks, size);
}
export const inflateRawSync = (bytes, options) => boundedInflate(bytes, options, true);
export const inflateSync = (bytes, options) => boundedInflate(bytes, options);
export const deflateSync = (bytes, options) => Buffer.from(deflate(bytes, options));
export const deflateRawSync = (bytes, options) => Buffer.from(deflateRaw(bytes, options));
