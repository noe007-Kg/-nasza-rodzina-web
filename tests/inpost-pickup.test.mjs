import test from 'node:test';
import assert from 'node:assert/strict';
import { pickupFields, pickupRef, QR_DATA_LIMIT } from '../server/inpost-pickup.mjs';
import { manageParcels } from '../server/inpost-service.mjs';
import { createFamilyRouter } from '../server/family-http.mjs';
const number='600000658493991742009752';
const qr='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6e0AAAAASUVORK5CYII=';
const pickup={code:'012345',phone:'123456789',note:'Buty dla Pawła',qr};
function database() {
  const profile={familyId:'family-a',role:'parent',active:true,canLogin:true};
  const docs=new Map([['members/a',profile]]);
  const db={collection:name=>({doc:id=>({path:`${name}/${id}`,get:async()=>({data:()=>docs.get(`${name}/${id}`)})})}),runTransaction:async fn=>fn({get:async ref=>({data:()=>docs.get(ref.path)}),set:(ref,value)=>docs.set(ref.path,structuredClone(value)),delete:ref=>docs.delete(ref.path)})};
  return {docs,context:{uid:'a',profile,db}};
}
const options={env:{},clock:()=>100000,provider:async()=>({unavailable:'provider'})};
test('pickup validation accepts leading zero, plain notes and raster images only',()=>{
  assert.deepEqual(pickupFields(pickup),pickup);
  for(const change of [{code:'12345'},{code:123456},{phone:'123'},{note:'x'.repeat(601)},{qr:'https://public.example/qr.png'},{qr:'data:image/svg+xml;base64,PHN2Zz4='},{qr:'data:image/png;base64,ZmFrZQ=='},{qr:'x'.repeat(QR_DATA_LIMIT+1)},{extra:'x'}])assert.throws(()=>pickupFields({...pickup,...change}));
});
test('pickup persists, is family scoped and is removed on archive',async()=>{
  const {context,docs}=database();
  await manageParcels(context,{operation:'add',number},options);
  await manageParcels(context,{operation:'pickup',number,pickup},options);
  const result=await manageParcels(context,{operation:'state'},options);
  assert.deepEqual(result.parcels[0].pickup,pickup);
  assert(![...docs.entries()].find(([key])=>key.startsWith('_inpostFamilies/'))[1].parcels[0].pickup);
  const other={...context.profile,familyId:'other-family'};docs.set('members/b',other);
  await assert.rejects(manageParcels({...context,uid:'b',profile:other},{operation:'pickup',number,pickup},options),/nie jest już aktywna/);
  assert.deepEqual((await manageParcels({...context,uid:'b',profile:other},{operation:'state'},options)).parcels,[]);
  await manageParcels(context,{operation:'archive',number},options);
  assert.equal(docs.get(pickupRef(context.db,'family-a',number).path),undefined);
  await assert.rejects(manageParcels(context,{operation:'pickup',number,pickup},options),/nie jest już aktywna/);
});
test('children read family pickup details but only adults can change them; Preview cannot write',async()=>{
  const {context,docs}=database();await manageParcels(context,{operation:'add',number},options);
  await manageParcels(context,{operation:'pickup',number,pickup},options);
  docs.set('members/a',{...context.profile,role:'child'});
  assert.deepEqual((await manageParcels(context,{operation:'state'},options)).parcels[0].pickup,pickup);
  await assert.rejects(manageParcels(context,{operation:'pickup',number,pickup},options),/dorosły/);
  docs.set('members/a',context.profile);
  await assert.rejects(manageParcels(context,{operation:'pickup',number,pickup},{...options,env:{VERCEL_ENV:'preview'}}),/Preview/);
});
test('carrier completion deletes the pickup secret and never sends it to InPost',async()=>{
  const {context,docs}=database();await manageParcels(context,{operation:'add',number},options);
  await manageParcels(context,{operation:'pickup',number,pickup},options);
  const result=await manageParcels(context,{operation:'state'},{...options,clock:()=>2000000,provider:async numbers=>{
    assert.deepEqual(numbers,[number]);return {updates:{[number]:{active:false,status:'Odebrana'}}};
  }});
  assert.deepEqual(result.parcels,[]);assert.equal(docs.get(pickupRef(context.db,'family-a',number).path),undefined);
});
test('parcel route accepts bounded QR uploads while other domains keep the small request limit',async()=>{
  const router=createFamilyRouter({env:{FAMILY_V2_SITE_ORIGIN:'https://family.example'},services:()=>({}),memberGuard:async()=>({}),parcelsAction:async()=>({saved:true})});
  const request={method:'POST',headers:{origin:'https://family.example','content-type':'application/json'},body:JSON.stringify({operation:'pickup',number,pickup:{...pickup,qr:'x'.repeat(17000)}})};
  const response=()=>({setHeader(){},end(body){this.body=JSON.parse(body);}});
  const valid=response();await router({...request,url:'/api/family/parcels'},valid);assert.equal(valid.statusCode,200);
  const large=response();await router({...request,url:'/api/family/parcels',body:'x'.repeat(190000)},large);assert.equal(large.statusCode,413);
  const other=response();await router({...request,url:'/api/family/tasks'},other);assert.equal(other.statusCode,413);
});
