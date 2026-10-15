import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import { prepareHouseholdOwnerReview } from '../scripts/lib/household-owner-review.mjs';
import { buildHouseholdIsolationPlan } from '../scripts/lib/household-isolation-plan.mjs';
import { HOUSEHOLD_FIELDS,STORAGE_PREFIXES } from '../scripts/lib/household-migration-inventory.mjs';
import { parseOwnerReviewArguments,runOwnerReview,renderOwnerReview,renderReviewProposal,askOwnerReview,readOwnerReviewTokens,classifyOwnerWarnings } from '../scripts/review-household-migration.mjs';
import { writePrivateFile } from '../scripts/lib/household-private-files.mjs';
import {sealHouseholdBackup,canonicalJson,backupDigest} from '../scripts/lib/household-backup-archive.mjs';

function fixture({realistic=false}={}) {
  const config={schemaVersion:1,projectId:'demo-household-review',bucket:'demo-household-review.appspot.com',householdConfirmed:true,
    familyId:'family-synthetic-review',reviewedRecordPaths:[],members:Array.from({length:5},(_,i)=>({uid:`review-test-${i}`,
      expectedName:`Synthetic ${i}`,expectedRole:i<2?'parent':'child',expectedCanLogin:i<4,expectedPersonKey:`person-${i}`}))};
  const collections=Object.fromEntries(Object.keys(HOUSEHOLD_FIELDS).map(name=>[name,[]]));
  const add=(name,id,data)=>{const row={id,path:`${name}/${id}`,data,updateTime:{seconds:'1792044000',nanoseconds:123456789}};collections[name].push(row);return row;};
  for(const member of config.members) {
    add('members',member.uid,{name:member.expectedName,role:member.expectedRole,canLogin:member.expectedCanLogin,personKey:member.expectedPersonKey,active:true});
    collections[`notificationInbox/${member.uid}/items`]=[];
  }
  add('familySettings','profile',{});
  if(realistic) {
    for(let i=0;i<179;i++)add('schoolItems',`school-${i}`,{createdBy:'review-test-0',person:'person-3'});
    for(let i=0;i<28;i++)add('schoolParentMessages',`mail-${i}`,{createdBy:'review-test-1',person:'person-3'});
    for(let i=0;i<4;i++)add('calendarEvents',`event-${i}`,{createdBy:'review-test-0',person:`person-${i}`,...(i===0?{ownerUid:'review-test-0',private:false}:{})});
    for(let i=0;i<4;i++)add('tasks',`task-${i}`,{createdBy:'review-test-0',person:'person-3'});
    for(let i=0;i<2;i++)add('healthRecords',`record-${i}`,{createdBy:'review-test-1',person:'person-3'});
  }
  const inventory={schemaVersion:1,source:'firebase-admin-read-only',projectId:config.projectId,bucket:config.bucket,
    collections,auth:config.members.map(member=>({uid:member.uid,exists:member.expectedCanLogin,disabled:false})),storage:[],
    coverage:{complete:true,missingCollections:[],authVerified:true,collections:Object.keys(collections),storagePrefixes:[...STORAGE_PREFIXES]}};
  const plan=()=>buildHouseholdIsolationPlan(config,inventory,{familyId:config.familyId,now:new Date('2026-10-15T07:00:00Z')});
  return {config,inventory,add,plan,review:(source=plan(),decisions)=>prepareHouseholdOwnerReview(config,source,inventory,decisions)};
}
const approve=request=>({...structuredClone(request),householdReviewed:true,records:request.records.map(row=>({...row,decision:'approve'}))});

