import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat,link} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {DIAGNOSTIC_CATALOG,buildHouseholdDiagnosticSummary,renderHouseholdDiagnostics,sourceDiagnosticCodes} from '../scripts/lib/household-diagnostics.mjs';
import {runHouseholdDiagnostics,parseDiagnosticArguments,confirmedHouseholdStillValid,compareDiagnosticArchives} from '../scripts/diagnose-household-migration.mjs';
import {projectHouseholdDiagnosticEvidence} from '../scripts/lib/household-diagnostic-evidence.mjs';
import {assessHouseholdReadiness} from '../scripts/lib/household-readiness-policy.mjs';
import {buildHouseholdIsolationPlan} from '../scripts/lib/household-isolation-plan.mjs';
import {HOUSEHOLD_FIELDS,STORAGE_PREFIXES} from '../scripts/lib/household-migration-inventory.mjs';
import {writePrivateFile,readPrivateJson} from '../scripts/lib/household-private-files.mjs';
import {backupDigest,canonicalJson} from '../scripts/lib/household-backup-archive.mjs';

const hash=value=>backupDigest(canonicalJson(value)),H='a'.repeat(64);
const previous=()=>({summary:{currentCounts:{fieldChanges:236}},readiness:{blockers:Object.keys(DIAGNOSTIC_CATALOG)
  .filter(code=>!['PRIMARY_DATA_EU_LOCATION_NOT_VERIFIED','PRIVATE_DOWNLOAD_TOKENS_REQUIRE_REVIEW'].includes(code))}});
