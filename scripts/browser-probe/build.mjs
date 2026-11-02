import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from '../../.build-cache/html-tools/node_modules/esbuild/lib/main.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const compatibility = {
  name: 'browser-probe-compatibility',
  setup(b) {
    b.onResolve({ filter: /^jszip$/ }, () => ({ path: root + 'node_modules/jszip/lib/index.js' }));
    b.onResolve({ filter: /^pdfjs-dist\// }, () => ({ path: root + 'scripts/browser-probe/unsupported-pdf.mjs' }));
    b.onResolve({ filter: /^(node:)?[\w_]/ }, ({ path }) => {
      const name = path.replace(/^node:/, '');
      if (!builtins.has(name)) return;
      if (name === 'module' || name === 'crypto') return { path: root + `scripts/browser-probe/${name}.mjs` };
      return { path: root + `.build-cache/html-tools/node_modules/@jspm/core/nodelibs/browser/${name}.js` };
    });
  },
};
const result = await build({
  absWorkingDir: root, entryPoints: ['scripts/browser-probe/worker.mjs'], bundle: true,
  mainFields: ['module', 'main'], write: false, format: 'esm', platform: 'browser',
  target: 'es2022', minify: true, metafile: true,
  define: { 'import.meta.url': 'self.location.href' },
  external: ['sharp', 'onnxruntime-node', '@huggingface/tokenizers', '@hyzyla/pdfium', 'puppeteer-core'],
  inject: process.argv.includes('--plain') ? [] : ['scripts/browser-probe/globals.mjs'],
  plugins: process.argv.includes('--plain') ? [] : [compatibility],
});
// Classic Blob workers work in file:// without a module fetch or a server.
// Send the request only after all asynchronous library initialization finishes.
const worker = '(async()=>{' + result.outputFiles[0].text + '\nself.postMessage({ready:true});})().catch(error=>self.postMessage({error:error.message}));';
const template = await readFile(new URL('./template.html', import.meta.url), 'utf8');
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const packageDirs = new Set(Object.keys(result.metafile.inputs).map(path => path.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean));
const notices = [await readFile(root+'LICENSE','utf8'), await readFile(root+'node_modules/kordoc/NOTICE','utf8')];
for (const directory of packageDirs) {
  for (const name of await readdir(resolve(root,directory))) {
    if (/^(license|licence|copyright|notice)(\.|$)/i.test(name)) {
      try { notices.push(`${directory}/${name}\n` + await readFile(resolve(root,directory,name),'utf8')); } catch (e) { if(e.code!=='EISDIR')throw e; }
    }
  }
}
const html = template.replace('/*WORKER_SOURCE*/', () => JSON.stringify(worker).replaceAll('<', '\\u003c'))
  .replace('<!--NOTICES-->', () => `<details><summary>오픈소스 고지</summary><pre>${escape(notices.join('\n\n'))}</pre></details>`);
await mkdir(root + 'artifacts/browser-probe', { recursive: true });
const output = 'artifacts/browser-probe/HWP diff HTML 검증.html';
await writeFile(root + output, html);
await writeFile(root + 'artifacts/browser-probe/build-info.json', JSON.stringify({
  output, bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex'),
  kordoc: '4.24.21', esbuild: '0.25.12', jspmCore: '2.1.0',
},null,2));
console.log(JSON.stringify({ workerBytes: Buffer.byteLength(worker), output }));
