import { resolveConnectionAccess, FAMILY_CONNECTION_ID } from './edu-access.mjs';
import { syncAction } from './edu-service.mjs';
import { markConnectionNeedsReconnect } from './edu-storage.mjs';
import { schoolSyncSlotStart, schoolSyncSlotConsumed } from './edu-school-slots.mjs';

// Two jobs avoid paying for ten-minute invocations throughout the night. Both
// expressions deliberately assign the 15:00 boundary to the hourly job.
export const EDU_DAY_SCHEDULE = '*/10 8-14 * * *';
export const EDU_NIGHT_SCHEDULE = '0 0-7,15-23 * * *';
export const EDU_SCHEDULE_TIME_ZONE = 'Europe/Warsaw';
export const EDU_DAY_INTERVAL_MS = 10 * 60 * 1000;
export const EDU_NIGHT_INTERVAL_MS = 60 * 60 * 1000;

const MEMBER_LIMIT = 64;
const NEXT_PROVIDER_BUDGET_MS = 50000;
const RUN_BUDGET_MS = 100000;
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: EDU_SCHEDULE_TIME_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});

function millis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  return typeof value === 'string' && value ? Date.parse(value) : NaN;
}

/** Warsaw hours select the policy. UTC identifies daytime slots and measures
 * the unchanged hourly interval across repeated/missing hours at DST changes. */
export function eduSchedulePolicy(instant) {
  const time = millis(instant);
  if (!Number.isFinite(time)) throw new TypeError('A valid scheduler time is required.');
  const parts = Object.fromEntries(formatter.formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour); const minute = Number(parts.minute);
  const window = hour >= 8 && hour < 15 ? 'day' : 'night';
  return { window, hour, minute, intervalMs: window === 'day' ? EDU_DAY_INTERVAL_MS : EDU_NIGHT_INTERVAL_MS,
    timeZone: EDU_SCHEDULE_TIME_ZONE };
}

export function eduScheduleTick(instant, window) {
  const policy = eduSchedulePolicy(instant);
  return policy.window === window && (window === 'day' ? policy.minute % 10 === 0 : policy.minute === 0);
}

function safeCode(error, fallback = 'EDU_SYNC_FAILED') {
  return typeof error?.code === 'string' && /^EDU_[A-Z0-9_]{1,76}$/.test(error.code) ? error.code : fallback;
}

function countCode(summary, code) {
  summary.codes[code] = (summary.codes[code] || 0) + 1;
}

