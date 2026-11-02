// Keep imports limited to built-ins so startup dependency failures can be logged.
import { appendFileSync } from 'node:fs';
import { release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function createStartupReporter(logPath, output = line => console.log(line)) {
  let writable = Boolean(logPath);
  return (stage, details = {}) => {
    // Only explicit startup events are recorded; never intercept request logs,
    // document names, document text, environment variables or console output.
    const line = `${new Date().toISOString()} ${stage} ${JSON.stringify(details)}`;
    output(line);
    if (writable) {
      try { appendFileSync(logPath, line + '\n', 'utf8'); }
      catch (error) {
        writable = false;
        output(`log-write-failed ${error.code ?? 'UNKNOWN'}; startup continues`);
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
