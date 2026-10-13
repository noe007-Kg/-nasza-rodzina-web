import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { collectHouseholdInventory } from '../scripts/lib/household-migration-inventory.mjs';
import { buildHouseholdMigrationPlan } from '../scripts/lib/household-migration-plan.mjs';

const projectId = 'demo-nasza-rodzina';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099'
  || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199' || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error('Migration integration requires the explicit local demo project, Auth, Firestore and Storage emulators.');
}

test('real Admin SDK dry-run reads the demo inventory and preserves Firestore, Auth and Storage without applying a plan', async t => {
  const app = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` }, `household-readonly-test-${randomUUID()}`);
  t.after(() => deleteApp(app));
  const db = getFirestore(app), auth = getAuth(app), bucket = getStorage(app).bucket();
  const cleared = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(cleared.ok, true);
  const c = { schemaVersion: 1, projectId, bucket: bucket.name, householdConfirmed: true,
    members: Array.from({ length: 5 }, (_, index) => ({ uid: `migration-integration-${index}`, expectedName: `Synthetic ${index}`,
      expectedRole: index < 2 ? 'parent' : 'child', expectedCanLogin: index !== 4 })) };
  const batch = db.batch();
  for (const member of c.members) {
    if (member.expectedCanLogin) {
      try { await auth.getUser(member.uid); }
      catch (error) { if (error.code !== 'auth/user-not-found') throw error; await auth.createUser({ uid: member.uid, disabled: false }); }
    }
    batch.set(db.doc(`members/${member.uid}`), { name: member.expectedName, role: member.expectedRole,
      active: true, canLogin: member.expectedCanLogin });
  }
  const taskId = `task-${randomUUID()}`, uploadId = randomUUID(), uid = c.members[2].uid;
  const objectPath = `taskProof/${taskId}/${uid}/${uploadId}.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  batch.set(db.doc(`tasks/${taskId}`), { title: 'Synthetic proof task', person: c.members[2].expectedName, createdBy: c.members[0].uid,
    submittedBy: uid, approvalStatus: 'pending', proofPath: objectPath, proofUploadId: uploadId, points: 123 });
  batch.set(db.doc(`_taskPhotoUploads/${uploadId}`), { taskId, uid, person: c.members[2].expectedName, familyId: null, path: objectPath,
    state: 'submitted', contentType: 'image/png', size: png.length });
  await batch.commit(); // Synthetic fixture creation ONLY, never called by the dry-run collector/planner.
  await bucket.file(objectPath).save(png, { resumable: false, metadata: { contentType: 'image/png', metadata: { taskId, uploadId, uploaderUid: uid } } });
  const paths = c.members.map(member => `members/${member.uid}`).concat(`tasks/${taskId}`, `_taskPhotoUploads/${uploadId}`);
  const before = await db.getAll(...paths.map(path => db.doc(path)));
  const [fileBefore] = await bucket.file(objectPath).getMetadata();
  const inventory = await collectHouseholdInventory({ db, auth, bucket }, c);
  assert.equal(inventory.coverage.complete, true);
  assert.equal(inventory.source, 'firebase-admin-read-only');
  assert.equal(inventory.auth.filter(row => row.exists).length, 4);
  assert.equal(JSON.stringify(inventory).includes('Synthetic proof task'), false, 'Clinical/task content must not be inventoried');
  const stored = inventory.storage.find(file => file.path === objectPath);
  assert.ok(stored?.exists); assert.equal(stored.links.uploadId, uploadId);
  assert.equal(stored.size, png.length); assert.equal(stored.contentType, 'image/png');
  const plan = buildHouseholdMigrationPlan(c, inventory, { familyId: `family-${randomUUID()}` });
  assert.equal(plan.writesPerformed, 0); assert.equal(plan.canApply, false);
  assert.equal(plan.status, 'prepared-requires-approval');
  assert.equal(plan.changes.length, 7);
  const after = await db.getAll(...paths.map(path => db.doc(path)));
  for (let index = 0; index < before.length; index++) {
    assert.deepEqual(after[index].data(), before[index].data());
    assert.ok(after[index].updateTime.isEqual(before[index].updateTime));
  }
  const [fileAfter] = await bucket.file(objectPath).getMetadata();
  assert.equal(fileAfter.generation, fileBefore.generation); assert.equal(fileAfter.metageneration, fileBefore.metageneration);
  assert.deepEqual((await bucket.file(objectPath).download())[0], png); // Byte verification belongs to this test, not the dry-run tool.
});
