process.env.KORDOC_OFFLINE = '1';
process.env.ORT_DISABLE_TELEMETRY = '1';
const { renderDocumentToScene } = await import('kordoc');
import { locateChanges, friendlyWarnings } from './preview-locations.mjs';

const MB = 1024 * 1024;
// Kordoc skips every image above maxImageBytes, so 1 byte draws text, tables and layout only.
const WITHOUT_IMAGES = 1;
const IMAGE_LIMIT = 5 * MB;
// Limits protect the worker (512MB heap, 60s) and the browser, which keeps up to 8 pages as base64.
const TEXT_LIMIT = 64 * MB;
const PAGE_LIMIT = 16 * MB;
const svgBytes = svgs => [...svgs.values()].reduce((n, svg) => n + Buffer.byteLength(svg), 0);

// `render` is replaceable only so tests can simulate picture-heavy documents.
export async function previewDocument(file, page = 1, options = {}, render = renderDocumentToScene) {
  if (!Number.isInteger(page) || page < 1 || page > 2000) throw new Error('올바른 쪽 번호를 선택해 주세요.');
  let scene = null, locations = [], searchMatches = [];
  if (options.targets?.length || options.search) {
    // Locating changes and search matches reads the text of every page, never
    // picture data. Rendering all pages without pictures keeps picture-heavy
    // documents (for example uncompressed BMP photos) within the limits.
    const text = await render(file.bytes, { reflow: true, maxImageBytes: WITHOUT_IMAGES });
    if (svgBytes(text.pageSvgs) > TEXT_LIMIT) throw new Error('문서의 글과 표가 많아 변경 위치를 찾을 수 없습니다. 문서를 나누어 확인해 주세요.');
    const located = locateChanges(text.scene, text.pageSvgs, options.targets ?? [], options.search);
    locations = Array.isArray(located) ? located : located.locations;
    searchMatches = Array.isArray(located) ? [] : located.searchMatches;
    scene = text.scene;
    const focus = locations.find(l => l.id === options.focusId);
    if (options.jump && focus?.boxes.length) page = focus.boxes[0].page;
    if (!scene.pages.some(p => p.page === page)) throw new Error('요청한 쪽을 렌더링할 수 없습니다.');
  }
  // Only the displayed page carries its pictures.
  const renderPage = maxImageBytes => render(file.bytes, { pages: [page], reflow: true, maxImageBytes, highlights: options.search ? [options.search] : undefined });
  let shown = await renderPage(IMAGE_LIMIT), imagesOmitted = false;
  if (Buffer.byteLength(shown.pageSvgs.get(page) ?? '') > PAGE_LIMIT) { shown = await renderPage(WITHOUT_IMAGES); imagesOmitted = true; }
  const svg = shown.pageSvgs.get(page);
  if (!svg) throw new Error('요청한 쪽을 렌더링할 수 없습니다.');
  if (Buffer.byteLength(svg) > PAGE_LIMIT) throw new Error('이 쪽의 글과 표가 많아 미리보기 한도를 넘습니다.');
  scene ??= shown.scene;
  // Skipped-picture warnings from the size fallback are reported once, below.
  const warnings = shown.scene.warnings.filter(w => !(imagesOmitted && /한도 초과로 생략/.test(w)));
  return {
    page, totalPages: scene.pages.length, format: scene.format,
    width: scene.pages.find(p => p.page === page)?.width, height: scene.pages.find(p => p.page === page)?.height,
    locations, searchMatches, searchQuery: options.search ?? '',
    rendering: {
      imagesOmitted,
      unmatchedTextCount: locations.filter(l => l.reason === 'text-unmatched').length,
      invalidBoxCount: locations.reduce((n, l) => n + (l.discardedBoxes ?? 0), 0),
      message: locations.some(l => l.reason === 'text-unmatched')
        ? '비교에서 읽은 문구 일부가 이 문서의 미리보기 텍스트에 없습니다. 내용 비교와 한컴 원본에서 확인해 주세요.'
        : locations.some(l => l.discardedBoxes) ? '일부 변경 구간의 위치 정보가 페이지 밖이거나 비어 있어 강조하지 않았습니다. 내용 비교와 원본 파일에서 확인해 주세요.' : '',
    },
    // SVG is displayed in an <img>, never inserted as active document markup.
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    warnings: [...(imagesOmitted ? ['이 쪽은 그림 용량이 커서 글과 표만 표시했습니다. 그림은 원본 파일에서 확인해 주세요.'] : []), ...friendlyWarnings(warnings)],
    technicalWarnings: shown.scene.warnings,
    notice: '문서에 저장된 배치를 우선 사용하며, 배치 정보가 없으면 자동 재배치합니다. 설치된 글꼴과 지원되지 않는 개체에 따라 한컴 화면과 다를 수 있습니다.',
  };
}
