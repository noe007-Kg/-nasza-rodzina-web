import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHouseholdIsolationPlan } from '../scripts/lib/household-isolation-plan.mjs';
import { HOUSEHOLD_FIELDS, STORAGE_PREFIXES } from '../scripts/lib/household-migration-inventory.mjs';
import { planMatchesBackup } from '../scripts/lib/household-evidence-capture.mjs';
const F='family-isolation-test', t='2026-10-14T08:00:00.123000000Z';
function fixture() {
  const config={schemaVersion:1,projectId:'demo-isolation-plan',bucket:'demo-isolation-plan.appspot.com',householdConfirmed:true,familyId:F,reviewedRecordPaths:[],
    members:Array.from({length:5},(_,i)=>({uid:`synthetic-person-${i}`,expectedName:`Synthetic ${i}`,expectedRole:i<2?'parent':'child',expectedCanLogin:i!==4,expectedPersonKey:`person-${i}`}))};
  const collections=Object.fromEntries(Object.keys(HOUSEHOLD_FIELDS).map(key=>[key,[]]));
  const add=(name,id,data)=>{const row={id,path:`${name}/${id}`,data,updateTime:{seconds:String(Date.parse('2026-10-14T08:00:00Z')/1000),nanoseconds:123000000}}; collections[name].push(row); return row;};
  for(const member of config.members){add('members',member.uid,{name:member.expectedName,role:member.expectedRole,personKey:member.expectedPersonKey,canLogin:member.expectedCanLogin,active:true});collections[`notificationInbox/${member.uid}/items`]=[];}
  const inventory={schemaVersion:1,source:'offline',projectId:config.projectId,bucket:config.bucket,collections,auth:config.members.map(m=>({uid:m.uid,exists:m.expectedCanLogin,disabled:false})),storage:[],
    coverage:{complete:true,authVerified:true,missingCollections:[],collections:Object.keys(collections),storagePrefixes:[...STORAGE_PREFIXES]}};
  return {config,inventory,add,run:()=>buildHouseholdIsolationPlan(config,inventory,{familyId:F})};
}
test('isolation dry-run proposes a complete owner/visibility stamp without changing event contents, UID or source',()=>{
  const f=fixture();f.add('calendarEvents','shared',{createdBy:'synthetic-person-0',person:'person-2',source:'manual'});
  f.add('privateCalendarEvents','private',{createdBy:'synthetic-person-0',ownerUid:'synthetic-person-0',person:'person-0',private:true});
  const before=structuredClone(f.inventory), p=f.run();assert.deepEqual(p.blockers,[]);assert.deepEqual(f.inventory,before);
  assert.equal(p.canApply,false);assert.equal(p.writesPerformed,0);
  const patches=p.changes.filter(c=>c.path==='calendarEvents/shared');assert.equal(patches.length,5);
  assert.equal(patches.find(c=>c.field==='ownerProfileId').after.value,'synthetic-person-2');
  assert.equal(patches.find(c=>c.field==='visibility').after.value,'family');
  assert.ok(p.changes.every(c=>['familyId','visibility','private','ownerUid','ownerProfileId','imagePath'].includes(c.field)));
  assert.ok(p.rollback.every(c=>c.conditions.postApplyUpdateTimeRequired));
});
test('private data in shared collection, foreign creator/target and ownerless presentation records block preparation',()=>{
  for(const data of [{createdBy:'synthetic-person-0',person:'person-2',private:true}, {createdBy:'foreign-user',person:'person-2'},
    {createdBy:'synthetic-person-0',person:'foreign-person'}, {createdBy:'synthetic-person-0',person:'person-2',ownerProfileId:'foreign-user'}]) {
    const f=fixture();f.add('calendarEvents','unsafe',data);assert.ok(f.run().blockers.length);
  }
  const f=fixture();f.add('quickProducts','legacy-unowned',{});assert.ok(f.run().blockers.some(c=>c.code==='ISOLATION_PRESENTATION_OWNER_REVIEW_REQUIRED'));
});
test('multi-field plan binds absent versus false metadata to full native backup and exact versions',()=>{
  const f=fixture();f.add('calendarEvents','shared',{createdBy:'synthetic-person-0',person:'person-2'});const p=f.run();
  const docs=Object.values(f.inventory.collections).flat().map(row=>({name:`projects/${p.projectId}/databases/(default)/documents/${row.path}`,updateTime:t,
    fields:Object.fromEntries(Object.entries(row.data).map(([key,value])=>[key,typeof value==='boolean'?{booleanValue:value}:{stringValue:value}]))}));
  assert.equal(planMatchesBackup(p,docs),true);
  docs.find(row=>row.name.endsWith('/calendarEvents/shared')).fields.private={booleanValue:false};assert.equal(planMatchesBackup(p,docs),false);
});
test('stored product image paths require uploader membership and exact object version, type and size',()=>{
  const f=fixture();const path='quick-products/synthetic-person-0/photo.png';
  f.add('quickProducts','path-only',{createdBy:'synthetic-person-0',imagePath:path});
  assert.ok(f.run().blockers.some(row=>row.code==='STORAGE_OBJECT_NOT_VERIFIED'));
  f.inventory.storage.push({path,exists:true,generation:'1',metageneration:'1',size:8,contentType:'image/png'});
  assert.deepEqual(f.run().blockers,[]);
  f.inventory.storage[0].generation='';assert.ok(f.run().blockers.some(row=>row.code==='STORAGE_OBJECT_NOT_VERIFIED'));
});
