import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeLegacyHealthFile, manageLegacyHealthFileAction } from '../server/legacy-health-files.mjs';
import { createFamilyRouter } from '../server/family-http.mjs';
import { familyMemoryContext } from './family-v2-test-helpers.mjs';
import { taskPhotoActorAllowed, taskPhotoCleanupActorAllowed } from '../server/tasks-photos.mjs';
import { canManageHealthOwner } from '../server/health-access.mjs';

const person = 'member-111111111111111111111111';
const sibling = 'member-222222222222222222222222';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const base = { active: true, canLogin: true, archived: false, familyId: 'test-household-a' };
function fixture({ uid = 'parent-a', visibility = 'shared', selectedPerson = person, type = 'image/png', bytes = png } = {}) {
  const context = familyMemoryContext({
    'members/parent-a': { ...base, role: 'parent', name: 'Sebastian' },
    'members/child-a': { ...base, role: 'child', name: 'Synthetic child', personKey: person },
    'members/sibling-a': { ...base, role: 'child', name: 'Synthetic sibling', personKey: sibling },
    'members/parent-b': { ...base, familyId: 'test-household-b', role: 'parent', name: 'Foreign parent' },
  }, uid);
  const path = `health/${visibility}/${selectedPerson}/${uid}/synthetic-file.png`;
  const metadata = { name: path, contentType: type, size: String(bytes.length), generation: '7', metageneration: '3',
    metadata: { firebaseStorageDownloadTokens: 'SYNTHETIC_DOWNLOAD_TOKEN', custom: 'preserved' } };
  const storageReads = [], effects = [];
  const file = { getMetadata: async () => [metadata], download: async options => { assert.equal(options.validation, 'crc32c'); return [bytes]; },
    setMetadata: async (value, options) => { effects.push({ value, options }); Object.assign(metadata,value); } };
  context.bucket = { file: (target, options) => { storageReads.push({ target, options }); assert.equal(target, path); return file; } };
  return { context, path, metadata, file, storageReads, effects };
}

test('legacy medical finalization protects exact verified generation, strips bearer token and preserves privacy', async () => {
  const f = fixture({ visibility: 'parents' });
  assert.deepEqual(await finalizeLegacyHealthFile(f.context, f.path), { path: f.path, familyId: base.familyId });
  assert.deepEqual(f.storageReads[1].options, { generation: '7' });
  assert.deepEqual(f.effects[0].options, { ifGenerationMatch: '7', ifMetagenerationMatch: '3' });
  assert.equal(f.effects[0].value.metadata.firebaseStorageDownloadTokens, null);
  assert.equal(f.effects[0].value.metadata.visibility, 'parents');
  assert.equal(f.effects[0].value.metadata.ownerProfileId, 'child-a');
  assert.equal(f.effects[0].value.metadata.custom, 'preserved');
  assert.equal(f.effects[0].value.cacheControl, 'private, no-store');
  assert.doesNotMatch(JSON.stringify(f.effects), /SYNTHETIC_DOWNLOAD_TOKEN/);
  assert.equal(f.context.calls.length, 0);
});

test('PDF, JPG, PNG, WebP and existing GIF legacy formats validate using original file bytes', async () => {
  const samples = [['application/pdf', Buffer.from('%PDF-1.7 synthetic')], ['image/jpeg', Buffer.from([255, 216, 255, 0])],
    ['image/png', png], ['image/webp', Buffer.from('RIFF1234WEBP')], ['image/gif', Buffer.from('GIF89a12')]];
  for (const [type, bytes] of samples) {
    const f = fixture({ type, bytes });
    assert.equal((await finalizeLegacyHealthFile(f.context, f.path)).path, f.path);
    assert.equal(f.effects.length, 1);
  }
});

test('children can finalize only their own shared uploads; parents can retain existing family uploads', async () => {
  const own = fixture({ uid: 'child-a' });
  assert.equal((await finalizeLegacyHealthFile(own.context, own.path)).path, own.path);
  for (const change of [{ uid: 'child-a', visibility: 'parents' }, { uid: 'child-a', selectedPerson: sibling },
    { uid: 'child-a', selectedPerson: 'family' }]) {
    const f = fixture(change);
    await assert.rejects(finalizeLegacyHealthFile(f.context, f.path), { code: 'STORAGE_HEALTH_FILE_FORBIDDEN' });
    assert.deepEqual(f.storageReads, []);
  }
  const family = fixture({ selectedPerson: 'family' });
  await finalizeLegacyHealthFile(family.context, family.path);
  assert.equal(family.effects[0].value.metadata.ownerProfileId, 'family');
  const oldName = fixture({ selectedPerson: 'Sebastian' });
  await finalizeLegacyHealthFile(oldName.context, oldName.path);
  assert.equal(oldName.effects[0].value.metadata.ownerProfileId, 'parent-a');
});

