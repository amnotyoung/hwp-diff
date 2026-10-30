import { readFile, writeFile, mkdir, rm, cp, symlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { root, cache, out, inputs, pkg, hash, archive, command, preparePayload } from './package-common.mjs';
if (process.platform !== 'darwin') throw new Error('Mac 앱/DMG 빌드는 macOS에서 실행하세요.');

// One DMG per chip. A universal app carries Intel code, and macOS 26 warns
// Apple Silicon users about apps that contain or run Intel components.
const targets = { arm64: { clang: 'arm64', label: 'Apple Silicon' }, x64: { clang: 'x86_64', label: 'Intel' } };
for (const [arch, input] of Object.entries(inputs.macArchives)) {
  const target = targets[arch];
  if (!target) throw new Error(`알 수 없는 Mac 아키텍처: ${arch}`);
  const { path } = await archive(input), runtime = join(cache, `node-mac-${arch}`);
  await mkdir(runtime, { recursive: true }); command('tar', ['-xzf', path, '-C', runtime, '--strip-components=1']);
  const { stage, manifest } = await preparePayload(`mac-${arch}`);
  const imageRoot = join(cache, `mac-image-${arch}`); await rm(imageRoot, { recursive: true, force: true }); await mkdir(imageRoot, { recursive: true });
  const app = join(imageRoot, '한컴 diff.app'), contents = join(app, 'Contents'), resources = join(contents, 'Resources');
  await mkdir(join(contents, 'MacOS'), { recursive: true }); await mkdir(resources, { recursive: true });
  await cp(stage, join(resources, 'app'), { recursive: true });
  const dest = join(resources, `runtime-${arch}`); await mkdir(dest);
  await cp(join(runtime, 'bin/node'), join(dest, 'node')); await chmod(join(dest, 'node'), 0o755);
  await cp(join(runtime, 'LICENSE'), join(dest, 'LICENSE'));
  await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.hancomdiff.app</string>
<key>CFBundleName</key><string>한컴 diff</string><key>CFBundleDisplayName</key><string>한컴 diff</string>
<key>CFBundleExecutable</key><string>HancomDiff</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${pkg.version}</string><key>CFBundleShortVersionString</key><string>${pkg.version}</string>
<key>LSMinimumSystemVersion</key><string>11.0</string><key>LSUIElement</key><true/>
</dict></plist>`);
  const launcher = join(contents, 'MacOS/HancomDiff');
  command('clang', ['-arch', target.clang, '-mmacosx-version-min=11.0', '-Os', join(root, 'packaging/mac-launcher.c'), '-o', launcher]);
  command('codesign', ['--force', '--sign', '-', '--timestamp=none', app]);
  command('codesign', ['--verify', '--strict', app]);
  // Run the bundled runtime only on its own chip: running Intel code through
  // Rosetta triggers the same macOS warning this split avoids.
  let runtimeTest = { ok: null, skipped: `빌드 PC(${process.arch})와 대상(${arch})의 칩이 달라 실행하지 않음` };
  if (process.arch === arch) {
    console.log(`Mac ${target.label} 포함 런타임/워커/렌더 자체 검증`);
    runtimeTest = JSON.parse(command(launcher, ['--self-test']).trim());
    if (!runtimeTest.ok) throw new Error('Mac 앱 자체 검증 실패');
  }
  await symlink('/Applications', join(imageRoot, 'Applications'));
  const output = join(out, `한컴 diff (${target.label}).dmg`);
  console.log(`Mac ${target.label} DMG 생성`);
  command('hdiutil', ['create', '-volname', '한컴 diff', '-srcfolder', imageRoot, '-format', 'UDZO', '-ov', output]);
  command('hdiutil', ['verify', output]);
  const dmg = await readFile(output);
  const release = { ...manifest, files: manifest.files.length, bytes: dmg.length, sha256: hash(dmg), signing: 'ad-hoc', notarized: false, runtimeTest };
  await writeFile(join(out, `mac-${arch}-build-info.json`), JSON.stringify(release, null, 2));
  console.log(`${output}\n${(dmg.length / 1024 / 1024).toFixed(1)} MB · SHA256 ${release.sha256}`);
}
