import { runWorker } from './worker-client.js';
import { validateFile } from './limits.js';
export const standalone = true;
const source = () => new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('document-worker').textContent), char => char.charCodeAt(0)));
export const probeWorker = () => runWorker(source(), { operation: 'probe' });

export async function requestCompare(form, demo, reverse, signal, onProgress) {
  const oldFile = form.get('oldFile'), newFile = form.get('newFile');
  if (!demo) { validateFile(oldFile); validateFile(newFile); }
  return runWorker(source(), { operation: 'compare', oldFile, newFile, demo, reverse }, { signal, onProgress });
}
export async function requestPreview(form, signal) {
  const demo = form.get('demo') === '1', file = form.get('file');
  if (!demo) validateFile(file);
  const focus = form.get('focusId');
  return runWorker(source(), {
    operation: 'preview', file, demo, reverse: form.get('reverse') === '1', side: form.get('side'),
    page: Number(form.get('page')),
    options: { search: form.get('search') ?? '', targets: JSON.parse(form.get('targets') ?? '[]'),
      focusId: /^(memo|format)-/.test(focus) ? focus : Number(focus), jump: form.get('jump') === '1' },
  }, { signal });
}
