import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolSyncBootstrap } from '../functions/notification-baseline.mjs';
import { deriveNotificationEvent } from '../functions/notification-events.mjs';
function database(records = {}) {
  const values = new Map(); let queries = 0;
  const snapshot = ref => ({ exists: values.has(ref.path), data: () => values.get(ref.path) });
  const db = {
    collection(name) { return {
      doc(id) { const ref = { path: `${name}/${id}`, async get() { return snapshot(ref); } }; return ref; },
      where(field, operator, profileId) { assert.equal(field, 'sourceProfileId'); assert.equal(operator, '=='); return { limit(count) { assert.equal(count, 1500); return { async get() { queries++; return { docs: (records[name] || []).filter(value => value.sourceProfileId === profileId).map(value => ({ data: () => value })) }; } }; } }; },
    }; },
    async runTransaction(callback) { return callback({ async get(ref) { return snapshot(ref); }, set(ref, value) { values.set(ref.path, value); } }); },
  };
  return { db, values, queries: () => queries };
}
const grade = { source: 'eduvulcan', sourceProfileId: 'nikodem-school', sourceConnectionScope: 'family', sourceSyncId: 'sync-new', sourceRecordId: 'grade-new', type: 'grade', person: 'Nikodem', title: 'Ocena', createdAt: new Date(2000) };
test('first new grade after installing notification functions is not lost when previous school history exists', async () => {
  const { db, values } = database({ schoolItems: [{ ...grade, sourceRecordId: 'old-grade', sourceSyncId: 'old-sync', createdAt: new Date(1000) }, grade] });
  assert.equal(await schoolSyncBootstrap(db, null, grade), false);
  assert.equal([...values.values()][0].initialSyncId, '');
  assert.ok(deriveNotificationEvent('schoolItems', 'new-grade', null, grade));
});
test('initial full import without earlier history is suppressed consistently across all items in its sync', async () => {
  const { db } = database({ schoolItems: [grade, { ...grade, sourceRecordId: 'second-grade' }] });
  assert.equal(await schoolSyncBootstrap(db, null, grade), true);
  assert.equal(await schoolSyncBootstrap(db, null, { ...grade, sourceRecordId: 'second-grade' }), true);
  assert.equal(await schoolSyncBootstrap(db, null, { ...grade, sourceSyncId: 'later-sync', createdAt: new Date(3000) }), false);
});
test('metadata-only synchronization of an existing document seeds history before semantic event derivation', async () => {
  const { db, values, queries } = database();
  const before = { ...grade, sourceSyncId: 'old-sync', syncedAt: 100 };
  const after = { ...grade, syncedAt: 200 };
  assert.equal(deriveNotificationEvent('schoolItems', 'existing-grade', before, after), null);
  assert.equal(await schoolSyncBootstrap(db, before, after), false);
  assert.equal([...values.values()][0].historyExists, true); assert.equal(queries(), 0);
  assert.equal(await schoolSyncBootstrap(db, null, { ...grade, sourceRecordId: 'new-grade' }), false);
});
test('older teacher message history also proves an existing production connection', async () => {
  const { db } = database({ schoolParentMessages: [{ ...grade, type: 'message', sourceSyncId: 'previous-sync', createdAt: new Date(1000) }] });
  assert.equal(await schoolSyncBootstrap(db, null, grade), false);
});
test('student scopes and other profiles do not initialize another account’s history baseline', async () => {
  const student = { ...grade, sourceConnectionScope: 'student', sourceOwnerUid: 'child-own-uid' };
  const { db } = database({ schoolItems: [{ ...grade, createdAt: new Date(1000) }, { ...student, sourceOwnerUid: 'another-child', createdAt: new Date(1000) }, { ...student, sourceProfileId: 'other-profile', createdAt: new Date(1000) }] });
  assert.equal(await schoolSyncBootstrap(db, null, student), true);
});
test('ordinary manual school records do not create an eduVULCAN baseline', async () => {
  const { db, values, queries } = database();
  assert.equal(await schoolSyncBootstrap(db, null, { title: 'Ręczne zadanie', person: 'Nikodem' }), false);
  assert.equal(values.size, 0); assert.equal(queries(), 0);
});
