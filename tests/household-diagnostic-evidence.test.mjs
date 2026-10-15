import test from 'node:test';
import assert from 'node:assert/strict';
import { projectHouseholdDiagnosticEvidence, preflightRestoreVerified } from '../scripts/lib/household-diagnostic-evidence.mjs';
import { canonicalJson, backupDigest } from '../scripts/lib/household-backup-archive.mjs';
import { buildHouseholdIsolationPlan } from '../scripts/lib/household-isolation-plan.mjs';
import { HOUSEHOLD_FIELDS } from '../scripts/lib/household-migration-inventory.mjs';
import { STORAGE_PREFIXES } from '../scripts/lib/household-storage-status.mjs';

const poison = 'POISON_CREDENTIAL_OR_MEDICAL_BODY';
const digest = 'a'.repeat(64);
const privateURL = 'https://example.invalid/private.pdf?token=POISON_CREDENTIAL_OR_MEDICAL_BODY';
function capture() {
  return { plan: { schemaVersion: 1, mode: 'dry-run', projectId: 'demo-diagnostic-source', bucket: 'demo-diagnostic-source.appspot.com',
    migrationContract: 'household-isolation-v1', familyId: 'family-synthetic', canApply: false, writesPerformed: 0,
    changes: [{ path: 'members/synthetic-parent', field: 'familyId', before: { present: false, token: poison },
      after: { present: true, value: 'family-synthetic', secret: poison }, updateTime: { seconds: '1', nanoseconds: 0, cookie: poison }, token: poison }],
    blockers: [], warnings: [{ code: 'NO_SECRET_SESSION_OR_PROVIDER_CONTENT_INSPECTED', path: '', secret: poison }],
    token: poison, rollback: [] },
    inventory: { schemaVersion: 1, projectId: 'demo-diagnostic-source', bucket: 'demo-diagnostic-source.appspot.com', source: 'firebase-admin-read-only',
      collections: { members: [{ id: 'synthetic-parent', path: 'members/synthetic-parent',
        data: { name: 'Synthetic member', role: 'parent', active: true, photoURL: privateURL, password: poison, body: poison },
        updateTime: { seconds: '1', nanoseconds: 0 }, body: poison }], _secretSessions: [{ session: poison }] },
      auth: [{ uid: 'synthetic-parent', exists: true, disabled: false, email: poison, refreshToken: poison }],
      storage: [{ path: 'avatars/synthetic-parent/test.png', exists: true, generation: '1', metageneration: '1', size: 4, contentType: 'image/png',
        links: { uploaderUid: 'synthetic-parent', firebaseStorageDownloadTokens: poison }, bytesBase64: poison, metadata: { firebaseStorageDownloadTokens: poison } }],
      coverage: { complete: true, authVerified: true, collections: ['members', '_secretSessions'], missingCollections: [], storagePrefixes: [...STORAGE_PREFIXES], cookie: poison }, token: poison },
    planDigest: digest, captureComplete: true,
    rules: { firestore: { verified: true, status: 'matched', sha256: digest, localSha256: digest, sourceFiles: [{ content: poison }], token: poison } },
    locations: { firestore: { verified: true, europeanUnion: true, location: 'eur3', labels: { secret: poison } } },
    consistency: { firestore: { stable: true, body: poison }, storage: { stable: true }, auth: { stable: true }, secret: poison },
    externalFiles: [{ id: digest, status: 'captured', sha256: digest, bytesBase64: poison, url: privateURL, headers: { Authorization: poison } }],
    payload: { evidence: { tokens: { scanVerified: true, privateTokenCount: 1, productTokenCount: 0, token: poison } },
      documents: [{ body: poison }], auth: [{ password: poison }], key: poison }, key: poison };
}

test('diagnostic projection retains metadata proofs and removes bodies, URLs, bytes, tokens and rule sources at every handoff level', () => {
  const source = capture();
  const result = projectHouseholdDiagnosticEvidence(source, { complete: true, manifestHashesVerified: true, archiveDigestSha256: digest, key: poison },
    { verified: true, safetyVerified: true, emulatorExitCode: 0, archiveDigestSha256: digest, sourceProjectId: source.plan.projectId,
      targetProjectId: 'demo-household-restore-abcdef', body: poison, rollback: { verified: true, concurrentChangeRejected: true, postApplyReceiptIsDemoOnly: true, receipt: poison },
      isolation: { rulesVerified: true, fullMultiHouseholdVerified: false, scenarios: [{ id: 'foreign-calendar', passed: true, token: poison }], secret: poison } });
  const text = JSON.stringify(result);
  assert.equal(text.includes(poison), false); assert.equal(text.includes('https://'), false);
  assert.equal(result.plan.changes[0].path, 'members/synthetic-parent');
  assert.equal(result.inventory.collections.members[0].data.fileSources.photoURL.kind, 'external-url');
  assert.equal(result.inventory.auth[0].uid, 'synthetic-parent');
  assert.deepEqual(result.tokens, { scanVerified: true, privateTokenCount: 1, productTokenCount: 0 });
  assert.equal(result.restore.isolation.fullMultiHouseholdVerified, false);
  assert.deepEqual(result.consistency, { firestore: { stable: true,checked:true }, storage: { stable: true,checked:true }, auth: { stable: true,checked:true } });
  assert.equal(Object.hasOwn(result, 'payload'), false);
  result.inventory.auth[0].disabled = true;
  assert.equal(source.inventory.auth[0].disabled, false, 'projection must not share mutable metadata rows');
});

