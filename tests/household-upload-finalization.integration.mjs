import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { sanitizePresentationImage } from '../server/presentation-images.mjs';
import { finalizeLegacyHealthFile } from '../server/legacy-health-files.mjs';

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_STORAGE_EMULATOR_HOST!=='127.0.0.1:9199')
  throw new Error('Explicit local demo Firestore/Storage emulators required.');
const projectId='demo-nasza-rodzina', bucketName=`${projectId}.appspot.com`;
const app=initializeApp({projectId,storageBucket:bucketName},'upload-isolation-tests');
const db=getFirestore(app), bucket=getStorage(app).bucket(bucketName);
const uid='upload-isolation-parent', familyId='upload-isolation-household';
const profile={role:'parent',name:'Sebastian',familyId,active:true,canLogin:true};
const context={app,db,bucket,uid,profile};
const png=Buffer.from([137,80,78,71,13,10,26,10]);
const created=[];
before(async()=>{await db.doc(`members/${uid}`).set(profile);});
after(async()=>{for(const path of created) await bucket.file(path).delete({ignoreNotFound:true});await db.doc(`members/${uid}`).delete();await deleteApp(app);});
for(const domain of ['product','health']) test(`real ${domain} finalization protects authenticated bytes and never accepts an emulator-retained token`,async()=>{
  const finalize=path=>domain==='product'?sanitizePresentationImage(context,path):finalizeLegacyHealthFile(context,path);
  for(const withToken of [false,true]) {
    const path=domain==='product'?`quick-products/${uid}/fixture-${withToken}.png`:`health/parents/Sebastian/${uid}/fixture-${withToken}.png`;
    created.push(path);
    await bucket.file(path).save(png,{resumable:false,metadata:{contentType:'image/png',metadata:withToken?{firebaseStorageDownloadTokens:'synthetic-local-upload-token'}:{}}});
    const [before]=await bucket.file(path).getMetadata();
    if(withToken) {
      // firebase-tools keeps a separate additive token list, unlike GCS null
      // metadata deletion. Prove that this limitation fails closed in our API.
      await assert.rejects(finalize(path),{code:domain==='product'?'STORAGE_IMAGE_NOT_READY':'STORAGE_HEALTH_FILE_NOT_READY'});
      continue;
    }
    const result=await finalize(path);assert.equal(result.path,path);assert.equal(result.familyId,familyId);
    const [after]=await bucket.file(path).getMetadata();
    assert.equal(after.metadata.firebaseStorageDownloadTokens,undefined);assert.equal(after.metadata.familyId,familyId);
    assert.equal(String(after.generation),String(before.generation));assert.notEqual(String(after.metageneration),String(before.metageneration));
    assert.deepEqual((await bucket.file(path).download())[0],png);
    const response=await fetch(`http://127.0.0.1:9199/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=synthetic-local-upload-token`);
    assert.equal(response.ok,false,'No bearer token downloads the authenticated object');
  }
});
test('real Storage metageneration precondition refuses stale metadata writes without resurrecting a download token',
  {todo:'firebase-tools Storage GCS PATCH ignores generation/metageneration preconditions; SDK transport conditions are tested separately.'},async()=>{
  const path=`quick-products/${uid}/stale.png`;created.push(path);
  await bucket.file(path).save(png,{resumable:false,metadata:{contentType:'image/png',metadata:{familyId}}});
  const [metadata]=await bucket.file(path).getMetadata();
  await bucket.file(path).setMetadata({cacheControl:'private,no-store'});
  await assert.rejects(bucket.file(path,{generation:metadata.generation}).setMetadata({metadata:{firebaseStorageDownloadTokens:'synthetic-stale-token'}},
    {ifGenerationMatch:metadata.generation,ifMetagenerationMatch:metadata.metageneration}));
  assert.equal((await bucket.file(path).getMetadata())[0].metadata.firebaseStorageDownloadTokens,undefined);
});
