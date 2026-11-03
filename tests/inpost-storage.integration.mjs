import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { manageParcels } from '../server/inpost-service.mjs';
import { POLL_MS } from '../server/inpost-provider.mjs';
import { manageHomeLayout } from '../server/home-layout-service.mjs';
test('real Firestore serializes concurrent refreshes and isolates families',async()=>{
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8080');
  const app=initializeApp({projectId:'demo-inpost-retirement'},'parcel-integration');const db=getFirestore(app);
  try {
    const profile={familyId:'parcel-test-family',role:'parent',active:true,canLogin:true};
    await db.collection('members').doc('parcel-test-parent').set(profile);
    const context={db,uid:'parcel-test-parent',profile};const number='600000658493991742009752';
    let now=Date.now();await manageParcels(context,{operation:'add',number},{env:{},clock:()=>now,provider:async()=>({unavailable:'provider'})});
    now+=POLL_MS;let calls=0;
    const options={env:{INPOST_CLIENT_ID:'test',INPOST_CLIENT_SECRET:'test'},clock:()=>now,provider:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,50));return {updates:{[number]:{status:'W drodze',active:true,updatedAt:'2026-11-03T10:00:00Z'}}};}};
    await Promise.all(Array.from({length:5},()=>manageParcels(context,{operation:'state'},options)));
    assert.equal(calls,1);
    const pickup={code:'012345',phone:'123456789',note:'Rodzinna paczka',qr:''};
    await manageParcels(context,{operation:'pickup',number,pickup},options);
    assert.deepEqual((await manageParcels(context,{operation:'state'},options)).parcels[0].pickup,pickup);
    const other={...profile,familyId:'another-test-family'};await db.collection('members').doc('parcel-test-other').set(other);
    const state=await manageParcels({db,uid:'parcel-test-other',profile:other},{operation:'state'},{env:{},clock:()=>now});
    assert.equal(state.parcels.length,0);
    await Promise.all(['mobile','desktop'].map(device=>manageHomeLayout(context,{operation:'save',device,tiles:[{id:'parcels',size:device==='mobile'?'small':'rectangle'}]})));
    const layout=await manageHomeLayout(context,{operation:'state'});
    assert.equal(layout.layouts.mobile[0].size,'small');assert.equal(layout.layouts.desktop[0].size,'rectangle');
    assert.deepEqual((await manageHomeLayout({db,uid:'parcel-test-other',profile:other},{operation:'state'})).layouts,{});
    await assert.rejects(manageParcels({db,uid:'parcel-test-other',profile:other},{operation:'pickup',number,pickup},options),/nie jest już aktywna/);
    await assert.rejects(manageParcels(context,{operation:'state',familyId:'another-test-family'},{env:{}}),/Nieprawidłowa/);
  } finally { await deleteApp(app); }
});
