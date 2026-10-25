import {readFile} from 'node:fs/promises';
import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment, assertSucceeds, assertFails} from '@firebase/rules-unit-testing';
import {doc, getDoc, setDoc, deleteDoc, serverTimestamp, collection, getDocs} from 'firebase/firestore';
let env;
before(async () => {
  env = await initializeTestEnvironment({projectId:'demo-nr-package-rules', firestore:{host:'127.0.0.1',port:8080,rules:await readFile(process.env.H1_RULES || 'firestore.rules','utf8')}});
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, familyId] of [['a','home'],['b','home'],['c','other']]) await setDoc(doc(db,'members',uid), {name:uid, role:'parent', active:true, canLogin:true, familyId});
    await setDoc(doc(db,'familyMessages','private-ab'), {uid:'b',channel:'private:a:b',participants:['a','b']});
    await setDoc(doc(db,'familyMessages','private-bc'), {uid:'b',channel:'private:b:c',participants:['b','c']});
  });
});
after(async()=>env?.cleanup());
test('owner receipts cannot modify others or foreign private messages', async()=>{
 const a=env.authenticatedContext('a').firestore();
 await assertSucceeds(setDoc(doc(a,'chatReadStates','a','messages','private-ab'),{read:true,updatedAt:serverTimestamp()}));
 await assertFails(setDoc(doc(a,'chatReadStates','a','messages','private-bc'),{read:true,updatedAt:serverTimestamp()}));
 await assertFails(setDoc(doc(a,'chatReadStates','b','messages','private-ab'),{read:true,updatedAt:serverTimestamp()}));
 await assertFails(setDoc(doc(a,'chatReadStates','a','messages','private-ab'),{read:false,updatedAt:serverTimestamp()}));
 await assertFails(deleteDoc(doc(a,'chatReadStates','a','messages','private-ab')));
});
test('devices merge without losing receipts; owner list survives reconnect',async()=>{
 const first=env.authenticatedContext('a').firestore(), second=env.authenticatedContext('a').firestore();
 await Promise.all([first,second].map(db=>assertSucceeds(setDoc(doc(db,'chatReadStates','a','messages','private-ab'),{read:true,updatedAt:serverTimestamp()}))));
 assert.equal((await getDoc(doc(second,'chatReadStates','a','messages','private-ab'))).data().read,true);
 await assertSucceeds(getDocs(collection(second,'chatReadStates','a','messages')));
 await assertFails(getDocs(collection(env.authenticatedContext('c').firestore(),'chatReadStates','a','messages')));
});
test('school baseline is immutable and personal; seen metadata cannot edit sources or another user',async()=>{
 const a=env.authenticatedContext('a').firestore(), b=env.authenticatedContext('b').firestore();
 const baseline=doc(a,'userPreferences','a','schoolState','baseline');
 await assertSucceeds(setDoc(baseline,{startedAt:serverTimestamp()}));
 await assertFails(setDoc(baseline,{startedAt:serverTimestamp()}));
 await assertSucceeds(setDoc(doc(a,'userPreferences','a','schoolSeen','stable-grade'),{seen:true,updatedAt:serverTimestamp()}));
 await assertFails(getDoc(doc(b,'userPreferences','a','schoolSeen','stable-grade')));
 await assertFails(setDoc(doc(b,'userPreferences','a','schoolSeen','stable-grade'),{seen:true,updatedAt:serverTimestamp()}));
 await assertFails(setDoc(doc(a,'userPreferences','a','schoolSeen','stable-grade'),{seen:false,updatedAt:serverTimestamp(),grade:'6'}));
});
