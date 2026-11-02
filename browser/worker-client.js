import { TIMEOUT_MS, MAX_AUTOMATIC_TIME_MS } from './limits.js';

export function runWorker(source, payload, { signal, onProgress = () => {}, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let worker, url, timer, settled = false, ready = false, checkpoint = 0;
    const started = Date.now();
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new DOMException('작업을 취소했습니다.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    const deadline = () => finish(new Error(ready
      ? '자동 처리 제한 시간을 넘었습니다. 비교를 완료하지 않았습니다. 다시 시도해 주세요.'
      : '문서 처리 기능을 시작하지 못했습니다. 브라우저의 로컬 HTML·JavaScript·Worker 실행 정책을 확인한 뒤 다시 시도하세요.'));
    timer = setTimeout(deadline, timeout);
    try {
      onProgress({ label: '문서 처리 기능을 시작하는 중' });
      url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.ready) { ready = true; worker.postMessage(payload); return; }
        if (data.progress) {
          if (Number.isInteger(data.progress.checkpoint) && data.progress.checkpoint > checkpoint) {
            checkpoint = data.progress.checkpoint;
            clearTimeout(timer);
            const remaining = MAX_AUTOMATIC_TIME_MS - (Date.now() - started);
            if (remaining <= 0) { deadline(); return; }
            timer = setTimeout(deadline, Math.min(timeout, remaining));
          }
          onProgress(data.progress); return;
        }
        if (data.error) return finish(new Error(data.error));
        if (!Object.hasOwn(data, 'result')) return finish(new Error('처리 결과를 받지 못했습니다. 다시 시도하세요.'));
        finish(null, data.result);
      };
      worker.onerror = event => {
        console.error('HWP diff Worker:', event.message);
        event.preventDefault();
        finish(new Error(ready
          ? '문서 처리 중 오류가 발생했습니다. 파일 상태와 크기를 확인하고 다시 시도하세요.'
          : '문서 처리 기능을 시작하지 못했습니다. 브라우저의 로컬 HTML·JavaScript·Worker 실행 정책을 확인한 뒤 다시 시도하세요.'));
      };
      worker.onmessageerror = () => finish(new Error('처리 결과를 완전히 읽을 수 없어 비교를 완료하지 않았습니다. 다시 시도하세요.'));
    } catch (error) {
      finish(new Error(`문서 처리 기능을 시작하지 못했습니다. 로컬 HTML·JavaScript·Worker 실행 정책을 확인하세요. (${error.name})`));
    }
  });
}
