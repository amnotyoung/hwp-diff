import { compareDocuments } from '../../src/engine.mjs';
import { previewDocument } from '../../src/preview.mjs';
self.onmessage = async ({ data }) => {
  try {
    const result = await compareDocuments(data.oldFile, data.newFile, progress => self.postMessage({ progress }));
    self.postMessage({ result });
    if (data.preview) {
      for (const [side, file] of [['before', data.oldFile], ['after', data.newFile]]) {
        try { self.postMessage({ side, preview: await previewDocument(file, 1) }); }
        catch (error) { self.postMessage({ side, previewError: error.message }); }
      }
    }
    self.postMessage({ done: true });
  } catch (error) { self.postMessage({ error: error.message, stack: error.stack }); }
};
