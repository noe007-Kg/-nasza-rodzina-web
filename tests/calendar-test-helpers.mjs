import { Timestamp } from 'firebase-admin/firestore';

export const calendarParent = { name: 'Sebastian', personKey: 'Sebastian', role: 'parent', active: true, canLogin: true };
export const calendarChild = { name: 'Nikodem', personKey: 'Nikodem', role: 'child', active: true, canLogin: true };
export const calendarId = '7574613c-b808-46e7-8af0-4cb0b302b640';
export const testNow = Date.parse('2026-10-08T08:00:00Z');

/** Test-only deterministic bytes. These never leave the in-memory fixture or represent a real key. */
export function calendarTestEnvironment() {
  const names = ['GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'CALENDAR_SITE_ORIGIN', 'CALENDAR_ENCRYPTION_KEY_BASE64', 'CALENDAR_ENCRYPTION_KEY_ID'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { GOOGLE_CALENDAR_CLIENT_ID: '123-calendar-fixture.apps.googleusercontent.com', GOOGLE_CALENDAR_CLIENT_SECRET: 'test-only-oauth-client-placeholder',
    CALENDAR_SITE_ORIGIN: 'https://family.example.test', CALENDAR_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 61).toString('base64'), CALENDAR_ENCRYPTION_KEY_ID: 'fixture' });
  return () => { for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; };
}
function clone(value) {
  if (value instanceof Timestamp) return Timestamp.fromMillis(value.toMillis());
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

/** Serializes transactions and rejects read-after-write, matching the Firestore transaction contract. */
export function calendarMemoryContext(initial = {}, uid = 'actor') {
  const rows = new Map(Object.entries({ 'members/actor': calendarParent, 'members/child': calendarChild, ...initial }).map(([path, value]) => [path, clone(value)]));
  const calls = [], controls = { beforeGet: null, beforeQuery: null };
  let tail = Promise.resolve();
  const snapshot = reference => ({ ref: reference, id: reference.path.split('/').at(-1), exists: rows.has(reference.path), data: () => clone(rows.get(reference.path)) });
  const query = (name, filters = [], count = Infinity) => ({ name, filters, count,
    doc: id => ({ path: `${name}/${id}`, get: async () => snapshot({ path: `${name}/${id}` }) }),
    where: (field, operation, value) => { if (operation !== '==') throw new Error('Unexpected test query'); return query(name, [...filters, [field, value]], count); },
    limit: value => query(name, filters, value),
    get: async () => {
      const docs = [...rows.keys()].filter(path => path.startsWith(`${name}/`) && filters.every(([field, value]) => rows.get(path)?.[field] === value)).slice(0, count).map(path => snapshot({ path }));
      if (controls.beforeQuery) await controls.beforeQuery(name, docs);
      return { docs };
    },
  });
  const db = { collection: name => query(name), runTransaction: operation => {
    const work = tail.then(async () => {
      const writes = [];
      const result = await operation({
        get: async reference => {
          if (writes.length) throw new Error('Firestore forbids transaction reads after writes');
          if (controls.beforeGet) await controls.beforeGet(reference);
          return reference.path ? snapshot(reference) : reference.get();
        },
        set: (reference, value, options) => writes.push({ type: 'set', path: reference.path, value: clone(value), merge: options?.merge === true }),
        update: (reference, value) => { if (!rows.has(reference.path)) throw new Error('Cannot update a missing document'); writes.push({ type: 'update', path: reference.path, value: clone(value) }); },
        delete: reference => writes.push({ type: 'delete', path: reference.path }),
      });
      for (const write of writes) {
        if (write.type === 'delete') rows.delete(write.path);
        else rows.set(write.path, write.type === 'update' || write.merge ? { ...rows.get(write.path), ...write.value } : write.value);
        calls.push(write);
      }
      return result;
    });
    tail = work.catch(() => {});
    return work;
  } };
  return { uid, profile: rows.get(`members/${uid}`), db, rows, calls, controls };
}

export const calendarConnection = (changes = {}) => ({ ownerUid: 'actor', provider: 'google', ownerProfileId: 'actor', person: 'Sebastian', visibility: 'private', mode: 'sync',
  calendarId: 'primary-id', calendarName: 'Test Calendar', selectionConfirmed: true, status: 'connected', version: 'first-version', leaseId: null, leaseExpiresAt: null, ...changes });
export const googleFixtureEvent = (id = 'event-1', changes = {}) => ({ externalEventId: id, title: 'Wizyta', description: 'Opis', location: 'Kołobrzeg',
  start: testNow + 3600000, end: testNow + 7200000, allDay: false, timeZone: 'Europe/Warsaw', cancelled: false, ...changes });
