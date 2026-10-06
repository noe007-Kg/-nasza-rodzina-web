import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDU_DAY_SCHEDULE, EDU_NIGHT_SCHEDULE, EDU_SCHEDULE_TIME_ZONE,
  EDU_DAY_INTERVAL_MS, EDU_NIGHT_INTERVAL_MS, eduSchedulePolicy, eduScheduleTick, runScheduledEduSync,
} from '../server/edu-scheduler.mjs';
import { studentConnectionId } from '../server/edu-access.mjs';
import { EduServerError } from '../server/edu-auth.mjs';

const NOW = Date.parse('2026-10-05T08:00:00Z'); // 10:00 Warsaw, CEST
const identity = { studentName: 'Synthetic student', schoolName: 'Synthetic school', schoolSymbol: 'TEST' };
const parent = { role: 'parent', active: true, canLogin: true };
const child = { role: 'child', active: true, canLogin: true, personKey: 'Nikodem' };

function storedConnection(changes = {}) {
  return {
    scope: 'family', accountRole: 'parent', connectedByUid: 'parent-b',
    sessionVersion: 'synthetic-session-version', envelope: { ciphertext: 'synthetic-encrypted-envelope' },
    selectedStudent: { profileId: 'profile-school', personKey: 'Nikodem' },
    students: [{ id: 'profile-school', ...identity }], expiresAt: NOW + 86400000,
    ...changes,
  };
}

function fakeDatabase({ members = { 'parent-a': parent, 'parent-b': parent }, connections = { family: storedConnection() },
  bindings = { Nikodem: { identity } } } = {}) {
  const data = { members, _eduConnections: connections, _eduStudentBindings: bindings };
  const reads = [];
  function document(collection, id) {
    const value = data[collection]?.[id];
    return { id, exists: Boolean(value), data: () => value };
  }
  return {
    reads, data,
    collection(collection) {
      return {
        doc(id) { return { get: async () => { reads.push(`${collection}/${id}`); return document(collection, id); } }; },
        where(field, operator, value) {
          assert.equal(operator, '==');
          return { limit(limit) { return { get: async () => {
            const docs = Object.keys(data[collection] || {}).filter((id) => data[collection][id][field] === value)
              .slice(0, limit).map((id) => document(collection, id));
            return { docs, size: docs.length };
          } }; } };
        },
      };
    },
  };
}

async function run(db, { now = NOW, event = { scheduleTime: new Date(now).toISOString(), window: 'day' }, syncFn, markReconnectFn } = {}) {
  const calls = []; const marks = [];
  const summary = await runScheduledEduSync({ db }, event, {
    now: () => now,
    syncFn: syncFn || (async (context, body) => {
      calls.push({ context, body });
      // Mirror a successful atomic lease claim so repeated runner invocations
      // exercise persisted slot deduplication rather than a stateless adapter.
      const connection = db.data._eduConnections[context.connection.id];
      if (Number.isFinite(context.scheduledSchoolSlotStartMs)) {
        connection.lastScheduledSchoolSlotAt = context.scheduledSchoolSlotStartMs;
      }
      connection.lastSyncAttemptAt = now;
      connection.lastSuccessfulSyncAt = now;
      return { status: {} };
    }),
    markReconnectFn: markReconnectFn || (async (id, condition, context) => { marks.push({ id, condition, context }); return true; }),
  });
  return { summary, calls, marks };
}

test('economical cron expressions split 08:00–15:00 ten-minute ticks from the remaining hourly ticks', () => {
  assert.equal(EDU_DAY_SCHEDULE, '*/10 8-14 * * *');
  assert.equal(EDU_NIGHT_SCHEDULE, '0 0-7,15-23 * * *');
  assert.equal(EDU_SCHEDULE_TIME_ZONE, 'Europe/Warsaw');
  const local = (hour, minute) => `2026-10-05T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+02:00`;
  let dayTicks = 0; let nightTicks = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 1) {
      const day = eduScheduleTick(local(hour, minute), 'day');
      const night = eduScheduleTick(local(hour, minute), 'night');
      assert.equal(day, hour >= 8 && hour < 15 && minute % 10 === 0);
      assert.equal(night, (hour < 8 || hour >= 15) && minute === 0);
      assert.equal(day && night, false);
      dayTicks += Number(day); nightTicks += Number(night);
    }
  }
  assert.equal(dayTicks, 42); assert.equal(nightTicks, 17);
  assert.equal(eduSchedulePolicy(local(7, 59)).intervalMs, EDU_NIGHT_INTERVAL_MS);
  assert.equal(eduSchedulePolicy(local(8, 0)).intervalMs, EDU_DAY_INTERVAL_MS);
  assert.equal(eduSchedulePolicy(local(14, 59)).intervalMs, EDU_DAY_INTERVAL_MS);
  assert.equal(eduSchedulePolicy(local(15, 0)).intervalMs, EDU_NIGHT_INTERVAL_MS);
});

