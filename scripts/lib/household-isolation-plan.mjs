import { buildHouseholdMigrationPlan } from './household-migration-plan.mjs';
import { explicitFamilyId } from '../../server/family-identity.mjs';
import { createHash } from 'node:crypto';
const digest = text => createHash('sha256').update(text).digest('hex');
export const ISOLATION_PLAN_FIELDS = Object.freeze(['familyId', 'private', 'visibility', 'ownerUid', 'ownerProfileId', 'imagePath']);

/** Reviewable patches only. Never imports a write SDK or executes a migration. */
export function buildHouseholdIsolationPlan(config, inventory, options) {
  const base = buildHouseholdMigrationPlan(config, inventory, options);
  const plan = structuredClone(base);
  plan.migrationContract = 'household-isolation-v1';
  const members = new Map(config.members.map(item => [item.uid, item]));
  const rows = new Map(Object.values(inventory.collections).flat().map(row => [row.path, row]));
  const persons = new Map(config.members.map(item => {
    const data = rows.get(`members/${item.uid}`)?.data || {};
    return [data.personKey || data.name, item.uid];
  }));
  const reviewed = new Set(config.reviewedRecordPaths);
  const addBlock = (code, path = '') => {
    if (!plan.blockers.some(item => item.code === code && item.path === path)) plan.blockers.push({ code, path });
  };
  const add = (row, field, value) => {
    if (Object.hasOwn(row.data, field) && row.data[field] === value) return;
    if (!row.updateTime || !/^[0-9]+$/.test(row.updateTime.seconds) || !Number.isInteger(row.updateTime.nanoseconds)) {
      addBlock('DOCUMENT_VERSION_NOT_VERIFIED', row.path); return;
    }
    const key = `${row.path}:${field}`;
    if (plan.changes.some(change => `${change.path}:${change.field}` === key)) return;
    plan.changes.push({ path: row.path, field, before: Object.hasOwn(row.data, field)
      ? { present: true, value: row.data[field] } : { present: false }, after: { present: true, value }, updateTime: { ...row.updateTime } });
  };
  const family = row => {
    if (Object.hasOwn(row.data, 'familyId') && ![undefined, null, '', '__legacy__', plan.familyId].includes(row.data.familyId)) {
      addBlock('EXISTING_FAMILY_CONFLICT', row.path); return false;
    }
    add(row, 'familyId', plan.familyId); return true;
  };
  const owner = row => {
    const authorities = ['createdBy', 'ownerUid', 'sourceOwnerUid'].filter(key => row.data[key] && row.data[key] !== 'family');
    if (!authorities.length || authorities.some(key => !members.has(row.data[key]))) { addBlock('ISOLATION_RECORD_OWNER_NOT_VERIFIED', row.path); return null; }
    if (row.data.person && row.data.person !== 'family' && !persons.has(row.data.person)) { addBlock('UNVERIFIED_PERSON_REFERENCE', row.path); return null; }
    return row.data.ownerUid || row.data.createdBy || row.data.sourceOwnerUid;
  };
  for (const name of ['calendarEvents', 'privateCalendarEvents']) for (const row of inventory.collections[name] || []) {
    const eventOwner = owner(row);
    if (!eventOwner) continue;
    if (name === 'calendarEvents' && (row.data.private === true || row.data.visibility && row.data.visibility !== 'family')) {
      addBlock('PRIVATE_EVENT_IN_SHARED_COLLECTION_REQUIRES_REVIEW', row.path); continue;
    }
    if (name === 'privateCalendarEvents' && (!members.has(row.data.ownerUid) || row.data.private === false
      || row.data.visibility && row.data.visibility !== 'private')) { addBlock('PRIVATE_CALENDAR_OWNER_NOT_VERIFIED', row.path); continue; }
    const profileId = row.data.person === 'family' ? 'family' : persons.get(row.data.person);
    if (!profileId || row.data.ownerProfileId !== undefined && row.data.ownerProfileId !== profileId) {
      addBlock('CALENDAR_PROFILE_LINK_NOT_VERIFIED', row.path); continue;
    }
    if (!family(row)) continue;
    add(row, 'private', name === 'privateCalendarEvents'); add(row, 'visibility', name === 'privateCalendarEvents' ? 'private' : 'family');
    add(row, 'ownerUid', eventOwner); add(row, 'ownerProfileId', profileId);
  }
  for (const name of ['schoolItems', 'schoolParentMessages', 'schoolStudentMessages', 'schoolPlans']) for (const row of inventory.collections[name] || []) {
    if (!owner(row)) continue;
    if (row.data.person === 'family' || !persons.has(row.data.person)
      || row.data.ownerProfileId && row.data.ownerProfileId !== persons.get(row.data.person)) { addBlock('SCHOOL_PROFILE_LINK_NOT_VERIFIED', row.path); continue; }
    family(row);
  }
  for (const row of inventory.collections.healthDocuments || []) {
    // Base planner already checks all UID ACLs, reciprocal links and exact file
    // versions. A failed base verification cannot become an isolation patch.
    if (plan.blockers.some(item => item.path === row.path)) continue;
    if (members.has(row.data.createdBy) && members.has(row.data.ownerProfileId) && row.data.state === 'ready') family(row);
  }
  for (const row of inventory.collections.healthDocumentGrants || []) {
    if (plan.blockers.some(item => item.path === row.path) || !members.has(row.data.ownerProfileId || row.id)) continue;
    family(row);
  }
  for (const row of inventory.collections._taskRewardPending || []) {
    const request = rows.get(`taskRewardRequests/${row.data.requestId}`);
    if (request && members.has(request.data.uid) && row.data.person === request.data.person && row.data.rewardId === request.data.rewardId
      && !plan.blockers.some(item => item.path === row.path || item.path === request.path)) family(row);
  }
  for (const name of ['quickProducts', 'familySettings', 'medicalContacts']) for (const row of inventory.collections[name] || []) {
    const files = row.data.fileSources || {};
    const image = files.imageURL;
    const path = name === 'quickProducts' ? row.data.imagePath || (image?.kind === 'firebase-storage' && image.bucket === config.bucket ? image.path : null) : null;
    if (path && (!/^quick-products\/[^/]+\/[^/]+$/.test(path) || path.split('/').some(part => part === '..' || part === '.')
      || image?.kind === 'firebase-storage' && (image.bucket !== config.bucket || image.path !== path))) {
      addBlock('FILE_SOURCE_PATH_MISMATCH', row.path); continue;
    }
    const uploader = path ? path.split('/')[1] : null;
    const authority = row.data.createdBy || row.data.updatedBy || uploader;
    if (!members.has(authority) && !reviewed.has(row.path)) { addBlock('ISOLATION_PRESENTATION_OWNER_REVIEW_REQUIRED', row.path); continue; }
    if (authority && !members.has(authority) || row.data.person && row.data.person !== 'family' && !persons.has(row.data.person)) {
      addBlock('ISOLATION_RECORD_OWNER_NOT_VERIFIED', row.path); continue;
    }
    if (plan.blockers.some(item => item.path === row.path)) continue;
    if (!family(row)) continue;
    if (uploader) {
      const object = inventory.storage.find(item => item.path === path && item.exists);
      if (!object || !/^[0-9]+$/.test(String(object.generation || '')) || !/^[0-9]+$/.test(String(object.metageneration || ''))
        || !Number.isSafeInteger(Number(object.size)) || Number(object.size) <= 0 || Number(object.size) > 5 * 1024 * 1024
        || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(object.contentType)) {
        addBlock('STORAGE_OBJECT_NOT_VERIFIED', row.path); continue;
      }
      add(row, 'imagePath', path);
    }
  }
  const sorted = plan.changes.sort((a, b) => a.path.localeCompare(b.path) || a.field.localeCompare(b.field));
  const paths = new Set(sorted.map(change => change.path));
  if (paths.size > 450) addBlock('ATOMIC_PLAN_TOO_LARGE');
  plan.status = plan.blockers.length ? 'blocked' : 'prepared-requires-approval';
  plan.rollback = sorted.map(change => ({ path: change.path, field: change.field, before: change.after, after: change.before,
    conditions: { postApplyUpdateTimeRequired: true, noConcurrentChanges: true } }));
  plan.summary.proposedFamilyIdChanges = sorted.filter(change => change.field === 'familyId').length;
  plan.summary.proposedFieldChanges = sorted.length; plan.summary.proposedDocumentChanges = paths.size;
  plan.summary.planDigest = digest(JSON.stringify(sorted));
  // Counts are proposals, not an assertion that any database write happened.
  plan.preservation.calendarWrites = 0; plan.preservation.storageWrites = 0;
  return plan;
}
