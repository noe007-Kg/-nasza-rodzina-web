import { createHash, randomUUID } from 'node:crypto';
import { EduServerError } from './edu-auth.mjs';
import { canReceiveNotification, deriveNotificationEvent, semanticRecord } from './notification-events.mjs';
import { enqueueInAppEvents } from './notification-inbox.mjs';

// All requests and reads are bounded. A collection over this limit is skipped
// rather than treating an incomplete snapshot as a new notification baseline.
export const MAX_REFRESH_RECORDS = 500;
export const MIN_REFRESH_INTERVAL_MS = 1500;
export const MAX_BASELINE_BYTES = 768 * 1024;
const LEASE_MS = 60000;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reasons = new Set(['launch', 'foreground', 'changes']);
const timestamp = value => typeof value?.toMillis === 'function' ? value.toMillis() : Number(value) || 0;

export function validateRefreshBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => key !== 'reason')
    || (body.reason !== undefined && !reasons.has(body.reason))) {
    throw new EduServerError('NOTIFICATION_INVALID_REQUEST', 400, 'Nieprawidłowe odświeżenie powiadomień.');
  }
}

/** Queries reproduce existing read permissions; no client-supplied UID, source,
 * record, text or arbitrary notification is ever accepted by this endpoint. */
export function refreshSources(db, uid, profile) {
  const ownPerson = profile.personKey || profile.name;
  const bounded = query => query.limit(MAX_REFRESH_RECORDS + 1);
  return [
    { scope: 'calendar', collection: 'calendarEvents', query: bounded(db.collection('calendarEvents')) },
    { scope: 'private-calendar', collection: 'privateCalendarEvents', query: bounded(db.collection('privateCalendarEvents').where('ownerUid', '==', uid)) },
    { scope: 'tasks', collection: 'tasks', query: bounded(db.collection('tasks')) },
    { scope: 'shopping', collection: 'shoppingItems', query: bounded(db.collection('shoppingItems')) },
    // Admin can read one recent window and authorize every candidate before
    // enqueueing. This single-field query needs no new composite index and
    // continues to work when the family has years of older chat history.
    { scope: 'chat', collection: 'familyMessages', rolling: true,
      query: db.collection('familyMessages').orderBy('createdAt', 'desc').limit(MAX_REFRESH_RECORDS) },
    { scope: 'health', collection: 'healthRecords', query: bounded(profile.role === 'parent'
      ? db.collection('healthRecords')
      : db.collection('healthRecords').where('privateToParents', '==', false).where('person', 'in', ['family', ownPerson])) },
  ];
}

const privacyFields = ['person', 'private', 'privateToParents', 'ownerUid', 'createdBy', 'uid', 'channel', 'participants', 'updatedBy'];
function pendingEvent(event) {
  // The baseline stores fingerprints and routing only, never chat/health text.
  const record = Object.fromEntries(privacyFields.filter(key => event.record[key] !== undefined).map(key => {
    const value = event.record[key];
    return [key, typeof value === 'string' ? value.slice(0, ['person', 'channel'].includes(key) ? 500 : 128)
      : Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 2).map(item => item.slice(0, 128))
        : value === true];
  }));
  return { ...event, record };
}
export function planRefreshSource(collection, previous, records, member) {
  const fingerprints = Object.fromEntries(records.map(row => [row.id, digest(semanticRecord(row.data))]));
  const historyThroughMs = previous?.initialized === true ? timestamp(previous.historyThroughMs)
    : Math.max(0, ...records.map(row => timestamp(row.data.createdAt)));
  if (previous?.initialized !== true) return { fingerprints, pending: [], baseline: true, historyThroughMs };
  // Keep the latest undelivered state per record. Repeated failures must not
  // grow a single Firestore baseline beyond its document size limit.
  const pending = new Map((Array.isArray(previous.pending) ? previous.pending : []).map(event => [event.recordId, event]));
  for (const row of records) {
    const oldFingerprint = previous.records?.[row.id];
    if (oldFingerprint === fingerprints[row.id]) continue;
    // Immutable older messages can re-enter the rolling window after a
    // deletion. Their timestamp proves they belong to the original history.
    if (collection === 'familyMessages' && !oldFingerprint && timestamp(row.data.createdAt) <= historyThroughMs) continue;
    // The semantic fingerprint already proves the change. An empty old record
    // selects the canonical "changed" action without persisting old private text.
    const event = deriveNotificationEvent(collection, row.id, oldFingerprint ? {} : null, row.data);
    if (event && canReceiveNotification(member, event)) pending.set(event.recordId, pendingEvent(event));
  }
  // Recheck current visibility for retryable events. A health record made
  // private or an event removed since a failed request must not leak on retry.
  const current = new Map(records.map(row => [row.id, row.data]));
  const eligible = [...pending.values()].flatMap(event => {
    const record = current.get(event.recordId);
    if (!record) return [];
    const next = pendingEvent({ ...event, record });
    return canReceiveNotification(member, next) ? [next] : [];
  });
  return { fingerprints, pending: eligible, baseline: false, historyThroughMs };
}

