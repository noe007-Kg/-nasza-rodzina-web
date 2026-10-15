import test from 'node:test';
import assert from 'node:assert/strict';
import { Storage } from '@google-cloud/storage';

test('the real GCS SDK serializes both object-version preconditions without executing a network request', async()=>{
  const storage=new Storage({projectId:'demo-storage-transport'});
  const bucket=storage.bucket('demo-storage-transport.appspot.com');
  const requests=[];
  bucket.request=(options,callback)=>{requests.push(options);callback(null,{generation:'7',metageneration:'4',metadata:{familyId:'family-test'}});};
  await bucket.file('quick-products/synthetic/image.png',{generation:'7'}).setMetadata({metadata:{firebaseStorageDownloadTokens:null,familyId:'family-test'}},
    {ifGenerationMatch:'7',ifMetagenerationMatch:'3'});
  assert.equal(requests.length,1);assert.equal(requests[0].method,'PATCH');
  assert.equal(String(requests[0].qs.ifGenerationMatch),'7');assert.equal(String(requests[0].qs.ifMetagenerationMatch),'3');
  assert.equal(String(requests[0].qs.generation),'7');assert.equal(requests[0].json.metadata.firebaseStorageDownloadTokens,null);
});
