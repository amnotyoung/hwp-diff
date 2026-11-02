import CFB from 'cfb';
// Kordoc's official HWP API loads its existing CFB dependency through createRequire.
export const createRequire = () => name => {
  if (name === 'cfb') return CFB;
  throw new Error(`HTML 버전에서 지원하지 않는 기능입니다: ${name}`);
};
