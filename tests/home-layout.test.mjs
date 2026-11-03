import test from 'node:test';
import assert from 'node:assert/strict';
import { manageHomeLayout, validateHomeLayout } from '../server/home-layout-service.mjs';
import { createFamilyRouter } from '../server/family-http.mjs';
const profile={active:true,canLogin:true,role:'child',familyId:'family'};
function database(){const docs=new Map([['members/a',profile],['members/b',profile]]);const db={collection:name=>({doc:id=>({path:`${name}/${id}`})}),runTransaction:async fn=>fn({get:async ref=>({data:()=>docs.get(ref.path)}),set:(ref,value)=>docs.set(ref.path,structuredClone(value))})};return {docs,db};}
const tiles=[{id:'parcels',size:'small'},{id:'family',size:'large'},{id:'calendar',size:'rectangle'}];
test('layout validates tile IDs, unique entries, sizes and permitted fields',()=>{
  assert.deepEqual(validateHomeLayout(tiles),tiles);
  for(const value of [null,[...tiles,tiles[0]],[{id:'unknown',size:'small'}],[{id:'family',size:'huge'}],[{id:'family',size:'small',uid:'other'}]])assert.throws(()=>validateHomeLayout(value));
});
test('layouts are private per UID and device; explicit saves preserve the other device',async()=>{
  const {db,docs}=database(),a={uid:'a',profile,db},b={uid:'b',profile,db};
  assert.deepEqual(await manageHomeLayout(a,{operation:'state'}),{layouts:{}});
  await manageHomeLayout(a,{operation:'save',device:'mobile',tiles});
  await manageHomeLayout(a,{operation:'save',device:'desktop',tiles:[{id:'parcels',size:'large'}]});
  const result=await manageHomeLayout(a,{operation:'state'});
  assert.deepEqual(result.layouts.mobile,tiles);assert.equal(result.layouts.desktop[0].size,'large');
  assert.deepEqual(await manageHomeLayout(b,{operation:'state'}),{layouts:{}});
  await assert.rejects(manageHomeLayout(a,{operation:'save',device:'mobile',tiles,uid:'b'}));
  docs.set('members/a',{...profile,active:false});await assert.rejects(manageHomeLayout(a,{operation:'state'}),/aktywnego/);
});
test('Preview blocks saves even with an active parent and leaves the persisted preference intact',async()=>{
  const {db}=database(),context={uid:'a',profile,db};
  await manageHomeLayout(context,{operation:'save',device:'mobile',tiles});
  await assert.rejects(manageHomeLayout(context,{operation:'save',device:'desktop',tiles},{env:{VERCEL_ENV:'preview'}}),/Preview/);
  assert.deepEqual((await manageHomeLayout(context,{operation:'state'},{env:{VERCEL_ENV:'preview'}})).layouts.mobile,tiles);
});
test('layout endpoint requires POST, same origin and authentication and does not alter unrelated domains',async()=>{
  const router=createFamilyRouter({env:{FAMILY_V2_SITE_ORIGIN:'https://family.example'},services:()=>({}),memberGuard:async()=>{throw Error('unauthenticated');}});
  for(const [method,origin,status] of [['GET','https://family.example',405],['POST','https://evil.example',403],['POST','https://family.example',500]]){
    const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
    await router({method,url:'/api/family/home-layout',headers:{origin,'content-type':'application/json'},body:{operation:'state'}},res);assert.equal(res.statusCode,status);assert.equal(res.body.ok,false);
  }
});
