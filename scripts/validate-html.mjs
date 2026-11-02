import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import JSZip from 'jszip';
import { markdownToHwpx } from 'kordoc';
import { sampleFiles } from '../src/sample-data.mjs';
import { compareDocuments } from '../src/engine.mjs';
import { previewDocument } from '../src/preview.mjs';
import { previewTargets } from '../public/report.js';
import { formatSamples } from '../tests/helpers/format-fixture.mjs';
import { memoFixture } from '../tests/helpers/memo-fixture.mjs';
import { hwpFixture } from '../tests/helpers/hwp-fixture.mjs';
import { automaticComparisonPairs } from '../tests/helpers/automatic-fixture.mjs';
import { imageHeavyPair } from '../tests/helpers/image-heavy-fixture.mjs';

// No server, browser security exceptions or downloads of browser binaries.
const isolated = await mkdtemp(join(tmpdir(), 'hwp-diff-html-'));
await copyFile(resolve('artifacts/HWP-diff.html'), join(isolated, 'HWP-diff.html'));
const url = pathToFileURL(join(isolated, 'HWP-diff.html')).href;
const artifacts = resolve('artifacts/browser-validation');
await mkdir(artifacts, { recursive: true });
const samples = Object.values(await sampleFiles());
const hwp = [{ name: '구버전.hwp', bytes: hwpFixture() }, { name: '신버전.hwp', bytes: hwpFixture(['사업비는 501만원입니다.']) }];
const plainHwp = hwp.map((file, i) => ({ ...file, bytes: hwpFixture([`사업비는 ${500 + i}만원입니다.`], { compressed: false }) }));
const formats = await formatSamples(), memos = await memoFixture();
const mixed = [hwp[0], { name: '혼합.hwpx', bytes: new Uint8Array(await markdownToHwpx('사업비는 501만원입니다.')) }];
const pictureHeavy = await imageHeavyPair();
const automatic=await automaticComparisonPairs();
const cases = [
  ['hwpx-change', samples], ['hwpx-identical', [samples[0], samples[0]]],
  ['format', formats], ['memo', memos], ['hwp-compressed', hwp],
  ['hwp-uncompressed', plainHwp], ['hwp-identical', [hwp[0], hwp[0]]], ['mixed', mixed],
  ['hwpx-9MiB-pictures', pictureHeavy],
  ['automatic-repeated',automatic.repeated], ['automatic-2101-paragraphs',automatic.large],
];
const baseline = new Map();
const withoutTime = result => { const copy = structuredClone(result); delete copy.createdAt; return copy; };
const encodeFile = file => ({ name: file.name, base64: Buffer.from(file.bytes).toString('base64') });
for (const [name, pair] of cases) {
  const result = await compareDocuments(...pair);
  const previews = await Promise.all(pair.map((file, i) => previewDocument(file, 1, { targets: previewTargets(result, i ? 'new' : 'old') })));
  baseline.set(name, { result, previews });
}

async function workerJob(page, data) {
  return page.evaluate(async data => {
    const source = new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('document-worker').textContent), c => c.charCodeAt(0)));
    for (const key of ['oldFile', 'newFile', 'file']) if (data[key]) {
      const { name, base64 } = data[key];
      data[key] = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], name);
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url), stages = [];
      const finish = outcome => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); resolve({ ...outcome, stages }); };
      const timer = setTimeout(() => { worker.terminate(); URL.revokeObjectURL(url); reject(new Error('worker timed out')); }, 60_000);
      worker.onmessage = ({ data: response }) => {
        if (response.ready) worker.postMessage(data);
        else if (response.progress) stages.push(response.progress);
        else finish(response);
      };
      worker.onerror = event => finish({ error: event.message });
    });
  }, data);
}
async function ready(page) {
  await page.goto(url);
  await page.locator('#app-shell').waitFor({ state: 'visible', timeout: 65_000 });
}
async function idle(page) { await page.waitForFunction(() => document.getElementById('cancel').hidden, null, { timeout: 65_000 }); }
async function upload(page, pair) {
  for (const [index, side] of ['old', 'new'].entries()) await page.locator(`#${side}-file`).setInputFiles({ name: pair[index].name, mimeType: 'application/octet-stream', buffer: Buffer.from(pair[index].bytes) });
}
async function exportJson(page) {
  await page.locator('#workbench-menu > summary').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-json').click();
  const download = await downloadPromise;
  const data = JSON.parse(await readFile(await download.path(), 'utf8'));
  await page.keyboard.press('Escape');
  return data;
}

