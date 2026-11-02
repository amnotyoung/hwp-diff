import { Buffer } from 'buffer';
import { MAX_ARCHIVE_EXPANDED_BYTES } from '../limits.js';
export { Buffer };
export const process = {
  env: { KORDOC_OFFLINE: '1', ORT_DISABLE_TELEMETRY: '1', KORDOC_MAX_UNZIP_MB: String(MAX_ARCHIVE_EXPANDED_BYTES / 1024 / 1024) },
  platform: 'browser', versions: {}, browser: true,
  nextTick: (callback, ...args) => queueMicrotask(() => callback(...args)),
};
export const global = globalThis;
