import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import JSZip from 'jszip';
import { boundedInflate } from '../browser/compat/zlib.js';
import { preflight } from '../browser/preflight.js';
import { validateFile, MAX_FILE_BYTES, MAX_ENTRY_BYTES, MAX_EXPANDED_BYTES } from '../browser/limits.js';
import { hwpFixture } from './helpers/hwp-fixture.mjs';
import { compareDocuments } from '../src/engine.mjs';
import { imageHeavyPair } from './helpers/image-heavy-fixture.mjs';
import { MAX_IMAGE_ENTRY_BYTES, MAX_IMAGES_EXPANDED_BYTES } from '../browser/limits.js';

test('browser file limit accepts 20MB, rejects empty, unsupported and oversized files', () => {
  validateFile({ name: 'a.hwpx', size: MAX_FILE_BYTES });
  for (const file of [{ name: 'a.hwpx', size: 0 }, { name: 'a.hwp', size: MAX_FILE_BYTES + 1 }, { name: 'a.docx', size: 1 }]) assert.throws(() => validateFile(file));
});
test('browser zlib enforces maxOutputLength during inflation and rejects truncation', () => {
  const packed = deflateRawSync(Buffer.alloc(100_000, 65));
  assert.equal(boundedInflate(packed, { maxOutputLength: 100_000 }, true).length, 100_000);
  assert.throws(() => boundedInflate(packed, { maxOutputLength: 99_999 }, true), /압축 해제/);
  assert.throws(() => boundedInflate(packed.subarray(0, 10), {}, true), /읽을 수/);
});
test('ZIP preflight rejects entry and aggregate expansion before document parsing', async () => {
  for (const sizes of [[MAX_ENTRY_BYTES + 1], [MAX_ENTRY_BYTES, MAX_ENTRY_BYTES, 1]]) {
    const zip = new JSZip();
    sizes.forEach((size, index) => zip.file(`Contents/part${index}.xml`, new Uint8Array(size)));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    assert.ok(bytes.length < MAX_FILE_BYTES);
    await assert.rejects(preflight({ name: 'large.hwpx', bytes }), /압축 해제/);
  }
  assert.equal(MAX_EXPANDED_BYTES, 64 * 1024 * 1024);
});
test('synthetic HWP5 fixtures exercise official content parsing and unsupported-format notices', async () => {
  const a = { name: 'old.hwp', bytes: hwpFixture() };
  const b = { name: 'new.hwp', bytes: hwpFixture(['사업비는 501만원입니다.']) };
  await preflight(a);
  const result = await compareDocuments(a, b);
  assert.equal(result.stats.modified, 1);
  assert.equal(result.formatting.available, false);
  assert.equal(result.annotations.available, false);
});
test('ZIP metadata cannot hide oversized actual expansion or excessive entry counts', async () => {
  const zip = new JSZip(); zip.file('Contents/section0.xml', new Uint8Array(MAX_ENTRY_BYTES + 1));
  const packed = Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', createFolders: false }));
  for (let offset = 0; offset < packed.length - 46; offset++) {
    if (packed.readUInt32LE(offset) === 0x02014b50) packed.writeUInt32LE(1, offset + 24);
    if (packed.readUInt32LE(offset) === 0x04034b50) packed.writeUInt32LE(1, offset + 22);
  }
  await assert.rejects(preflight({ name: 'spoofed.hwpx', bytes: packed }), /실제 압축 해제/);
  const many = new JSZip();
  for (let i = 0; i < 501; i++) many.file(`entry${i}`, '');
  await assert.rejects(preflight({ name: 'many.hwpx', bytes: await many.generateAsync({ type: 'uint8array' }) }), /파일 수/);
});

test('two approximately 9MiB HWPX files with 72MiB of pictures pass without relaxing XML limits', async () => {
  const files = await imageHeavyPair();
  for (const file of files) {
    assert.ok(file.bytes.length > 9 * 1024 * 1024 && file.bytes.length < 10 * 1024 * 1024);
    await preflight(file);
  }
  const result = await compareDocuments(...files);
  assert.equal(result.stats.modified, 1);
  assert.equal(MAX_ENTRY_BYTES, 32 * 1024 * 1024);
  assert.equal(MAX_EXPANDED_BYTES, 64 * 1024 * 1024);
});

test('picture limits stay bounded and error explains original versus expanded size', async () => {
  const zip = new JSZip();
  zip.file('BinData/large.bmp', new Uint8Array(MAX_IMAGE_ENTRY_BYTES + 1));
  const file = { name: 'picture.hwpx', bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) };
  await assert.rejects(preflight(file), error => /picture.hwpx/.test(error.message) && /그림.*64\.0MiB/.test(error.message) && /원본 파일/.test(error.message));
  const spoofed = Buffer.from(file.bytes);
  for (let at = 0; at < spoofed.length - 46; at++) {
    if (spoofed.readUInt32LE(at) === 0x02014b50) spoofed.writeUInt32LE(1, at + 24);
    if (spoofed.readUInt32LE(at) === 0x04034b50) spoofed.writeUInt32LE(1, at + 22);
  }
  await assert.rejects(preflight({name:'spoofed-picture.hwpx',bytes:spoofed}), /실제 압축 해제.*64\.0MiB/);
  assert.equal(MAX_IMAGES_EXPANDED_BYTES, 192 * 1024 * 1024);
});

test('picture aggregate is checked independently of the text allowance', async () => {
  const zip = new JSZip();
  for (let i = 0; i < 4; i++) zip.file(`BinData/picture${i}.bmp`, new Uint8Array(8), {createFolders:false});
  const bytes = Buffer.from(await zip.generateAsync({type:'uint8array'}));
  for (let at = 0; at < bytes.length - 46; at++) {
    if (bytes.readUInt32LE(at) === 0x02014b50) bytes.writeUInt32LE(49 * 1024 * 1024, at + 24);
    if (bytes.readUInt32LE(at) === 0x04034b50) bytes.writeUInt32LE(49 * 1024 * 1024, at + 22);
  }
  await assert.rejects(preflight({name:'pictures.hwpx',bytes}), /그림 합계.*196\.0MiB.*192\.0MiB/);
});

test('large text cannot use the image budget through a misleading directory or extension', async () => {
  for (const name of ['BinData/section0.xml', 'Contents/fake.bmp', 'BinData/vector.svg']) {
    const zip = new JSZip(); zip.file(name, new Uint8Array(MAX_ENTRY_BYTES + 1));
    await assert.rejects(preflight({ name:'text.hwpx', bytes:await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}) }), /본문·서식.*32\.0MiB/);
  }
});
