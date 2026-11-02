import { randomFillSync } from 'node:crypto';
import { markdownToHwpx } from 'kordoc';
import JSZip from 'jszip';

// Two valid 36MiB BMPs with 9MiB of incompressible pixels in total. This creates
// real HWPX picture references and exercises both the former 32/64MiB limits.
export async function imageHeavyPair() {
  const pictures = {};
  for (const name of ['first.bmp', 'second.bmp']) {
    const pixels = 4096 * 3072 * 3, bytes = Buffer.alloc(54 + pixels);
    bytes.write('BM'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10);
    bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(4096, 18); bytes.writeInt32LE(3072, 22);
    bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(pixels, 34);
    randomFillSync(bytes, 54, 4.5 * 1024 * 1024);
    pictures[name] = bytes;
  }
  const files = [];
  for (const [name, amount] of [['image-heavy-old.hwpx', 500], ['image-heavy-new.hwpx', 501]]) {
    const original = await markdownToHwpx(`# 그림 포함 문서\n\n사업비는 ${amount}만원입니다.\n\n![첫 그림](first.bmp)\n\n![둘째 그림](second.bmp)`, { images: pictures });
    const zip = await JSZip.loadAsync(original);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 1 } });
    files.push({ name, bytes });
  }
  return files;
}
