// Keep imports limited to built-ins so startup dependency failures can be logged.
import { appendFileSync } from 'node:fs';
import { release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// The native launcher has a narrow, single-line list. Keep screen output short;
// the file below retains timestamps and the complete structured event.
export function formatStartupStatus(stage, details = {}) {
  const lines = [stage];
  if (stage === 'runtime-started') lines.push(`Node ${details.node} / ${details.platform} ${details.arch}`);
  if (details.url && ['server-ready', 'browser-open-failed'].includes(stage)) lines.push(details.url);
  if (details.code) lines.push(`code: ${details.code}`);
  if (details.reason) lines.push(`reason: ${details.reason}`);
  return lines.flatMap(line => Array.from(String(line)).reduce((parts, char, index) => {
    if (index % 48 === 0) parts.push('');
    parts[parts.length - 1] += char;
    return parts;
  }, []));
}

export function createStartupReporter(logPath, output = line => console.log(line)) {
  let writable = Boolean(logPath);
  return (stage, details = {}) => {
    // Only explicit startup events are recorded; never intercept request logs,
    // document names, document text, environment variables or console output.
    const line = `${new Date().toISOString()} ${stage} ${JSON.stringify(details)}`;
    for (const status of formatStartupStatus(stage, details)) output(status);
    if (writable) {
      try { appendFileSync(logPath, line + '\n', 'utf8'); }
      catch (error) {
        writable = false;
        output('log-write-failed');
        for (const status of formatStartupStatus('startup-continues', { code: error.code ?? 'UNKNOWN' })) output(status);
      }
    }
  };
}

export async function startDiagnostic({ logPath, openBrowser, startupTimeout, output } = {}) {
  const report = createStartupReporter(logPath, output);
  report('runtime-started', { node: process.version, platform: process.platform, arch: process.arch, os: release() });
  try {
    const { launchPortable } = await import('./portable.mjs');
    report('modules-loaded');
    return await launchPortable({ report, openBrowser, startupTimeout });
  } catch (error) {
    report('startup-failed', { code: error.code ?? error.name ?? 'UNKNOWN' });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const index = process.argv.indexOf('--log');
    const app = await startDiagnostic({ logPath: index >= 0 ? process.argv[index + 1] : undefined });
    process.once('SIGINT', () => app.stop('SIGINT'));
    process.once('SIGTERM', () => app.stop('SIGTERM'));
  } catch {
    process.exitCode = 1;
  }
}
