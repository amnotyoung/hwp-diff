export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
export const MAX_ENTRIES = 500;
export const TIMEOUT_MS = 60_000;
export const MAX_RESULT_BYTES = 32 * 1024 * 1024;

export function validateFile(file) {
  if (!file || !/\.(hwp|hwpx)$/i.test(file.name ?? '')) throw new Error('HWP 또는 HWPX 파일을 선택해 주세요.');
  const size = file.size ?? file.bytes?.length;
  if (!size || size > MAX_FILE_BYTES) throw new Error('빈 파일은 비교할 수 없으며, 파일별 최대 크기는 20MB입니다.');
}
