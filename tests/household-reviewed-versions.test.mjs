import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHouseholdConfig, buildHouseholdMigrationPlan } from '../scripts/lib/household-migration-plan.mjs';
import { buildHouseholdIsolationPlan } from '../scripts/lib/household-isolation-plan.mjs';
import { HOUSEHOLD_FIELDS, STORAGE_PREFIXES } from '../scripts/lib/household-migration-inventory.mjs';

const version = () => ({ seconds: '1792051200', nanoseconds: 123456789 });
function fixture() {
  const config = { schemaVersion: 1, projectId: 'demo-reviewed-versions', bucket: 'demo-reviewed-versions.appspot.com',
    householdConfirmed: true, familyId: 'family-synthetic-review', reviewedRecordPaths: [],
    members: Array.from({ length: 5 }, (_, i) => ({ uid: `receipt-member-${i}`, expectedName: `Synthetic ${i}`,
      expectedRole: i < 2 ? 'parent' : 'child', expectedCanLogin: i < 4, expectedPersonKey: `receipt-person-${i}` })) };
  const collections = Object.fromEntries(Object.keys(HOUSEHOLD_FIELDS).map(name => [name, []]));
  const add = (collection, id, data) => {
    const row = { id, path: `${collection}/${id}`, data, updateTime: version() }; collections[collection].push(row); return row;
  };
  for (const member of config.members) {
    add('members', member.uid, { name: member.expectedName, role: member.expectedRole, canLogin: member.expectedCanLogin,
      personKey: member.expectedPersonKey, active: true }); collections[`notificationInbox/${member.uid}/items`] = [];
  }
  const inventory = { schemaVersion: 1, projectId: config.projectId, bucket: config.bucket, source: 'offline',
    collections, auth: config.members.map(member => ({ uid: member.uid, exists: member.expectedCanLogin, disabled: false })), storage: [],
    coverage: { complete: true, authVerified: true, missingCollections: [], collections: Object.keys(collections), storagePrefixes: [...STORAGE_PREFIXES] } };
  const review = row => {
    config.reviewedRecordPaths.push(row.path);
    (config.reviewedRecordVersions ||= []).push({ path: row.path, updateTime: { ...row.updateTime } });
  };
  const run = () => buildHouseholdMigrationPlan(config, inventory, { now: '2026-10-15T09:00:00Z' });
  return { config, inventory, add, review, run };
}
function finance(f) {
  const bill = f.add('financeBills', 'synthetic-bill', { ownerUid: f.config.members[0].uid, familyId: '__legacy__',
    sharedWith: [f.config.members[2].uid], seriesId: 'synthetic-bill', periodIndex: 0 });
  const audit = f.add('financeBillAudit', 'synthetic-audit', { actorUid: f.config.members[0].uid, billId: bill.id, familyId: '__legacy__' });
  f.review(bill); f.review(audit); return { bill, audit };
}

test('legacy configurations without reviewedRecordVersions preserve the previous normalized output exactly', () => {
  const f = fixture(), normalized = validateHouseholdConfig(f.config);
  assert.deepEqual(normalized, f.config); assert.equal(Object.hasOwn(normalized, 'reviewedRecordVersions'), false);
  const before = f.run(); f.config.reviewedRecordVersions = [];
  assert.deepEqual(f.run(), before); assert.deepEqual(validateHouseholdConfig(f.config).reviewedRecordVersions, []);
});
test('receipts retain exact string seconds and nanoseconds, sort deterministically and never alias input versions', () => {
  const f = fixture(); finance(f);
  const normalized = validateHouseholdConfig(f.config);
  assert.deepEqual(normalized.reviewedRecordVersions.map(row => row.path), ['financeBillAudit/synthetic-audit', 'financeBills/synthetic-bill']);
  assert.deepEqual(normalized.reviewedRecordVersions[0].updateTime, version());
  normalized.reviewedRecordVersions[0].updateTime.nanoseconds = 0;
  assert.ok(f.config.reviewedRecordVersions.every(row => row.updateTime.nanoseconds === 123456789));
});
test('invalid, duplicate, unreviewed and out-of-allowlist receipts fail without echoing private input', () => {
  const mutations = [c => { c.reviewedRecordVersions = undefined; }, c => { c.reviewedRecordVersions = {}; },
    c => { c.reviewedRecordVersions.push(c.reviewedRecordVersions[0]); },
    c => { c.reviewedRecordVersions[0].path = 'members/receipt-member-0'; },
    c => { c.reviewedRecordVersions[0].path = 'quickProducts/not-reviewed'; },
    c => { c.reviewedRecordVersions[0].updateTime.seconds = 1792051200; },
    c => { c.reviewedRecordVersions[0].updateTime.seconds = '-1'; },
    c => { c.reviewedRecordVersions[0].updateTime.nanoseconds = 1e9; },
    c => { c.reviewedRecordVersions[0].updateTime.nanoseconds = 1.5; },
    c => { c.reviewedRecordVersions[0].updateTime.nanoseconds = -1; },
    c => { c.reviewedRecordVersions[0].updateTime.extra = 'POISON_PRIVATE_DATA'; },
    c => { c.reviewedRecordVersions[0].secret = 'POISON_PRIVATE_DATA'; }];
  for (const mutate of mutations) {
    const f = fixture(); finance(f); mutate(f.config);
    assert.throws(() => validateHouseholdConfig(f.config), error => error.code === 'CONFIG_REVIEWED_VERSIONS_INVALID'
      && !error.message.includes('POISON_PRIVATE_DATA'));
  }
});
test('an exact reviewed finance document version permits the existing read-only plan without changing contents or ACL', () => {
  const f = fixture(); finance(f); const before = structuredClone(f.inventory), plan = f.run();
  assert.deepEqual(plan.blockers, []); assert.equal(plan.changes.length, 7);
  assert.equal(plan.canApply, false); assert.equal(plan.writesPerformed, 0); assert.deepEqual(f.inventory, before);
});
test('one nanosecond or second difference, missing version or missing document revokes the exact reviewed authority', () => {
  for (const mutate of [bill => bill.updateTime.nanoseconds++, bill => { bill.updateTime.seconds = '1792051201'; },
    bill => { delete bill.updateTime; }, (bill, f) => { f.inventory.collections.financeBills = []; }]) {
    const f = fixture(), { bill } = finance(f); mutate(bill, f); const plan = f.run();
    assert.ok(plan.blockers.some(row => row.code === 'REVIEWED_RECORD_VERSION_CHANGED' && row.path === bill.path));
    assert.ok(!plan.changes.some(row => row.path === bill.path)); assert.equal(plan.status, 'blocked'); assert.equal(plan.canApply, false);
  }
});
test('stale presentation approvals also block the expanded isolation plan instead of silently accepting a reused path', () => {
  const f = fixture(), row = f.add('familySettings', 'profile', {}); f.review(row);
  const first = buildHouseholdIsolationPlan(f.config, f.inventory, { familyId: f.config.familyId });
  assert.deepEqual(first.blockers, []);
  row.updateTime.nanoseconds++;
  const stale = buildHouseholdIsolationPlan(f.config, f.inventory, { familyId: f.config.familyId });
  assert.ok(stale.blockers.some(item => item.code === 'REVIEWED_RECORD_VERSION_CHANGED' && item.path === row.path));
  assert.equal(stale.status, 'blocked'); assert.equal(stale.canApply, false); assert.equal(stale.writesPerformed, 0);
});
