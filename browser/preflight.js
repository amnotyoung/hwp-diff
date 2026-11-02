import JSZip from 'jszip';
import { detectFormat, detectOle2Format, detectZipFormat } from 'kordoc';
import { validateFile, MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_EXPANDED_BYTES } from './limits.js';

// This is an archive resource check, not an HWP parser. Format detection and
// all document parsing remain in Kordoc's public API.
export async function preflight(file) {
  validateFile(file);
  const bytes = file.bytes;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const format = detectFormat(buffer);
  if (format === 'hwp') {
    if (detectOle2Format(buffer) !== 'hwp') throw new Error('HWP 5.x 문서가 아닙니다.');
    return;
  }
  if (format !== 'hwpx') throw new Error('HTML 버전은 HWP 5.x와 HWPX만 지원합니다. 원본 형식을 확인해 주세요.');
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ENTRIES) throw new Error('문서 내부 파일 수가 처리 한도를 넘습니다.');
  let declaredTotal = 0, actualTotal = 0;
  for (const entry of entries) {
    const declared = entry._data?.uncompressedSize ?? 0;
    declaredTotal += declared;
    if (declared > MAX_ENTRY_BYTES || declaredTotal > MAX_EXPANDED_BYTES) throw new Error('문서의 압축 해제 크기가 처리 한도를 넘습니다. 문서를 나누어 확인해 주세요.');
  }
  for (const entry of entries.filter(entry => !entry.dir)) {
    await new Promise((resolve, reject) => {
      let size = 0;
      const stream = entry.internalStream('uint8array');
      stream.on('data', chunk => {
        size += chunk.length; actualTotal += chunk.length;
        if (size > MAX_ENTRY_BYTES || actualTotal > MAX_EXPANDED_BYTES) {
          stream.pause();
          reject(new Error('문서의 실제 압축 해제 크기가 처리 한도를 넘습니다.'));
        }
      }).on('error', reject).on('end', resolve).resume();
    });
  }
  if (await detectZipFormat(buffer) !== 'hwpx') throw new Error('실제 파일 형식이 HWPX가 아닙니다.');
}
