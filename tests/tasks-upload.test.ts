import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TASK_PHOTO_LIMIT, uploadTaskPhoto, validateTaskPhoto, type TaskUploadProgress } from '../src/features/tasks-upload';

test('proof and reward illustration uploads report transferred bytes and reserve 100% for confirmed completion', async () => {
  const progress: TaskUploadProgress[] = [];
  await uploadTaskPhoto({ on: (_event, next, _error, complete) => {
    next({ bytesTransferred: 10, totalBytes: 100 }); next({ bytesTransferred: 50, totalBytes: 100 });
    next({ bytesTransferred: 100, totalBytes: 100 }); complete();
  } }, item => progress.push(item));
  assert.deepEqual(progress.map(item => item.percent), [0, 10, 50, 99, 100]);
  assert.equal(progress.at(-1)?.phase, 'saving');
});

test('failed upload retains real progress and rejects unsupported files before a ticket is requested', async () => {
  const progress: TaskUploadProgress[] = [];
  await assert.rejects(uploadTaskPhoto({ on: (_event, next, error) => {
    next({ bytesTransferred: 38, totalBytes: 100 }); error(new Error('synthetic connection failure'));
  } }, item => progress.push(item)), /synthetic connection failure/);
  assert.deepEqual(progress.at(-1), { phase: 'error', percent: 38 });
  for (const file of [{ type: 'application/pdf', size: 10 }, { type: 'image/png', size: 0 }, { type: 'image/png', size: TASK_PHOTO_LIMIT + 1 }]) assert.throws(() => validateTaskPhoto(file));
  assert.doesNotThrow(() => validateTaskPhoto({ type: 'image/jpeg', size: 100 }));
});
