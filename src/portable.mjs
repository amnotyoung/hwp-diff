import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from './server.mjs';

function defaultBrowser(url) {
  return new Promise((resolve, reject) => {
    const child = process.platform === 'darwin' ? spawn('/usr/bin/open', [url], { stdio: 'ignore' })
      : spawn('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('기본 브라우저를 열지 못했습니다.')));
  });
}

// The single-file launcher waits for this process. Closing its final browser tab
// closes the SSE connection; a grace period permits reloads and tab replacement.
export async function launchPortable({ openBrowser = defaultBrowser, closeDelay = 10_000, startupTimeout = 120_000 } = {}) {
  const clients = new Set(); let idleTimer, startupTimer, stopped = false;
  const heartbeat = setInterval(() => { for (const res of clients) res.write(': keep-alive\n\n'); }, 20_000);
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(idleTimer); clearTimeout(startupTimer); clearInterval(heartbeat);
    for (const res of clients) res.end(); clients.clear();
    server.close(); server.closeAllConnections();
  };
  const lifecycle = {
    stop,
    attach(res) {
      clearTimeout(idleTimer); clearTimeout(startupTimer); clients.add(res);
      res.on('close', () => {
        clients.delete(res);
        if (!clients.size && !stopped) idleTimer = setTimeout(stop, closeDelay);
      });
    },
  };
  const server = createServer({ lifecycle });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    startupTimer = setTimeout(stop, startupTimeout);
    await openBrowser(url);
    return { server, url, stop };
  } catch (error) { stop(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--self-test')) {
      const app = await launchPortable({ openBrowser: async () => {} });
      try {
        const response = await fetch(`${app.url}/api/demo`, { method: 'POST', headers: { 'X-Hwp-Diff': '1' } });
        const data = await response.json();
        if (!response.ok || data.stats.modified !== 3) throw new Error('패키지 비교 검증 실패');
        const form = new FormData(); form.append('demo', '1'); form.append('side', 'new');
        const preview = await fetch(`${app.url}/api/preview`, { method: 'POST', headers: { 'X-Hwp-Diff': '1' }, body: form });
        if (!preview.ok || !(await preview.json()).image.startsWith('data:image/svg+xml')) throw new Error('패키지 렌더 검증 실패');
        console.log(JSON.stringify({ ok: true, arch: process.arch, node: process.version, comparison: data.stats }));
      } finally { app.stop(); }
    } else {
      const app = await launchPortable();
      process.once('SIGINT', app.stop); process.once('SIGTERM', app.stop);
    }
  } catch (error) {
    console.error(`HWP diff를 실행하지 못했습니다. ${error.message}`);
    process.exitCode = 1;
  }
}
