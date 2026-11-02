// Kordoc's official HWP API loads its existing cfb dependency with createRequire.
// Bundle that exact dependency; do not reimplement any HWP parsing.
import CFB from 'cfb';
export function createRequire() {
  return name => {
    if (name === 'cfb') return CFB;
    throw new Error(`HTML 검증에서 지원하지 않는 모듈: ${name}`);
  };
}
