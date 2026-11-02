import CFB from 'cfb';
import { deflateRawSync } from 'node:zlib';

// Small synthetic fixture writer, following Kordoc's MIT-licensed test layout:
// https://github.com/chrisryugj/kordoc/blob/main/tests/hwp5-patch.test.ts
// Production parsing uses only Kordoc's public API.
const record = (tag, level, bytes) => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(tag | (level << 10) | (bytes.length << 20));
  return Buffer.concat([header, bytes]);
};
export function hwpFixture(texts = ['사업비는 500만원입니다.'], { compressed = true, flags = 0 } = {}) {
  const header = Buffer.alloc(256);
  header.write('HWP Document File'); header[35] = 5;
  header.writeUInt32LE(flags | (compressed ? 1 : 0), 36);
  const paragraphs = texts.map((text, index) => {
    const para = Buffer.alloc(24);
    para.writeUInt32LE(text.length + 1); para.writeUInt16LE(1, 12); para.writeUInt16LE(1, 16);
    const line = Buffer.alloc(36);
    line.writeInt32LE(index * 1400, 4); line.writeInt32LE(1200, 8); line.writeInt32LE(1200, 12); line.writeInt32LE(200, 20);
    return Buffer.concat([record(66, 0, para), record(67, 1, Buffer.from(text + '\r', 'utf16le')), record(68, 1, Buffer.alloc(8)), record(69, 1, line)]);
  });
  const cfb = CFB.utils.cfb_new();
  const pack = data => compressed ? deflateRawSync(data) : data;
  CFB.utils.cfb_add(cfb, '/FileHeader', header);
  CFB.utils.cfb_add(cfb, '/DocInfo', pack(Buffer.alloc(0)));
  CFB.utils.cfb_add(cfb, '/BodyText/Section0', pack(Buffer.concat(paragraphs)));
  return new Uint8Array(CFB.write(cfb, { type: 'buffer' }));
}
