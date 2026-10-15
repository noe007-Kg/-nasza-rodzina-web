/** Local review planning only: no Firebase clients, network or write capability. */
import { validateHouseholdConfig } from './household-migration-plan.mjs';
import { buildHouseholdIsolationPlan, ISOLATION_PLAN_FIELDS } from './household-isolation-plan.mjs';
import { HOUSEHOLD_FIELDS } from './household-migration-inventory.mjs';
import { canonicalJson, backupDigest } from './household-backup-archive.mjs';
import { controlFailure as fail } from './household-private-files.mjs';

const digest = value => backupDigest(canonicalJson(value));
const presentationCollections = new Set(['familySettings', 'quickProducts', 'medicalContacts']);
const labels = { familySettings: 'Ustawienia wspólnego profilu rodziny', quickProducts: 'Ustawienia szybkiego produktu',
  medicalContacts: 'Powiązanie kontaktu medycznego (bez treści)' };
const roleLabels = { parent: 'rodzic', adult: 'dorosły', child: 'dziecko' };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safePath = value => typeof value === 'string' && value.length <= 1600 && value.split('/').length === 2
  && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[\u0000-\u001f\u007f\\]/.test(part));

function validateSourcePlan(config, plan) {
  if (!plain(plan) || plan.schemaVersion !== 1 || plan.migrationContract !== 'household-isolation-v1'
    || plan.projectId !== config.projectId || plan.bucket !== config.bucket || plan.canApply !== false
    || plan.writesPerformed !== 0 || !Array.isArray(plan.changes) || plan.changes.length > 5000
    || !Array.isArray(plan.blockers) || !Array.isArray(plan.warnings)
    || config.familyId !== undefined && plan.familyId !== config.familyId) fail('SOURCE_PLAN_NOT_SAFE');
  validateHouseholdConfig({ ...config, familyId: plan.familyId });
  const uids = new Set(config.members.map(member => member.uid)), seen = new Set();
  for (const change of plan.changes) {
    const key = `${change.path}:${change.field}`;
    if (!safePath(change.path) || !Object.hasOwn(HOUSEHOLD_FIELDS, change.path.split('/')[0])
      || !ISOLATION_PLAN_FIELDS.includes(change.field) || seen.has(key) || change.after?.present !== true
      || !plain(change.before) || typeof change.before.present !== 'boolean'
      || !/^\d+$/.test(change.updateTime?.seconds || '') || !Number.isInteger(change.updateTime?.nanoseconds)
      || change.updateTime.nanoseconds < 0 || change.updateTime.nanoseconds >= 1e9) fail('SOURCE_PLAN_NOT_SAFE');
    seen.add(key);
    const value = change.after.value;
    if (change.field === 'familyId' && value !== plan.familyId
      || change.field === 'ownerUid' && !uids.has(value)
      || change.field === 'ownerProfileId' && value !== 'family' && !uids.has(value)
      || change.field === 'visibility' && !['private', 'family'].includes(value)
      || change.field === 'private' && typeof value !== 'boolean'
      || change.field === 'imagePath' && (typeof value !== 'string' || !/^quick-products\/[^/]+\/[^/]+$/.test(value)
        || !uids.has(value.split('/')[1]) || value.split('/').some(part => ['.', '..'].includes(part)))) fail('SOURCE_PLAN_NOT_SAFE');
  }
}

export function reviewCounts(changes) {
  const fields = {}, collections = {};
  for (const change of changes) {
    fields[change.field] = (fields[change.field] || 0) + 1;
    const collection = change.path.split('/')[0]; collections[collection] = (collections[collection] || 0) + 1;
  }
  return { fields, collections, fieldChanges: changes.length, documentChanges: new Set(changes.map(row => row.path)).size };
}

