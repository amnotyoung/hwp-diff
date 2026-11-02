import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyPayloadDirectory } from '../scripts/package-common.mjs';

test('payload copy retains file bytes and excludes executable shims', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'hwp-diff-payload-'));
  try {
    const source = join(temp, 'source'), destination = join(temp, 'destination');
    await mkdir(join(source, 'nested'), { recursive: true });
    await mkdir(join(source, '.bin'));
    await writeFile(join(source, '.bin', 'excluded'), 'shim');
    for (let i = 0; i < 40; i++) await writeFile(join(source, 'nested', `${i}.bin`), Buffer.from([i, 0, 255]));
    await copyPayloadDirectory(source, destination);
    assert.deepEqual(await readdir(destination), ['nested']);
    for (let i = 0; i < 40; i++) assert.deepEqual(await readFile(join(destination, 'nested', `${i}.bin`)), Buffer.from([i, 0, 255]));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('payload copy rejects links to files outside the inclusion tree', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'hwp-diff-payload-'));
  try {
    await mkdir(join(temp, 'source'));
    await mkdir(join(temp, 'outside'));
    await symlink(join(temp, 'outside'), join(temp, 'source', 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(copyPayloadDirectory(join(temp, 'source'), join(temp, 'destination')), /심볼릭 링크/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