const report = { platform: process.platform, os: (await import('node:os')).release(), copiedHtml: url, channels: [] };
for (const channel of process.argv.slice(2).length ? process.argv.slice(2) : ['msedge', 'chrome']) {
  const browser = await chromium.launch({ channel, headless: true, chromiumSandbox: true });
  try {
    const context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    const requests = [], errors = [];
    context.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await ready(page);
    const openingUrl=page.url();
    await page.locator('.topbar .brand').click();
    assert.equal(page.url(),openingUrl,'app name must not navigate to file root');
    const buildInfo=await page.locator('#app-build-info').evaluate(el=>JSON.parse(el.textContent));
    assert.equal(buildInfo.version,'0.2.0');assert.equal(buildInfo.target,'standalone-html');
    assert.ok(buildInfo.buildId.includes(buildInfo.revision.slice(0,8)));
    assert.match(await page.locator('.topbar [data-app-version]').textContent(), /v0\.2\.0/);
    await page.locator('.topbar [data-app-version]').click();
    assert.equal(await page.locator('#app-version-dialog').isVisible(),true);
    assert.ok((await page.locator('#app-version-text').inputValue()).includes(buildInfo.buildId));
    await page.evaluate(()=>{window.__versionCopied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__versionCopied=text;}}});});
    await page.locator('#app-version-copy').click();
    assert.ok((await page.evaluate(()=>window.__versionCopied)).includes(buildInfo.buildId));
    await page.keyboard.press('Escape');assert.equal(await page.locator('#app-version-dialog').isVisible(),false);
    await page.locator('.topbar [data-app-version]').click();await page.mouse.click(1,1);
    assert.equal(await page.locator('#app-version-dialog').isVisible(),false);
    await page.locator('.topbar [data-app-version]').click();
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('blocked');}}}));
    await page.locator('#app-version-copy').click();
    assert.match(await page.locator('#app-version-status').textContent(),/Ctrl\+C/);
    assert.equal(await page.locator('#app-version-text').evaluate(el=>el.selectionEnd-el.selectionStart), (await page.locator('#app-version-text').inputValue()).length);
    await page.locator('#app-version-close').click();
    const results = [];
    for (const [name, pair] of cases) {
      const actual = await workerJob(page, { operation: 'compare', oldFile: encodeFile(pair[0]), newFile: encodeFile(pair[1]) });
      assert.equal(actual.error, undefined, `${name}: ${actual.error}`);
      assert.deepEqual(withoutTime(actual.result), withoutTime(baseline.get(name).result), `${name}: complete JSON`);
      assert.deepEqual([...new Set(actual.stages.filter(step => step.step).map(step => step.step))], [1, 2, 3, 4]);
      if(name.startsWith('automatic-')) assert.ok(actual.stages.some(step=>step.checkpoint>0),'automatic work emits completed checkpoints');
      for (const [i, side] of ['old', 'new'].entries()) {
        const preview = await workerJob(page, { operation: 'preview', file: encodeFile(pair[i]), page: 1, options: { targets: previewTargets(actual.result, side) } });
        assert.equal(preview.error, undefined, `${name}: ${preview.error}`);
        assert.deepEqual(preview.result, baseline.get(name).previews[i], `${name}: ${side} complete preview`);
      }
      results.push(name); console.log(`${channel}: ${name} JSON + both SVG previews match Node`);
    }
    const broken = await workerJob(page, { operation: 'compare', oldFile: encodeFile({ name: 'broken.hwp', bytes: new Uint8Array([1, 2, 3]) }), newFile: encodeFile(samples[1]) });
    assert.ok(broken.error); assert.equal(broken.result, undefined);
    const encrypted = await workerJob(page, { operation: 'compare', oldFile: encodeFile({ name: 'encrypted.hwp', bytes: hwpFixture(undefined, { flags: 2 }) }), newFile: encodeFile(hwp[1]) });
    assert.ok(encrypted.error); assert.equal(encrypted.result, undefined);
    const zip = new JSZip(); zip.file('Contents/section0.xml', new Uint8Array(32 * 1024 * 1024 + 1));
    const bomb = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const limited = await workerJob(page, { operation: 'compare', oldFile: encodeFile({ name: 'large.hwpx', bytes: bomb }), newFile: encodeFile(samples[1]) });
    assert.match(limited.error, /압축 해제/); assert.equal(limited.result, undefined);

    const recovered = await workerJob(page, {operation:'compare',oldFile:encodeFile(automatic.picture[0]),newFile:encodeFile(automatic.picture[1])});
    assert.equal(recovered.error,undefined);
    const expectedRecovered=await compareDocuments(...automatic.picture);
    assert.deepEqual(recovered.result.diffs,expectedRecovered.diffs);
    assert.deepEqual(recovered.result.documents,expectedRecovered.documents);
    assert.equal(recovered.result.warnings.filter(w=>w.code==='PICTURES_OMITTED').length,2);
    const reducedPreview=await workerJob(page,{operation:'preview',file:encodeFile(automatic.picture[0]),page:1,options:{}});
    assert.equal(reducedPreview.error,undefined);assert.equal(reducedPreview.result.rendering.imagesOmitted,true);
    assert.ok(reducedPreview.result.warnings.some(w=>w.includes('그림을 제외')));

    // Real file-selection UI, cancellation/retry, report/JSON download and navigation.
    await upload(page, samples);
    await page.evaluate(() => { document.getElementById('compare').click(); document.getElementById('cancel').click(); });
    await idle(page);
    assert.match(await page.locator('#status').textContent(), /취소/);
    assert.equal(await page.locator('#results').isVisible(), false);
    await page.locator('#compare').click(); await idle(page);
    assert.deepEqual(withoutTime(await exportJson(page)), withoutTime(baseline.get('hwpx-change').result));
    const reportDownload = page.waitForEvent('download');
    await page.locator('#export-html').click();
    assert.match(await readFile(await (await reportDownload).path(), 'utf8'), /사업기간/);
    await page.evaluate(() => {
      document.getElementById('view-preview').click();
      const cancel = document.getElementById('cancel-preview');
      if (cancel.hidden || cancel.getBoundingClientRect().width === 0) throw new Error('Preview cancellation is not visible');
      cancel.click();
    });
    await idle(page);
    for (const side of ['old', 'new']) {
      assert.equal(await page.locator(`#${side}-preview-retry`).isVisible(), true);
      await page.locator(`#${side}-preview-retry`).click(); await idle(page);
      assert.equal(await page.locator(`#${side}-canvas`).isVisible(), true);
    }
    await page.locator('#view-preview').click(); await idle(page);
    assert.equal(await page.locator('#selection-panel').isVisible(), false);
    assert.equal(await page.locator('#preview-zoom').inputValue(), 'page');
    for (const width of [1440, 960]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: join(artifacts, `${channel}-${width}.png`) });
      assert.equal(await page.locator('.workbench-header [data-app-version]').isVisible(),true);
      const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
        images: ['old', 'new'].map(side => { const img = document.getElementById(`${side}-preview`), box = img.getBoundingClientRect(); return { valid: img.naturalWidth > 0, width: box.width, height: box.height }; }) }));
      assert.ok(geometry.scroll <= geometry.width + 1, 'no horizontal page overflow');
      assert.ok(geometry.images.every(img => img.valid && img.width > 100 && img.height > 100));
    }
    const beforeBrand=await page.locator('#result-title').textContent();
    const beforeSelection=await page.locator('#change-list').inputValue();
    const beforeBrandUrl=page.url();
    await page.locator('.workbench-header .workbench-brand').click();
    assert.equal(page.url(),beforeBrandUrl,'result app name must not navigate to file root');
    assert.equal(await page.locator('#results').isVisible(),true);
    assert.equal(await page.locator('#result-title').textContent(),beforeBrand);
    assert.equal(await page.locator('#change-list').inputValue(),beforeSelection);
    assert.equal(await page.locator('#old-file').evaluate(el=>el.files.length),1);
    await page.locator('.workbench-header [data-app-version]').click();
    assert.ok((await page.locator('#app-version-text').inputValue()).includes(buildInfo.buildId));
    assert.ok(!(await page.locator('#app-version-text').inputValue()).includes(samples[0].name));
    await page.screenshot({path:join(artifacts,`${channel}-version.png`)});
    await page.locator('#app-version-close').click();
    // Mode switches must not move the document or auto-select an item.
    await page.locator('#next-change').click(); await idle(page);
    const selectedContent = await page.locator('#change-list').inputValue();
    const positions = await page.evaluate(() => ['old', 'new'].map(side => ({ page: document.getElementById(`${side}-page`).value, top: document.getElementById(`${side}-viewport`).scrollTop })));
    await page.locator('#view-formats').click();
    assert.equal(await page.locator('#view-preview').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(() => ['old', 'new'].map(side => ({ page: document.getElementById(`${side}-page`).value, top: document.getElementById(`${side}-viewport`).scrollTop }))), positions);
    await page.locator('#view-content').click();
    assert.equal(await page.locator('#change-list').inputValue(), selectedContent);

    // Independent filters and searches are kept when changing review categories.
    await page.locator('#view-list').click();
    await page.locator('[data-filter="modified"]').click();
    await page.locator('#toggle-search').click(); await page.locator('#search').fill('사업');
    await page.waitForFunction(() => document.getElementById('search-count').textContent.includes('일치'));
    await page.locator('#view-memos').click();
    assert.equal(await page.locator('#search').inputValue(), '');
    await page.locator('#view-content').click();
    assert.equal(await page.locator('#search').inputValue(), '사업');
    assert.equal(await page.locator('[data-filter="modified"]').getAttribute('aria-pressed'), 'true');

    // HWP unchecked notices remain visible in the full UI.
    await ready(page); await upload(page, mixed); await page.locator('#compare').click(); await idle(page);
    assert.match(await page.locator('#view-formats').textContent(), /미검사/);
    assert.match(await page.locator('#view-memos').textContent(), /미검사/);
    await page.locator('#notice-menu > summary').click();
    assert.match(await page.locator('#critical-notices').innerText(), /HWP|서식/);
    await page.keyboard.press('Escape');

    await ready(page); await upload(page,automatic.large); await page.locator('#compare').click(); await idle(page);
    assert.deepEqual(withoutTime(await exportJson(page)),withoutTime(baseline.get('automatic-2101-paragraphs').result));

    // A failed read/parse leaves a retryable UI, never an unchanged result.
    await ready(page); await upload(page, [{ name: 'broken.hwp', bytes: new Uint8Array([1, 2, 3]) }, samples[1]]);
    await page.locator('#compare').click(); await idle(page);
    assert.equal(await page.locator('#error').isVisible(), true);
    assert.equal(await page.locator('#results').isVisible(), false);
    assert.equal(await page.locator('#compare').isEnabled(), true);
    await upload(page, samples); await page.locator('#compare').click(); await idle(page);
    assert.equal(await page.locator('#results').isVisible(), true);

    const blocked = await context.newPage();
    await blocked.addInitScript(() => { window.Worker = class { constructor() { throw new DOMException('Blocked by test policy', 'SecurityError'); } }; });
    await blocked.goto(url); await blocked.locator('#launch-retry').waitFor({ state: 'visible' });
    assert.match(await blocked.locator('#launch-status').textContent(), /정책/);
    assert.equal(await blocked.locator('#app-shell').isVisible(), false);
    assert.match(await blocked.locator('#launch-help [data-app-version]').textContent(), /v0\.2\.0/);
    await blocked.close();
    const noJsContext = await browser.newContext({ javaScriptEnabled: false, offline: true });
    const noJs = await noJsContext.newPage(); await noJs.goto(url);
    assert.match(await noJs.locator('#launch-help').innerText(), /JavaScript/);
    await noJsContext.close();
    assert.deepEqual(requests, [], 'zero HTTP/HTTPS requests including localhost');
    assert.deepEqual(errors, [], 'no uncaught page exceptions');
    const item = { appBuild:buildInfo, versionUi:'visible, popup, copy, denied-clipboard fallback, close/Escape/outside passed', channel, version: browser.version(), cases: results, previews: results.length * 2, requests: requests.length, ui: 'cancel/retry, exports, mode state, 1440/960, policy/JavaScript fallback passed' };
    report.channels.push(item); console.log(JSON.stringify(item));
    await context.close();
  } finally { await browser.close(); }
}
await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Validation report: ${join(artifacts, 'report.json')}`);
