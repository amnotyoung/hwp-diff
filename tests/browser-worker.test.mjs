import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorker } from '../browser/worker-client.js';

function environment(t, failConstructor = false) {
  const state = { workers: [], revoked: [], timers: [] };
  t.mock.method(URL, 'createObjectURL', () => 'blob:test');
  t.mock.method(URL, 'revokeObjectURL', url => state.revoked.push(url));
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { state.timers.push({ callback, delay }); return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  globalThis.Worker = class {
    constructor() { if (failConstructor) throw new DOMException('policy', 'SecurityError'); this.terminated = 0; state.workers.push(this); }
    postMessage(data) { this.payload = data; }
    terminate() { this.terminated++; }
  };
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'Worker', previous); else delete globalThis.Worker; });
  return state;
}
test('worker handshake waits for readiness; progress is not a result; completion releases resources once', async t => {
  const state = environment(t), stages = [];
  const promise = runWorker('source', { operation: 'compare' }, { onProgress: value => stages.push(value) });
  const worker = state.workers[0];
  assert.equal(worker.payload, undefined);
  worker.onmessage({ data: { ready: true } });
  assert.equal(worker.payload.operation, 'compare');
  worker.onmessage({ data: { progress: { step: 1 } } });
  worker.onmessage({ data: { result: { stats: { modified: 1 } } } });
  assert.equal((await promise).stats.modified, 1);
  worker.onmessage({ data: { result: false } });
  assert.equal(worker.terminated, 1); assert.deepEqual(state.revoked, ['blob:test']);
  assert.equal(stages.at(-1).step, 1);
});
test('60-second deadline terminates a busy worker and rejects instead of yielding unchanged', async t => {
  const state = environment(t), promise = runWorker('source', {});
  state.workers[0].onmessage({ data: { ready: true } });
  assert.equal(state.timers[0].delay, 60_000);
  const rejection = assert.rejects(promise, /제한 시간/);
  state.timers[0].callback(); await rejection;
  assert.equal(state.workers[0].terminated, 1);
});
test('abort terminates immediately and a fresh worker can retry successfully', async t => {
  const state = environment(t), controller = new AbortController();
  const promise = runWorker('source', {}, { signal: controller.signal });
  const rejection = assert.rejects(promise, { name: 'AbortError' });
  controller.abort(); await rejection;
  assert.equal(state.workers[0].terminated, 1);
  const retry = runWorker('source', {});
  state.workers[1].onmessage({ data: { ready: true } });
  state.workers[1].onmessage({ data: { result: true } });
  assert.equal(await retry, true);
});
test('worker policy failure gives actionable guidance and revokes the Blob URL', async t => {
  const state = environment(t, true);
  await assert.rejects(runWorker('source', {}), /정책.*SecurityError/);
  assert.deepEqual(state.revoked, ['blob:test']);
});
test('initialization timeout and message decode failure cannot become successful results', async t => {
  const state = environment(t), first = runWorker('source', {});
  const rejection = assert.rejects(first, /시작하지 못했습니다/);
  state.timers[0].callback(); await rejection;
  const second = runWorker('source', {}), rejected = assert.rejects(second, /처리 결과/);
  state.workers[1].onmessageerror(); await rejected;
  assert.ok(state.workers.every(worker => worker.terminated === 1));
});

test('automatic batches renew only completed checkpoints and retain a five-minute total deadline', async t => {
  const state=environment(t);let now=0;t.mock.method(Date,'now',()=>now);
  const promise=runWorker('source',{});const worker=state.workers[0];
  worker.onmessage({data:{ready:true}});
  now=50_000;worker.onmessage({data:{progress:{checkpoint:1,label:'batch done'}}});
  assert.equal(state.timers.at(-1).delay,60_000);
  const count=state.timers.length;
  worker.onmessage({data:{progress:{checkpoint:1,label:'duplicate'}}});
  assert.equal(state.timers.length,count);
  now=290_000;worker.onmessage({data:{progress:{checkpoint:2}}});
  assert.equal(state.timers.at(-1).delay,10_000);
  const rejected=assert.rejects(promise,/제한 시간/);
  state.timers.at(-1).callback();await rejected;assert.equal(worker.terminated,1);
});
