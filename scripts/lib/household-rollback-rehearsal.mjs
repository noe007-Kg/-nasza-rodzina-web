import { assertRestoreTarget } from './household-restore-verifier.mjs';
import { canonicalJson, backupDigest } from './household-backup-archive.mjs';
import { ISOLATION_PLAN_FIELDS } from './household-isolation-plan.mjs';
import { controlFailure as fail } from './household-private-files.mjs';
const encoded = name => name.split('/').map(encodeURIComponent).join('/');
export async function rehearseHouseholdRollback(payload, target, request = fetch) {
  assertRestoreTarget(target);
  const plan = payload.plan;
  if (!plan || plan.canApply !== false || plan.writesPerformed !== 0 || plan.blockers?.length || new Set((plan.changes || []).map(row => row.path)).size > 450) fail('REHEARSAL_PLAN_INVALID');
  const source = `projects/${payload.projectId}/databases/(default)/documents/`;
  const destination = `projects/${target.projectId}/databases/(default)/documents/`;
  const originals = new Map(payload.documents.map(row => [row.name.slice(source.length), row]));
  const base = `http://${target.firestoreHost}/v1`;
  const read = async change => {
    const response = await request(`${base}/${encoded(destination + change.path)}`, { headers: { Authorization: 'Bearer owner' }, redirect: 'error' });
    if (!response.ok) fail('REHEARSAL_READ_FAILED');
    return response.json();
  };
  const commit = async writes => request(`${base}/${encoded(destination.slice(0, -1))}:commit`, {
    method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }), redirect: 'error' });
  const groups = new Map();
  const scalar = value => value === null ? { nullValue: null } : typeof value === 'boolean'
    ? { booleanValue: value } : typeof value === 'string' ? { stringValue: value } : fail('REHEARSAL_CHANGE_INVALID');
  for (const change of plan.changes || []) {
    if (!ISOLATION_PLAN_FIELDS.includes(change.field) || !originals.has(change.path)
      || change.after?.present !== true || change.field === 'familyId' && change.after.value !== plan.familyId
      || /(^|\/)\.\.?($|\/)|[\u0000-\u001f]/.test(change.path)) fail('REHEARSAL_CHANGE_INVALID');
    const expected = originals.get(change.path).fields?.[change.field];
    if ((expected !== undefined) !== change.before?.present || change.before?.present
      && canonicalJson(expected) !== canonicalJson(scalar(change.before.value))) fail('REHEARSAL_CHANGE_INVALID');
    const group = groups.get(change.path) || { path: change.path, fields: {}, mask: [] };
    if (group.mask.includes(change.field)) fail('REHEARSAL_CHANGE_INVALID');
    group.fields[change.field] = scalar(change.after.value); group.mask.push(change.field);
    groups.set(change.path, group);
  }
  const changes = [...groups.values()];
  if (!changes.length) return { verified: true, changeCount: 0, postApplyReceiptIsDemoOnly: true, concurrentChangeRejected: true };
  const before = await Promise.all(changes.map(read));
  const apply = before.map((row, i) => ({ update: { name: row.name, fields: changes[i].fields },
    updateMask: { fieldPaths: changes[i].mask }, currentDocument: { updateTime: row.updateTime } }));
  if (!(await commit(apply)).ok) fail('REHEARSAL_APPLY_FAILED');
  const after = await Promise.all(changes.map(read));
  const reverse = after.map((row, i) => ({ update: { name: row.name, fields: Object.fromEntries(changes[i].mask.filter(key => Object.hasOwn(before[i].fields || {}, key)).map(key => [key, before[i].fields[key]])) }, updateMask: { fieldPaths: changes[i].mask }, currentDocument: { updateTime: row.updateTime } }));
  if (!(await commit(reverse)).ok) fail('REHEARSAL_ROLLBACK_FAILED');
  const reversed = await Promise.all(changes.map(read));
  if (reversed.some((row, i) => canonicalJson(row.fields || {}) !== canonicalJson(before[i].fields || {}))) fail('REHEARSAL_ROLLBACK_HASH_MISMATCH');
  const current = await Promise.all(changes.map(read));
  if (!(await commit(current.map((row, i) => ({ update: { name: row.name, fields: changes[i].fields },
    updateMask: { fieldPaths: changes[i].mask }, currentDocument: { updateTime: row.updateTime } })))).ok) fail('REHEARSAL_APPLY_FAILED');
  const receipts = await Promise.all(changes.map(read));
  const marker = { stringValue: 'SYNTHETIC_CONCURRENT_RESTORE_TEST' };
  if (!(await commit([{ update: { name: receipts[0].name, fields: { householdRestoreConcurrentProbe: marker } },
    updateMask: { fieldPaths: ['householdRestoreConcurrentProbe'] }, currentDocument: { updateTime: receipts[0].updateTime } }])).ok) fail('REHEARSAL_CONCURRENT_PROBE_FAILED');
  const staleReverse = reverse.map((write, i) => ({ ...write, currentDocument: { updateTime: receipts[i].updateTime } }));
  const rejected = await commit(staleReverse);
  if (rejected.ok || ![400, 409, 412].includes(rejected.status)) fail('REHEARSAL_STALE_VERSION_NOT_REJECTED');
  const unchanged = await Promise.all(changes.map(read));
  if (unchanged.some((row, i) => changes[i].mask.some(key => canonicalJson(row.fields?.[key]) !== canonicalJson(changes[i].fields[key])))
    || unchanged[0].fields?.householdRestoreConcurrentProbe?.stringValue !== marker.stringValue) fail('REHEARSAL_ATOMIC_REFUSAL_FAILED');
  return { verified: true, changeCount: changes.length, concurrentChangeRejected: true, rollbackFieldsSha256: backupDigest(canonicalJson(before.map(row => row.fields || {}))), postApplyReceiptIsDemoOnly: true };
}
