import test from 'node:test';
import assert from 'node:assert/strict';
import { canReceiveNotification, deriveNotificationEvent } from '../server/notification-events.mjs';
import { schoolNotificationChanges } from '../server/school-notifications.mjs';
import { resolveConnectionAccess } from '../server/edu-access.mjs';
const parent={id:'parent-a',role:'parent',active:true,canLogin:true,familyId:'family-a',personKey:'Nikodem'};
test('foreign and unassigned household cannot receive calendar/task/health/school notifications even with identical person names',()=>{
  for(const collection of ['calendarEvents','privateCalendarEvents','tasks','healthRecords','schoolItems','schoolParentMessages']){
    const record={familyId:'family-a',person:'Nikodem',ownerUid:'parent-a',type:'grade',title:'Synthetic',sourceProfileId:'synthetic',sourceRecordId:'synthetic'};
    const event=deriveNotificationEvent(collection,'synthetic',null,record);
    assert.ok(event); assert.equal(canReceiveNotification(parent,event),true);
    for(const familyId of ['family-b',undefined,'__legacy__']) assert.equal(canReceiveNotification({...parent,familyId},event),false);
  }
});
test('children get their own/family task alerts, never sibling assignments or parent mailboxes',()=>{
  const child={...parent,id:'child-a',role:'child'};
  const record={familyId:'family-a',person:'Paweł',title:'Synthetic'};
  assert.equal(canReceiveNotification(child,deriveNotificationEvent('tasks','task',null,record)),false);
  assert.equal(canReceiveNotification(child,deriveNotificationEvent('tasks','task',null,{...record,person:'family'})),true);
  assert.equal(canReceiveNotification(child,deriveNotificationEvent('schoolParentMessages','message',null,record)),false);
});
test('durable school queue retains household authority without duplicating private provider content',()=>{
  const after={familyId:'family-a',type:'grade',person:'Nikodem',title:'Synthetic private grade',note:'SYNTHETIC_PRIVATE_NOTE',sourceProfileId:'p',sourceRecordId:'g'};
  const [event]=schoolNotificationChanges([{collection:'schoolItems',id:'g',before:null,after}],['grade']);
  assert.equal(event.record.familyId,'family-a'); assert.equal(JSON.stringify(event.record).includes('PRIVATE_NOTE'),false);
});
test('another household cannot reuse the existing shared eduVULCAN connection or even inspect its student roster',async()=>{
  let rosterReads=0;
  const db={collection:name=>({doc:uid=>({get:async()=>({exists:true,data:()=>name==='_eduConnections'?{connectedByUid:'parent-owner'}:{...parent,familyId:'family-a'}})}),
    where:()=>{rosterReads++;throw new Error('UNAUTHORIZED_ROSTER_READ');}})};
  await assert.rejects(resolveConnectionAccess({uid:'foreign-parent',profile:{...parent,familyId:'family-b'},db}),{code:'EDU_CONNECTION_FORBIDDEN'});
  assert.equal(rosterReads,0);
  for(const familyId of [undefined,'__legacy__']) await assert.rejects(resolveConnectionAccess({uid:'unassigned',profile:{...parent,familyId},db}),{code:'EDU_HOUSEHOLD_REQUIRED'});
});
test('student cannot use a parent-approved school identity from another household with the same person key',async()=>{
  const student={...parent,id:'child-b',role:'child',familyId:'family-b',personKey:'Nikodem',schoolEnabled:true};
  const identity={studentName:'Synthetic student',schoolName:'Synthetic school'};
  const db={collection:name=>({doc:uid=>({get:async()=>({exists:true,data:()=>name==='_eduStudentBindings'
    ? {identity,establishedByUid:'parent-a'}:parent})})})};
  await assert.rejects(resolveConnectionAccess({uid:student.id,profile:student,db},'student'),{code:'EDU_STUDENT_LINK_REQUIRED'});
});

test('stored provider connection ownership is rechecked after authorization, including disconnect and pre-decryption status',async()=>{
  const {getConnectionStatus,disconnectConnection}=await import('../server/edu-storage.mjs');
  const {familyMemoryContext}=await import('./family-v2-test-helpers.mjs');
  const {Timestamp}=await import('firebase-admin/firestore');
  const profile={...parent,personKey:'Sebastian'};
  const context=familyMemoryContext({'members/parent-a':profile,'members/parent-owner':profile,
    '_eduConnections/family':{scope:'family',accountRole:'parent',connectedByUid:'parent-owner',
      expiresAt:Timestamp.fromMillis(Date.now()+600000),students:[],selectedStudent:null}},'parent-a');
  context.connection={id:'family',scope:'family',accountRole:'parent',actorUid:'parent-a',allowedPersonKeys:[],personProfileIds:{}};
  assert.equal((await getConnectionStatus('family',context)).connected,true);
  context.rows.get('members/parent-owner').familyId='family-b';
  const before=JSON.stringify([...context.rows]);
  await assert.rejects(getConnectionStatus('family',context),{code:'EDU_CONNECTION_FORBIDDEN'});
  await assert.rejects(disconnectConnection('family',context),{code:'EDU_CONNECTION_FORBIDDEN'});
  assert.equal(JSON.stringify([...context.rows]),before);assert.equal(context.calls.length,0);
});