test('Warsaw scheduling uses the correct summer/winter offsets at both DST changes', () => {
  for (const [utc, hour, window] of [
    ['2026-03-29T00:00:00Z', 1, 'night'], ['2026-03-29T01:00:00Z', 3, 'night'],
    ['2026-03-29T06:00:00Z', 8, 'day'], ['2026-03-28T07:00:00Z', 8, 'day'],
    ['2026-10-25T00:00:00Z', 2, 'night'], ['2026-10-25T01:00:00Z', 2, 'night'],
    ['2026-10-25T07:00:00Z', 8, 'day'], ['2026-10-24T06:00:00Z', 8, 'day'],
  ]) {
    const policy = eduSchedulePolicy(utc);
    assert.equal(policy.hour, hour); assert.equal(policy.window, window);
    assert.equal(eduScheduleTick(utc, window), true);
  }
  assert.throws(() => eduSchedulePolicy('invalid time'), TypeError);
});

test('daytime run calls the existing syncAction entry point once with its canonical ten-minute slot', async () => {
  const db = fakeDatabase(); const result = await run(db);
  assert.deepEqual(result.summary, { examined: 1, synced: 1, skipped: 0, reconnectRequired: 0, failed: 0, codes: {} });
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].context.connection.id, 'family');
  assert.equal(result.calls[0].context.uid, 'parent-b');
  assert.equal(result.calls[0].context.profile.role, 'parent');
  assert.equal(result.calls[0].context.scheduledSyncIntervalMs, EDU_DAY_INTERVAL_MS);
  assert.equal(result.calls[0].context.scheduledSchoolSlotStartMs, NOW);
  assert.deepEqual(result.calls[0].body, {});
  assert.doesNotMatch(JSON.stringify({ connection: result.calls[0].context.connection, body: result.calls[0].body }),
    /password|login|ciphertext|synthetic-encrypted-envelope/);
});

test('manual and legacy starts within the current school slot suppress its duplicate; earlier slots do not', async () => {
  for (const field of ['lastSuccessfulSyncAt', 'lastSyncAttemptAt']) {
    for (const elapsed of [0, -60000]) {
      const db = fakeDatabase({ connections: { family: storedConnection({ [field]: NOW - elapsed }) } });
      const result = await run(db);
      assert.equal(result.calls.length, 0); assert.equal(result.summary.codes.EDU_SYNC_COOLDOWN, 1);
    }
    const result = await run(fakeDatabase({ connections: { family: storedConnection({ [field]: NOW - EDU_DAY_INTERVAL_MS + 5000 }) } }));
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].context.scheduledSchoolSlotStartMs, NOW);
  }
});

test('hourly gates retain elapsed-time checks for last success and attempt, including future timestamps', async () => {
  const now = Date.parse('2026-10-05T18:00:00Z');
  for (const field of ['lastSuccessfulSyncAt', 'lastSyncAttemptAt']) {
    for (const elapsed of [0, EDU_NIGHT_INTERVAL_MS - 1, -60000]) {
      const db = fakeDatabase({ connections: { family: storedConnection({ [field]: now - elapsed }) } });
      const result = await run(db, { now, event: { scheduleTime: new Date(now).toISOString(), window: 'night' } });
      assert.equal(result.calls.length, 0); assert.equal(result.summary.codes.EDU_SYNC_COOLDOWN, 1);
    }
    const result = await run(fakeDatabase({ connections: { family: storedConnection({ [field]: now - EDU_NIGHT_INTERVAL_MS }) } }),
      { now, event: { scheduleTime: new Date(now).toISOString(), window: 'night' } });
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].context.scheduledSyncIntervalMs, EDU_NIGHT_INTERVAL_MS);
    assert.equal(result.calls[0].context.scheduledSchoolSlotStartMs, undefined);
  }
});

