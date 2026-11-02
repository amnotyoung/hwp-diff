import { probeWorker } from './transport.js';
const help = document.getElementById('launch-help');
const retry = document.getElementById('launch-retry');
async function start() {
  retry.hidden = true;
  document.getElementById('launch-status').textContent = '문서 처리 기능을 확인하고 있습니다…';
  try {
    await probeWorker();
    await import('../public/app.js');
    help.hidden = true;
    document.getElementById('app-shell').hidden = false;
  } catch (error) {
    document.getElementById('launch-status').textContent = error.message;
    retry.hidden = false;
  }
}
retry.addEventListener('click', start);
start();
