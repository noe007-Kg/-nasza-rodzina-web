import { calendarConfiguration, calendarSelection, activeCalendarMember, calendarError } from './calendar-config.mjs';
import { calendarEncryptionConfigured } from './calendar-secrets.mjs';
import { assertCalendarSelection, timestampMillis } from './calendar-storage.mjs';
import { syncGoogleCalendar } from './calendar-service.mjs';

export const GOOGLE_CALENDAR_SCHEDULE = '0 * * * *';
export const GOOGLE_CALENDAR_TIME_ZONE = 'Europe/Warsaw';
export const GOOGLE_CALENDAR_CONNECTION_LIMIT = 100;
const HOUR_MS = 3600000;
const RUN_BUDGET_MS = 490000;
const NEXT_SOURCE_BUDGET_MS = 65000;
const dateMillis = value => typeof value === 'string' ? Date.parse(value) : timestampMillis(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f/\\]/.test(value);
const sourceId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const safeErrorCodes = new Set(['CALENDAR_BUSY', 'CALENDAR_RATE_LIMITED', 'CALENDAR_SCHEDULE_SLOT_CONSUMED', 'CALENDAR_SYNC_STALE',
  'CALENDAR_RECONNECT_REQUIRED', 'CALENDAR_MEMBER_REQUIRED', 'CALENDAR_PROFILE_UNAVAILABLE', 'CALENDAR_PROFILE_FORBIDDEN',
  'CALENDAR_CONNECTION_FORBIDDEN', 'CALENDAR_SELECTION_REQUIRED', 'CALENDAR_NOT_CONFIGURED', 'CALENDAR_DECRYPT_FAILED', 'CALENDAR_PROVIDER_DATA',
  'CALENDAR_AUTH_UNAVAILABLE', 'CALENDAR_PROVIDER_LIMIT', 'CALENDAR_PROVIDER_RATE_LIMITED', 'CALENDAR_PROVIDER_UNAVAILABLE', 'CALENDAR_EVENT_CONFLICT']);
const skippedCodes = new Set(['CALENDAR_BUSY', 'CALENDAR_RATE_LIMITED', 'CALENDAR_SCHEDULE_SLOT_CONSUMED', 'CALENDAR_SYNC_STALE',
  'CALENDAR_MEMBER_REQUIRED', 'CALENDAR_PROFILE_UNAVAILABLE', 'CALENDAR_PROFILE_FORBIDDEN', 'CALENDAR_CONNECTION_FORBIDDEN', 'CALENDAR_SELECTION_REQUIRED']);
const codeFor = error => safeErrorCodes.has(error?.code) ? error.code : 'CALENDAR_PROVIDER_UNAVAILABLE';
const count = (summary, code, quantity = 1) => { summary.codes[code] = (summary.codes[code] || 0) + quantity; };
const stamp = value => Number.isFinite(timestampMillis(value)) ? timestampMillis(value) : -Infinity;

/** UTC distinguishes both 02:00 Warsaw hours at autumn DST. Scheduler jitter
 * cannot turn 08:00:05 -> 09:00:01 into a missing hourly synchronization. */
export function googleCalendarScheduleSlot(scheduleTime, now = Date.now()) {
  const executionTime = dateMillis(now);
  if (!Number.isFinite(executionTime) || executionTime < 0) throw new TypeError('A valid scheduler execution time is required.');
  const supplied = dateMillis(scheduleTime);
  const time = Number.isFinite(supplied) && supplied >= 0 && supplied <= executionTime + 60000 ? supplied : executionTime;
  return Math.floor(time / HOUR_MS) * HOUR_MS;
}

function configured() {
  try { calendarConfiguration(); return calendarEncryptionConfigured(); } catch { return false; }
}

/** Orchestration only. OAuth refresh, decryption, idempotent writes, version
 * checks and the manual/scheduled atomic lease stay in syncGoogleCalendar. */