test('empty, failed and malformed evidence cannot become positive checks or invent token counts', () => {
  for (const value of [undefined, null, {}, { plan: {} }, { inventory: {} }]) assert.equal(projectHouseholdDiagnosticEvidence(value), null);
  const result = projectHouseholdDiagnosticEvidence({ plan: {}, inventory: {} });
  assert.equal(result.captureComplete, false); assert.equal(result.backup.complete, false);
  assert.equal(result.restore.verified, false); assert.equal(result.rules.firestore.verified, false);
  assert.deepEqual(result.tokens, { scanVerified: false, privateTokenCount: null, productTokenCount: null });
  assert.equal(result.consistency.firestore.stable, null);assert.equal(result.consistency.firestore.checked,false);
  assert.equal(result.externalFiles, null, 'an absent full capture cannot prove zero external references');
  const source = capture(); source.payload.evidence.tokens.privateTokenCount = -1;
  source.payload.evidence.tokens.productTokenCount = '0';
  source.rules.firestore.code = privateURL;
  source.rules.firestore.status = { body: poison };
  source.rules.firestore.httpStatus = { body: poison };
  source.locations.firestore.location = privateURL;
  const checked = projectHouseholdDiagnosticEvidence(source);
  assert.equal(checked.tokens.privateTokenCount, null); assert.equal(checked.tokens.productTokenCount, null);
  assert.equal(checked.rules.firestore.code, null);
  assert.equal(checked.rules.firestore.status, null); assert.equal(checked.rules.firestore.httpStatus, null);
  assert.equal(checked.locations.firestore.location, null);
});
test('an unavailable full recheck cannot be reported as an observed concurrent change',()=>{
  const source=capture();source.consistency={code:'CAPTURE_RECHECK_FAILED',firestore:{stable:false},storage:{stable:false},auth:{stable:false}};
  const result=projectHouseholdDiagnosticEvidence(source);
  for(const service of ['firestore','storage','auth'])assert.equal(result.consistency[service].checked,false);
});

test('already-projected file references keep their safe descriptor without returning URL or token values', () => {
  const source = capture();
  delete source.inventory.collections.members[0].data.photoURL;
  source.inventory.collections.members[0].data.fileSources = { photoURL: { kind: 'firebase-storage',
    bucket: 'demo-diagnostic-source.appspot.com', path: 'avatars/synthetic-parent/test.png', hasBearerToken: true } };
  const result = projectHouseholdDiagnosticEvidence(source);
  assert.deepEqual(result.inventory.collections.members[0].data.fileSources,
    source.inventory.collections.members[0].data.fileSources);
  assert.equal(JSON.stringify(result).includes(privateURL), false);
});

test('projection preserves the exact canonical digest of an actual planner-produced plan', () => {
  const config = { schemaVersion: 1, projectId: 'demo-diagnostic-source', bucket: 'demo-diagnostic-source.appspot.com', householdConfirmed: true,
    familyId: 'family-synthetic', reviewedRecordPaths: [], members: Array.from({ length: 5 }, (_, i) => ({ uid: `synthetic-${i}`,
      expectedName: `Synthetic ${i}`, expectedPersonKey: `person-${i}`, expectedRole: i < 2 ? 'parent' : 'child', expectedCanLogin: i < 4 })) };
  const inventory = { schemaVersion: 1, projectId: config.projectId, bucket: config.bucket, source: 'firebase-admin-read-only',
    collections: Object.fromEntries([...Object.keys(HOUSEHOLD_FIELDS), ...config.members.map(row => `notificationInbox/${row.uid}/items`)].map(name => [name, []])),
    auth: config.members.map(row => ({ uid: row.uid, exists: row.expectedCanLogin, disabled: false })), storage: [],
    coverage: { complete: true, missingCollections: [], collections: [...Object.keys(HOUSEHOLD_FIELDS), ...config.members.map(row => `notificationInbox/${row.uid}/items`)], storagePrefixes: [...STORAGE_PREFIXES], authVerified: true } };
  inventory.collections.members = config.members.map(row => ({ id: row.uid, path: `members/${row.uid}`,
    data: { name: row.expectedName, personKey: row.expectedPersonKey, role: row.expectedRole, canLogin: row.expectedCanLogin, active: true }, updateTime: { seconds: '1', nanoseconds: 0 } }));
  const plan = buildHouseholdIsolationPlan(config, inventory, { familyId: config.familyId, now: new Date('2026-10-15T00:00:00Z') });
  const result = projectHouseholdDiagnosticEvidence({ plan, inventory, planDigest: backupDigest(canonicalJson(plan)) });
  assert.equal(canonicalJson(result.plan), canonicalJson(plan));
});

test('human restore PASS requires strict readiness, safe target, archive binding, successful process and complete authenticated backup', () => {
  const proof = { sourceProjectId: 'demo-diagnostic-source', checks: [{ id: 'restore', status: 'verified' }],
    backup: { complete: true, manifestHashesVerified: true, archiveDigestSha256: digest },
    restore: { verified: true, safetyVerified: true, sourceProjectId: 'demo-diagnostic-source', targetProjectId: 'demo-household-restore-abcdef',
      archiveDigestSha256: digest, emulatorExitCode: 0 } };
  assert.equal(preflightRestoreVerified(proof), true);
  for (const mutate of [value => value.checks = [], value => value.backup.complete = false,
    value => value.backup.manifestHashesVerified = false, value => value.restore.emulatorExitCode = 1,
    value => value.restore.archiveDigestSha256 = 'b'.repeat(64), value => value.restore.targetProjectId = 'nasza-rodzina',
    value => value.restore.safetyVerified = false, value => value.restore.sourceProjectId = 'foreign-project',
    value => { delete value.sourceProjectId; delete value.restore.sourceProjectId; }]) {
    const value = structuredClone(proof); mutate(value); assert.equal(preflightRestoreVerified(value), false);
  }
  assert.equal(preflightRestoreVerified({ restore: { verified: true } }), false);
  assert.equal(preflightRestoreVerified(null), false);
});
