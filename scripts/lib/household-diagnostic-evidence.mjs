/** In-memory diagnostic handoff only. No bodies, credentials, URLs or rule sources. */
import { HOUSEHOLD_FIELDS, projectedHouseholdData, documentVersion } from './household-migration-inventory.mjs';
import { sanitizeStorageCheck, STORAGE_PREFIXES } from './household-storage-status.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value || {}, key)).map(key => [key, value[key]]));
const scalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value : null;
const scalarMap = value => Object.fromEntries(Object.entries(object(value) ? value : {}).filter(([, item]) => typeof item === 'number' || typeof item === 'boolean'));
const code = value => typeof value === 'string' && /^[A-Z_0-9]{1,100}$/.test(value) ? value : null;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
const list = value => Array.isArray(value) ? value : [];
const allowedCollection = name => Object.hasOwn(HOUSEHOLD_FIELDS, name) || /^notificationInbox\/[^/]+\/items$/.test(name);
const flags = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key] === true]));
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const checkedAt = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const project = value => typeof value === 'string' && /^[a-z][a-z0-9-]{3,61}[a-z0-9]$/.test(value) ? value : null;
const httpStatus = value => Number.isInteger(value) && value >= 400 && value <= 599 ? value : null;
const issue = value => ({ code: code(value?.code), ...pick(value, ['path']),
  ...(Array.isArray(value?.details?.identifiers) ? { details: { identifiers: value.details.identifiers.filter(item => typeof item === 'string') } } : {}) });
const state = value => ({ present: value?.present === true, ...(value?.present === true ? { value: scalar(value.value) } : {}) });
const change = value => ({ ...pick(value, ['path', 'field']), before: state(value?.before), after: state(value?.after),
  ...(value?.updateTime ? { updateTime: documentVersion(value.updateTime) } : {}),
  ...(value?.conditions ? { conditions: pick(value.conditions, ['familyIdEquals', 'postApplyUpdateTimeRequired', 'noConcurrentChanges']) } : {}) });

function projectPlan(plan) {
  if (!object(plan)) return null;
  return { ...pick(plan, ['schemaVersion', 'mode', 'migrationContract', 'writesPerformed', 'canApply', 'status',
    'familyId', 'projectId', 'bucket', 'generatedAt', 'inventorySource']),
    blockers: list(plan.blockers).map(issue), warnings: list(plan.warnings).map(issue),
    changes: list(plan.changes).map(change), rollback: list(plan.rollback).map(change),
    ...(object(plan.preservation) ? { preservation: { ...scalarMap(plan.preservation),
      collections: Object.fromEntries(Object.entries(plan.preservation.collections || {}).filter(([name]) => allowedCollection(name)).map(([name, value]) => [name, scalarMap(value)])) } } : {}),
    ...(object(plan.summary) ? { summary: { ...scalarMap(plan.summary), ...pick(plan.summary, ['storageScope']),
      ...(object(plan.summary.fileSources) ? { fileSources: scalarMap(plan.summary.fileSources) } : {}),
      ...(hash(plan.summary.planDigest) ? { planDigest: plan.summary.planDigest } : {}) } } : {}) };
}

function projectInventory(inventory) {
  if (!object(inventory)) return null;
  return { ...pick(inventory, ['schemaVersion', 'projectId', 'bucket', 'source']),
    collections: Object.fromEntries(Object.entries(inventory.collections || {}).filter(([name]) => allowedCollection(name)).map(([name, rows]) => [name,
      list(rows).map(row => ({ ...pick(row, ['id', 'path']), data: projectedHouseholdData(name, row.data || {}), updateTime: documentVersion(row.updateTime) }))])),
    auth: list(inventory.auth).map(row => pick(row, ['uid', 'exists', 'disabled'])),
    storage: list(inventory.storage).map(row => ({ ...pick(row, ['path', 'exists', 'generation', 'metageneration', 'size', 'contentType', 'hasDownloadToken']),
      links: pick(row.links, ['taskId', 'rewardId', 'uploadId', 'uploaderUid']) })),
    coverage: { ...flags(inventory.coverage, ['complete', 'authVerified']),
      missingCollections: list(inventory.coverage?.missingCollections).filter(name => name === 'storage' || allowedCollection(name)),
      collections: list(inventory.coverage?.collections).filter(allowedCollection),
      storagePrefixes: list(inventory.coverage?.storagePrefixes).filter(prefix => STORAGE_PREFIXES.includes(prefix)),
      ...(inventory.coverage?.storageCheck ? { storageCheck: sanitizeStorageCheck(inventory.coverage.storageCheck) } : {}) } };
}

function projectService(value, isRules) {
  return Object.fromEntries(['firestore', 'storage'].map(service => {
    const row = value?.[service];
    return [service, { verified: row?.verified === true,
      status: ['matched', 'mismatch', 'unavailable', 'changed', 'verified'].includes(row?.status) ? row.status : null,
      httpStatus: httpStatus(row?.httpStatus),
      ...(isRules ? { code: code(row?.code), sha256: hash(row?.sha256), localSha256: hash(row?.localSha256) }
        : { europeanUnion: row?.europeanUnion === true,
          location: typeof row?.location === 'string' && /^[a-z0-9-]{1,80}$/i.test(row.location) ? row.location : null }) }];
  }));
}