export async function runScheduledGoogleCalendarSync(context, event = {}, dependencies = {}) {
  const clock = dependencies.clock || Date.now;
  const started = Number(clock());
  if (!context?.db || typeof context?.auth?.getUser !== 'function' || !Number.isFinite(started)) throw new TypeError('Managed database/auth services and a valid execution time are required.');
  const slot = googleCalendarScheduleSlot(event.scheduleTime, started);
  const summary = { examined: 0, synced: 0, skipped: 0, deferred: 0, reconnectRequired: 0, failed: 0,
    imported: 0, changed: 0, cancelled: 0, unchanged: 0, codes: {} };
  if (!(dependencies.configured || configured)()) {
    summary.skipped++; count(summary, 'CALENDAR_NOT_CONFIGURED'); return summary;
  }
  let rows;
  try {
    // A single equality filter uses Firestore's ordinary index. Do not ship a
    // new composite index or silently truncate an authorization/work list.
    rows = (await context.db.collection('_calendarConnections').where('status', '==', 'connected')
      .limit(GOOGLE_CALENDAR_CONNECTION_LIMIT + 1).get()).docs;
  } catch {
    summary.failed++; count(summary, 'CALENDAR_SCHEDULE_READ_FAILED'); return summary;
  }
  if (rows.length > GOOGLE_CALENDAR_CONNECTION_LIMIT) {
    summary.failed++; count(summary, 'CALENDAR_SCHEDULE_SOURCE_LIMIT'); return summary;
  }
  summary.examined = rows.length;
  // Deferred sources lead the next run. Repeated provider failures on one
  // source must not starve other family members when the budget is exhausted.
  rows.sort((a, b) => {
    const left = a.data(), right = b.data();
    const order = stamp(left.lastScheduledSyncSlotAt || left.lastAttemptAt) - stamp(right.lastScheduledSyncSlotAt || right.lastAttemptAt);
    const successOrder = stamp(left.lastSuccessfulSyncAt) - stamp(right.lastSuccessfulSyncAt);
    return (Number.isNaN(order) ? 0 : order) || (Number.isNaN(successOrder) ? 0 : successOrder) || a.id.localeCompare(b.id);
  });
  const sync = dependencies.sync || syncGoogleCalendar;
  const authOwners = new Map();
  async function activeAuthOwner(uid) {
    if (!authOwners.has(uid)) authOwners.set(uid, context.auth.getUser(uid).then(user => user?.uid === uid && user.disabled !== true).catch(error => {
      if (error?.code === 'auth/user-not-found') return false;
      throw calendarError('CALENDAR_AUTH_UNAVAILABLE', 503, 'Nie można teraz sprawdzić aktywności konta.');
    }));
    return authOwners.get(uid);
  }
  for (let index = 0; index < rows.length; index++) {
    if (Number(clock()) - started > RUN_BUDGET_MS - NEXT_SOURCE_BUDGET_MS) {
      const remaining = rows.length - index;
      summary.deferred += remaining; count(summary, 'CALENDAR_SCHEDULE_BUDGET', remaining); break;
    }
    const snapshot = rows[index], data = snapshot.data();
    if (data.provider !== 'google' || data.mode !== 'sync' || data.status !== 'connected' || data.selectionConfirmed !== true
      || !data.envelope || !sourceId(snapshot.id) || !identifier(data.ownerUid)) {
      summary.skipped++; count(summary, 'CALENDAR_SCHEDULE_INELIGIBLE'); continue;
    }
    if (['lastScheduledSyncSlotAt', 'lastSuccessfulSyncAt', 'lastAttemptAt'].some(field => stamp(data[field]) >= slot)) {
      summary.skipped++; count(summary, 'CALENDAR_SCHEDULE_SLOT_CONSUMED'); continue;
    }
    try {
      if (!(await activeAuthOwner(data.ownerUid))) { summary.skipped++; count(summary, 'CALENDAR_SCHEDULE_MEMBER_UNAVAILABLE'); continue; }
      const authorised = await context.db.runTransaction(async transaction => {
        const actorSnapshot = await transaction.get(context.db.collection('members').doc(data.ownerUid));
        const actor = actorSnapshot.data();
        if (!activeCalendarMember(actor) || actor.disabled === true) return null;
        const selection = calendarSelection(data);
        if (selection.ownerProfileId !== 'family') {
          const target = await transaction.get(context.db.collection('members').doc(selection.ownerProfileId));
          // The selected PROFILE may have no login; the OAuth owner may not.
          if (!target.exists || target.data().active !== true || target.data().archived === true || target.data().disabled === true) return null;
        }
        const authorised = { ...context, uid: data.ownerUid, profile: actor, scheduledCalendarSlotStartMs: slot };
        await assertCalendarSelection(transaction, authorised, actor, selection);
        return authorised;
      }, { readOnly: true });
      if (!authorised) { summary.skipped++; count(summary, 'CALENDAR_SCHEDULE_MEMBER_UNAVAILABLE'); continue; }
      if (Number(clock()) - started > RUN_BUDGET_MS - NEXT_SOURCE_BUDGET_MS) {
        const remaining = rows.length - index;
        summary.deferred += remaining; count(summary, 'CALENDAR_SCHEDULE_BUDGET', remaining); break;
      }
      const result = await sync(authorised, { connectionId: snapshot.id }, { clock });
      summary.synced++;
      for (const field of ['imported', 'changed', 'cancelled', 'unchanged']) {
        if (Number.isSafeInteger(result?.[field]) && result[field] >= 0) summary[field] += result[field];
      }
    } catch (error) {
      const code = codeFor(error);
      if (code === 'CALENDAR_RECONNECT_REQUIRED') summary.reconnectRequired++;
      else if (skippedCodes.has(code)) summary.skipped++;
      else summary.failed++;
      count(summary, code);
    }
  }
  return summary;
}
