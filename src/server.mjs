import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { spawn } from 'node:child_process';

const MAX_FILE = 20 * 1024 * 1024;
const MAX_BODY = 2 * MAX_FILE + 1024 * 1024;
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/launch-guard.js', ['launch-guard.js', 'text/javascript; charset=utf-8']],
  ['/report.js', ['report.js', 'text/javascript; charset=utf-8']],
  ['/text-diff.js', ['text-diff.js', 'text/javascript; charset=utf-8']],
  ['/search.js', ['search.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function body(req) {
  if (Number(req.headers['content-length']) > MAX_BODY) throw new HttpError(413, '파일은 각각 20MB 이하로 선택해 주세요.');
  const parts = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) throw new HttpError(413, '파일은 각각 20MB 이하로 선택해 주세요.');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

async function uploadFiles(req) {
  if (!req.headers['content-type']?.startsWith('multipart/form-data;')) throw new HttpError(400, '문서 두 개를 선택해 주세요.');
  let form;
  try {
    form = await new Request('http://localhost', {
      method: 'POST', headers: { 'Content-Type': req.headers['content-type'] }, body: await body(req),
    }).formData();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, '파일 요청을 읽을 수 없습니다. 다시 선택해 주세요.');
  }
  const result = {};
  for (const key of ['oldFile', 'newFile']) {
    const files = form.getAll(key);
    const file = files[0];
    if (files.length !== 1 || !file || typeof file === 'string') throw new HttpError(400, '구버전과 신버전 파일을 각각 하나씩 선택해 주세요.');
    if (!/\.(hwp|hwpx)$/i.test(file.name)) throw new HttpError(400, 'HWP 또는 HWPX 파일만 지원합니다.');
    if (!file.size || file.size > MAX_FILE) throw new HttpError(413, '빈 파일은 비교할 수 없으며, 파일별 최대 크기는 20MB입니다.');
    result[key] = { name: file.name.split(/[\\/]/).pop().slice(0, 240), bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  return result;
}

async function previewRequest(req) {
  const raw = await body(req);
  const form = await new Request('http://localhost', { method: 'POST',
    headers: { 'Content-Type': req.headers['content-type'] ?? '' }, body: raw }).formData()
    .catch(() => { throw new HttpError(400, '미리보기 요청을 읽을 수 없습니다.'); });
  const page = Number(form.get('page') ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 2000) throw new HttpError(400, '올바른 쪽 번호를 선택해 주세요.');
  let targets = [];
  const rawTargets = form.get('targets');
  if (rawTargets) {
    if (typeof rawTargets !== 'string' || rawTargets.length > 6_000_000) throw new HttpError(400, '변경 목록이 너무 큽니다. 문서를 나누어 비교해 주세요.');
    try { targets = JSON.parse(rawTargets); } catch { throw new HttpError(400, '변경 목록을 읽을 수 없습니다.'); }
    if (!Array.isArray(targets) || targets.length > 8000 || targets.some(t => !t || (t.category === 'memo' || t.category === 'format'
      ? typeof t.id !== 'string' || !(t.category === 'memo' ? /^memo-[1-9]\d*$/ : /^format-[1-9]\d*$/).test(t.id) || !['added', 'removed', 'modified', 'unchanged'].includes(t.type)
      : !Number.isInteger(t.id) || !['added', 'removed', 'modified'].includes(t.type)))) throw new HttpError(400, '올바르지 않은 변경 목록입니다.');
  }
  const rawFocus = form.get('focusId');
  const search = form.get('search') ?? '';
  if (typeof search !== 'string' || search.length > 100) throw new HttpError(400, '검색어는 100자 이하로 입력해 주세요.');
  const options = { targets, search, focusId: typeof rawFocus === 'string' && /^(memo|format)-[1-9]\d*$/.test(rawFocus) ? rawFocus : Number(rawFocus), jump: form.get('jump') === '1' };
  if (form.get('demo') === '1') {
    const side = form.get('side');
    if (!['old', 'new'].includes(side)) throw new HttpError(400, '미리볼 문서를 선택해 주세요.');
    return { preview: true, demo: true, side, page, options };
  }
  const file = form.get('file');
  if (!file || typeof file === 'string' || !/\.(hwp|hwpx)$/i.test(file.name)) throw new HttpError(400, 'HWP·HWPX 문서를 선택해 주세요.');
  if (!file.size || file.size > MAX_FILE) throw new HttpError(413, '파일별 최대 크기는 20MB입니다. 빈 파일은 열 수 없습니다.');
  return { preview: true, page, options, file: { bytes: new Uint8Array(await file.arrayBuffer()) } };
}

function runWorker(data, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
      workerData: data, resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new HttpError(499, '비교를 취소했습니다.'));
    const timer = setTimeout(() => finish(new HttpError(408, '60초 안에 처리하지 못했습니다. 문서를 나누어 다시 비교해 주세요.')), 60_000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    worker.on('message', message => finish(message.error ? new HttpError(422, message.error) : null, message.result));
    worker.on('error', () => finish(new HttpError(422, '문서 처리 중 오류가 발생했습니다. 파일 상태와 크기를 확인해 주세요.')));
    worker.on('exit', () => { if (!settled) finish(new HttpError(422, '문서 처리 작업이 종료되었습니다.')); });
  });
}

export function createServer() {
  let busy = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const send = (status, data) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    try {
      const port = server.address()?.port;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(req.headers.host)) throw new HttpError(403, '이 PC의 로컬 주소로 접속해 주세요.');
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && assets.has(path)) {
        const [file, mime] = assets.get(path);
        const bytes = await readFile(new URL(`../public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': mime });
        res.end(bytes);
      } else if (req.method === 'GET' && path === '/api/health') {
        send(200, { status: 'ok', offline: true, maxFileBytes: MAX_FILE });
      } else if (req.method === 'POST' && ['/api/compare', '/api/demo', '/api/preview'].includes(path)) {
        if (req.headers['x-hwp-diff'] !== '1' ||
          (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) ||
          req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '이 프로그램의 비교 화면에서 요청해 주세요.');
        if (busy) throw new HttpError(409, '다른 비교를 처리하고 있습니다. 잠시 후 다시 시도해 주세요.');
        busy = true;
        const abort = new AbortController();
        const onClose = () => { if (!res.writableEnded) abort.abort(); };
        res.on('close', onClose);
        try {
          const data = path === '/api/demo' ? (await body(req), { demo: true })
            : path === '/api/preview' ? await previewRequest(req) : await uploadFiles(req);
          const result = await runWorker(data, abort.signal);
          send(200, result);
        } finally { busy = false; res.off('close', onClose); }
      } else send(404, { error: '요청한 페이지를 찾을 수 없습니다.' });
    } catch (error) { send(error.status ?? 500, { error: error.status ? error.message : '요청 처리 중 오류가 발생했습니다.' }); }
  });
  server.requestTimeout = 90_000;
  server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT는 1~65535 사이의 숫자여야 합니다.');
  const server = createServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `${port} 포트가 사용 중입니다. PORT 환경변수로 다른 포트를 지정해 주세요.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`한컴 diff — ${url}\n이 PC에서만 접속할 수 있습니다. 종료: Ctrl+C`);
    if (process.platform === 'win32' && process.env.HWP_DIFF_OPEN_BROWSER === '1') {
      const browser = spawn('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
      browser.on('error', () => console.error(`브라우저를 열지 못했습니다. ${url} 주소를 직접 열어 주세요.`));
    }
  });
}
