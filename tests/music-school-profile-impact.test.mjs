import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { captureProfileImpact, assessProfileImpact, PROFILE_IMPACT_COLLECTIONS, PROFILE_IMPACT_FIELDS } from '../scripts/lib/music-school-profile-impact.mjs';
import { canReadFinanceBill } from '../server/finance-model.mjs';

function fixture(extra = {}) {
  return { members: Array.from({ length: 5 }, (_, i) => ({ id: `private-uid-${i}`, data: { role: i < 2 ? 'parent' : 'child', active: true, canLogin: i !== 4 } })), ...extra };
}
function reader(input = fixture(), options = {}) {
  const calls = [];
  const db = { collection(name) {
    assert.ok(PROFILE_IMPACT_COLLECTIONS.includes(name)); calls.push(name);
    const q = { select(...fields) { assert.deepEqual(fields, [...PROFILE_IMPACT_FIELDS]); return q; },
      limit(size) { assert.equal(size, 1001); return q; }, async get() {
        if (options.denied === name) throw new Error('permission denied private payload');
        const rows = input[name] || [];
        return { size: rows.length, docs: rows.map(row => ({ id: row.id, data: () => row.data, updateTime: { toMillis: () => row.version || 123 } })) };
      } };
    return q;
  } };
  const auth = { async getUsers(ids) {
    if (options.authDenied) throw new Error('auth denied');
    return { users: ids.filter(x => x.uid !== options.missingUid).map(x => ({ uid: x.uid, disabled: x.uid === options.disabledUid })) };
  } };
  return { db, auth, calls };
}
async function report(input, options) { const context = reader(input, options); const first = await captureProfileImpact(context); return assessProfileImpact(first, await captureProfileImpact(context)); }
const has = (report, code) => report.blockers.some(x => x.code === code);

