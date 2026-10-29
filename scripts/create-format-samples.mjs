import { mkdir, writeFile } from 'node:fs/promises';
import { formatSamples } from '../tests/helpers/format-fixture.mjs';
process.env.KORDOC_OFFLINE = '1';
const directory = new URL('../samples/generated/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const file of await formatSamples()) { await writeFile(new URL(file.name, directory), file.bytes); console.log(file.name); }
