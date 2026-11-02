import JSZip from 'jszip';
import { detectFormat, detectOle2Format, detectZipFormat } from 'kordoc';
import { validateFile, MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_EXPANDED_BYTES, MAX_IMAGE_ENTRY_BYTES, MAX_IMAGES_EXPANDED_BYTES, MAX_ARCHIVE_EXPANDED_BYTES } from './limits.js';

const raster = name => /^(?:Contents\/)?BinData\/[^/]+\.(?:bmp|png|jpe?g|gif|webp|tiff?)$/i.test(name);
// Round upward so a value just over the limit never reads "64.0 > 64.0".
const mib = bytes => (Math.ceil(bytes / 1024 / 1024 * 10) / 10).toFixed(1);
function checkSize(file, name, image, size, totals, actual = false) {
  const fail = (subject, value, limit) => {
    const error = new Error(`${file.name}: ${subject}의 ${actual ? '실제 ' : ''}압축 해제 크기가 약 ${mib(value)}MiB로 한도 ${mib(limit)}MiB를 넘습니다. (원본 파일 약 ${mib(file.bytes.length)}MiB) 자동 처리 한도를 넘어 작업을 완료하지 않았습니다.`);
    error.imageLimit = image;
    throw error;
  };
  const limit = image ? MAX_IMAGE_ENTRY_BYTES : MAX_ENTRY_BYTES;
  if (size > limit) fail(image ? `그림 "${name.split('/').pop()}"` : '본문·서식 등 내부 데이터 한 개', size, limit);
  if (totals.text > MAX_EXPANDED_BYTES) fail('본문·서식 등 데이터 합계', totals.text, MAX_EXPANDED_BYTES);
  if (totals.images > MAX_IMAGES_EXPANDED_BYTES) fail('그림 합계', totals.images, MAX_IMAGES_EXPANDED_BYTES);
  if (totals.text + totals.images > MAX_ARCHIVE_EXPANDED_BYTES) fail('문서 전체', totals.text + totals.images, MAX_ARCHIVE_EXPANDED_BYTES);
}

// This is an archive resource check, not an HWP parser. Format detection and
// all document parsing remain in Kordoc's public API.
export async function preflight(file, { automatic = false, onProgress = () => {} } = {}) {
  validateFile(file);
  const bytes = file.bytes;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const format = detectFormat(buffer);
  if (format === 'hwp') {
    if (detectOle2Format(buffer) !== 'hwp') throw new Error('HWP 5.x 문서가 아닙니다.');
    return file;
  }
  if (format !== 'hwpx') throw new Error('HTML 버전은 HWP 5.x와 HWPX만 지원합니다. 원본 형식을 확인해 주세요.');
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ENTRIES) throw new Error('문서 내부 파일 수가 처리 한도를 넘습니다.');
  const validate = async (omitPictures = false) => {
    const checked = entries.filter(entry => !entry.dir && !(omitPictures && raster(entry.name)));
    const declaredTotals = { text: 0, images: 0 }, actualTotals = { text: 0, images: 0 };
    for (const entry of checked) {
      const declared = entry._data?.uncompressedSize ?? 0;
      const image = raster(entry.name);
      declaredTotals[image ? 'images' : 'text'] += declared;
      checkSize(file, entry.name, image, declared, declaredTotals);
    }
    for (const entry of checked) {
      await new Promise((resolve, reject) => {
        let size = 0;
        const image = raster(entry.name);
        const stream = entry.internalStream('uint8array');
        stream.on('data', chunk => {
          size += chunk.length; actualTotals[image ? 'images' : 'text'] += chunk.length;
          try { checkSize(file, entry.name, image, size, actualTotals, true); }
          catch (error) {
            stream.pause();
            reject(error);
          }
        }).on('error', reject).on('end', resolve).resume();
      });
    }
  };
  let omitted = false;
  try { await validate(); }
  catch (error) {
    if (!automatic || !error.imageLimit) throw error;
    onProgress({label:'큰 그림을 분리해 본문을 처리하는 중'});
    await validate(true);
    omitted = true;
  }
  if (await detectZipFormat(buffer) !== 'hwpx') throw new Error('실제 파일 형식이 HWPX가 아닙니다.');
  if (!omitted) return file;
  // Keep entries/references (including unreferenced picture inventory) so the
  // official parser does not turn a missing image into a new text paragraph.
  for (const entry of entries) if (raster(entry.name)) zip.file(entry.name, new Uint8Array(0));
  const light = await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  return {...file,bytes:light,originalSize:file.bytes.length,automaticImagesOmitted:true};
}
