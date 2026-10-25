import {test} from 'node:test';
import assert from 'node:assert/strict';
import {manageHealthAction} from '../server/health-service.mjs';
import {familyMemoryContext,fixtureParent} from './family-v2-test-helpers.mjs';
test('shared copies have exactly the selected three editors/readers, require explicit extra sharing, and never grant legal authority',async()=>{
 const old=process.env.HEALTH_SHARED_COPY_FOLDER;
 process.env.HEALTH_SHARED_COPY_FOLDER=JSON.stringify({familyId:'fixture-family',ownerProfileId:'adult',memberUids:['parent','second-parent','adult']});
 try{
 const c=familyMemoryContext({'members/second-parent':{...fixtureParent,name:'Other parent'}});
 const metadata={title:'Copy',documentType:'court_document',issuedOn:'',expiresOn:'',indefinite:true,number:'',note:'',pinned:false,shareOwner:false};
 const ticket=await manageHealthAction(c,{operation:'prepare',ownerProfileId:'adult',copyFolder:true,metadata,mimeType:'application/pdf',size:10,fileName:'copy.pdf'});
 const path='healthDocuments/'+ticket.documentId;const row=c.rows.get(path);
 assert.deepEqual(row.readers,['parent','second-parent','adult']);assert.deepEqual(row.editors,row.readers);assert.equal(row.pinned,true);assert.equal(row.accessScope,'shared-copies');assert.equal(c.rows.has('healthDocumentGrants/adult'),false);
 await assert.rejects(manageHealthAction(c.as('child'),{operation:'prepare',ownerProfileId:'adult',copyFolder:true,metadata,mimeType:'application/pdf',size:10,fileName:'copy.pdf'}));
 await assert.rejects(manageHealthAction(c,{operation:'prepare',ownerProfileId:'adult',metadata,mimeType:'application/pdf',size:10,fileName:'copy.pdf'}));
 c.rows.set(path,{...row,state:'ready'});
 await manageHealthAction(c,{operation:'share-copy',documentId:ticket.documentId,readerUids:['child']});assert.deepEqual(c.rows.get(path).readers,['parent','second-parent','adult','child']);
 await assert.rejects(manageHealthAction(c.as('child'),{operation:'share-copy',documentId:ticket.documentId,readerUids:[]}));
 await manageHealthAction(c.as('adult'),{operation:'share-copy',documentId:ticket.documentId,readerUids:[]});assert.deepEqual(c.rows.get(path).readers,['parent','second-parent','adult']);
 c.rows.set('members/second-parent',{...fixtureParent,disabled:true});await assert.rejects(manageHealthAction(c,{operation:'share-copy',documentId:ticket.documentId,readerUids:[]}));
 }finally{if(old===undefined)delete process.env.HEALTH_SHARED_COPY_FOLDER;else process.env.HEALTH_SHARED_COPY_FOLDER=old;}
});
