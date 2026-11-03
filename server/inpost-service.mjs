import { createHash, randomUUID } from 'node:crypto';
import { EduServerError } from './edu-auth.mjs';
import { fetchTracking, trackingNumber, POLL_MS, providerConfigured } from './inpost-provider.mjs';
import { pickupFields, pickupRef } from './inpost-pickup.mjs';

const fail = (status, message) => { throw new EduServerError('PARCEL_ACCESS', status, message); };
function family(profile) {
  if (!profile?.active || profile.archived || profile.canLogin !== true || !['parent','adult','child'].includes(profile.role) || typeof profile.familyId !== 'string' || !profile.familyId.trim()) fail(403,'Brak aktywnej rodziny na tym koncie.');
  return profile.familyId;
}
export async function manageParcels(context, body, { env = process.env, provider = fetchTracking, clock = Date.now, includePickup = true } = {}) {
  const operation = body.operation;
  if (!['state','add','archive','pickup'].includes(operation) || Object.keys(body).some(key => !(operation === 'pickup' ? ['operation','number','pickup'] : ['operation','number']).includes(key))) fail(400,'Nieprawidłowa operacja paczek.');
  if (operation !== 'state' && env.VERCEL_ENV === 'preview') fail(403,'Wersja Preview nie zmienia paczek.');
  const familyId = family(context.profile);
  const ref = context.db.collection('_inpostFamilies').doc(createHash('sha256').update(familyId).digest('hex'));
  const number = operation === 'state' ? null : trackingNumber(body.number);
  const pickup = operation === 'pickup' ? pickupFields(body.pickup) : null;
  const now = clock(), lease = randomUUID();
  const claimed = await context.db.runTransaction(async tx => {
    const [member, snapshot] = await Promise.all([tx.get(context.db.collection('members').doc(context.uid)), tx.get(ref)]);
    const profile = member.data();
    if (family(profile) !== familyId) fail(403,'Rodzina na koncie została zmieniona.');
    if (operation !== 'state' && !['parent','adult'].includes(profile.role)) fail(403,'Paczkami zarządza dorosły członek rodziny.');
    const state = snapshot.data() || { parcels:[] };
    let parcels = state.parcels || [];
    if (operation === 'pickup') {
      if (!parcels.some(p=>p.number === number && p.active)) fail(404,'Ta paczka nie jest już aktywna.');
      tx.set(pickupRef(context.db,familyId,number),pickup);
    }
    if (operation === 'add') {
      if (!parcels.some(p => p.number === number && p.active)) {
        if (now - (state.lastAddAt || 0) < 10_000) fail(429,'Poczekaj chwilę przed dodaniem kolejnej paczki.');
        if (parcels.filter(p=>p.active).length >= 20) fail(400,'Możesz śledzić maksymalnie 20 aktywnych paczek.');
        parcels = [...parcels.filter(p=>p.number !== number), { number, active:true, status:'Oczekuje na potwierdzenie InPost', updatedAt:null, createdAt:new Date(now).toISOString() }];
      }
    }
    if (operation === 'archive') {
      parcels = parcels.map(p => p.number === number ? { ...p, active:false } : p);
      tx.delete(pickupRef(context.db,familyId,number));
    }
    // Bound stored history; archive removes tracking only, never deletes user accounts or messages.
    parcels = [...parcels.filter(p=>p.active), ...parcels.filter(p=>!p.active).slice(-20)];
    const changedToActive = operation === 'add' && !(state.parcels || []).some(p=>p.active);
    const attemptDue = env.VERCEL_ENV !== 'preview' && parcels.some(p=>p.active) && (!state.lastProviderAttemptAt || now >= state.lastProviderAttemptAt + POLL_MS) && (changedToActive || state.providerVersion !== 2 || now >= (state.nextCheckAt || 0));
    const due = attemptDue && providerConfigured(env);
    const emptyDue = !parcels.some(p=>p.active) && now >= (state.nextCheckAt || 0);
    const next = { ...state, familyId, ownerUid:context.uid, parcels, ...(emptyDue || operation === 'archive' && !parcels.some(p=>p.active) ? { nextCheckAt:now+24*60*60_000 } : {}), ...(operation === 'add' ? { lastAddAt:now } : {}), ...(attemptDue ? { nextCheckAt:now+POLL_MS } : {}), ...(due ? { lease, lastProviderAttemptAt:now, providerVersion:2 } : {}) };
    if (env.VERCEL_ENV !== 'preview' && (operation !== 'state' || attemptDue || emptyDue)) tx.set(ref,next);
    return { state:next, due };
  });
  let state = claimed.state;
  if (claimed.due) {
    let result;
    try { result = await provider(state.parcels.filter(p=>p.active).map(p=>p.number), { env }); }
    catch { result = { unavailable:'provider' }; }
    state = await context.db.runTransaction(async tx => {
      const snapshot = await tx.get(ref); const current = snapshot.data();
      if (current.lease !== lease) return current;
      const next = { ...current, issue:result.unavailable || '', checkedAt:new Date(now).toISOString(), nextCheckAt: now + Math.max(POLL_MS,result.retryMs || 0),
        parcels:current.parcels.map(p => p.active && result.updates?.[p.number] ? { ...p, ...result.updates[p.number] } : p) };
      if (!next.parcels.some(p=>p.active)) next.nextCheckAt = now+24*60*60_000;
      for (const p of current.parcels) if (p.active && next.parcels.some(next=>next.number === p.number && !next.active)) tx.delete(pickupRef(context.db,familyId,p.number));
      tx.set(ref,next); return next;
    });
  }
  // Codes/QR live in separate private documents, keeping the family summary small.
  const parcels = await Promise.all(state.parcels.filter(p=>p.active).map(async p=>({
    number:p.number, status:p.status, updatedAt:p.updatedAt, locker:p.locker || '',
    detailsUrl:`https://inpost.pl/sledzenie-przesylek?number=${p.number}`,
    ...(includePickup ? { pickup:(await pickupRef(context.db,familyId,p.number).get()).data() || {code:'',phone:'',note:'',qr:''} } : {}),
  })));
  // Revalidate before disclosing pickup details after external reads.
  if (family((await context.db.collection('members').doc(context.uid).get()).data()) !== familyId) fail(403,'Rodzina na koncie została zmieniona.');
  return { parcels,
    configured:providerConfigured(env), issue:state.issue || '', checkedAt:state.checkedAt || null };
}