function fixture() {
  const config={schemaVersion:1,projectId:'demo-final-diagnostics',bucket:'demo-final-diagnostics.appspot.com',householdConfirmed:true,
    familyId:'family-diagnostic-test',reviewedRecordPaths:[],members:Array.from({length:5},(_,i)=>({uid:`diagnostic-person-${i}`,
      expectedName:`Synthetic ${i}`,expectedRole:i<2?'parent':'child',expectedCanLogin:i<4,expectedPersonKey:`person-${i}`}))};
  const collections=Object.fromEntries(Object.keys(HOUSEHOLD_FIELDS).map(key=>[key,[]]));
  const add=(name,id,data)=>{const row={id,path:`${name}/${id}`,data,updateTime:{seconds:'1792044000',nanoseconds:123456789}};collections[name].push(row);return row;};
  for(const member of config.members){add('members',member.uid,{name:member.expectedName,personKey:member.expectedPersonKey,role:member.expectedRole,
    active:true,canLogin:member.expectedCanLogin});collections[`notificationInbox/${member.uid}/items`]=[];}
  add('familySettings','profile',{});
  const inventory={schemaVersion:1,source:'firebase-admin-read-only',projectId:config.projectId,bucket:config.bucket,collections,
    auth:config.members.map(row=>({uid:row.uid,exists:row.expectedCanLogin,disabled:false})),storage:[],
    coverage:{complete:true,authVerified:true,missingCollections:[],collections:Object.keys(collections),storagePrefixes:[...STORAGE_PREFIXES]}};
  const rules=Object.fromEntries(['firestore','storage'].map(service=>[service,{verified:true,status:'matched',sha256:H,localSha256:H}]));
  const locations={firestore:{verified:true,europeanUnion:true},storage:{verified:true,europeanUnion:true}};
  return {config,inventory,rules,locations,tokens:{scanVerified:true,privateTokenCount:0,productTokenCount:0},
    plan:()=>buildHouseholdIsolationPlan(config,inventory,{familyId:config.familyId,now:new Date('2026-10-15T08:00:00Z')})};
}
async function setup(t) {
  const directory=await mkdtemp(path.join(tmpdir(),'household-diagnostic-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const f=fixture(),configFile=path.join(directory,'config.private.json');
  await writePrivateFile(configFile,JSON.stringify(f.config));await writePrivateFile(path.join(directory,'review-summary.json'),JSON.stringify(previous()));
  await writePrivateFile(path.join(directory,'candidate-plan.private.json'),JSON.stringify(f.plan()));
  return {...f,directory,configFile,options:{config:configFile,review:directory,output:path.join(directory,'result')}};
}
const environment=async()=>({node22:true,java21:true,restoreCliAvailable:true});
function callbackCapture(f,config) {
  const plan=buildHouseholdIsolationPlan(config,f.inventory,{familyId:config.familyId});
  const restore={verified:true,safetyVerified:true,emulatorExitCode:0,sourceProjectId:config.projectId,
    targetProjectId:'demo-household-restore-abcdef12',archiveDigestSha256:H,
    rollback:{verified:true,concurrentChangeRejected:true,postApplyReceiptIsDemoOnly:true}};
  return projectHouseholdDiagnosticEvidence({plan,inventory:f.inventory,planDigest:hash(plan),captureComplete:true,
    rules:f.rules,locations:f.locations,consistency:{firestore:{stable:true},storage:{stable:true},auth:{stable:true}},externalFiles:[],
    payload:{evidence:{tokens:f.tokens}}},
  {complete:true,manifestHashesVerified:true,archiveDigestSha256:H},restore);
}

test('all fourteen possible gates are covered and the actual twelve are read from the private report',()=>{
  assert.equal(Object.keys(DIAGNOSTIC_CATALOG).length,14);
  const p=previous(),codes=sourceDiagnosticCodes(p);assert.equal(codes.reportedCount,12);assert.equal(codes.known.length,12);
  const report=buildHouseholdDiagnosticSummary({previous:p,current:null});
  assert.equal(report.sourceBlockerCount,12);assert.equal(report.originalFieldChanges,236);
  assert.equal(report.checks.filter(row=>row.previouslyBlocked).length,12);assert.equal(report.readyForMigration,false);
});
test('historical booleans, malicious source strings and unknown codes never produce green checks or leak',()=>{
  const p=previous();p.readiness.checks=Object.values(DIAGNOSTIC_CATALOG).map(row=>({id:row.check,status:'verified'}));
  p.readiness.blockers.push('POISON_TOKEN_AND_PERSONAL_NAME');p.summary.currentCounts.fieldChanges='POISON_MEDICAL_CONTENT';
  const report=buildHouseholdDiagnosticSummary({previous:p,current:null});
  assert.equal(report.verifiedChecks,0);assert.equal(report.currentFieldChanges,null);
  assert.ok(report.checks.some(row=>row.code==='UNRECOGNIZED_BLOCKER_1'));
  assert.ok(!JSON.stringify(report).includes('POISON'));assert.ok(!renderHouseholdDiagnostics(report).includes('POISON'));
  assert.equal(sourceDiagnosticCodes({}).valid,false);
});
test('configuration differences, 403, non-EU location and actual tokens are distinguished from missing evidence',()=>{
  const f=fixture();f.rules.firestore={verified:false,status:'mismatch'};f.rules.storage={verified:false,status:'unavailable',httpStatus:403};
  f.locations.storage={verified:true,europeanUnion:false};f.tokens={scanVerified:true,privateTokenCount:1,productTokenCount:0};
  const report=buildHouseholdDiagnosticSummary({previous:previous(),source:f});
  const kind=code=>report.checks.find(row=>row.code===code).kind;
  assert.equal(kind('PRODUCTION_FIRESTORE_RULES_NOT_VERIFIED'),'confirmed-configuration-difference');
  assert.equal(kind('PRODUCTION_STORAGE_RULES_NOT_VERIFIED'),'missing-evidence');
  assert.equal(kind('PRIMARY_DATA_EU_LOCATION_NOT_VERIFIED'),'confirmed-non-eu-location');
  assert.equal(kind('PRIVATE_DOWNLOAD_TOKENS_REQUIRE_REVIEW'),'confirmed-token-presence');
});
test('a failed recheck is not presented as a positively observed data change',()=>{
  for(const checked of [false,true]) {
    const r=buildHouseholdDiagnosticSummary({previous:previous(),freshEvidence:{consistency:{firestore:{stable:false,checked}}}});
    assert.equal(r.checks.find(row=>row.code==='CAPTURE_CHANGED_OR_NOT_RECHECKED').kind,checked?'confirmed-concurrent-change':'missing-evidence');
  }
});
test('rollback cannot be marked verified if restore failed, exited nonzero, or belongs to another archive',()=>{
  for(const change of [{verified:false},{emulatorExitCode:1},{archiveDigestSha256:'b'.repeat(64)},{targetProjectId:'production-project'}]) {
    const evidence={plan:{projectId:'demo-source',canApply:false,writesPerformed:0,blockers:[]},backup:{complete:true,manifestHashesVerified:true,archiveDigestSha256:H},
      restore:{verified:true,safetyVerified:true,emulatorExitCode:0,sourceProjectId:'demo-source',targetProjectId:'demo-household-restore-abcdef',archiveDigestSha256:H,
        rollback:{verified:true,concurrentChangeRejected:true,postApplyReceiptIsDemoOnly:true},...change}};
    const result=assessHouseholdReadiness(evidence);
    assert.ok(result.blockers.includes('RESTORE_NOT_VERIFIED'));assert.ok(result.blockers.includes('ROLLBACK_REHEARSAL_NOT_VERIFIED'));
  }
});
test('one command keeps a pending or rejected R001 blocked and never starts a full capture without its decision',async t=>{
  for(const answer of ['', 'NIE']) {
    const f=await setup(t),answers=['POTWIERDZAM',answer];let captures=0;
    const r=await runHouseholdDiagnostics({...f.options,interactive:true},{environment,readSource:async()=>f,ask:async()=>answers.shift(),
      preflight:async()=>{captures++;throw Error('UNEXPECTED_CAPTURE');}});
    assert.equal(captures,0);assert.equal(r.remainingOwnerDecisions,1);assert.equal(r.fullPreflightAttempted,false);
    assert.equal(r.checks.find(row=>row.code==='PLAN_NOT_VERIFIED').kind,'owner-confirmation-required');
    assert.equal(r.productionWritesPerformed,0);assert.equal(r.canApply,false);
  }
});
test('owner approval leads to the existing full preflight in the same invocation, without inventing ownerUid',async t=>{
  const f=await setup(t),answers=['POTWIERDZAM','TAK'];let captures=0;
  const r=await runHouseholdDiagnostics({...f.options,interactive:true},{environment,readSource:async()=>f,ask:async()=>answers.shift(),
    preflight:async(options,{onEvidence})=>{
      captures++;const reviewed=await readPrivateJson(options.config);
      assert.deepEqual(reviewed.reviewedRecordPaths,['familySettings/profile']);
      assert.deepEqual(reviewed.reviewedRecordVersions,[{path:'familySettings/profile',updateTime:f.inventory.collections.familySettings[0].updateTime}]);
      const ctx=callbackCapture(f,reviewed);assert.ok(!ctx.plan.changes.some(row=>row.path==='familySettings/profile'&&row.field==='ownerUid'));
      await onEvidence(ctx,{verified:true});return {status:'blocked'};
    }});
  assert.equal(captures,1);assert.equal(r.remainingOwnerDecisions,0);assert.equal(r.currentFieldChanges,6);
  for(const code of ['FULL_BACKUP_NOT_VERIFIED','RESTORE_NOT_VERIFIED','ROLLBACK_REHEARSAL_NOT_VERIFIED','CAPTURE_CHANGED_OR_NOT_RECHECKED','EXTERNAL_FILES_NOT_FULLY_CAPTURED','OWNER_HOUSEHOLD_REVIEW_REQUIRED'])
    assert.equal(r.checks.find(row=>row.code===code).verified,true,code);
  for(const code of ['LEGACY_HOUSEHOLD_ISOLATION_NOT_VERIFIED','AUTH_AND_PROVIDER_KEY_RECOVERY_NOT_VERIFIED','SECOND_BACKUP_COPY_AND_SEPARATE_KEY_NOT_VERIFIED'])
    assert.equal(r.checks.find(row=>row.code===code).verified,false,code);
  assert.equal(r.readyForMigration,false);assert.equal(r.secretManagerValuesRead,false);
  const text=await readFile(path.join(f.options.output,'diagnostic-summary.json'),'utf8');
  for(const value of [f.config.projectId,f.config.familyId,'diagnostic-person-0','Synthetic 0','familySettings/profile'])assert.ok(!text.includes(value));
  assert.equal((await stat(path.join(f.options.output,'report.md'))).mode&0o777,0o600);
});
test('returned proof JSON is not trusted when no runtime evidence callback occurred',async t=>{
  const f=await setup(t),answers=['POTWIERDZAM','TAK'];
  const r=await runHouseholdDiagnostics({...f.options,interactive:true},{environment,readSource:async()=>f,ask:async()=>answers.shift(),
    preflight:async()=>({backup:{complete:true},restore:{verified:true},checks:[{id:'restore',status:'verified'}]})});
  assert.equal(r.executionFailure,true);assert.equal(r.checks.find(row=>row.code==='FULL_BACKUP_NOT_VERIFIED').verified,false);
  assert.equal(r.checks.find(row=>row.code==='RESTORE_NOT_VERIFIED').verified,false);
});
test('a changed reviewed document or changed profile identity cannot inherit confirmation into the new plan',async t=>{
  for(const mutate of [f=>{f.inventory.collections.familySettings[0].updateTime.nanoseconds++;},f=>{f.inventory.collections.members[0].data.role='child';}]) {
    const f=await setup(t),answers=['POTWIERDZAM','TAK'];
    const r=await runHouseholdDiagnostics({...f.options,interactive:true},{environment,readSource:async()=>f,ask:async()=>answers.shift(),
      preflight:async(options,{onEvidence})=>{
        const cfg=await readPrivateJson(options.config);mutate(f);const ctx=callbackCapture(f,cfg);
        assert.equal(confirmedHouseholdStillValid(cfg,ctx),false);await onEvidence(ctx,{});
      }});
    assert.equal(r.checks.find(row=>row.code==='OWNER_HOUSEHOLD_REVIEW_REQUIRED').verified,false);
    assert.equal(r.checks.find(row=>row.code==='PLAN_NOT_VERIFIED').verified,false);
  }
});
test('partial cloud failures still produce a final redacted report and never copy raw errors',async t=>{
  const f=await setup(t);
  const r=await runHouseholdDiagnostics(f.options,{environment,readSource:async()=>{throw Error('POISON_PRIVATE_REMOTE_ERROR');}});
  assert.equal(r.executionFailure,true);assert.equal(r.currentFieldChanges,null);
  assert.ok(!JSON.stringify(r).includes('POISON'));assert.ok((await readFile(path.join(f.options.output,'report.md'),'utf8')).includes('GOTOWE DO MIGRACJI: NIE'));
});
test('unavailable inventory retains independent live GET evidence but never verifies ownership or backup',async t=>{
  const f=await setup(t);let captures=0;
  const r=await runHouseholdDiagnostics(f.options,{environment,readSource:async()=>({...f,inventory:null}),
    preflight:async()=>{captures++;}});
  assert.equal(captures,0);assert.equal(r.executionFailure,true);assert.equal(r.currentFieldChanges,null);
  for(const code of ['PRODUCTION_FIRESTORE_RULES_NOT_VERIFIED','PRODUCTION_STORAGE_RULES_NOT_VERIFIED',
    'PRIMARY_DATA_EU_LOCATION_NOT_VERIFIED','PRIVATE_DOWNLOAD_TOKENS_REQUIRE_REVIEW'])
    assert.equal(r.checks.find(row=>row.code===code).verified,true,code);
  for(const code of ['PLAN_NOT_VERIFIED','OWNER_HOUSEHOLD_REVIEW_REQUIRED','FULL_BACKUP_NOT_VERIFIED','RESTORE_NOT_VERIFIED'])
    assert.equal(r.checks.find(row=>row.code===code).verified,false,code);
  assert.equal(r.readyForMigration,false);assert.equal(r.productionWritesPerformed,0);
});
test('unsupported flags and unsafe app origins are rejected without offering apply, skip, secret or deployment modes',()=>{
  for(const flag of ['--apply','--deploy','--migrate','--delete','--skip-rules','--skip-backup','--key-file','--secret','--yes'])
    assert.throws(()=>parseDiagnosticArguments([flag]));
  for(const origin of ['http://localhost/','https://127.0.0.1/','https://user:password@example.org/'])
    assert.throws(()=>parseDiagnosticArguments(['--config','c','--review','r','--app-origin',origin]));
  assert.equal(parseDiagnosticArguments(['--config','c','--review','r']).output,undefined);
  assert.throws(()=>parseDiagnosticArguments(['--config','c','--review','r','--archive','a']));
});
test('encrypted byte comparison detects duplicates without claiming authentication, independence or current-plan binding',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'diagnostic-copy-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const first=path.join(dir,'first.nrb'),second=path.join(dir,'second.nrb'),hard=path.join(dir,'hard.nrb');
  await writePrivateFile(first,Buffer.from('NRHB1SYNTHETIC_OPAQUE_ARCHIVE'));await writePrivateFile(second,Buffer.from('NRHB1SYNTHETIC_OPAQUE_ARCHIVE'));
  await link(first,hard);
  const matched=await compareDiagnosticArchives(first,second);assert.equal(matched.bytesMatch,true);assert.equal(matched.distinctFiles,true);
  assert.equal(matched.authenticationVerified,false);assert.equal(matched.independentLocationVerified,false);assert.equal(matched.boundToCurrentPlan,false);
  assert.equal((await compareDiagnosticArchives(first,hard)).distinctFiles,false);
  assert.equal((await compareDiagnosticArchives(first,path.join(dir,'missing'))).comparisonPerformed,false);
});
