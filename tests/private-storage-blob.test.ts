import assert from 'node:assert/strict';
import {test} from 'node:test';
import {typedPrivateBlob} from '../src/private-storage-blob';

test('bounded Firebase blobs regain their authorized image MIME without changing original bytes',async()=>{
  for(const type of ['image/png','image/jpeg','image/webp','image/gif']) {
    const original=new Blob([new Uint8Array([1,2,3,4])]);
    const result=typedPrivateBlob(original,{size:4,contentType:type},10);
    assert.equal(original.type,'');assert.equal(result.type,type);
    assert.deepEqual(await result.arrayBuffer(),await original.arrayBuffer());
  }
});
test('PDF bytes retain the original format only in the medical viewer',async()=>{
  const pdf=new Blob(['%PDF-1.7 synthetic']);
  assert.throws(()=>typedPrivateBlob(pdf,{size:pdf.size,contentType:'application/pdf'},100));
  const result=typedPrivateBlob(pdf,{size:pdf.size,contentType:'application/pdf'},100,true);
  assert.equal(result.type,'application/pdf');assert.equal(await result.text(),await pdf.text());
});
test('truncated, empty, oversized and executable previews are refused',()=>{
  const blob=new Blob(['abc']);
  for(const metadata of [{size:4,contentType:'image/png'},{size:0,contentType:'image/png'},
    {size:11,contentType:'image/png'},{size:3,contentType:'text/html'},{size:3,contentType:'image/svg+xml'}]) {
    assert.throws(()=>typedPrivateBlob(blob,metadata,10,true));
  }
});
