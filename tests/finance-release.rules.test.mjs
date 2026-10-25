import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw Error('LOCAL_EMULATOR_REQUIRED');
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-nasza-rodzina',firestore:{host:'127.0.0.1',port:8080,rules:await readFile(new URL('../deploy/finance/firestore.rules',import.meta.url),'utf8')}});await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{
 for(const [uid,role,familyId,disabled]of [['parent','parent','one',false],['child','child','one',false],['sibling','child','one',false],['foreign','parent','two',false],['disabled','parent','one',true]])await setDoc(doc(c.firestore(),'members',uid),{name:uid,role,familyId,active:true,canLogin:true,archived:false,disabled});
 await setDoc(doc(c.firestore(),'financeBills','bill'),{familyId:'one',sharedWith:['child'],archived:false});
});});
after(async()=>env?.cleanup());
test('exact finance release restricts bills by family, explicit sharing and active status; all writes are server-owned',async()=>{
 for(const uid of ['parent','child'])await assertSucceeds(getDoc(doc(env.authenticatedContext(uid).firestore(),'financeBills','bill')));
 for(const uid of ['sibling','foreign','disabled'])await assertFails(getDoc(doc(env.authenticatedContext(uid).firestore(),'financeBills','bill')));
 const db=env.authenticatedContext('parent').firestore();await assertFails(updateDoc(doc(db,'financeBills','bill'),{status:'paid'}));await assertFails(setDoc(doc(db,'financeBillAudit','forged'),{kind:'paid'}));
});