test('08:00:05 and 08:10:01 execution jitter does not suppress either distinct school slot', async () => {
  const db = fakeDatabase();
  const firstSlot = Date.parse('2026-10-05T08:00:00+02:00');
  const secondSlot = firstSlot + EDU_DAY_INTERVAL_MS;
  const first = await run(db, { now: firstSlot + 5000,
    event: { scheduleTime: new Date(firstSlot).toISOString(), window: 'day' } });
  const second = await run(db, { now: secondSlot + 1000,
    event: { scheduleTime: new Date(secondSlot).toISOString(), window: 'day' } });
  assert.equal(first.summary.synced, 1); assert.equal(second.summary.synced, 1);
  assert.equal(first.calls[0].context.scheduledSchoolSlotStartMs, firstSlot);
  assert.equal(second.calls[0].context.scheduledSchoolSlotStartMs, secondSlot);
  assert.equal(db.data._eduConnections.family.lastScheduledSchoolSlotAt, secondSlot);
});

test('persisted slot claims reject a repeated slot and an older out-of-order delivery', async () => {
  const db = fakeDatabase(); const slot = NOW;
  const event = { scheduleTime: new Date(slot).toISOString(), window: 'day' };
  const first = await run(db, { now: slot + 5000, event });
  assert.equal(first.summary.synced, 1);
  // Expiry of the ordinary time cooldown must never reopen a consumed slot.
  const repeat = await run(db, { now: slot + 2 * EDU_DAY_INTERVAL_MS + 1000, event });
  assert.equal(repeat.calls.length, 0); assert.equal(repeat.summary.codes.EDU_SYNC_COOLDOWN, 1);
  const older = await run(db, { now: slot + 3 * EDU_DAY_INTERVAL_MS,
    event: { scheduleTime: new Date(slot - EDU_DAY_INTERVAL_MS).toISOString(), window: 'day' } });
  assert.equal(older.calls.length, 0); assert.equal(older.summary.codes.EDU_SYNC_COOLDOWN, 1);
});

test('a persisted future school slot fails closed instead of reopening an earlier slot', async () => {
  const result = await run(fakeDatabase({ connections: { family: storedConnection({
    lastScheduledSchoolSlotAt: { toMillis: () => NOW + EDU_DAY_INTERVAL_MS },
  }) } }));
  assert.equal(result.calls.length, 0); assert.equal(result.summary.codes.EDU_SYNC_COOLDOWN, 1);
});

test('a consumed school slot remains deduplicated after its provider attempt fails', async () => {
  const db = fakeDatabase(); let calls = 0;
  const event = { scheduleTime: new Date(NOW).toISOString(), window: 'day' };
  const syncFn = async (context) => {
    calls += 1;
    // A real lease claims the slot atomically before invoking the provider.
    db.data._eduConnections.family.lastScheduledSchoolSlotAt = context.scheduledSchoolSlotStartMs;
    db.data._eduConnections.family.lastSyncAttemptAt = NOW + 5000;
    throw new EduServerError('EDU_PROVIDER_TIMEOUT', 504, 'Synthetic safe timeout');
  };
  const first = await run(db, { now: NOW + 5000, event, syncFn });
  assert.equal(first.summary.failed, 1); assert.equal(first.summary.codes.EDU_PROVIDER_TIMEOUT, 1);
  const repeat = await run(db, { now: NOW + 2 * EDU_DAY_INTERVAL_MS, event, syncFn });
  assert.equal(repeat.summary.skipped, 1); assert.equal(repeat.summary.codes.EDU_SYNC_COOLDOWN, 1);
  assert.equal(calls, 1); assert.equal(db.data._eduConnections.family.lastSuccessfulSyncAt, undefined);
});

test('DST repeated hours use elapsed time and never collapse or weaken the hourly interval', async () => {
  const first = Date.parse('2026-10-25T00:00:00Z'); const repeated = Date.parse('2026-10-25T01:00:00Z');
  const connection = storedConnection({ expiresAt: repeated + 86400000, lastSuccessfulSyncAt: first });
  assert.equal(eduSchedulePolicy(first).hour, eduSchedulePolicy(repeated).hour);
  const result = await run(fakeDatabase({ connections: { family: connection } }),
    { now: repeated, event: { scheduleTime: new Date(repeated).toISOString(), window: 'night' } });
  assert.equal(result.calls.length, 1);
  const retry = await run(fakeDatabase({ connections: { family: { ...connection, lastSyncAttemptAt: repeated - 1000 } } }),
    { now: repeated, event: { scheduleTime: new Date(repeated).toISOString(), window: 'night' } });
  assert.equal(retry.calls.length, 0);
  const springFirst = Date.parse('2026-03-29T00:00:00Z'); const springNext = Date.parse('2026-03-29T01:00:00Z');
  const spring = await run(fakeDatabase({ connections: { family: storedConnection({ expiresAt: springNext + 86400000, lastSuccessfulSyncAt: springFirst }) } }),
    { now: springNext, event: { scheduleTime: new Date(springNext).toISOString(), window: 'night' } });
  assert.equal(spring.calls.length, 1);
});