test('foreign uploader, missing/legacy household and disabled memberships cannot touch Storage', async () => {
  const foreign = fixture({ uid: 'parent-b' });
  await assert.rejects(finalizeLegacyHealthFile(foreign.context, foreign.path), { code: 'STORAGE_HEALTH_FILE_FORBIDDEN' });
  assert.deepEqual(foreign.storageReads, []);
  const forgedPath = fixture();
  await assert.rejects(finalizeLegacyHealthFile(forgedPath.context, forgedPath.path.replace('/parent-a/', '/parent-b/')), { code: 'STORAGE_HEALTH_FILE_FORBIDDEN' });
  assert.deepEqual(forgedPath.storageReads, []);
  for (const change of [{ familyId: undefined }, { familyId: '__legacy__' }, { disabled: true }, { active: false }, { canLogin: false }]) {
    const f = fixture();
    Object.assign(f.context.rows.get('members/parent-a'), change);
    await assert.rejects(finalizeLegacyHealthFile(f.context, f.path), { code: 'STORAGE_HOUSEHOLD_REQUIRED' });
    assert.deepEqual(f.storageReads, []);
  }
});

test('revoking a member disables task-photo verification, interactive cleanup and medical authority', async () => {
  const f = fixture();
  const ticket = { familyId: base.familyId, uid: 'parent-a' };
  assert.equal(await taskPhotoActorAllowed(f.context, ticket), true);
  assert.equal(await taskPhotoCleanupActorAllowed(f.context), true);
  f.context.rows.get('members/parent-a').disabled = true;
  assert.equal(await taskPhotoActorAllowed(f.context, ticket), false);
  assert.equal(await taskPhotoCleanupActorAllowed(f.context), false);
  const actor = { ...f.context.rows.get('members/parent-a'), id: 'parent-a' };
  const owner = { ...f.context.rows.get('members/child-a'), id: 'child-a', birthDate: '2016-03-02' };
  assert.equal(canManageHealthOwner(actor, owner, null, new Date('2026-10-14T10:00:00Z')), false);
  assert.deepEqual(f.storageReads, []);
});

test('moved family, changed privacy authorization or archived owner during download cannot finalize a path', async () => {
  for (const change of ['family', 'role', 'owner']) {
    const f = fixture({ visibility: 'parents' });
    f.file.download = async () => {
      if (change === 'family') f.context.rows.get('members/parent-a').familyId = 'test-household-b';
      if (change === 'role') f.context.rows.get('members/parent-a').role = 'child';
      if (change === 'owner') f.context.rows.get('members/child-a').archived = true;
      return [png];
    };
    await assert.rejects(finalizeLegacyHealthFile(f.context, f.path), error => error.status === 403);
    assert.deepEqual(f.effects, []);
  }
});

test('wrong bytes, size, MIME, generation and foreign metadata fail without token changes', async () => {
  for (const change of [{ contentType: 'text/html' }, { size: '7' }, { size: '10485761' }, { generation: 'invalid' },
    { metageneration: 'invalid' }, { name: 'health/foreign' }, { metadata: { familyId: 'test-household-b' } },
    { metadata: { uploaderUid: 'parent-b' } }]) {
    const f = fixture(); Object.assign(f.metadata, change);
    await assert.rejects(finalizeLegacyHealthFile(f.context, f.path));
    assert.deepEqual(f.effects, []);
  }
  const bytes = fixture(); bytes.file.download = async () => [Buffer.alloc(png.length)];
  await assert.rejects(finalizeLegacyHealthFile(bytes.context, bytes.path), { code: 'STORAGE_HEALTH_FILE_INVALID' });
  assert.deepEqual(bytes.effects, []);
  const concurrent = fixture();
  concurrent.file.setMetadata = async (_value, options) => { assert.equal(options.ifMetagenerationMatch, '3'); throw { code: 412 }; };
  await assert.rejects(finalizeLegacyHealthFile(concurrent.context, concurrent.path), { code: 'STORAGE_HEALTH_FILE_NOT_READY' });
});

test('only the existing gated storage route dispatches finalization; Preview cannot enable it', async () => {
  const f = fixture(), response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } });
  const request = () => ({ url: '/api/family/storage', method: 'POST', headers: { 'content-type': 'application/json' },
    body: { operation: 'finalizeHealthFile', path: f.path } });
  const build = env => createFamilyRouter({ env, services: () => ({}), memberGuard: async () => f.context });
  for (const env of [{ FAMILY_V2_WRITES_ENABLED: 'false' }, { VERCEL_ENV: 'preview', FAMILY_V2_WRITES_ENABLED: 'true' }]) {
    const result = response(); await build(env)(request(), result);
    assert.equal(result.statusCode, 503); assert.equal(result.body.error.code, 'FAMILY_V2_READ_ONLY');
    assert.deepEqual(f.storageReads, []);
  }
  const result = response(); await build({ FAMILY_V2_WRITES_ENABLED: 'true' })(request(), result);
  assert.equal(result.statusCode, 200); assert.equal(result.body.path, f.path);
  assert.equal(result.body.familyId, base.familyId); assert.equal(result.headers['Cache-Control'], 'no-store, private, max-age=0');
  await assert.rejects(manageLegacyHealthFileAction(f.context, { operation: 'finalizeHealthFile', path: f.path, familyId: 'forged' }));
});
