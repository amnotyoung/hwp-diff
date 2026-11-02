import { Buffer } from 'buffer';
export { Buffer };
export const process = {
  env: { KORDOC_OFFLINE: '1', ORT_DISABLE_TELEMETRY: '1', KORDOC_MAX_UNZIP_MB: '64' },
  platform: 'browser', versions: {}, browser: true,
  nextTick: (callback, ...args) => queueMicrotask(() => callback(...args)),
};
export const global = globalThis;
