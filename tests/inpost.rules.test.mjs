import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
let env;
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-inpost-retirement',firestore:{host:'127.0.0.1',port:8080,rules:await readFile('deploy/inpost/firestore.rules','utf8')}});
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for(const uid of ['a','b','c']) await setDoc(doc(db,'members',uid),{name:'Sebastian',role:'parent',active:true,canLogin:true,familyId:uid==='c'?'other':'family'});
    await setDoc(doc(db,'familyMessages','private'),{uid:'a',channel:'private:a:b',participants:['a','b'],text:'History'});
    await setDoc(doc(db,'familyMessages','family'),{uid:'a',channel:'family',participants:[],text:'History'});
    await setDoc(doc(db,'_inpostFamilies','family'),{parcels:[{number:'600000658493991742009752'}]});
  });
});
after(async()=>env?.cleanup());
test('chat history remains accessible only under its original visibility; every write is denied',async()=>{
  const a=env.authenticatedContext('a').firestore(),c=env.authenticatedContext('c').firestore();
  await assertSucceeds(getDoc(doc(a,'familyMessages','private')));
  await assertFails(getDoc(doc(c,'familyMessages','private')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'familyMessages','family')));
  await assertFails(setDoc(doc(a,'familyMessages','new'),{uid:'a',channel:'family',text:'New'}));
  await assertFails(setDoc(doc(a,'familyMessages','private'),{text:'Changed'},{merge:true}));
  await assertFails(deleteDoc(doc(a,'familyMessages','private')));
  await assertFails(setDoc(doc(a,'familyMessages','private','reactions','a'),{uid:'a',emoji:'👍'}));
  await assertFails(setDoc(doc(a,'chatReadStates','a','messages','private'),{read:true}));
});
test('parcel records are inaccessible directly even to a parent; only the authorized server can read or write',async()=>{
  for(const db of [env.authenticatedContext('a').firestore(),env.authenticatedContext('c').firestore(),env.unauthenticatedContext().firestore()]) {
    await assertFails(getDoc(doc(db,'_inpostFamilies','family')));
    await assertFails(setDoc(doc(db,'_inpostFamilies','spoof'),{parcels:[]}));
    await assertFails(deleteDoc(doc(db,'_inpostFamilies','family')));
    await assertFails(getDoc(doc(db,'_inpostPickup','family-parcel')));
    await assertFails(setDoc(doc(db,'_inpostPickup','family-parcel'),{code:'123456',qr:'private'}));
    await assertFails(deleteDoc(doc(db,'_inpostPickup','family-parcel')));
    await assertFails(getDoc(doc(db,'_homeLayouts','a')));
    await assertFails(setDoc(doc(db,'_homeLayouts','a'),{mobile:[]}));
  }
});
