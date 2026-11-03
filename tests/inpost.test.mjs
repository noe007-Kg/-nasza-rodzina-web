import test from 'node:test';
import assert from 'node:assert/strict';
import { trackingNumber, projectParcel, fetchTracking, POLL_MS } from '../server/inpost-provider.mjs';
import { manageParcels } from '../server/inpost-service.mjs';
import { createFamilyRouter } from '../server/family-http.mjs';
import { deriveNotificationEvent } from '../server/notification-events.mjs';
import { cronAuthorized } from '../server/inpost-scheduler.mjs';
const number = '600000658493991742009752';
const profile = { familyId:'family-a', role:'parent', active:true, canLogin:true };
function database() {
  const docs = new Map([['members/parent',profile]]);
  const db = { collection:name=>({ doc:id=>({ path:`${name}/${id}`, get:async()=>({ data:()=>docs.get(`${name}/${id}`) }) }) }), runTransaction:async fn=>fn({ get:async ref=>({ data:()=>docs.get(ref.path) }), set:(ref,data)=>docs.set(ref.path,structuredClone(data)) }) };
  return { docs, context:{ uid:'parent',profile,db } };
}
const env = { INPOST_CLIENT_ID:'test-id', INPOST_CLIENT_SECRET:'test-secret' };
test('PL tracking numbers are strictly validated',()=>{assert.equal(trackingNumber(` ${number} `),number); for(const n of ['x',123,number+'/',number+'?x=1','１２３',number.slice(1)]) assert.throws(()=>trackingNumber(n));});
test('unordered events, unknown statuses, destination and terminal states',()=>{
  const events=[{eventCode:'LMD.1005',eventTimestamp:'2026-11-03T10:00:00Z'},{eventCode:'MMD.1001',eventTimestamp:'2026-11-02T10:00:00Z'}];
  assert.equal(projectParcel({events,destination:{type:'LOCKER_POINT',name:'KOL01A'}}).locker,'KOL01A');
  assert.equal(projectParcel({events}).status,'Czeka w paczkomacie');
  for(const code of ['EOL.1001','EOL.1002','EOL.9004','RTS.1002']) assert.equal(projectParcel({events:[{eventCode:code,eventTimestamp:'2026-11-03T10:00:00Z'}]}).active,false);
  assert.equal(projectParcel({events:[{eventCode:'NEW.123',eventTimestamp:'2026-11-03T10:00:00Z'}]}).active,true);
  assert.equal(projectParcel({events:[]}),null);
  assert(!('eta' in projectParcel({events})));
});
test('OAuth stays on server and tracking batches never exceed ten',async()=>{
  const calls=[]; const numbers=Array.from({length:20},(_,i)=>String(i).padStart(24,'0'));
  const result=await fetchTracking(numbers,{env,fetcher:async(url,options)=>{
    calls.push({url:String(url),options});
    return new Response(JSON.stringify(calls.length===1?{access_token:'secret-access-token'}:{parcels:[]}),{status:200});
  }});
  assert.deepEqual(result,{updates:{}}); assert.equal(calls.length,3);
  assert.equal(calls[0].options.body.get('scope'),'api:tracking:read');
  for(const call of calls.slice(1)){assert.equal(new URL(call.url).searchParams.getAll('trackingNumbers').length,10);assert.equal(call.options.headers.Authorization,'Bearer secret-access-token');assert.equal(call.options.redirect,'error');}
});
test('429 Retry-After does not create a tight retry loop',async()=>{
  let count=0;
  const result=await fetchTracking([number],{env,fetcher:async()=>++count===1?new Response('{"access_token":"x"}'):new Response('',{status:429,headers:{'retry-after':'3600'}})});
  assert.equal(result.retryMs,3600000);assert.equal(result.unavailable,'rate-limit');
});
test('save is idempotent, persists without API, and archive hides the last parcel',async()=>{
  const {context}=database();const options={env:{},clock:()=>100000,provider:async()=>({unavailable:'provider'})};
  assert.equal((await manageParcels(context,{operation:'state'},options)).parcels.length,0);
  for(let i=0;i<2;i++) assert.equal((await manageParcels(context,{operation:'add',number},options)).parcels.length,1);
  const state=await manageParcels(context,{operation:'state'},options);assert.equal(state.configured,true);assert.equal(state.parcels[0].updatedAt,null);
  assert.equal((await manageParcels(context,{operation:'archive',number},options)).parcels.length,0);
});
test('shared persisted throttle and failed API preserve last known state',async()=>{
  const {context}=database();let now=100000,calls=0;
  const options={env,clock:()=>now,provider:async()=>{calls++;return {updates:{[number]:{status:'W drodze',active:true,updatedAt:'2026-11-03T10:00:00Z'}}};}};
  await manageParcels(context,{operation:'add',number},options);
  await manageParcels(context,{operation:'state'},options);assert.equal(calls,1);
  now+=POLL_MS;options.provider=async()=>{throw Error('private provider error');};
  const state=await manageParcels(context,{operation:'state'},options);assert.equal(state.parcels[0].status,'W drodze');assert.equal(state.issue,'provider');
});
test('delivered parcels disappear automatically',async()=>{
  const {context}=database();const state=await manageParcels(context,{operation:'add',number},{env,clock:()=>100000,provider:async()=>({updates:{[number]:{status:'Odebrana',active:false,updatedAt:'2026-11-03T10:00:00Z'}}})});
  assert.equal(state.parcels.length,0);
});
test('fresh membership, role and family changes are enforced',async()=>{
  const {context,docs}=database();docs.set('members/parent',{...profile,familyId:'other-family'});
  await assert.rejects(manageParcels(context,{operation:'state'},{env:{}}),/Rodzina/);
  docs.set('members/parent',{...profile,role:'child'});
  await assert.rejects(manageParcels(context,{operation:'add',number},{env:{}}),/dorosły/);
  docs.set('members/parent',{...profile,active:false});await assert.rejects(manageParcels(context,{operation:'state'},{env:{}}),/aktywnej/);
});
test('preview reads do not refresh API and writes are blocked',async()=>{
  const {context}=database();await manageParcels(context,{operation:'add',number},{env:{},clock:()=>100000,provider:async()=>({unavailable:'provider'})});
  let calls=0;const options={env:{...env,VERCEL_ENV:'preview'},provider:async()=>{calls++;}};
  await manageParcels(context,{operation:'state'},options);assert.equal(calls,0);
  await assert.rejects(manageParcels(context,{operation:'archive',number},options),/Preview/);
});
test('API protects route, origin, method and authentication',async()=>{
  let called=0;const router=createFamilyRouter({env:{FAMILY_V2_SITE_ORIGIN:'https://family.example'},services:()=>({}),memberGuard:async()=>{called++;throw new Error('not authorized');}});
  for(const [method,url,origin,status] of [['GET','/api/family/parcels','https://family.example',405],['POST','/api/family/parcels','https://evil.example',403],['POST','/api/family/parcels?x=1&action=tasks','https://family.example',404]]) {
    const response={setHeader(){},end(body){this.body=JSON.parse(body);}};await router({method,url,headers:{origin},body:{operation:'state'}},response);assert.equal(response.statusCode,status);
  }assert.equal(called,0);
});
test('chat no longer produces notifications',()=>assert.equal(deriveNotificationEvent('familyMessages','id',null,{text:'secret',channel:'family'}),null));
test('empty list is checked daily; active list every fifteen minutes, using public tracking',async()=>{
  const {context,docs}=database();let now=100000;
  const options={env:{},clock:()=>now,provider:async()=>({unavailable:'provider'})};
  await manageParcels(context,{operation:'state'},options);
  const state=()=>[...docs.entries()].find(([path])=>path.startsWith('_inpostFamilies/'))[1];
  assert.equal(state().nextCheckAt,now+86400000);
  now+=10000;await manageParcels(context,{operation:'add',number},options);
  assert.equal(POLL_MS,900000);assert.equal(state().nextCheckAt,now+POLL_MS);
  now+=10000;await manageParcels(context,{operation:'archive',number},options);
  assert.equal(state().nextCheckAt,now+86400000);
});
test('scheduler requires a strong exact server secret and cannot run in Preview',()=>{
  const secret='x'.repeat(64), request={headers:{authorization:`Bearer ${secret}`}};
  assert.equal(cronAuthorized(request,{INPOST_CRON_SECRET:secret}),true);
  for(const env of [{},{INPOST_CRON_SECRET:'short'},{INPOST_CRON_SECRET:secret,VERCEL_ENV:'preview'},{INPOST_CRON_SECRET:'y'.repeat(64)}])assert.equal(cronAuthorized(request,env),false);
});
test('existing unconfigured parcels refresh without waiting for the old three-hour schedule',async()=>{
  const {context,docs}=database();let now=100000,calls=0;
  const options={env:{},clock:()=>now,provider:async()=>{calls++;return {updates:{[number]:{status:'W drodze',active:true,updatedAt:'2026-11-03T10:00:00Z'}}};}};
  await manageParcels(context,{operation:'add',number},options);
  const [path,state]=[...docs.entries()].find(([path])=>path.startsWith('_inpostFamilies/'));
  delete state.providerVersion;delete state.lastProviderAttemptAt;
  state.nextCheckAt=now+3*60*60_000;docs.set(path,state);calls=0;
  now+=10000;
  const result=await manageParcels(context,{operation:'state'},options);
  assert.equal(calls,1);assert.equal(result.configured,true);assert.equal(result.parcels[0].status,'W drodze');
  await manageParcels(context,{operation:'state'},options);assert.equal(calls,1);
  assert.equal(docs.get(path).providerVersion,2);assert.equal(docs.get(path).nextCheckAt,now+POLL_MS);
});
