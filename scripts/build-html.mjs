import { createBuildInfo } from '../src/app-info.mjs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleFiles } from '../src/sample-data.mjs';
import { htmlNotices } from './html-notices.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const compat = name => resolve(root, 'browser/compat', `${name}.js`);
const files = await sampleFiles();
const demo = Object.values(files).map(file => ({ name: file.name, base64: Buffer.from(file.bytes).toString('base64') }));
const browserPlugin = {
  name: 'offline-browser-runtime',
  setup(bundler) {
    bundler.onResolve({ filter: /^embedded-demo$/ }, () => ({ path: 'demo', namespace: 'embedded' }));
    bundler.onLoad({ filter: /.*/, namespace: 'embedded' }, () => ({ contents: `export default ${JSON.stringify(demo)}` }));
    bundler.onResolve({ filter: /(^|\/)transport\.js$/ }, args => args.importer.endsWith('public/app.js') || args.importer.endsWith('public\\app.js') ? { path: resolve(root, 'browser/transport.js') } : undefined);
    bundler.onResolve({ filter: /^(node:)?(zlib|module|fs(?:\/promises)?|child_process|os|crypto|url|path|util)$/ }, args => ({ path: compat(/^(?:node:)?zlib$/.test(args.path) ? 'zlib' : /^(?:node:)?module$/.test(args.path) ? 'module' : 'unavailable') }));
    // Keep JSZip's streaming entry: Kordoc uses nodeStream to bound XML inflation.
    bundler.onResolve({ filter: /^jszip$/ }, () => ({ path: require.resolve('jszip/lib/index.js') }));
    bundler.onResolve({ filter: /^readable-stream$/ }, () => ({ path: require.resolve('readable-stream/readable-browser.js') }));
    // These optional Kordoc features are unreachable for accepted HWP5/HWPX inputs.
    bundler.onResolve({ filter: /^(sharp|puppeteer-core)$|\/(image-ocr|parser)-[^/]+\.js$/ }, () => ({ path: compat('unavailable') }));
  },
};
const common = { absWorkingDir: root, bundle: true, write: false, minify: true, metafile: true, target: 'es2022', legalComments: 'inline', plugins: [browserPlugin] };
const worker = await build({ ...common, entryPoints: ['browser/worker.js'], format: 'esm', platform: 'browser',
  mainFields: ['module', 'main'], inject: [compat('globals')], define: { 'import.meta.url': '""' } });
const app = await build({ ...common, entryPoints: ['browser/entry.js'], format: 'iife', platform: 'browser' });
const inline = text => text.replace(/<\/script/gi, '<\\/script');
const workerSource = `(async()=>{${worker.outputFiles[0].text}\n})().catch(error=>self.postMessage({error:'문서 처리 기능 초기화 실패: '+error.message}));`;
const notices = await htmlNotices(root, [worker, app]);
const css = await readFile(resolve(root, 'public/style.css'), 'utf8');
const payloadHash = createHash('sha256').update(workerSource).update(app.outputFiles[0].text).update(css).digest('hex');
const appBuild = await createBuildInfo(root, {target:'standalone-html',builtAt:new Date().toISOString(),payloadHash});
const buildJson = JSON.stringify(appBuild).replaceAll('<', '\\u003c');
let html = await readFile(resolve(root, 'public/index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./style.css">', () => `<style>${css}</style>`)
  .replace('  <script src="./launch-guard.js" defer></script>', '')
  .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'">`)
  .replace(/<main id="launch-help"[\s\S]*?<\/main>/, `<main id="launch-help" class="launch-help">
    <h1>HWP diff</h1><p id="launch-status" role="status">JavaScript를 실행할 수 없거나 시작하지 못했습니다. Edge·Chrome에서 이 HTML 파일을 직접 열고, 기관 담당자에게 로컬 HTML·JavaScript·Worker 실행 정책을 확인해 주세요.</p>
    <button type="button" class="app-version-button" data-app-version aria-label="앱 버전 정보" aria-haspopup="dialog" aria-expanded="false">버전 정보</button>
    <button id="launch-retry" class="button primary" hidden>다시 시도</button>
    <p>브라우저 보안 해제나 관리자 권한은 필요하지 않습니다.</p></main>`)
  .replace('class="brand" href="/"', 'class="brand" href="#"')
  .replace('HWP · HWPX / 파일당 최대 20MB', 'HWP 5.x · HWPX / 파일당 최대 20MB')
  .replace('문서는 메모리에서 처리하며 원본 파일은 수정하지 않습니다.', '문서는 메모리에서 처리하며 외부 전송·자동 저장하지 않습니다.')
  .replace('<div id="empty-state"></div>', `<div id="empty-state"><details class="launch-note"><summary>지원 범위와 처리 한도</summary><p>HWP 5.x·HWPX 내용과 HWPX 글자 서식·메모를 비교합니다. HWP 서식·메모, HWP 3.x·암호·DRM·배포용 문서는 지원하지 않습니다. 미리보기는 한컴 화면과 다를 수 있습니다.</p><p>파일당 20MB로 제한합니다. 문단·표는 자동으로 나눠 비교하며 완료한 구간마다 진행 상황을 표시합니다. 응답 없는 처리는 60초, 자동 분할 작업 전체는 최대 5분으로 제한합니다. HWPX는 압축 해제 후 본문·서식 한 개 32MiB·합계 64MiB, 그림 한 개 64MiB·합계 192MiB까지 처리합니다. 그림이 처리 한도를 넘으면 그림의 참조와 자리는 유지한 내부 처리본으로 본문 비교를 계속합니다. 이 경우 미리보기에서 그림이 생략됐음을 안내합니다. 문서 복잡도와 브라우저 메모리에 따라 더 작은 파일도 중단될 수 있습니다.</p></details></div>`)
  .replace('</body>', () => `${notices}\n<script id="app-build-info" type="application/json">${buildJson}</script>\n<script id="document-worker" type="text/plain">${Buffer.from(workerSource).toString('base64')}</script>\n<script>${inline(app.outputFiles[0].text)}</script>\n</body>`);
const output = resolve(root, process.argv[2] ?? 'artifacts/HWP-diff.html');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html);
await writeFile(output + '.build.json', JSON.stringify({...appBuild,fileSha256:createHash('sha256').update(html).digest('hex')},null,2));
console.log(`${output} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
