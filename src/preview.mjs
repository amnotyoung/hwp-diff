process.env.KORDOC_OFFLINE = '1';
process.env.ORT_DISABLE_TELEMETRY = '1';
const { renderDocumentToScene } = await import('kordoc');

export async function previewDocument(file, page = 1) {
  if (!Number.isInteger(page) || page < 1 || page > 2000) throw new Error('올바른 쪽 번호를 선택해 주세요.');
  const { scene, pageSvgs } = await renderDocumentToScene(file.bytes, {
    pages: [page], reflow: true, maxImageBytes: 5 * 1024 * 1024,
  });
  const svg = pageSvgs.get(page);
  if (!svg) throw new Error('요청한 쪽을 렌더링할 수 없습니다.');
  if (Buffer.byteLength(svg) > 16 * 1024 * 1024) throw new Error('이 쪽의 이미지 용량이 미리보기 한도를 넘습니다.');
  return {
    page, totalPages: scene.pages.length, format: scene.format,
    // SVG is displayed in an <img>, never inserted as active document markup.
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    warnings: scene.warnings,
    notice: '문서에 저장된 배치를 우선 사용하며, 배치 정보가 없으면 자동 재배치합니다. 설치된 글꼴과 지원되지 않는 개체에 따라 한컴 화면과 다를 수 있습니다.',
  };
}
