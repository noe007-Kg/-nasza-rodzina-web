import { Timestamp } from 'firebase-admin/firestore';

export const familyTestNow = new Date('2026-10-11T08:00:00Z');
export const fixtureParent = { name: 'Rodzic testowy', personKey: 'parent-person', role: 'parent', active: true, canLogin: true, familyId: 'fixture-family' };
export const fixtureChild = { name: 'Dziecko testowe', personKey: 'child-person', role: 'child', active: true, canLogin: true, familyId: 'fixture-family', birthDate: '2016-03-02' };
export const fixtureAdult = { name: 'Dorosły testowy', personKey: 'adult-person', role: 'child', active: true, canLogin: true, familyId: 'fixture-family', birthDate: '2006-03-02' };

function clone(value) {
  if (value instanceof Timestamp) return Timestamp.fromMillis(value.toMillis());
  if (value instanceof Date) return new Date(value);
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    if (value.constructor.name.endsWith('Transform')) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

/** A bounded in-memory Firestore fixture: atomic serialized transactions, create preconditions,
 * read-before-write enforcement, FieldValue transforms and exact collection paths. No network. */
export function familyMemoryContext(initial = {}, uid = 'parent') {
  const rows = new Map(Object.entries({ 'members/parent': fixtureParent, 'members/child': fixtureChild,
    'members/adult': fixtureAdult, ...initial }).map(([path, value]) => [path, clone(value)]));
  const calls = [];
  let tail = Promise.resolve();
  const apply = (previous, data) => {
    const value = { ...previous };
    for (const [key, item] of Object.entries(data)) {
      if (item?.constructor.name === 'DeleteTransform') delete value[key];
      else if (item?.constructor.name === 'ServerTimestampTransform') value[key] = Timestamp.fromDate(familyTestNow);
      else if (item?.constructor.name === 'NumericIncrementTransform') value[key] = Number(value[key] || 0) + item.operand;
      else value[key] = clone(item);
    }
    return value;
  };
  const commit = writes => {
    const pending = new Map(rows);
    for (const write of writes) {
      if (write.type === 'create' && pending.has(write.path)) throw new Error('ALREADY_EXISTS');
      if (write.type === 'update' && !pending.has(write.path)) throw new Error('NOT_FOUND');
      if (write.type === 'delete') pending.delete(write.path);
      else pending.set(write.path, apply(write.type === 'update' || write.merge ? pending.get(write.path) : {}, write.data));
    }
    rows.clear();
    for (const [path, data] of pending) rows.set(path, data);
    calls.push(...writes);
  };
  const reference = path => ({ path, id: path.split('/').at(-1),
    get: async () => snapshot(reference(path)), collection: name => query(`${path}/${name}`),
    set: async (data, options) => commit([{ type: 'set', path, data, merge: options?.merge === true }]),
    update: async data => commit([{ type: 'update', path, data }]),
    delete: async () => commit([{ type: 'delete', path }]),
  });
  const snapshot = ref => ({ ref, id: ref.id, exists: rows.has(ref.path), data: () => clone(rows.get(ref.path)) });
  const compare = (left, operation, right) => {
    const a = left?.toMillis?.() ?? left;
    const b = right?.toMillis?.() ?? right;
    if (operation === '==') return a === b;
    if (operation === '<=') return a <= b;
    if (operation === '<') return a < b;
    if (operation === '>=') return a >= b;
    if (operation === '>') return a > b;
    if (operation === 'array-contains') return Array.isArray(a) && a.includes(b);
    throw new Error(`Unsupported fixture query: ${operation}`);
  };
  const query = (name, filters = [], count = Infinity) => ({ name,
    doc: id => reference(`${name}/${id}`),
    where: (field, operation, value) => query(name, [...filters, [field, operation, value]], count),
    limit: limit => query(name, filters, limit),
    get: async () => {
      const depth = name.split('/').length + 1;
      const docs = [...rows.keys()].filter(path => path.startsWith(`${name}/`) && path.split('/').length === depth
        && filters.every(([field, operation, value]) => compare(rows.get(path)?.[field], operation, value)))
        .slice(0, count).map(path => snapshot(reference(path)));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  const writer = writes => ({
    set: (ref, data, options) => writes.push({ type: 'set', path: ref.path, data, merge: options?.merge === true }),
    create: (ref, data) => writes.push({ type: 'create', path: ref.path, data }),
    update: (ref, data) => writes.push({ type: 'update', path: ref.path, data }),
    delete: ref => writes.push({ type: 'delete', path: ref.path }),
  });
  const db = { collection: name => query(name),
    batch: () => { const writes = []; return { ...writer(writes), commit: async () => commit(writes) }; },
    runTransaction: operation => {
      const work = tail.then(async () => {
        const writes = [];
        const read = async ref => {
          if (writes.length) throw new Error('Firestore forbids transaction reads after writes');
          return ref.path ? snapshot(ref) : ref.get();
        };
        const result = await operation({ ...writer(writes), get: read, getAll: (...refs) => Promise.all(refs.map(read)) });
        commit(writes);
        return result;
      });
      tail = work.catch(() => {});
      return work;
    },
  };
  const context = { uid, profile: clone(rows.get(`members/${uid}`)), db, rows, calls, now: familyTestNow };
  context.as = actor => ({ ...context, uid: actor, profile: clone(rows.get(`members/${actor}`)) });
  return context;
}

/** Storage fixture preserves objects until an actual delete and supports transient failures. */
export function memoryBucket(initial = {}) {
  const objects = new Map(Object.entries(initial).map(([path, value]) => [path, clone(value)]));
  const deletes = [], controls = { failDeletes: 0 };
  return { objects, deletes, controls, file: path => ({
    getMetadata: async () => { const item = objects.get(path); if (!item) throw new Error('NOT_FOUND'); return [clone(item.metadata)]; },
    download: async options => { const item = objects.get(path); if (!item) throw new Error('NOT_FOUND'); return [item.bytes.subarray(options?.start || 0, options?.end === undefined ? undefined : options.end + 1)]; },
    setMetadata: async metadata => { const item = objects.get(path); if (!item) throw new Error('NOT_FOUND'); item.metadata = { ...item.metadata, ...clone(metadata) }; },
    delete: async options => {
      if (controls.failDeletes > 0) { controls.failDeletes -= 1; throw new Error('TRANSIENT_STORAGE_ERROR'); }
      if (!objects.has(path) && !options?.ignoreNotFound) throw new Error('NOT_FOUND');
      objects.delete(path); deletes.push(path);
    },
  }) };
}
