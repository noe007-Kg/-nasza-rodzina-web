import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,getDoc,Timestamp} from 'firebase/firestore';
import {ref,uploadBytes,getMetadata,deleteObject} from 'firebase/storage';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_STORAGE_EMULATOR_HOST!=='127.0.0.1:9199')throw Error('LOCAL_DEMO_EMULATORS_REQUIRED');
const projectId='demo-nasza-rodzina';let env;
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
const db=uid=>env.authenticatedContext(uid).firestore();
const storage=(uid,bucket)=>env.authenticatedContext(uid).storage(`gs://${bucket}`);
const proofBucket='nasza-rodzina-task-proofs';
const rewardBucket='nasza-rodzina.firebasestorage.app';
const source=async name=>readFile(new URL('../deploy/package-a/'+name,import.meta.url),'utf8');
before(async()=>{
 env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080,rules:await source('firestore.rules')},storage:{host:'127.0.0.1',port:9199,rules:await source('storage-proofs.rules')}});
});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{
 for(const [uid,role,familyId,personKey] of [['parent','parent','one','parent-person'],['child','child','one','Nikodem'],['sibling','child','one','Paweł'],['foreign','parent','two','foreign']])await setDoc(doc(c.firestore(),'members',uid),{name:uid,role,familyId,personKey,active:true,canLogin:true,archived:false});
 await setDoc(doc(c.firestore(),'tasks','task'),{person:'Nikodem',points:5,done:false,approvalStatus:'pending'});
});});
test('release denies direct task, points and ticket writes including the parent',async()=>{
 for(const uid of ['parent','child']){
  await assertSucceeds(getDoc(doc(db(uid),'tasks','task')));
  await assertFails(updateDoc(doc(db(uid),'tasks','task'),{done:true}));
  for(const name of ['taskPointLedger','taskPointBalances','taskRewards','_taskPhotoUploads','_taskPhotoCleanup'])await assertFails(setDoc(doc(db(uid),name,'forged'),{balance:999}));
 }
});
test('exact release proof rules revoke access before physical deletion and reject foreign family',async()=>{
 const id=randomUUID(),path=`taskProof/task/child/${id}.png`;
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'_taskPhotoUploads',id),{taskId:'task',uid:'child',person:'Nikodem',familyId:'one',state:'open',path,size:8,contentType:'image/png',expiresAt:Timestamp.fromMillis(Date.now()+60000)}));
 await assertSucceeds(uploadBytes(ref(storage('child',proofBucket),path),png,{contentType:'image/png'}));
 await assertSucceeds(getMetadata(ref(storage('parent',proofBucket),path)));
 for(const uid of ['sibling','foreign'])await assertFails(getMetadata(ref(storage(uid,proofBucket),path)));
 await assertFails(deleteObject(ref(storage('child',proofBucket),path)));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'_taskPhotoUploads',id),{state:'revoked'}));
 for(const uid of ['child','parent'])await assertFails(getMetadata(ref(storage(uid,proofBucket),path)));
});
test('default bucket release permits only authorized reward images; health and proofs remain denied',async()=>{
 // Load the second exact production Storage artifact for this isolated test.
 await env.cleanup();
 env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080,rules:await source('firestore.rules')},storage:{host:'127.0.0.1',port:9199,rules:await source('storage-default.rules')}});
 const id=randomUUID(),path=`taskRewardImages/reward/parent/${id}.png`;
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'_taskRewardImageUploads',id),{rewardId:'reward',uid:'parent',familyId:'one',state:'open',path,size:8,contentType:'image/png',expiresAt:Timestamp.fromMillis(Date.now()+60000),active:true,people:['Nikodem']}));
 await assertSucceeds(uploadBytes(ref(storage('parent',rewardBucket),path),png,{contentType:'image/png'}));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'_taskRewardImageUploads',id),{state:'attached'}));
 await assertSucceeds(getMetadata(ref(storage('child',rewardBucket),path)));
 await assertFails(getMetadata(ref(storage('foreign',rewardBucket),path)));
 await assertFails(uploadBytes(ref(storage('parent',rewardBucket),'health/file.png'),png,{contentType:'image/png'}));
 assert.equal((await getDoc(doc(db('parent'),'tasks','task'))).data().done,false);
});