async function acquireRefresh(context, now, leaseId) {
  const ref = context.db.collection('_notificationBaselines').doc(digest(['inapp-refresh-gate-v1', context.uid]));
  return context.db.runTransaction(async transaction => {
    const previous = (await transaction.get(ref)).data() || {};
    const retryAfterMs = Math.max(0, timestamp(previous.leaseUntilMs) - now,
      timestamp(previous.lastStartedAtMs) + MIN_REFRESH_INTERVAL_MS - now);
    if (retryAfterMs > 0) return { acquired: false, retryAfterMs, ref };
    transaction.set(ref, { kind: 'inapp-refresh-gate-v1', uid: context.uid, leaseId, leaseUntilMs: now + LEASE_MS, lastStartedAtMs: now });
    return { acquired: true, ref };
  });
}

/** Existing Firebase Admin/Vercel architecture; Firebase Functions, outbox,
 * messaging and a VAPID key are deliberately absent from this producer. */
export async function refreshInAppNotifications(context, body = {}, options = {}) {
  validateRefreshBody(body);
  const now = options.now ?? Date.now();
  const leaseId = randomUUID();
  const gate = await acquireRefresh(context, now, leaseId);
  if (!gate.acquired) return { mode: 'in-app', created: 0, checked: 0, rateLimited: true, retryAfterMs: Math.min(LEASE_MS, gate.retryAfterMs), skippedSources: [] };
  let created = 0;
  let checked = 0;
  let baselines = 0;
  const skippedSources = [];
  try {
    const memberSnapshot = await context.db.collection('members').doc(context.uid).get();
    const profile = memberSnapshot.data();
    if (!profile || profile.active !== true || profile.canLogin !== true || !['parent', 'child'].includes(profile.role)) {
      throw new EduServerError('EDU_MEMBER_REQUIRED', 403, 'Konto nie ma już dostępu do aplikacji.');
    }
    const member = { ...profile, id: context.uid };
    for (const source of refreshSources(context.db, context.uid, profile)) {
      const snapshot = await source.query.get();
      if (!source.rolling && snapshot.docs.length > MAX_REFRESH_RECORDS) { skippedSources.push(source.scope); continue; }
      const records = snapshot.docs.map(row => ({ id: row.id, data: row.data() }));
      const ref = context.db.collection('_notificationBaselines').doc(digest(['inapp-refresh-source-v1', context.uid, source.scope]));
      const plan = await context.db.runTransaction(async transaction => {
        const activeLease = (await transaction.get(gate.ref)).data();
        if (activeLease?.leaseId !== leaseId) return { stale: true };
        const previous = (await transaction.get(ref)).data();
        const next = planRefreshSource(source.collection, previous, records, member);
        const baseline = { kind: 'inapp-refresh-source-v1', uid: context.uid, scope: source.scope, initialized: true,
          records: next.fingerprints, pending: next.pending, historyThroughMs: next.historyThroughMs, updatedAtMs: now };
        if (Buffer.byteLength(JSON.stringify(baseline), 'utf8') > MAX_BASELINE_BYTES) return null;
        transaction.set(ref, baseline);
        return next;
      });
      if (!plan) { skippedSources.push(source.scope + ':size'); continue; }
      if (plan.stale) { skippedSources.push(source.scope + ':busy'); continue; }
      if (plan.baseline) baselines++;
      if (plan.pending.length) {
        const result = await (options.enqueue || enqueueInAppEvents)(context, plan.pending, {
          recipientUid: context.uid, revalidateSource: true,
        });
        created += result.created;
        checked += result.checked;
        // Pending is written atomically with the baseline before delivery. A
        // failed/partial inbox transaction retries safely with the same IDs.
        await context.db.runTransaction(async transaction => {
          const current = (await transaction.get(ref)).data();
          if (current?.updatedAtMs === now) transaction.set(ref, { ...current, pending: [] });
        });
      }
    }
    return { mode: 'in-app', created, checked, baselines, rateLimited: false, retryAfterMs: 0, skippedSources };
  } finally {
    await context.db.runTransaction(async transaction => {
      const current = (await transaction.get(gate.ref)).data();
      if (current?.leaseId === leaseId) transaction.set(gate.ref, { ...current, leaseUntilMs: 0, lastFinishedAtMs: now });
    });
  }
}
