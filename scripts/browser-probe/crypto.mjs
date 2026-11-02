export * from '../../.build-cache/html-tools/node_modules/@jspm/core/nodelibs/browser/crypto.js';
// Encrypted document support is outside this feasibility probe. Never emulate
// a timing-safe security primitive with a normal JavaScript comparison.
export function timingSafeEqual() { throw new Error('암호화 문서는 HTML 검증에서 지원하지 않습니다.'); }