test('an active lease and atomic race responses never start a parallel or immediate repeated synchronization', async () => {
  const busy = await run(fakeDatabase({ connections: { family: storedConnection({ lease: { expiresAt: NOW + 10000 } }) } }));
  assert.equal(busy.calls.length, 0); assert.equal(busy.summary.codes.EDU_SYNC_BUSY, 1);
  for (const code of ['EDU_SYNC_BUSY', 'EDU_SYNC_COOLDOWN', 'EDU_CONNECTION_CHANGED']) {
    let calls = 0;
    const raced = await run(fakeDatabase(), { syncFn: async () => { calls += 1; throw new EduServerError(code, 409, 'Synthetic safe conflict'); } });
    assert.equal(calls, 1); assert.equal(raced.summary.skipped, 1); assert.equal(raced.summary.failed, 0);
    assert.equal(raced.summary.codes[code], 1); assert.equal(raced.marks.length, 0);
  }
});

test('expired metadata and provider-expired sessions request parent reconnect without logging in or retrying', async () => {
  for (const expiry of [NOW - 1, null, 'invalid']) {
    const expired = await run(fakeDatabase({ connections: { family: storedConnection({ expiresAt: expiry }) } }));
    assert.equal(expired.calls.length, 0); assert.equal(expired.marks.length, 1);
    assert.deepEqual(expired.marks[0].condition, { sessionVersion: 'synthetic-session-version' });
    assert.equal(expired.summary.reconnectRequired, 1); assert.equal(expired.summary.codes.EDU_SESSION_EXPIRED, 1);
  }
  for (const code of ['EDU_SESSION_EXPIRED', 'EDU_SESSION_INVALID']) {
    let calls = 0; const db = fakeDatabase();
    const rejected = await run(db, { syncFn: async (_context, body) => {
      calls += 1; assert.deepEqual(body, {}); db.data._eduConnections.family.reconnectRequired = true;
      throw new EduServerError(code, 401, 'Synthetic expired session');
    } });
    assert.equal(calls, 1); assert.equal(rejected.marks.length, 0); assert.equal(rejected.summary.codes[code], 1);
    assert.equal(rejected.summary.reconnectRequired, 1);
  }
  const reconnect = await run(fakeDatabase({ connections: { family: storedConnection({ reconnectRequired: true }) } }));
  assert.equal(reconnect.calls.length, 0); assert.equal(reconnect.marks.length, 0);
});

test('a decryption failure cannot invalidate a working session encrypted under a different configured key', async () => {
  const result = await run(fakeDatabase(), { syncFn: async () => {
    throw new EduServerError('EDU_SESSION_INVALID', 409, 'Synthetic wrong runtime key');
  } });
  assert.equal(result.marks.length, 0); assert.equal(result.summary.reconnectRequired, 0);
  assert.equal(result.summary.failed, 1); assert.equal(result.summary.codes.EDU_SESSION_INVALID, 1);
});

test('a parent reconnect racing expired metadata is preserved by the shared session-version guard', async () => {
  const result = await run(fakeDatabase({ connections: { family: storedConnection({ expiresAt: NOW - 1 }) } }),
    { markReconnectFn: async () => false });
  assert.equal(result.summary.reconnectRequired, 0); assert.equal(result.summary.skipped, 1);
  assert.equal(result.summary.codes.EDU_CONNECTION_CHANGED, 1);
});

test('a slow connection leaves provider budget for the next cron instead of overlapping Functions timeout', async () => {
  const studentId = studentConnectionId('child-a');
  const db = fakeDatabase({ members: { 'parent-a': parent, 'child-a': child }, connections: {
    family: storedConnection(), [studentId]: storedConnection({ scope: 'student', accountRole: 'student', connectedByUid: 'child-a' }),
  } });
  let now = NOW; const calls = [];
  const result = await runScheduledEduSync({ db }, { scheduleTime: new Date(NOW).toISOString(), window: 'day' }, {
    now: () => now, syncFn: async (context) => { calls.push(context.connection.id); now += 51000; },
    markReconnectFn: async () => { assert.fail('No session is expired'); },
  });
  assert.deepEqual(calls, ['family']); assert.equal(result.synced, 1); assert.equal(result.skipped, 1);
  assert.equal(result.codes.EDU_SCHEDULE_BUDGET, 1);
});

