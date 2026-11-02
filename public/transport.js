export const standalone = false;

// The server streams one JSON object per line: stage updates, then the result.
async function readProgressStream(response, onProgress) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '', scanned = 0, outcome = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    for (let at = buffer.indexOf('\n', scanned); at >= 0; at = buffer.indexOf('\n', 0)) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.progress) onProgress(message.progress); else outcome = message;
    }
    scanned = buffer.length;
    if (done) break;
  }
  if (outcome?.error) throw new Error(outcome.error);
  if (!outcome?.result) throw new Error('비교 결과를 받지 못했습니다. 다시 비교해 주세요.');
  return outcome.result;
}
export async function requestCompare(form, demo, reverse, signal, onProgress) {
  const response = await fetch(demo ? '/api/demo' : '/api/compare', { method: 'POST', headers: { 'X-Hwp-Diff': '1', 'X-Hwp-Progress': '1' }, body: demo ? JSON.stringify({ reverse }) : form, signal });
  if (response.ok && response.headers.get('Content-Type')?.startsWith('application/x-ndjson')) return readProgressStream(response, onProgress);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '비교하지 못했습니다.');
  return data;
}
export async function requestPreview(form, signal) {
  const response = await fetch('/api/preview', { method: 'POST', headers: { 'X-Hwp-Diff': '1' }, body: form, signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '미리보기를 만들 수 없습니다.');
  return data;
}
