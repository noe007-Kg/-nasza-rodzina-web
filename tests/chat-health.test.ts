import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableChatHeight } from '../src/features/chat-layout';
import { HEALTH_FILE_MAX_BYTES, observeHealthUpload, transferPercent, validateHealthFile, type HealthUploadProgress } from '../src/features/health-upload';

test('chat composer fits above navigation, viewport panning and a reduced keyboard viewport', () => {
  assert.equal(availableChatHeight({ viewportHeight: 844, pageTop: 92, bottomObstruction: 74 }), 670);
  assert.equal(availableChatHeight({ viewportHeight: 350, pageTop: 92 }), 250);
  assert.equal(availableChatHeight({ viewportHeight: 350, viewportOffsetTop: 120, pageTop: 30 }), 342);
  assert.equal(availableChatHeight({ viewportHeight: 100, pageTop: 120, bottomObstruction: 70 }), 0);
});

test('chat reserves the full floating navigation obstruction, including its bottom gap', () => {
  const viewportHeight = 844;
  const pageTop = 62;
  const navigationTop = 766; // 68px navigation plus its 10px floating bottom gap.
  const height = availableChatHeight({
    viewportHeight,
    pageTop,
    bottomObstruction: viewportHeight - navigationTop,
  });
  assert.equal(navigationTop - (pageTop + height), 8);
});

test('upload progress is calculated from bytes and remains below 100 until completion', () => {
  assert.equal(transferPercent(0, 1000), 0);
  assert.equal(transferPercent(100, 1000), 10);
  assert.equal(transferPercent(500, 1000), 50);
  assert.equal(transferPercent(780, 1000), 78);
  assert.equal(transferPercent(1000, 1000), 99);
  assert.equal(transferPercent(1005, 1000), 99);
  assert.equal(transferPercent(-1, 1000), 0);
  assert.equal(transferPercent(1, 0), 0);
});

function controlledTask() {
  let next!: (snapshot: { bytesTransferred: number; totalBytes: number }) => void;
  let fail!: (error: Error) => void;
  let complete!: () => void;
  return {
    on(_event: 'state_changed', receive: typeof next, error: typeof fail, success: typeof complete) {
      next = receive; fail = error; complete = success;
      return () => {};
    },
    transfer(bytesTransferred: number, totalBytes: number) { next({ bytesTransferred, totalBytes }); },
    fail(error: Error) { fail(error); },
    complete() { complete(); },
  };
}

test('resumable upload waits for Storage completion before announcing success', async () => {
  const task = controlledTask();
  const states: HealthUploadProgress[] = [];
  let resolved = false;
  const result = observeHealthUpload(task, (state) => states.push(state)).then(() => { resolved = true; });
  assert.deepEqual(states, [{ phase: 'uploading', percent: 0 }]);
  task.transfer(500, 1000);
  assert.deepEqual(states.at(-1), { phase: 'uploading', percent: 50 });
  task.transfer(1000, 1000);
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.deepEqual(states.at(-1), { phase: 'uploading', percent: 99 });
  task.complete();
  await result;
  assert.equal(resolved, true);
  assert.deepEqual(states.at(-1), { phase: 'uploaded', percent: 100 });
});

test('failed upload keeps its actual progress and rejects without a false success', async () => {
  const task = controlledTask();
  const states: HealthUploadProgress[] = [];
  const error = new Error('storage/unauthorized');
  const result = observeHealthUpload(task, (state) => states.push(state));
  task.transfer(780, 1000);
  task.fail(error);
  await assert.rejects(result, (failure) => failure === error);
  assert.deepEqual(states.at(-1), { phase: 'error', percent: 78 });
  assert.equal(states.some((state) => state.phase === 'uploaded' || state.percent === 100), false);
});

test('medical upload accepts PDF/JPG/JPEG/PNG and existing WebP without widening the size/type policy', () => {
  for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) {
    assert.doesNotThrow(() => validateHealthFile({ type, size: HEALTH_FILE_MAX_BYTES }));
  }
  assert.throws(() => validateHealthFile({ type: 'application/pdf', size: HEALTH_FILE_MAX_BYTES + 1 }));
  assert.throws(() => validateHealthFile({ type: 'application/javascript', size: 100 }));
});