export function projectHouseholdDiagnosticEvidence(capture, backup, restore) {
  if (!object(capture) || !object(capture.plan) || !object(capture.inventory)) return null;
  return { plan: projectPlan(capture.plan), inventory: projectInventory(capture.inventory), planDigest: hash(capture.planDigest),
    backup: { capturedAt: checkedAt(backup?.capturedAt),
      scope: backup?.scope === 'full-default-firestore-and-current-selected-bucket-plus-captured-external-files' ? backup.scope : null,
      ...flags(backup, ['complete', 'manifestHashesVerified']), archiveDigestSha256: hash(backup?.archiveDigestSha256) },
    restore: { sourceProjectId: project(restore?.sourceProjectId), targetProjectId: project(restore?.targetProjectId),
      ...Object.fromEntries(['documentCount', 'objectCount', 'externalFileCount', 'authMetadataCount', 'authMissingCount', 'externalFilesUnverifiedCount']
        .map(key => [key, count(restore?.[key])])),
      checkedAt: checkedAt(restore?.checkedAt), emulatorExitCode: Number.isInteger(restore?.emulatorExitCode) ? restore.emulatorExitCode : null,
      ...flags(restore, ['authenticationCredentialsRestored', 'authSessionAndHistoricalTimestampsRestored']),
      authVerifiedScope: restore?.authVerifiedScope === 'uid-email-phone-avatar-disabled-claims-provider-profile-metadata' ? restore.authVerifiedScope : null,
      ...flags(restore, ['verified', 'safetyVerified']), archiveDigestSha256: hash(restore?.archiveDigestSha256), code: code(restore?.code),
      rollback: { changeCount: count(restore?.rollback?.changeCount), ...flags(restore?.rollback, ['verified', 'concurrentChangeRejected', 'postApplyReceiptIsDemoOnly']), rollbackFieldsSha256: hash(restore?.rollback?.rollbackFieldsSha256) },
      isolation: { ...flags(restore?.isolation, ['rulesVerified', 'fullMultiHouseholdVerified']), code: code(restore?.isolation?.code),
        scenarios: list(restore?.isolation?.scenarios).map(row => ({ id: typeof row?.id === 'string' && /^[a-z0-9-]{1,100}$/.test(row.id) ? row.id : null,
          ...Object.fromEntries(['expectedAllowed', 'actualAllowed', 'passed'].map(key => [key, typeof row?.[key] === 'boolean' ? row[key] : null])) })) } },
    rules: projectService(capture.rules, true),
    locations: projectService(capture.locations, false),
    consistency: Object.fromEntries(['firestore', 'storage', 'auth'].map(service => [service, {
      stable: typeof capture.consistency?.[service]?.stable === 'boolean' ? capture.consistency[service].stable : null,
      checked: typeof capture.consistency?.[service]?.stable === 'boolean' && !capture.consistency?.code,
    }])),
    externalFiles: object(capture.payload) && Array.isArray(capture.externalFiles) ? capture.externalFiles.map(row => ({
      status: ['captured', 'blocked'].includes(row?.status) ? row.status : null,
      id: hash(row?.id), sha256: hash(row?.sha256), code: code(row?.code) })) : null,
    tokens: { scanVerified: capture.payload?.evidence?.tokens?.scanVerified === true,
      privateTokenCount: Number.isSafeInteger(capture.payload?.evidence?.tokens?.privateTokenCount) && capture.payload.evidence.tokens.privateTokenCount >= 0 ? capture.payload.evidence.tokens.privateTokenCount : null,
      productTokenCount: Number.isSafeInteger(capture.payload?.evidence?.tokens?.productTokenCount) && capture.payload.evidence.tokens.productTokenCount >= 0 ? capture.payload.evidence.tokens.productTokenCount : null },
    captureComplete: capture.captureComplete === true, sourceProjectId: capture.plan.projectId };
}

/** Human PASS must use the same strict archive/exit/safety gate as readiness. */
export function preflightRestoreVerified(proof) {
  const restore = proof?.restore, archive = proof?.backup?.archiveDigestSha256;
  return proof?.checks?.some(row => row.id === 'restore' && row.status === 'verified') === true
    && proof?.backup?.complete === true && proof.backup.manifestHashesVerified === true && hash(archive) !== null
    && restore?.verified === true && restore.safetyVerified === true && restore.emulatorExitCode === 0
    && /^demo-household-restore-[a-z0-9-]{6,32}$/.test(restore.targetProjectId || '')
    && project(proof.sourceProjectId) !== null
    && restore.sourceProjectId === proof.sourceProjectId && restore.archiveDigestSha256 === archive;
}