/** Decisions bind exact UID configuration, full metadata inventory and versions, never names alone. */
export function prepareHouseholdOwnerReview(input, sourcePlan, inventory, decisions) {
  const config = validateHouseholdConfig(input);
  validateSourcePlan(config, sourcePlan);
  const rows = new Map(Object.values(inventory.collections).flat().map(row => [row.path, row]));
  const receipts = new Map((config.reviewedRecordVersions || []).map(row=>[row.path,row.updateTime]));
  const trustedPaths = config.reviewedRecordPaths.filter(path=>!presentationCollections.has(path.split('/')[0])
    || receipts.has(path) && canonicalJson(receipts.get(path))===canonicalJson(rows.get(path)?.updateTime || null));
  const boundConfig = { ...config, familyId: sourcePlan.familyId, reviewedRecordPaths:trustedPaths,
    ...(config.reviewedRecordVersions ? {reviewedRecordVersions:config.reviewedRecordVersions.filter(row=>trustedPaths.includes(row.path))} : {}) };
  const initial = buildHouseholdIsolationPlan(boundConfig, inventory, { familyId: sourcePlan.familyId });
  const blockersFor = path => initial.blockers.filter(item => item.path === path);
  const candidates = [...new Set(initial.blockers.filter(item => item.code === 'ISOLATION_PRESENTATION_OWNER_REVIEW_REQUIRED')
    .map(item => item.path))].sort().filter(path => {
    const row = rows.get(path);
    // Existing family/UID references and all other blockers remain authoritative.
    // Simulate this one explicit confirmation to detect hidden conflicts first.
    if (!row || !presentationCollections.has(path.split('/')[0]) || blockersFor(path).some(item => item.code !== 'ISOLATION_PRESENTATION_OWNER_REVIEW_REQUIRED')) return false;
    const probe = buildHouseholdIsolationPlan({ ...boundConfig, reviewedRecordPaths: [...new Set([...trustedPaths, path])] }, inventory, { familyId: sourcePlan.familyId });
    return !probe.blockers.some(item => item.path === path);
  });
  const inventoryDigest = digest(inventory), configDigest = digest({config,boundConfig}), sourcePlanDigest = digest(sourcePlan);
  const reviewDigest = digest({ inventoryDigest, configDigest, sourcePlanDigest, changes: initial.changes, blockers: initial.blockers });
  const request = { schemaVersion: 1, mode: 'owner-review-only', canApply: false, productionWritesPerformed: 0,
    reviewDigest, configDigest, inventoryDigest, sourcePlanDigest, householdReviewed: false,
    records: candidates.map((path, index) => ({ reviewId: `R${String(index + 1).padStart(3, '0')}`, path,
      documentDigest: digest(rows.get(path)), decision: 'pending' })) };
  let confirmed = false;
  const accepted = [];
  if (decisions !== undefined) {
    if (!plain(decisions) || Object.keys(decisions).some(key => !Object.hasOwn(request, key))
      || Object.keys(request).some(key => !Object.hasOwn(decisions, key))
      || typeof decisions.householdReviewed !== 'boolean' || !Array.isArray(decisions.records)
      || canonicalJson({ ...decisions, householdReviewed: false, records: decisions.records.map(row => ({ ...row, decision: 'pending' })) }) !== canonicalJson(request)
      || decisions.records.some(row => !['pending', 'approve', 'reject'].includes(row.decision))) fail('OWNER_DECISION_STALE_OR_INVALID');
    confirmed = decisions.householdReviewed;
    for (const row of decisions.records) if (row.decision === 'approve') accepted.push(row.path);
  }
  // An explicit document decision alone does not establish the household.
  const reviewedConfig = confirmed ? validateHouseholdConfig({ ...boundConfig,
    reviewedRecordPaths: [...new Set([...trustedPaths, ...accepted])],
    ...(accepted.length || boundConfig.reviewedRecordVersions ? {reviewedRecordVersions:[
      ...(boundConfig.reviewedRecordVersions || []).filter(row=>!accepted.includes(row.path)),
      ...accepted.map(path=>({path,updateTime:{...rows.get(path).updateTime}})),
    ]} : {}),
  }) : null;
  const plan = reviewedConfig ? buildHouseholdIsolationPlan(reviewedConfig, inventory, { familyId: sourcePlan.familyId }) : initial;
  const unresolved = plan.blockers.filter(item => item.code === 'ISOLATION_PRESENTATION_OWNER_REVIEW_REQUIRED');
  const sourceCurrent = digest(sourcePlan.changes) === digest(initial.changes)
    && digest(sourcePlan.blockers.map(({code,path})=>({code,path})).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))))
      === digest(initial.blockers.map(({code,path})=>({code,path})).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))));
  const profiles = config.members.map((member, index) => ({ label: `Profil ${index + 1}`, role: roleLabels[member.expectedRole],
    identityReference: digest(member.uid).slice(0, 12),
    verified: !plan.blockers.some(item => item.path === `members/${member.uid}`),
    canLogin: member.expectedCanLogin }));
  const profileLabels = new Map(config.members.map((member,index)=>[member.uid,`Profil ${index+1}`]));
  const personLabels = new Map(config.members.filter(member=>!plan.blockers.some(item=>item.path===`members/${member.uid}`))
    .map(member=>{const profile=rows.get(`members/${member.uid}`)?.data;return [profile?.personKey||profile?.name,profileLabels.get(member.uid)];}));
  const assignments = [...new Set(plan.changes.map(row=>row.path))].sort().map((path,index)=>({
    reference: `D${String(index+1).padStart(4,'0')}`, collection: path.split('/')[0],
    fields: plan.changes.filter(row=>row.path===path).map(row=>row.field),
    owners: [...new Set(['createdBy','ownerUid','sourceOwnerUid'].map(key=>rows.get(path)?.data[key])
      .concat(plan.changes.filter(row=>row.path===path&&['ownerUid','ownerProfileId'].includes(row.field)).map(row=>row.after.value))
      .map(uid=>profileLabels.get(uid)).filter(Boolean))],
    subjectProfiles:[...new Set([
      ...['person','completedPerson','ownerPersonKey'].map(key=>rows.get(path)?.data[key]).map(person=>person==='family'?'Całe gospodarstwo':personLabels.get(person)),
      ...['ownerProfileId','uid'].map(key=>profileLabels.get(rows.get(path)?.data[key])),
      ...(path.startsWith('members/')?[profileLabels.get(path.split('/')[1])]:[]),
      ...(Array.isArray(rows.get(path)?.data.people)?rows.get(path).data.people.map(person=>personLabels.get(person)):[]),
    ].filter(Boolean))],
    verification: plan.blockers.some(item=>item.path===path)?'blocked':accepted.includes(path)||trustedPaths.includes(path)?'owner-confirmed':'uid-and-linked-metadata',
  }));
  const codeCounts = items => Object.fromEntries([...new Set(items.map(item=>item.code))].map(code=>[code,items.filter(item=>item.code===code).length]));
  const summary = { schemaVersion:1, mode:'owner-review-only', canApply:false, migrationExecutable:false, productionWritesPerformed:0,
    sourceReportCurrent:sourceCurrent, reviewDigest, householdConfirmed:confirmed,
    originalCounts:reviewCounts(sourcePlan.changes), currentCounts:reviewCounts(plan.changes), profiles, assignments,
    ambiguous: request.records.map(row=>({reference:row.reviewId,collection:row.path.split('/')[0], label:labels[row.path.split('/')[0]],
      documentReference:row.documentDigest.slice(0,12), decision:decisions?.records.find(item=>item.reviewId===row.reviewId)?.decision || 'pending'})),
    blockers:codeCounts(plan.blockers), warnings:codeCounts(plan.warnings),
    unresolvedPresentationCount:unresolved.length, automaticallyVerifiedDocuments:assignments.filter(row=>row.verification==='uid-and-linked-metadata').length,
    requiresFreshPreflight:true, sourceSnapshotIsAtomic:false,
  };
  return { request, summary, plan, reviewedConfig };
}
