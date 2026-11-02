import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export async function createBuildInfo(root, { target = 'node-source', builtAt = null, payloadHash = null } = {}) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 3000 });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const revision = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain', '--untracked-files=normal']);
  const dirty = status === null ? null : status.length > 0;
  const stamp = builtAt ? new Date(builtAt).toISOString().replace(/[-:.]/g, '') : 'source';
  const identity = `${revision?.slice(0, 8) ?? 'unknown'}${dirty ? '-dirty' : ''}`;
  return {
    app: 'HWP diff', version: pkg.version, target, builtAt,
    buildId: `${pkg.version}+${stamp}.${identity}${payloadHash ? '.' + payloadHash.slice(0, 10) : ''}`,
    revision, dirty, payloadHash, engine: `Kordoc ${pkg.dependencies.kordoc}`,
  };
}

export async function runtimeBuildInfo(root) {
  try {
    const manifest = JSON.parse(await readFile(join(root, 'BUILD-MANIFEST.json'), 'utf8'));
    if (manifest.appBuild) return manifest.appBuild;
    return { app:manifest.app, version:manifest.version, target:manifest.target, builtAt:null,
      buildId:`${manifest.version}+${manifest.revision ?? 'unknown'}`, revision:manifest.revision,
      dirty:null, payloadHash:null, engine:null };
  } catch { return createBuildInfo(root); }
}