test('five legacy profiles never become an automatic household or executable patch', async () => {
  const r = await report(fixture());
  assert.equal(r.profiles.missingFamilyId, 5); assert.equal(r.profiles.parents, 2);
  assert.equal(r.metadataComplete, true); assert.equal(r.metadataStableBetweenReads, true);
  assert.equal(r.canApply, false); assert.equal(r.profileUpdateReady, false); assert.equal(r.writesPerformed, 0);
  assert.ok(has(r, 'OWNER_UID_HOUSEHOLD_CONFIRMATION_REQUIRED'));
  assert.ok(has(r, 'SCHOOL_FLAGS_REQUIRE_EXPLICIT_UID_SELECTION'));
});
test('finance legacy records and missing family bills forecast loss of access', async () => {
  const r = await report(fixture({ financeBills: [{ id: 'private-bill', data: { familyId: '__legacy__' } }, { id: 'another-bill', data: {} }] }));
  assert.equal(r.potentialAccessLoss.financeBills, 2); assert.ok(has(r, 'FINANCE_ACCESS_WOULD_CHANGE'));
});
test('current finance authorization really rejects the old shared bill after a profiles-only family change', () => {
  const parent = { id: 'private-parent', role: 'parent', active: true, canLogin: true };
  const child = { id: 'private-child', role: 'child', active: true, canLogin: true };
  const bill = { familyId: '__legacy__', sharedWith: ['private-child'] };
  assert.equal(canReadFinanceBill(parent, bill), true);
  assert.equal(canReadFinanceBill(child, bill), true);
  assert.equal(canReadFinanceBill({ ...parent, familyId: 'new-real-family' }, bill), false);
  assert.equal(canReadFinanceBill({ ...child, familyId: 'new-real-family' }, bill), false);
});
test('live task/reward file tickets forecast Storage equality failures, deleted tickets do not', async () => {
  const r = await report(fixture({ _taskPhotoUploads: [{ id: 'photo', data: { state: 'submitted' } }, { id: 'deleted', data: { state: 'deleted' } }],
    _taskRewardImageUploads: [{ id: 'reward', data: { state: 'attached' } }] }));
  assert.equal(r.potentialAccessLoss.taskUploadTickets, 2); assert.ok(has(r, 'TASK_FILE_ACCESS_WOULD_CHANGE'));
});
test('linked health attachments forecast loss without disclosing content', async () => {
  const r = await report(fixture({ healthDocuments: [{ id: 'private-document', data: { attachmentKind: 'health-record', state: 'ready' } },
    { id: 'other', data: { attachmentKind: 'important-document', state: 'ready' } }] }));
  assert.equal(r.potentialAccessLoss.healthAttachments, 1); assert.ok(has(r, 'HEALTH_ATTACHMENT_ACCESS_WOULD_CHANGE'));
});
test('unknown owner UID never inferred from person/name, shared child grants do not imply ownership', async () => {
  const r = await report(fixture({ calendarEvents: [{ id: 'private-event', data: { ownerUid: 'foreign-uid', person: 'Known-looking name' } }],
    tasks: [{ id: 'task', data: { person: 'Known-looking name', sharedWith: ['private-uid-2'] } }] }));
  assert.ok(has(r, 'UNRESOLVED_UID_REFERENCES')); assert.ok(has(r, 'PERSON_ONLY_REFERENCE_REVIEW_REQUIRED'));
});
test('metadata report never masquerades as backup, restore, Storage scan or deployed rule verification', async () => {
  const r = await report(fixture());
  for (const code of ['FULL_BACKUP_AND_RESTORE_NOT_VERIFIED', 'PRODUCTION_RULES_NOT_VERIFIED', 'STORAGE_OBJECTS_NOT_VERIFIED', 'LEGACY_CROSS_HOUSEHOLD_ISOLATION_NOT_VERIFIED']) assert.ok(has(r, code));
  assert.equal(r.evidence.backup, 'not-verified'); assert.equal(r.evidence.storageObjects, 'not-inspected');
});
test('403, missing collection permission and truncated inventory are blockers, not empty confirmation', async () => {
  const denied = await report(fixture(), { denied: 'healthDocuments' });
  assert.equal(denied.metadataComplete, false); assert.ok(has(denied, 'METADATA_INVENTORY_INCOMPLETE'));
  const large = await report(fixture({ calendarEvents: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), data: {} })) }));
  assert.equal(large.metadataComplete, false); assert.equal(large.collections.calendarEvents.complete, false);
});
test('missing/disabled Auth identities and unavailable Auth are not accepted', async () => {
  for (const options of [{ missingUid: 'private-uid-1' }, { disabledUid: 'private-uid-0' }, { authDenied: true }]) {
    assert.ok(has(await report(fixture(), options), 'PROFILE_AUTH_UID_CHECK_FAILED'));
  }
});
test('a different roster size requires explicit review', async () => {
  assert.ok(has(await report(fixture({ members: fixture().members.slice(0, 4) })), 'EXPLICIT_UID_ROSTER_REVIEW_REQUIRED'));
});
test('data version changes between captures invalidate consistency evidence', async () => {
  const input = fixture(), context = reader(input), first = await captureProfileImpact(context);
  input.members[0].version = 999;
  const r = assessProfileImpact(first, await captureProfileImpact(context));
  assert.equal(r.metadataStableBetweenReads, false); assert.ok(has(r, 'METADATA_CHANGED_OR_NOT_VERIFIED'));
});
test('even apparently configured profiles never bypass independent ownership and backup evidence', async () => {
  const input = fixture(); for (const p of input.members) { p.data.familyId = 'explicit-household'; p.data.schoolEnabled = false; }
  const r = await report(input);
  assert.equal(r.profiles.explicitHouseholds, 1); assert.equal(r.canApply, false); assert.equal(r.profileUpdateReady, false);
  assert.ok(has(r, 'OWNER_UID_HOUSEHOLD_CONFIRMATION_REQUIRED')); assert.ok(has(r, 'FULL_BACKUP_AND_RESTORE_NOT_VERIFIED'));
});
test('stdout report contains no raw identities, record IDs, family values, names, tokens, titles or provider data', async () => {
  const input = fixture(); input.members[0].data.familyId = 'private-family-value';
  input.healthDocuments = [{ id: 'SECRET_DOCUMENT_ID', data: { title: 'SECRET_MEDICAL_TITLE', token: 'SECRET_TOKEN', familyId: 'private-family-value', ownerUid: 'SECRET_OTHER_UID' } }];
  const serialized = JSON.stringify(await report(input));
  for (const forbidden of ['private-uid-', 'private-family-value', 'SECRET_DOCUMENT_ID', 'SECRET_MEDICAL_TITLE', 'SECRET_TOKEN', 'SECRET_OTHER_UID']) assert.equal(serialized.includes(forbidden), false);
});
test('collector only reads exact projected metadata allowlist and exposes no writer', async () => {
  const context = reader(); await captureProfileImpact(context);
  assert.deepEqual(context.calls, [...PROFILE_IMPACT_COLLECTIONS]);
  for (const field of ['title', 'description', 'note', 'documentURL', 'photoURL', 'password', 'session', 'token']) assert.equal(PROFILE_IMPACT_FIELDS.includes(field), false);
  for (const name of ['_eduConnections', '_calendarConnections', 'familyMessages', '_notificationDevices']) assert.equal(context.calls.includes(name), false);
});
test('CLI rejects apply/migration flags before any SDK reads and never accepts secrets in arguments', async () => {
  const source = await readFile(new URL('../scripts/check-music-school-profile-impact.mjs', import.meta.url), 'utf8');
  assert.match(source, /args\.length !== 2/); assert.match(source, /args\[0\] !== '--project'/);
  assert.doesNotMatch(source, /\.(?:set|update|delete|create|commit|runTransaction)\(/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*error\.(?:message|stack)/);
});
