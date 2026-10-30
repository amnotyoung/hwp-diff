import { parentPort, workerData } from 'node:worker_threads';
import { compareDocuments } from './engine.mjs';
import { sampleFiles } from './sample-data.mjs';
import { previewDocument } from './preview.mjs';

try {
  const files = workerData.demo ? await sampleFiles() : workerData;
  if (workerData.demo && workerData.reverse) [files.oldFile, files.newFile] = [files.newFile, files.oldFile];
  const result = workerData.preview
    ? await previewDocument(workerData.demo ? files[workerData.side === 'old' ? 'oldFile' : 'newFile'] : workerData.file, workerData.page, workerData.options)
    : await compareDocuments(files.oldFile, files.newFile, progress => parentPort.postMessage({ progress }));
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
