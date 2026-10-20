import { createHash, randomUUID } from 'node:crypto';
import { EduServerError } from './edu-auth.mjs';
import { MUSIC_SCHOOL_TEMPLATE, isDate, occurrences, warsawParts, hasLessonsOn } from './music-school-model.mjs';
import { fetchPublicCancellations } from './music-school-public.mjs';

const collection = 'musicSchoolPlans';
function fail(code = 'MUSIC_FORBIDDEN', status = 403, message = 'Brak uprawnień do planu szkoły muzycznej.') { throw new EduServerError(code, status, message); }
function family(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value) && !['__legacy__', 'legacy'].includes(value); }
function active(p) { return p && p.active !== false && p.archived !== true && p.disabled !== true; }
function text(v, max = 120) { return typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v); }
function time(v) { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v); }
function validDateRange(from, until) { return isDate(from) && isDate(until) && from <= until && Date.parse(until) - Date.parse(from) <= 370 * 86400000; }
function planRef(db, familyId, uid) { return db.collection(collection).doc(createHash('sha256').update(`${familyId}|${uid}|psm-kolobrzeg`).digest('hex')); }
export function musicWritesAllowed(env = process.env) { return env.MUSIC_SCHOOL_ENABLED === 'true' && env.VERCEL_ENV !== 'preview'; }
export function assertMusicWrites(env = process.env) {
  if (!musicWritesAllowed(env)) fail('MUSIC_DISABLED', 503, 'Zapis i sprawdzanie planu wymagają włączenia modułu przez administratora. W Preview zapisy są wyłączone.');
}
async function identity(context) {
  const snap = await context.db.collection('members').doc(context.uid).get(), actor = snap.data();
  if (!snap.exists || !active(actor) || actor.canLogin !== true || !family(actor.familyId) || !['parent', 'child'].includes(actor.role)) fail();
  return actor;
}
function ownerAllowed(owner, actor, uid, targetId) {
  return active(owner) && owner.role === 'child' && owner.schoolEnabled === true && owner.familyId === actor.familyId
    && (actor.role === 'parent' || uid === targetId);
}
function publicPlan(id, plan) {
  return { id, ownerProfileId: plan.ownerProfileId, person: plan.person, revision: plan.revision,
    validFrom: plan.validFrom, validUntil: plan.validUntil, lessons: plan.lessons, excludedDates: plan.excludedDates,
    check: plan.check || null, occurrences: occurrences(plan) };
}
function validateDraft(body) {
  if (!validDateRange(body.validFrom, body.validUntil) || !Array.isArray(body.lessons) || !body.lessons.length || body.lessons.length > 30
    || !Array.isArray(body.excludedDates) || body.excludedDates.length > 370 || !body.excludedDates.every(isDate)) fail('MUSIC_INVALID', 400, 'Sprawdź daty i plan zajęć (maksymalnie jeden rok).');
  const ids = new Set();
  const lessons = body.lessons.map(x => {
    if (!x || !/^[a-z0-9-]{1,40}$/.test(x.id) || ids.has(x.id) || !Number.isInteger(x.weekday) || x.weekday < 0 || x.weekday > 6
      || !text(x.title) || !text(x.teacher) || typeof x.room !== 'string' || x.room.length > 60 || !time(x.time) || !time(x.endTime) || x.time >= x.endTime) fail('MUSIC_INVALID', 400, 'Sprawdź każdą pozycję planu.');
    ids.add(x.id);
    return { id: x.id, weekday: x.weekday, title: x.title.trim(), teacher: x.teacher.trim(), room: x.room, time: x.time, endTime: x.endTime };
  });
  return { validFrom: body.validFrom, validUntil: body.validUntil, lessons, excludedDates: [...new Set(body.excludedDates)].sort() };
}
export async function manageMusicSchoolAction(context, body, { env = process.env, now = Date.now(), fetchPublic = fetchPublicCancellations, clock = Date.now } = {}) {
  const actor = await identity(context), operation = body.operation || body.action;
  if (operation === 'state') {
    const snapshot = await context.db.collection(collection).where('familyId', '==', actor.familyId).limit(101).get();
    if (snapshot.size > 100) fail('MUSIC_LIMIT', 409, 'Zbyt wiele planów. Skontaktuj się z administratorem.');
    const plans = [];
    for (const doc of snapshot.docs) {
      const p = doc.data();
      if (actor.role !== 'parent' && p.ownerProfileId !== context.uid) continue;
      const owner = (await context.db.collection('members').doc(p.ownerProfileId).get()).data();
      if (ownerAllowed(owner, actor, context.uid, p.ownerProfileId)) plans.push(publicPlan(doc.id, p));
    }
    return { plans, template: MUSIC_SCHOOL_TEMPLATE, writesEnabled: musicWritesAllowed(env) };
  }
  assertMusicWrites(env);
  if (actor.role !== 'parent' || typeof body.ownerProfileId !== 'string' || !/^[^/]{1,128}$/.test(body.ownerProfileId)) fail();
  const ref = planRef(context.db, actor.familyId, body.ownerProfileId);
  if (operation === 'check') {
    const owner = (await context.db.collection('members').doc(body.ownerProfileId).get()).data();
    if (!ownerAllowed(owner, actor, context.uid, body.ownerProfileId)) fail();
    return { checkResult: await checkMusicSchoolPlan(context, ref, { now, fetchPublic, clock }) };
  }
  if (!['save', 'override'].includes(operation)) fail('MUSIC_OPERATION', 400, 'Nieznana operacja.');
  const draft = operation === 'save' ? validateDraft(body) : null;
  await context.db.runTransaction(async tx => {
    const [a, o, snap] = await Promise.all([tx.get(context.db.collection('members').doc(context.uid)), tx.get(context.db.collection('members').doc(body.ownerProfileId)), tx.get(ref)]);
    const fresh = a.data(), owner = o.data(), previous = snap.data();
    if (!active(fresh) || fresh.role !== 'parent' || fresh.canLogin !== true || fresh.familyId !== actor.familyId || !ownerAllowed(owner, fresh, context.uid, body.ownerProfileId)) fail();
    if ((previous?.revision || 0) !== body.revision) fail('MUSIC_CONFLICT', 409, 'Plan został zmieniony. Odśwież widok przed zapisem.');
    if (previous?.lease?.until > now) fail('MUSIC_BUSY', 409, 'Trwa sprawdzanie komunikatów. Spróbuj za chwilę.');
    if (operation === 'save') {
      tx.set(ref, { ...previous, ...draft, familyId: actor.familyId, ownerProfileId: body.ownerProfileId,
        person: owner.personKey || owner.name, active: true, revision: body.revision + 1,
        overrides: previous?.overrides || {}, cancellations: previous?.cancellations || {}, updatedAt: now });
    } else {
      if (!previous || !occurrences(previous).some(x => x.id === body.occurrenceId)) fail('MUSIC_INVALID', 400, 'Nie znaleziono zajęć.');
      const x = body.override;
      if (!x || !isDate(x.date) || x.date < previous.validFrom || x.date > previous.validUntil || !time(x.time) || !time(x.endTime) || x.time >= x.endTime
        || typeof x.cancelled !== 'boolean' || typeof x.note !== 'string' || x.note.length > 500) fail('MUSIC_INVALID', 400, 'Nieprawidłowa zmiana zajęć.');
      // Local parent decisions always take precedence over future public checks.
      tx.update(ref, { overrides: { ...previous.overrides, [body.occurrenceId]: { date: x.date, time: x.time, endTime: x.endTime, cancelled: x.cancelled, note: x.note } }, revision: body.revision + 1, updatedAt: now });
    }
  });
  return { saved: true };
}
export async function checkMusicSchoolPlan(context, ref, { now = Date.now(), slot = '', fetchPublic = fetchPublicCancellations, clock = Date.now } = {}) {
  const leaseId = randomUUID();
  const acquired = await context.db.runTransaction(async tx => {
    const snap = await tx.get(ref), p = snap.data();
    if (!p || !p.active || !family(p.familyId)) return null;
    const owner = (await tx.get(context.db.collection('members').doc(p.ownerProfileId))).data();
    if (!active(owner) || owner.familyId !== p.familyId || owner.schoolEnabled !== true || owner.role !== 'child') return null;
    if (p.lease?.until > now || slot && p.lastSlot === slot || !slot && p.check?.attemptAt > now - 300_000) return null;
    tx.update(ref, { lease: { id: leaseId, until: now + 90_000 }, ...(slot ? { lastSlot: slot } : {}), check: { ...p.check, attemptAt: now, status: 'checking' } });
    return p;
  });
  if (!acquired) return 'skipped';
  let result;
  try { result = await fetchPublic(); } catch { result = null; }
  const finishedAt = clock();
  return context.db.runTransaction(async tx => {
    const snap = await tx.get(ref), p = snap.data();
    if (p?.lease?.id !== leaseId || p.lease.until <= finishedAt || p.revision !== acquired.revision) return 'skipped';
    const owner = (await tx.get(context.db.collection('members').doc(p.ownerProfileId))).data();
    if (!active(owner) || owner.familyId !== p.familyId || owner.schoolEnabled !== true) {
      tx.update(ref, { lease: null, check: { ...p.check, status: 'unavailable' } }); return 'skipped';
    }
    if (!result) {
      tx.update(ref, { lease: null, check: { ...p.check, status: 'unavailable' } }); return 'unavailable';
    }
    const cancellations = { ...p.cancellations };
    for (const lesson of occurrences(p)) {
      // Moved occurrences require manual review, never match against an obsolete date.
      if (lesson.manual) continue;
      const notice = result.notices.find(n => n.teacher === lesson.teacher && lesson.date >= n.from && lesson.date <= n.until);
      if (notice) cancellations[lesson.id] = notice;
    }
    tx.update(ref, { lease: null, cancellations, check: { attemptAt: now, successAt: result.review ? p.check?.successAt || null : now, status: result.review ? 'review' : 'checked' } });
    return result.review ? 'review' : 'checked';
  });
}
export async function runMusicSchoolHourly(context, { scheduleTime, now = Date.now(), env = process.env, fetchPublic = fetchPublicCancellations, clock = Date.now } = {}) {
  if (!musicWritesAllowed(env)) return { disabled: 1 };
  const scheduled = new Date(scheduleTime);
  if (!Number.isFinite(scheduled.getTime()) || Math.abs(now - scheduled.getTime()) > 3600_000) return { skipped: 1 };
  const parts = warsawParts(scheduled);
  if (parts.hour < 8 || parts.hour > 18) return { skipped: 1 };
  const docs = await context.db.collection(collection).where('active', '==', true).limit(101).get();
  if (docs.size > 100) return { limit: 1 };
  const counts = { checked: 0, review: 0, unavailable: 0, skipped: 0 };
  let promise;
  const sharedFetch = () => promise ||= fetchPublic();
  for (const doc of docs.docs) {
    if (!hasLessonsOn(doc.data(), parts.date)) { counts.skipped++; continue; }
    // Logical Warsaw slot, not elapsed seconds from a delayed invocation.
    const result = await checkMusicSchoolPlan(context, doc.ref, { now, slot: `${parts.date}T${parts.hour}`, fetchPublic: sharedFetch, clock });
    counts[result]++;
  }
  return counts;
}
