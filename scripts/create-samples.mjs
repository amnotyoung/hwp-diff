import { mkdir, writeFile } from 'node:fs/promises';
import { sampleFiles } from '../src/sample-data.mjs';
const directory = new URL('../samples/generated/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const file of Object.values(await sampleFiles())) {
  await writeFile(new URL(file.name, directory), file.bytes);
  console.log(`샘플 생성: ${file.name}`);
}
