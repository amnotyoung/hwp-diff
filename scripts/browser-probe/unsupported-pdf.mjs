const unsupported = () => { throw new Error('PDF는 HTML 검증에서 지원하지 않습니다.'); };
export const OPS = new Proxy({}, {get: unsupported});
export const ImageKind = new Proxy({}, {get: unsupported});
export const GlobalWorkerOptions = {};
export const getDocument = unsupported;
export const normalizeUnicode = unsupported;
export const WorkerMessageHandler = {setup: unsupported};
