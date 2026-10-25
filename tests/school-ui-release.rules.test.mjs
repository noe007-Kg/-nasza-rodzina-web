import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,serverTimestamp} from 'firebase/firestore';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw Error('LOCAL_DEMO_REQUIRED');
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-nasza-rodzina',firestore:{host:'127.0.0.1',port:8080,rules:await readFile(new URL('../deploy/school-ui/firestore.rules',import.meta.url),'utf8')}});await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{for(const uid of ['one','two'])await setDoc(doc(c.firestore(),'members',uid),{name:uid,role:'child',active:true,canLogin:true,archived:false});});});
after(async()=>env?.cleanup());
test('school new markers are private, baseline immutable, and cannot modify source records',async()=>{
 const one=env.authenticatedContext('one').firestore(),two=env.authenticatedContext('two').firestore();
 const baseline=doc(one,'userPreferences/one/schoolState/baseline');
 await assertSucceeds(setDoc(baseline,{startedAt:serverTimestamp()}));
 await assertFails(setDoc(baseline,{startedAt:serverTimestamp()}));
 await assertFails(getDoc(doc(two,'userPreferences/one/schoolState/baseline')));
 await assertSucceeds(setDoc(doc(one,'userPreferences/one/schoolSeen/item'),{seen:true,updatedAt:serverTimestamp()}));
 await assertFails(setDoc(doc(two,'userPreferences/one/schoolSeen/item'),{seen:true,updatedAt:serverTimestamp()}));
 await assertFails(setDoc(doc(one,'userPreferences/one/schoolSeen/forged'),{seen:true,updatedAt:serverTimestamp(),title:'forged'}));
 await assertFails(setDoc(doc(one,'schoolItems/source'),{source:'eduvulcan',title:'forged'}));
});
