import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { root, cache, out, inputs, pkg, hash, archive, command, preparePayload } from './package-common.mjs';
const escape = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
const [runtime, nsis] = await Promise.all([archive(inputs.nodeArchive), archive(inputs.nsisArchive)]);
const tools = join(cache, 'nsis-3.12'); await mkdir(tools, { recursive: true });
command('tar', ['-xzf', nsis.path, '-C', tools, '--strip-components=1']);
const zip = await JSZip.loadAsync(runtime.data), prefix = `node-v${inputs.nodeVersion}-win-x64/`;
const node = await zip.file(prefix + 'node.exe').async('nodebuffer');
if (node.toString('ascii', 0, 2) !== 'MZ' || node.readUInt16LE(node.readUInt32LE(0x3c) + 4) !== 0x8664) throw new Error('Windows x64 Node 실행 파일이 아닙니다.');
const nodePath = join(cache, 'node.exe'), license = join(cache, 'NODE-LICENSE.txt');
await writeFile(nodePath, node); await writeFile(license, await zip.file(prefix + 'LICENSE').async('nodebuffer'));
const { stage, manifest } = await preparePayload('win-x64', { 'NSIS-LICENSE.txt': join(tools, 'LICENSE') });
const compiler = process.platform === 'win32' ? join(tools, 'windows', 'makensis.exe') : join(tools, process.platform === 'darwin' ? 'mac' : 'linux', process.arch, 'makensis');
await lstat(compiler);
const output = join(out, 'HWP diff.exe'), flag = process.platform === 'win32' ? '/' : '-';
console.log('Windows 단일 EXE 압축');
// The script contains Korean text. Off Windows, makensis converts it through the
// process locale, so an unset locale (C) fails with 'Bad text encoding'.
const log = command(compiler, [flag + 'V2', flag + 'NOCONFIG', flag + 'INPUTCHARSET', 'UTF8', flag + 'DPAYLOAD_DIR=' + escape(stage),
  flag + 'DNODE_EXE=' + escape(nodePath), flag + 'DNODE_LICENSE=' + escape(license), flag + 'DOUTPUT_EXE=' + escape(output),
  flag + 'DAPP_VERSION=' + pkg.version, flag + 'DAPP_QUAD_VERSION=' + pkg.version + '.0', join(root, 'packaging/portable.nsi')],
  { env: { ...process.env, NSISDIR: join(tools, 'windows'), ...(process.platform === 'win32' ? {} : { LC_ALL: 'en_US.UTF-8' }) } });
if (log.trim()) console.log(log.trim());
const exe = await readFile(output), release = { ...manifest, files: manifest.files.length, bytes: exe.length, sha256: hash(exe), signed: false, windowsRuntimeTested: false };
await writeFile(join(out, 'windows-build-info.json'), JSON.stringify(release, null, 2));
console.log(`${output}\n${(exe.length / 1024 / 1024).toFixed(1)} MB · SHA256 ${release.sha256}`);
