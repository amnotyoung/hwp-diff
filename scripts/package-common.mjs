import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, basename, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const cache = join(root, '.build-cache'), out = join(root, 'dist');
export const inputs = JSON.parse(await readFile(join(root, 'packaging/inputs.json'), 'utf8'));
export const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
export const hash = data => createHash('sha256').update(data).digest('hex');
export async function archive(input) {
  await mkdir(cache, { recursive: true });
  const path = join(cache, input.name); let data;
  try { data = await readFile(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (process.argv.includes('--offline')) throw new Error(`빌드 캐시가 없습니다: ${input.name}`);
    console.log(`다운로드: ${input.name}`);
    const response = await fetch(input.url); if (!response.ok) throw new Error(`다운로드 실패: ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
    if (hash(data) !== input.sha256) throw new Error(`체크섬 불일치: ${input.name}`);
    await writeFile(path, data);
  }
  if (hash(data) !== input.sha256) throw new Error(`체크섬 불일치: ${input.name}`);
  return { path, data };
}
export function command(executable, args, options = {}) {
  const r = spawnSync(executable, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw new Error(`${basename(executable)} 실패: ${r.error?.message ?? ''}\n${r.stderr || r.stdout}`);
  return r.stdout;
}
export async function filesUnder(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.bin') continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`배포 대상에 심볼릭 링크가 있습니다: ${relative(root, path)}`);
    if (entry.isDirectory()) paths.push(...await filesUnder(path)); else paths.push(path);
  }
  return paths;
}
export async function preparePayload(target, extras = {}) {
  const stage = join(cache, `payload-${target}`);
  await mkdir(cache, { recursive: true }); await mkdir(out, { recursive: true });
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  for (const [path, spec] of Object.entries(lock.packages)) {
    if (!path || spec.optional || spec.dev) continue;
    const installed = JSON.parse(await readFile(join(root, path, 'package.json'), 'utf8'));
    if (installed.version !== spec.version) throw new Error(`설치 버전 불일치: ${path}. npm ci --omit=optional --ignore-scripts로 준비하세요.`);
  }
  const dependencies = await filesUnder(join(root, 'node_modules'));
  if (dependencies.some(p => /\.(node|dll|so|dylib)$/i.test(p))) throw new Error('네이티브 의존성이 있습니다. 대상 OS용 의존성 검증이 필요합니다.');
  await rm(stage, { recursive: true, force: true }); await mkdir(stage, { recursive: true });
  // Explicit allowlist: no documents, tests, credentials, .git or prior artifacts.
  for (const path of ['src', 'public', 'node_modules', 'package.json', 'package-lock.json', 'README.md']) {
    await cp(join(root, path), join(stage, path), { recursive: true, filter: path => basename(path) !== '.bin' });
  }
  for (const [name, source] of Object.entries(extras)) await cp(source, join(stage, name));
  console.log('포함된 앱으로 문서 비교·렌더링 검증');
  command(process.execPath, ['--input-type=module', '-e', `
    import { sampleFiles } from './src/sample-data.mjs';
    import { compareDocuments } from './src/engine.mjs';
    import { previewDocument } from './src/preview.mjs';
    const f = await sampleFiles(); const r = await compareDocuments(f.oldFile, f.newFile);
    if (r.stats.modified !== 3) throw new Error('packaged comparison failed');
    const p = await previewDocument(f.newFile);
    if (!p.image.startsWith('data:image/svg+xml')) throw new Error('packaged preview failed');
  `], { cwd: stage });
  const entries = [];
  for (const path of (await filesUnder(stage)).sort()) entries.push({ path: relative(stage, path).replaceAll('\\', '/'), sha256: hash(await readFile(path)) });
  let revision = 'unknown'; try { revision = command('git', ['rev-parse', 'HEAD']).trim(); } catch {}
  const manifest = { app: '한컴 diff', version: pkg.version, target, runtime: inputs.nodeVersion, revision, files: entries };
  await writeFile(join(stage, 'BUILD-MANIFEST.json'), JSON.stringify(manifest, null, 2));
  return { stage, manifest };
}