test('canonical family and parent-approved student scopes are used; legacy UID sessions are never inspected', async () => {
  const studentId = studentConnectionId('child-a');
  const db = fakeDatabase({ members: { 'parent-a': parent, 'parent-b': { ...parent, active: false }, 'child-a': child,
    'child-unbound': { ...child, personKey: 'Paweł' }, 'child-baby': { ...child, personKey: 'Unknown' } },
  connections: { family: storedConnection(), 'parent-a': storedConnection(),
    [studentId]: storedConnection({ scope: 'student', accountRole: 'student', connectedByUid: 'child-a' }) } });
  const result = await run(db);
  assert.equal(result.calls.length, 2); assert.equal(result.calls[0].context.uid, 'parent-a');
  assert.equal(result.calls[1].context.connection.id, studentId);
  assert.equal(result.calls[1].context.connection.scope, 'student');
  assert.deepEqual(result.calls[1].context.connection.allowedStudentIdentity, identity);
  assert.equal(db.reads.includes('_eduConnections/parent-a'), false);
  assert.equal(db.reads.includes(`_eduConnections/${studentConnectionId('child-unbound')}`), false);
  assert.doesNotMatch(JSON.stringify(result.summary), /parent-a|child-a|Nikodem|profile-school|Synthetic/);
});

test('missing authorization, forged scope and forged selected student fail closed before reading provider data', async () => {
  const noParent = await run(fakeDatabase({ members: { 'parent-a': { ...parent, canLogin: false } } }));
  assert.equal(noParent.calls.length, 0); assert.equal(noParent.summary.codes.EDU_PARENT_REQUIRED, 1);
  const wrongScope = await run(fakeDatabase({ connections: { family: storedConnection({ scope: 'student' }) } }));
  assert.equal(wrongScope.calls.length, 0); assert.equal(wrongScope.summary.codes.EDU_CONNECTION_FORBIDDEN, 1);
  const invalidStudent = await run(fakeDatabase({ connections: { family: storedConnection({ selectedStudent: { profileId: 'other-profile', personKey: 'Sebastian' } }) } }));
  assert.equal(invalidStudent.calls.length, 0); assert.equal(invalidStudent.summary.codes.EDU_SELECT_STUDENT, 1);
  const studentId = studentConnectionId('child-a');
  const wrongOwner = await run(fakeDatabase({ members: { 'child-a': child }, connections: {
    [studentId]: storedConnection({ scope: 'student', accountRole: 'student', connectedByUid: 'other-child' }),
  } }));
  assert.equal(wrongOwner.calls.length, 0); assert.equal(wrongOwner.summary.codes.EDU_CONNECTION_FORBIDDEN, 1);
});

test('late school invocations retain the stricter night policy and never acquire a daytime slot', async () => {
  const night = Date.parse('2026-10-05T13:00:00Z'); // 15:00 Warsaw
  const delayed = await run(fakeDatabase({ connections: { family: storedConnection({ lastSuccessfulSyncAt: night - EDU_DAY_INTERVAL_MS }) } }),
    { now: night, event: { scheduleTime: '2026-10-05T12:50:00Z', window: 'day' } });
  assert.equal(delayed.calls.length, 0); assert.equal(delayed.summary.codes.EDU_SYNC_COOLDOWN, 1);
  const allowed = await run(fakeDatabase(), { now: night,
    event: { scheduleTime: '2026-10-05T12:50:00Z', window: 'day' } });
  assert.equal(allowed.calls.length, 1);
  assert.equal(allowed.calls[0].context.scheduledSyncIntervalMs, EDU_NIGHT_INTERVAL_MS);
  assert.equal(allowed.calls[0].context.scheduledSchoolSlotStartMs, undefined);
});

