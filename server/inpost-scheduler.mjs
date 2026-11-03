import { timingSafeEqual } from 'node:crypto';
import { getServerFirebase, eduRequestHeader } from './edu-auth.mjs';
import { manageParcels } from './inpost-service.mjs';

export function cronAuthorized(request, env) {
  const actual = Buffer.from(eduRequestHeader(request, 'authorization'));
  const expected = Buffer.from(`Bearer ${env.INPOST_CRON_SECRET || ''}`);
  return env.VERCEL_ENV !== 'preview' && typeof env.INPOST_CRON_SECRET === 'string' && env.INPOST_CRON_SECRET.length >= 32
    && actual.length === expected.length && timingSafeEqual(actual,expected);
}
export async function runParcelSchedule(services, { env=process.env, clock=Date.now } = {}) {
  const families = await services.db.collection('_inpostFamilies').where('nextCheckAt','<=',clock()).limit(3).get();
  const results = await Promise.allSettled(families.docs.map(async document => {
    const state = document.data();
    if (typeof state.familyId !== 'string') return;
    const members = await services.db.collection('members').where('familyId','==',state.familyId).limit(100).get();
    const member = members.docs.find(d => { const p=d.data(); return p.active === true && p.canLogin === true && !p.archived && ['parent','adult'].includes(p.role); });
    if (!member) return;
    await manageParcels({ ...services, uid:member.id, profile:member.data() }, { operation:'state' }, { env, clock });
  }));
  return { processed:results.filter(r=>r.status==='fulfilled').length, failed:results.filter(r=>r.status==='rejected').length };
}
export function createParcelCron({ services=getServerFirebase, env=process.env, run=runParcelSchedule }={}) {
  return async (request,response) => {
    response.setHeader('Cache-Control','no-store, private');
    response.setHeader('Content-Type','application/json');
    if (request.method !== 'POST' || !cronAuthorized(request,env)) { response.statusCode=401;response.end('{"ok":false}');return; }
    try { const result=await run(services(),{env});response.statusCode=result.failed?503:200;response.end(JSON.stringify({ok:!result.failed,...result})); }
    catch { response.statusCode=503;response.end('{"ok":false}'); }
  };
}
