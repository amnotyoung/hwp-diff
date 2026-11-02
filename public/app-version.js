const modes = { 'standalone-html':'단일 HTML', 'node-source':'Node 소스 실행', 'win-x64':'Windows EXE', 'mac-arm64':'macOS 앱', 'mac-x64':'macOS 앱' };
export function versionFeedback(info) {
  return [
    info.app ?? 'HWP diff',
    `앱 버전: ${info.version ?? '확인 불가'}`,
    `빌드 ID: ${info.buildId ?? '확인 불가'}`,
    `빌드 시각(UTC): ${info.builtAt ?? '기록 없음 · 소스 실행 또는 이전 패키지'}`,
    `배포 방식: ${modes[info.target] ?? info.target ?? '확인 불가'}`,
    `코드 커밋: ${info.revision ?? '확인 불가'}`,
    `소스 상태: ${info.dirty === true ? '커밋 전 변경 포함' : info.dirty === false ? '커밋된 소스' : '확인 불가'}`,
    `비교 엔진: ${info.engine ?? '확인 불가'}`,
    ...(info.payloadHash ? [`프로그램 식별값: ${info.payloadHash}`] : []),
  ].join('\n');
}
let initialized;
export function initializeVersionInfo() {
  return initialized ??= setup();
}
async function setup() {
  const dialog = document.getElementById('app-version-dialog');
  const buttons = [...document.querySelectorAll('[data-app-version]')];
  const text = document.getElementById('app-version-text');
  const status = document.getElementById('app-version-status');
  let info = {app:'HWP diff'};
  try {
    const embedded = document.getElementById('app-build-info');
    if (embedded) info = JSON.parse(embedded.textContent);
    else if (/^https?:$/.test(location.protocol)) {
      const response = await fetch('/api/version');
      if (!response.ok) throw new Error('Version unavailable');
      info = await response.json();
    }
  } catch { /* Unknown is shown explicitly; never invent a release identity. */ }
  const short = info.payloadHash?.slice(0, 8) ?? info.revision?.slice(0, 8);
  for (const button of buttons) {
    button.textContent = info.version ? `v${info.version}${short ? ' · ' + short : ''}${info.dirty ? ' (개발)' : ''}` : '버전 확인 불가';
    button.title = '앱 버전 정보 · 피드백용 정보 복사';
    button.addEventListener('click', () => {
      text.value = versionFeedback(info); status.textContent = '';
      dialog.showModal(); button.setAttribute('aria-expanded', 'true');
    });
  }
  document.getElementById('app-version-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => buttons.forEach(b => b.setAttribute('aria-expanded', 'false')));
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
  });
  document.getElementById('app-version-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text.value);
      status.textContent = '버전 정보를 복사했습니다. 피드백에 붙여 넣어 주세요.';
    } catch {
      text.focus(); text.select();
      status.textContent = '자동 복사가 제한됐습니다. 선택된 내용을 Ctrl+C로 복사해 주세요.';
    }
  });
  return info;
}
