// Synthetic, non-sensitive regression documents: 5 content edits + 2 excluded images.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
process.env.KORDOC_OFFLINE = '1';
const { markdownToHwpx } = await import('kordoc');

export async function reviewSamples() {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  async function build(version) {
    const fresh = version === '0.7';
    const rows = Array.from({ length: 90 }, (_, i) => `| 사업 ${String(i + 1).padStart(2, '0')} | ${fresh && i === 64 ? '501' : '500'} | 지역 보건소 |`);
    const md = `# 현장사업 검토용 가상 문서\n\n사업기간은 2026년부터 ${fresh ? '2029' : '2028'}년까지입니다.\n\n연간 교육 인원은 ${fresh ? '180' : '120'}명입니다.\n\n연간 점검 횟수는 ${fresh ? '6' : '4'}회입니다.\n\n현지 담당 인원은 ${fresh ? '8' : '5'}명입니다.\n\n| 사업명 | 예산 | 비고 |\n| --- | --- | --- |\n${rows.join('\n')}\n\n![${fresh ? '새' : '기존'} 그림 1](logo-${version}.png)\n\n![${fresh ? '새' : '기존'} 그림 2](stamp-${version}.png)`;
    return { name: `지역보건사업_전체지역사업비검토_기관협의내용반영_비교검증용문서_v${version}.hwpx`, bytes: new Uint8Array(await markdownToHwpx(md, { images: { [`logo-${version}.png`]: png, [`stamp-${version}.png`]: png } })) };
  }
  return { oldFile: await build('0.5'), newFile: await build('0.7') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL('../samples/generated/', import.meta.url); await mkdir(dir, { recursive: true });
  for (const file of Object.values(await reviewSamples())) { await writeFile(new URL(file.name, dir), file.bytes); console.log(file.name); }
}