test('the production-shaped synthetic manifest verifies 236 field changes without treating names as independent proof',()=>{
  const f=fixture({realistic:true}),review=f.review();
  assert.equal(review.summary.currentCounts.fieldChanges,236);
  assert.deepEqual(review.summary.currentCounts.fields,{familyId:222,ownerProfileId:4,ownerUid:3,private:3,visibility:4});
  assert.deepEqual(review.summary.currentCounts.collections,{calendarEvents:18,healthRecords:2,members:5,schoolItems:179,schoolParentMessages:28,tasks:4});
  assert.equal(review.summary.automaticallyVerifiedDocuments,222);
  assert.deepEqual(review.summary.assignments.find(row=>row.collection==='schoolItems').subjectProfiles,['Profil 4']);
  assert.equal(review.summary.ambiguous.length,1);assert.equal(review.summary.ambiguous[0].collection,'familySettings');
  assert.equal(review.summary.householdConfirmed,false);assert.equal(review.reviewedConfig,null);
  assert.equal(review.plan.canApply,false);assert.equal(review.plan.writesPerformed,0);
});
test('only an explicit bound decision plus household confirmation prepares a separate reviewed configuration',()=>{
  const f=fixture(),source=f.plan(),first=f.review(source),original=structuredClone(f.config);
  const accepted=approve(first.request),review=f.review(source,accepted);
  assert.deepEqual(review.reviewedConfig.reviewedRecordPaths,['familySettings/profile']);
  assert.deepEqual(f.config,original);assert.deepEqual(review.plan.blockers,[]);
  assert.equal(review.plan.changes.length,6);assert.equal(review.summary.unresolvedPresentationCount,0);
  assert.equal(review.summary.automaticallyVerifiedDocuments,5);
  assert.deepEqual(review.reviewedConfig.reviewedRecordVersions,[{path:'familySettings/profile',updateTime:f.inventory.collections.familySettings[0].updateTime}]);
  accepted.householdReviewed=false;assert.equal(f.review(source,accepted).reviewedConfig,null);
  assert.ok(f.review(source,accepted).plan.blockers.length);
});
test('a generated configuration cannot silently reuse presentation approval after the document changes',()=>{
  const f=fixture(),source=f.plan(),first=f.review(source),accepted=f.review(source,approve(first.request));
  const reviewedConfig=accepted.reviewedConfig;
  let checked=buildHouseholdIsolationPlan(reviewedConfig,f.inventory,{familyId:f.config.familyId});
  assert.deepEqual(checked.blockers,[]);
  f.inventory.collections.familySettings[0].updateTime.nanoseconds++;
  checked=buildHouseholdIsolationPlan(reviewedConfig,f.inventory,{familyId:f.config.familyId});
  assert.ok(checked.blockers.some(row=>row.code==='REVIEWED_RECORD_VERSION_CHANGED'));
  const renewed=prepareHouseholdOwnerReview(reviewedConfig,source,f.inventory);
  assert.equal(renewed.request.records.length,1);assert.equal(renewed.reviewedConfig,null);
});
test('legacy presentation paths without a version receipt need explicit confirmation again',()=>{
  const f=fixture();f.config.reviewedRecordPaths=['familySettings/profile'];
  const r=f.review();assert.equal(r.request.records.length,1);
  assert.equal(r.summary.unresolvedPresentationCount,1);assert.equal(r.reviewedConfig,null);
});
test('pending and rejected records remain blocking rather than disappearing from the migration plan',()=>{
  for(const decision of ['pending','reject']) {
    const f=fixture(),source=f.plan(),decisions=approve(f.review(source).request);decisions.records[0].decision=decision;
    const review=f.review(source,decisions);
    assert.equal(review.summary.unresolvedPresentationCount,1);
    assert.ok(review.plan.blockers.some(row=>row.code==='ISOLATION_PRESENTATION_OWNER_REVIEW_REQUIRED'));
  }
});
test('stale versions, changed UID map and forged or added approval paths are refused',()=>{
  const mutators=[(f,d)=>{f.inventory.collections.familySettings[0].updateTime.nanoseconds++;},
    (f,d)=>{d.records[0].path='medicalContacts/arbitrary';},(f,d)=>{d.records.push({...d.records[0],reviewId:'R999'});},
    (f,d)=>{d.records[0].decision='skip';},(f,d)=>{d.householdReviewed='true';},
    (f,d)=>{f.config.members[0].uid='foreign-same-name';},(f,d)=>{d.extra=true;}];
  for(const mutate of mutators) {
    const f=fixture(),source=f.plan(),decisions=approve(f.review(source).request);mutate(f,decisions);
    assert.throws(()=>f.review(source,decisions),{code:'OWNER_DECISION_STALE_OR_INVALID'});
  }
});
test('foreign creator, ambiguous person and existing foreign family can never become owner-confirmable candidates',()=>{
  for(const value of [{createdBy:'foreign-user'}, {familyId:'foreign-family'}, {person:'foreign-person'},
    {createdBy:'review-test-0',familyId:'foreign-family'}]) {
    const f=fixture();f.add('medicalContacts','unsafe',value);const review=f.review();
    assert.ok(!review.request.records.some(row=>row.path==='medicalContacts/unsafe'));
    assert.ok(review.plan.blockers.some(row=>row.path==='medicalContacts/unsafe'));
    const accepted=approve(review.request),checked=f.review(f.plan(),accepted);
    assert.ok(checked.plan.blockers.some(row=>row.path==='medicalContacts/unsafe'));
  }
});
test('same name on a different UID, disabled account and another household remain blockers',()=>{
  const changes=[f=>{f.inventory.collections.members[2].id='other-user';f.inventory.collections.members[2].path='members/other-user';},
    f=>{f.inventory.auth[0].disabled=true;},f=>{f.inventory.collections.members[1].data.familyId='other-household';},
    f=>{f.add('members','foreign-member',{name:'Synthetic 3',personKey:'person-3',active:true,role:'child'});}];
  for(const mutate of changes){const f=fixture();mutate(f);const r=f.review();assert.ok(r.plan.blockers.length>1);assert.equal(r.plan.canApply,false);}
});
test('a refreshed inventory is distinguished from the old report and all approval digests are renewed',()=>{
  const f=fixture(),source=f.plan(),initial=f.review(source);
  f.add('tasks','new-task',{createdBy:'review-test-0',person:'person-3'});
  const refreshed=f.review(source);assert.equal(refreshed.summary.sourceReportCurrent,false);
  assert.notEqual(refreshed.request.reviewDigest,initial.request.reviewDigest);
  assert.throws(()=>f.review(source,approve(initial.request)),{code:'OWNER_DECISION_STALE_OR_INVALID'});
});
test('the private source manifest cannot propose new fields, another project/family or foreign owner UID',()=>{
  const changes=[p=>{p.projectId='foreign-project';},p=>{p.familyId='__legacy__';},p=>{p.canApply=true;},p=>{p.writesPerformed=1;},
    p=>{p.changes[0].field='points';},p=>{p.changes[0].after.value='another-household';},
    p=>{p.changes.push({...p.changes[0],field:'ownerUid',after:{present:true,value:'foreign-user'}});}];
  for(const mutate of changes){const f=fixture(),p=f.plan();mutate(p);assert.throws(()=>f.review(p));}
});
test('safe summaries omit real UIDs, names, paths, medical contents and token strings',()=>{
  const f=fixture();f.add('medicalContacts','private-identifier',{notes:'POISON_MEDICAL_TEXT',secret:'POISON_TOKEN'});
  const summary=f.review().summary,text=JSON.stringify(summary);
  for(const secret of ['POISON_MEDICAL_TEXT','POISON_TOKEN','private-identifier','review-test-0','Synthetic 0','familySettings/profile'])assert.ok(!text.includes(secret));
  for(const secret of ['POISON_MEDICAL_TEXT','POISON_TOKEN','private-identifier','review-test-0'])assert.ok(!renderReviewProposal(summary).includes(secret));
});
test('interactive answers have no default approval and only exact confirmations count',async()=>{
  const f=fixture(),r=f.review();let asked=0;
  const no=await askOwnerReview(r.request,r.summary,async()=>{asked++;return '';});assert.equal(asked,1);assert.equal(no.householdReviewed,false);
  const answers=['POTWIERDZAM',''];const pending=await askOwnerReview(r.request,r.summary,async()=>answers.shift());
  assert.equal(pending.householdReviewed,true);assert.equal(pending.records[0].decision,'pending');
  const yes=['POTWIERDZAM','TAK'];assert.equal((await askOwnerReview(r.request,r.summary,async()=>yes.shift())).records[0].decision,'approve');
});
test('the CLI refuses apply/deploy/delete/skip flags and mutually exclusive decision modes',()=>{
  for(const flag of ['--apply','--migrate','--delete','--deploy','--skip-backup','--skip-rules'])assert.throws(()=>parseOwnerReviewArguments([flag]));
  assert.throws(()=>parseOwnerReviewArguments(['--config','a','--preflight','b','--output','c','--interactive','--decisions','d']));
  assert.equal(parseOwnerReviewArguments(['--help']).help,true);
});
test('a real local CLI workflow retains the blocker, creates no fake backup and writes only private artifacts',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'owner-review-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const f=fixture(),configFile=path.join(dir,'config.private.json'),sourceFile=path.join(dir,'plan.private.json');
  await writePrivateFile(configFile,JSON.stringify(f.config));await writePrivateFile(sourceFile,JSON.stringify(f.plan()));
  const source={inventory:f.inventory,rules:{},locations:{},tokens:{scanVerified:true,privateTokenCount:0,productTokenCount:0}};
  let restores=0;
  const deps={readSource:async()=>source,restore:async()=>{restores++;throw Error('MUST_NOT_RESTORE_A_MISSING_ARCHIVE');}};
  const output=path.join(dir,'first'),r=await runOwnerReview({config:configFile,preflight:sourceFile,output},deps);
  assert.equal(restores,0);assert.equal(r.backupCheck.verified,false);assert.ok(r.readiness.blockers.includes('FULL_BACKUP_NOT_VERIFIED'));
  assert.ok(r.readiness.blockers.includes('OWNER_HOUSEHOLD_REVIEW_REQUIRED'));assert.equal(r.productionWritesPerformed,0);
  assert.ok(!r.readiness.blockers.includes('PRIVATE_DOWNLOAD_TOKENS_REQUIRE_REVIEW'));
  const template=JSON.parse(await readFile(path.join(output,'decisions-template.private.json')));
  const decisionsFile=path.join(dir,'approved.private.json');await writePrivateFile(decisionsFile,JSON.stringify(approve(template)));
  const second=path.join(dir,'second'),confirmed=await runOwnerReview({config:configFile,preflight:sourceFile,output:second,decisions:decisionsFile},deps);
  assert.equal(confirmed.summary.unresolvedPresentationCount,0);assert.equal(confirmed.readiness.status,'blocked');
  const next=JSON.parse(await readFile(path.join(second,'reviewed-config.private.json')));
  assert.deepEqual(next.reviewedRecordPaths,['familySettings/profile']);
  assert.ok((await readFile(path.join(second,'report.md'),'utf8')).includes('npm run household:preflight'));
  for(const file of ['review-summary.json','candidate-plan.private.json','decisions-template.private.json','report.md'])
    assert.equal((await stat(path.join(second,file))).mode&0o777,0o600);
  await chmod(configFile,0o644);await assert.rejects(runOwnerReview({config:configFile,preflight:sourceFile,output:path.join(dir,'bad')},deps),{code:'PRIVATE_FILE_PERMISSIONS_REQUIRED'});
});
test('token metadata scans paginate, discard token values, and fail closed on 403/404 or incomplete scans',async()=>{
  let reads=0;
  const result=await readOwnerReviewTokens({getFiles:async options=>{
    reads++;assert.ok(options.fields.includes('firebaseStorageDownloadTokens'));
    return reads===1?[[{name:'health/private.pdf',generation:'1',metadata:{firebaseStorageDownloadTokens:'POISON_TOKEN'}}],{pageToken:'next'}]
      :[[{name:'quick-products/u/p.png',generation:'2',metadata:{firebaseStorageDownloadTokens:'OTHER_POISON'}}],null];
  }});
  assert.deepEqual(result,{scanVerified:true,privateTokenCount:1,productTokenCount:1});assert.ok(!JSON.stringify(result).includes('POISON'));
  for(const code of [403,404]) {
    const failed=await readOwnerReviewTokens({getFiles:async()=>{throw Object.assign(Error('PRIVATE_REMOTE_ERROR'),{code});}});
    assert.equal(failed.scanVerified,false);assert.equal(failed.privateTokenCount,null);assert.ok(!JSON.stringify(failed).includes('PRIVATE_REMOTE_ERROR'));
  }
  let pages=0;
  const cycle=await readOwnerReviewTokens({getFiles:async()=>{pages++;return [[],{pageToken:pages%2?'a':'b'}];}});
  assert.equal(cycle.scanVerified,false);assert.equal(pages,3);
});
test('CLI rechecks real encrypted archive bytes before invoking restore and never serializes provider contents',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'owner-review-archive-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const f=fixture();f.inventory.collections.familySettings=[];
  const seconds=String(Math.floor(Date.now()/1000)-10),time=new Date(Number(seconds)*1000).toISOString();
  for(const row of f.inventory.collections.members)row.updateTime={seconds,nanoseconds:0};
  const plan=f.plan(),root=`projects/${f.config.projectId}/databases/(default)/documents/`;
  const documents=f.inventory.collections.members.map(row=>({name:root+row.path,createTime:time,updateTime:time,
    fields:Object.fromEntries(Object.entries(row.data).map(([key,value])=>[key,typeof value==='boolean'?{booleanValue:value}:{stringValue:value}]))}));
  documents.push({name:root+'_eduConnections/opaque-provider',createTime:time,updateTime:time,
    fields:{ciphertext:{stringValue:'POISON_ENCRYPTED_PROVIDER'},nestedMedical:{stringValue:'POISON_PRIVATE_MEDICAL_CONTENT'}}});
  const hash=value=>backupDigest(canonicalJson(value));
  const payload={schemaVersion:1,createdAt:new Date().toISOString(),projectId:f.config.projectId,bucket:f.config.bucket,
    documents,objects:[],externalFiles:[],references:[],auth:f.inventory.auth,config:f.config,plan,
    consistency:{firestore:{stable:true},storage:{stable:true},auth:{stable:true}},
    manifest:{captureComplete:true,firestoreComplete:true,storageComplete:true,planBoundToBackup:true,
      documentCount:documents.length,objectCount:0,externalReferenceCount:0,documentsSha256:hash(documents),objectsSha256:hash([]),
      authScope:'five-profile-metadata-only',objectScope:'current-live-selected-bucket-objects',archivedObjectVersionsIncluded:false,secretManagerKeysIncluded:false},
    evidence:{planDigest:hash(plan)}};
  const key=randomBytes(32),archive=sealHouseholdBackup(payload,key),configFile=path.join(dir,'config.private.json');
  await writePrivateFile(configFile,JSON.stringify(f.config));await writePrivateFile(path.join(dir,'plan.private.json'),JSON.stringify(plan));
  await writePrivateFile(path.join(dir,'backup.key'),key);await writePrivateFile(path.join(dir,'household-backup.nrb'),archive);
  const secondCopy=path.join(dir,'second.nrb');await writePrivateFile(secondCopy,archive);
  let executions=0;
  const r=await runOwnerReview({config:configFile,preflight:dir,output:path.join(dir,'out'),'second-copy':secondCopy},{
    readSource:async()=>({inventory:f.inventory,rules:{},locations:{},tokens:{scanVerified:true,privateTokenCount:0,productTokenCount:0}}),
    restore:async(output,archiveFile,keyFile,verified)=>{
      executions++;assert.deepEqual(verified,payload);assert.equal(archiveFile,path.join(dir,'household-backup.nrb'));
      assert.equal(keyFile,path.join(dir,'backup.key'));
      return {verified:true,safetyVerified:true,emulatorExitCode:0,sourceProjectId:f.config.projectId,targetProjectId:'demo-household-restore-12345678',
        archiveDigestSha256:backupDigest(archive),rollback:{verified:true,concurrentChangeRejected:true,postApplyReceiptIsDemoOnly:true}};
    }});
  assert.equal(executions,1);assert.equal(r.backupCheck.verified,true);
  assert.equal(r.readiness.checks.find(row=>row.id==='restore').status,'verified');
  assert.equal(r.secondCopyBytesMatch,true);assert.equal(r.independentBackupLocationVerified,false);
  assert.ok(r.readiness.blockers.includes('CAPTURE_CHANGED_OR_NOT_RECHECKED'));
  assert.ok(r.readiness.blockers.includes('SECOND_BACKUP_COPY_AND_SEPARATE_KEY_NOT_VERIFIED'));
  const report=await readFile(path.join(dir,'out','review-summary.json'),'utf8');
  assert.ok(!report.includes('POISON_ENCRYPTED_PROVIDER'));assert.ok(!report.includes('POISON_PRIVATE_MEDICAL_CONTENT'));
  assert.equal(Object.hasOwn(r.backupCheck,'payload'),false);assert.equal(r.canApply,false);
});
test('the human report never says restore PASS when emulator exit/source/archive safety gates fail',()=>{
  const f=fixture(),summary=f.review().summary;
  const text=renderOwnerReview({summary,readiness:{blockers:['RESTORE_NOT_VERIFIED'],checks:[{id:'restore',status:'missing-or-failed'}]},
    backupCheck:{backup:{},codes:[]},restore:{verified:true,emulatorExitCode:1}});
  assert.ok(text.includes('Ponownie wykonane odtworzenie: NIE ZWERYFIKOWANO'));
  assert.ok(!text.includes('PASS (wyłącznie lokalne demo)'));
});
test('warnings are classified by actual evidence, not their presence or original count',()=>{
  const summary={warnings:{OPERATOR_ATTESTATION_IS_NOT_INDEPENDENT_HOUSEHOLD_PROOF:1,
    STORAGE_DOWNLOAD_TOKEN_REVOCATION_NOT_PERFORMED:1,LEGACY_NON_FINANCIAL_RULES_ARE_NOT_FULL_MULTI_HOUSEHOLD_ISOLATION:1,
    FULL_DOCUMENT_AND_BINARY_BACKUP_NOT_CAPTURED:1}};
  const rows=classifyOwnerWarnings(summary,{checks:[{id:'household-confirmation',status:'verified'},
    {id:'private-download-tokens',status:'verified'},{id:'household-isolation',status:'missing-or-failed'},
    {id:'complete-backup',status:'verified'},{id:'restore',status:'missing-or-failed'}]});
  assert.deepEqual(rows.map(row=>row.blocking),[false,false,true,true]);
  assert.ok(rows[0].note.includes('niezależnym'));
});