async function activeMembers(db, role) {
  const snapshot = await db.collection('members').where('role', '==', role).limit(MEMBER_LIMIT).get();
  // This is a one-family project. Refuse a truncated authorization list rather
  // than silently selecting a parent or losing a student's connection.
  if (snapshot.size >= MEMBER_LIMIT) return null;
  return snapshot.docs.filter((document) => {
    const profile = document.data();
    return typeof document.id === 'string' && document.id.length > 0 && document.id.length <= 128
      && !document.id.includes('/') && profile?.active === true && profile.canLogin === true;
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function selectedProfileValid(data, connection) {
  const selection = data.selectedStudent;
  return typeof selection?.profileId === 'string' && selection.profileId.length > 0 && selection.profileId.length <= 500
    && connection.allowedPersonKeys.includes(selection.personKey)
    && Array.isArray(data.students) && data.students.some((student) => student.id === selection.profileId);
}

function storedScopeValid(id, data, connection) {
  return id === connection.id && data.scope === connection.scope && data.accountRole === connection.accountRole
    && (connection.scope !== 'student' || data.connectedByUid === connection.actorUid);
}

/** Trusted scheduler entry point. The provider, decryption, school writes,
 * notification baseline and atomic synchronization lease remain in syncAction.
 * This module never accepts credentials or calls the provider's login flow.
 * Optional dependencies exist solely for deterministic tests of orchestration. */
export async function runScheduledEduSync(context, event = {}, dependencies = {}) {
  const clock = dependencies.now || Date.now;
  const now = Number(clock());
  if (!Number.isFinite(now) || !context?.db) throw new TypeError('A managed database and valid execution time are required.');
  const actualPolicy = eduSchedulePolicy(now);
  const suppliedTime = millis(event.scheduleTime);
  // scheduleTime comes from Cloud Scheduler, never from an HTTP/client body.
  // Invalid or future timestamps use execution time. A delayed/retried daytime
  // invocation cannot relax the hourly night policy, and vice versa.
  const eventTime = Number.isFinite(suppliedTime) && suppliedTime <= now + 60000 ? suppliedTime : now;
  const eventPolicy = eduSchedulePolicy(eventTime);
  const intervalMs = Math.max(actualPolicy.intervalMs, eventPolicy.intervalMs);
  // A delayed daytime job must still honor the hourly policy after 15:00.
  const schoolSlotStart = intervalMs === EDU_DAY_INTERVAL_MS ? schoolSyncSlotStart(eventTime) : null;
  const summary = { examined: 0, synced: 0, skipped: 0, reconnectRequired: 0, failed: 0, codes: {} };
  if (event.window && !['day', 'night'].includes(event.window)) throw new TypeError('A valid scheduler window is required.');
  if (event.window && event.window !== eventPolicy.window) {
    summary.skipped += 1; countCode(summary, 'EDU_SCHEDULE_WINDOW'); return summary;
  }
  const sync = dependencies.syncFn || syncAction;
  const markReconnect = dependencies.markReconnectFn || markConnectionNeedsReconnect;
  let budgetExhausted = false;

  async function synchronize(authorised, snapshot) {
    if (!snapshot.exists) return;
    summary.examined += 1;
    const data = snapshot.data(); const connection = authorised.connection;
    if (!storedScopeValid(snapshot.id, data, connection)) {
      summary.skipped += 1; countCode(summary, 'EDU_CONNECTION_FORBIDDEN'); return;
    }
    const scheduledContext = { ...authorised, scheduledSyncIntervalMs: intervalMs,
      ...(schoolSlotStart !== null ? { scheduledSchoolSlotStartMs: schoolSlotStart } : {}) };
    if (data.reconnectRequired === true || data.state === 'needs_reconnect') {
      summary.skipped += 1; countCode(summary, 'EDU_RECONNECT_REQUIRED'); return;
    }
    // Do not invalidate a concurrently running synchronization. Its existing
    // lease and session-version checks decide whether its result may be saved.
    if (millis(data.lease?.expiresAt) > now) {
      summary.skipped += 1; countCode(summary, 'EDU_SYNC_BUSY'); return;
    }
    if (!Number.isFinite(millis(data.expiresAt)) || millis(data.expiresAt) <= now) {
      try {
        const marked = await markReconnect(connection.id, { sessionVersion: data.sessionVersion }, scheduledContext);
        if (marked === false) {
          summary.skipped += 1; countCode(summary, 'EDU_CONNECTION_CHANGED');
        } else {
          summary.reconnectRequired += 1; countCode(summary, 'EDU_SESSION_EXPIRED');
        }
      } catch (error) { summary.failed += 1; countCode(summary, safeCode(error)); }
      return;
    }
    if (!selectedProfileValid(data, connection)) {
      summary.skipped += 1; countCode(summary, 'EDU_SELECT_STUDENT'); return;
    }
    const lastSuccess = millis(data.lastSuccessfulSyncAt); const lastAttempt = millis(data.lastSyncAttemptAt);
    // Daytime deduplicates logical schedule slots, not actual worker starts.
    // The existing elapsed-time policy remains unchanged for the hourly job.
    const lastStart = Number.isFinite(lastAttempt) ? lastAttempt : lastSuccess;
    const coolingDown = schoolSlotStart !== null
      ? schoolSyncSlotConsumed(schoolSlotStart, millis(data.lastScheduledSchoolSlotAt), lastStart)
      : Number.isFinite(lastStart) && now - lastStart < intervalMs;
    if (coolingDown) {
      summary.skipped += 1; countCode(summary, 'EDU_SYNC_COOLDOWN'); return;
    }
    // Functions has a 110-second deadline. Leave enough room for the adapter's
    // next bounded read; retrying another connection on the next cron is safer
    // than terminating halfway through a provider request or school transaction.
    if (Number(clock()) - now > RUN_BUDGET_MS - NEXT_PROVIDER_BUDGET_MS) {
      budgetExhausted = true; summary.skipped += 1; countCode(summary, 'EDU_SCHEDULE_BUDGET'); return;
    }
    try {
      await sync(scheduledContext, {});
      summary.synced += 1;
    } catch (error) {
      const code = safeCode(error);
      if (['EDU_SESSION_EXPIRED', 'EDU_SESSION_INVALID'].includes(code)) {
        // Only the shared service can prove that a successfully decrypted
        // provider session was rejected while it owned the lease. A wrong
        // Functions encryption key must not invalidate a good Vercel session.
        const current = await context.db.collection('_eduConnections').doc(connection.id).get();
        if (current.exists && current.data().reconnectRequired === true) summary.reconnectRequired += 1;
        else summary.failed += 1;
      } else if (['EDU_SYNC_BUSY', 'EDU_SYNC_COOLDOWN', 'EDU_CONNECTION_CHANGED', 'EDU_NOT_CONNECTED', 'EDU_SELECT_STUDENT'].includes(code)) {
        summary.skipped += 1;
      } else summary.failed += 1;
      countCode(summary, code);
    }
  }

  const [parents, children] = await Promise.all([activeMembers(context.db, 'parent'), activeMembers(context.db, 'child')]);
  if (parents === null || children === null) {
    summary.failed += 1; countCode(summary, 'EDU_MEMBER_LIMIT'); return summary;
  }
  const familySnapshot = await context.db.collection('_eduConnections').doc(FAMILY_CONNECTION_ID).get();
  if (familySnapshot.exists && parents.length) {
    const connectedByUid = familySnapshot.data().connectedByUid;
    const parent = parents.find((member) => member.id === connectedByUid) || parents[0];
    const authorised = await resolveConnectionAccess({ ...context, uid: parent.id, profile: parent.data() }, 'family');
    await synchronize(authorised, familySnapshot);
  } else if (familySnapshot.exists) {
    summary.examined += 1; summary.skipped += 1; countCode(summary, 'EDU_PARENT_REQUIRED');
  }
  for (const child of children) {
    if (budgetExhausted) break;
    let authorised;
    try {
      authorised = await resolveConnectionAccess({ ...context, uid: child.id, profile: child.data() }, 'student');
    } catch (error) {
      // Non-school children and children without a parent-approved binding have
      // no authorized student connection. Do not inspect any of their sessions.
      if (['EDU_STUDENT_LINK_REQUIRED', 'EDU_STUDENT_REQUIRED', 'EDU_MEMBER_REQUIRED'].includes(safeCode(error))) continue;
      summary.failed += 1; countCode(summary, safeCode(error)); continue;
    }
    const snapshot = await context.db.collection('_eduConnections').doc(authorised.connection.id).get();
    await synchronize(authorised, snapshot);
  }
  return summary;
}