test('invalid and far-future scheduler timestamps fall back to the current canonical school slot', async () => {
  for (const scheduleTime of ['invalid', undefined, new Date(NOW + EDU_NIGHT_INTERVAL_MS).toISOString()]) {
    const result = await run(fakeDatabase(), { now: NOW + 19000, event: { scheduleTime, window: 'day' } });
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].context.scheduledSyncIntervalMs, EDU_DAY_INTERVAL_MS);
    assert.equal(result.calls[0].context.scheduledSchoolSlotStartMs, NOW);
  }
  const rounded = await run(fakeDatabase(), { now: NOW + 19000,
    event: { scheduleTime: new Date(NOW + 5000).toISOString(), window: 'day' } });
  assert.equal(rounded.calls[0].context.scheduledSchoolSlotStartMs, NOW);
  const mismatch = await run(fakeDatabase(), { event: { scheduleTime: new Date(NOW).toISOString(), window: 'night' } });
  assert.equal(mismatch.calls.length, 0); assert.equal(mismatch.summary.codes.EDU_SCHEDULE_WINDOW, 1);
});

test('14:50 school slot followed by 15:00 keeps the existing hourly protection at the boundary', async () => {
  const db = fakeDatabase(); const lastSchoolSlot = Date.parse('2026-10-05T14:50:00+02:00');
  const firstNightSlot = Date.parse('2026-10-05T15:00:00+02:00');
  const school = await run(db, { now: lastSchoolSlot + 5000,
    event: { scheduleTime: new Date(lastSchoolSlot).toISOString(), window: 'day' } });
  assert.equal(school.summary.synced, 1);
  assert.equal(school.calls[0].context.scheduledSchoolSlotStartMs, lastSchoolSlot);
  const boundary = await run(db, { now: firstNightSlot + 1000,
    event: { scheduleTime: new Date(firstNightSlot).toISOString(), window: 'night' } });
  assert.equal(boundary.calls.length, 0); assert.equal(boundary.summary.codes.EDU_SYNC_COOLDOWN, 1);
  const hourly = await run(db, { now: firstNightSlot + EDU_NIGHT_INTERVAL_MS + 1000,
    event: { scheduleTime: new Date(firstNightSlot + EDU_NIGHT_INTERVAL_MS).toISOString(), window: 'night' } });
  assert.equal(hourly.summary.synced, 1);
  assert.equal(hourly.calls[0].context.scheduledSchoolSlotStartMs, undefined);
  assert.equal(db.data._eduConnections.family.lastScheduledSchoolSlotAt, lastSchoolSlot);
});

test('successful runner invocation uses the shared notification pipeline once, with no secondary notification writes', async () => {
  const db = fakeDatabase(); let syncCalls = 0;
  const syncFn = async (context) => {
    syncCalls += 1;
    db.data._eduConnections.family.lastSuccessfulSyncAt = NOW;
    db.data._eduConnections.family.lastSyncAttemptAt = NOW;
    db.data._eduConnections.family.lastScheduledSchoolSlotAt = context.scheduledSchoolSlotStartMs;
    assert.equal(context.connection.scope, 'family');
    return { sync: { notifications: { added: 1 } } };
  };
  const first = await run(db, { syncFn }); const repeat = await run(db, { syncFn });
  assert.equal(first.summary.synced, 1); assert.equal(repeat.summary.synced, 0); assert.equal(syncCalls, 1);
  assert.equal(db.reads.some((path) => path.startsWith('notificationInbox') || path.startsWith('notificationOutbox')), false);
});

test('unknown adapter errors are represented only by safe aggregate codes', async () => {
  const result = await run(fakeDatabase(), { syncFn: async () => {
    const error = new Error('Synthetic cookie, name and password must never be in summaries');
    error.code = 'arbitrary-sensitive-code'; throw error;
  } });
  assert.equal(result.summary.failed, 1); assert.equal(result.summary.codes.EDU_SYNC_FAILED, 1);
  assert.doesNotMatch(JSON.stringify(result.summary), /cookie|password|arbitrary-sensitive-code/);
});

test('a later successful completion does not postpone the next ten-minute or hourly start slot', async () => {
  for (const [now, window, interval] of [[NOW, 'day', EDU_DAY_INTERVAL_MS], [Date.parse('2026-10-05T18:00:00Z'), 'night', EDU_NIGHT_INTERVAL_MS]]) {
    const db = fakeDatabase({ connections: { family: storedConnection({ lastSyncAttemptAt: now - interval, lastSuccessfulSyncAt: now - interval + 30000 }) } });
    const result = await run(db, { now, event: { scheduleTime: new Date(now).toISOString(), window } });
    assert.equal(result.summary.synced, 1); assert.equal(result.calls.length, 1);
  }
});
