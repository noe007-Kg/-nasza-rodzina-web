import assert from 'node:assert/strict';
import { test } from 'node:test';
import { manageTasksAction } from '../server/tasks-service.mjs';
import { runTaskPhotoCleanup } from '../server/tasks-photos.mjs';
import { familyMemoryContext, memoryBucket, familyTestNow, fixtureChild } from './family-v2-test-helpers.mjs';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const draft = changes => ({ action: 'save-reward', id: 'reward-image', title: 'Nagroda testowa', note: 'Opis nagrody testowej', cost: 5, people: ['child-person'], active: true, ...changes });
const code = expected => error => error?.code === expected;
const now = { now: familyTestNow };

test('only parents delete rewards; pending requests close without spending points and images are revoked', async()=>{
  const {context,ticket}=await uploadedReward();
  await manageTasksAction(context,draft({imageUploadId:ticket.uploadId}),now);
  const request=await manageTasksAction(context.as('child'),{action:'request-reward',rewardId:'reward-image'},now);
  const remove={action:'archive-reward',rewardId:'reward-image',confirmed:true};
  await assert.rejects(manageTasksAction(context.as('child'),remove,now),code('TASK_PARENT_REQUIRED'));
  context.rows.set('members/foreign-parent',{...context.rows.get('members/parent'),familyId:'other-family'});
  await assert.rejects(manageTasksAction(context.as('foreign-parent'),remove,now),code('TASK_REWARD_NOT_FOUND'));
  await assert.rejects(manageTasksAction(context,{...remove,confirmed:false},now),code('TASK_CONFIRM_REQUIRED'));
  const ledgerBefore=[...context.rows.entries()].filter(([key])=>key.startsWith('taskPointLedger/'));
  await manageTasksAction(context,remove,now); await manageTasksAction(context,remove,now);
  assert.equal(context.rows.get('taskRewards/reward-image').archived,true);
  assert.equal(context.rows.get(`taskRewardRequests/${request.requestId}`).state,'rejected');
  assert.equal(context.rows.get(`_taskRewardImageUploads/${ticket.uploadId}`).state,'deleted');
  assert.equal(context.bucket.objects.has(ticket.path),false);
  assert.deepEqual([...context.rows.entries()].filter(([key])=>key.startsWith('taskPointLedger/')),ledgerBefore);
  assert.equal((await manageTasksAction(context,{action:'state'},now)).rewards.length,0);
  await assert.rejects(manageTasksAction(context,draft(),now),code('TASK_REWARD_NOT_AVAILABLE'));
  await assert.rejects(manageTasksAction(context.as('child'),{action:'request-reward',rewardId:'reward-image'},now),code('TASK_REWARD_NOT_AVAILABLE'));
});

async function uploadedReward(context = familyMemoryContext()) {
  context.bucket ||= memoryBucket();
  const ticket = await manageTasksAction(context, { action: 'begin-reward-image', rewardId: 'reward-image', contentType: 'image/png', size: png.length }, now);
  context.bucket.objects.set(ticket.path, { bytes: png, metadata: { contentType: 'image/png', size: png.length, metadata: {
    rewardId: 'reward-image', uploadId: ticket.uploadId, uploaderUid: 'parent', firebaseStorageDownloadTokens: 'synthetic-test-value',
  } } });
  return { context, ticket };
}

test('a parent creates and assigns a task; another child cannot submit it or decide the completion', async () => {
  const context = familyMemoryContext({ 'members/other-child': { ...fixtureChild, personKey: 'other-person' } });
  await manageTasksAction(context, { action: 'save-task', id: 'assigned-task', title: 'Zadanie testowe', person: 'child-person',
    dueDate: '2026-10-12', priority: 'normal', note: 'Opis zadania', points: 7, verificationMode: 'parent', repeat: 'none' }, now);
  assert.equal(context.rows.get('tasks/assigned-task').person, 'child-person');
  await assert.rejects(manageTasksAction(context.as('other-child'), { action: 'submit', taskId: 'assigned-task' }, now), code('TASK_FORBIDDEN'));
  await manageTasksAction(context.as('child'), { action: 'submit', taskId: 'assigned-task' }, now);
  await assert.rejects(manageTasksAction(context.as('child'), { action: 'rework', taskId: 'assigned-task', comment: 'synthetic' }, now), code('TASK_PARENT_REQUIRED'));
  await manageTasksAction(context, { action: 'rework', taskId: 'assigned-task', comment: 'Popraw zadanie testowe' }, now);
  assert.equal(context.rows.get('tasks/assigned-task').done, false);
  assert.equal(context.rows.get('tasks/assigned-task').approvalStatus, 'none');
  assert.equal([...context.rows.keys()].some(path => path.startsWith('taskPointBalances/')), false);
});

test('a reward requires a nonempty description and positive integral cost; a child cannot create the catalogue', async () => {
  const context = familyMemoryContext();
  for (const note of ['', ' ', undefined]) await assert.rejects(manageTasksAction(context, draft({ note }), now), code('TASK_INVALID_REQUEST'));
  for (const cost of [0, -1, 2.5]) await assert.rejects(manageTasksAction(context, draft({ cost }), now));
  await assert.rejects(manageTasksAction(context.as('child'), draft({}), now), code('TASK_PARENT_REQUIRED'));
  assert.equal(context.rows.has('taskRewards/reward-image'), false);
});

test('only a fresh parent role reserves a reward illustration and cannot use a different family reward', async () => {
  const context = familyMemoryContext({ 'taskRewards/foreign': { title: 'Obca nagroda', familyId: 'foreign-family' } });
  context.bucket = memoryBucket();
  const body = { action: 'begin-reward-image', rewardId: 'reward-image', contentType: 'image/png', size: png.length };
  await assert.rejects(manageTasksAction(context.as('child'), body, now), code('TASK_PARENT_REQUIRED'));
  await assert.rejects(manageTasksAction(context, { ...body, rewardId: 'foreign' }, now), code('TASK_FORBIDDEN'));
  context.rows.get('members/parent').role = 'child';
  await assert.rejects(manageTasksAction(context, body, now), code('TASK_PARENT_REQUIRED'));
  assert.equal([...context.rows.keys()].some(path => path.startsWith('_taskRewardImageUploads/')), false);
});

test('reward image attaches after actual byte validation, revokes bearer download links and persists through repeated saves', async () => {
  const { context, ticket } = await uploadedReward();
  await manageTasksAction(context, draft({ imageUploadId: ticket.uploadId }), now);
  await manageTasksAction(context, draft({ imageUploadId: ticket.uploadId }), now);
  assert.equal(context.rows.get('taskRewards/reward-image').imagePath, ticket.path);
  const attached = context.rows.get(`_taskRewardImageUploads/${ticket.uploadId}`);
  assert.equal(attached.state, 'attached');
  assert.deepEqual(attached.people, ['child-person']);
  assert.equal(attached.active, true);
  assert.equal(context.bucket.objects.get(ticket.path).metadata.metadata.firebaseStorageDownloadTokens, null);
  assert.equal(context.bucket.deletes.length, 0);
  const childState = await manageTasksAction(context.as('child'), { action: 'state' });
  assert.equal(childState.rewards[0].imagePath, ticket.path);
});

test('reward approval spends points once and never deletes its permanent illustration', async () => {
  const { context, ticket } = await uploadedReward(familyMemoryContext({ 'tasks/earned': {
    title: 'Zadanie testowe', person: 'child-person', points: 12, verificationMode: 'trust', done: false, repeat: 'none', familyId: 'fixture-family',
  } }));
  await manageTasksAction(context.as('child'), { action: 'submit', taskId: 'earned' }, now);
  await manageTasksAction(context, draft({ imageUploadId: ticket.uploadId }), now);
  const request = await manageTasksAction(context.as('child'), { action: 'request-reward', rewardId: 'reward-image' }, now);
  await assert.rejects(manageTasksAction(context.as('child'), { action: 'decide-reward', requestId: request.requestId, approved: true }, now), code('TASK_PARENT_REQUIRED'));
  await Promise.all([1, 2].map(() => manageTasksAction(context, { action: 'decide-reward', requestId: request.requestId, approved: true }, now)));
  const balance = [...context.rows.entries()].find(([path]) => path.startsWith('taskPointBalances/'))[1];
  assert.equal(balance.balance, 7);
  assert.equal(balance.spent, 5);
  assert.equal([...context.rows.entries()].filter(([path, item]) => path.startsWith('taskPointLedger/') && item.kind === 'redeemed').length, 1);
  await runTaskPhotoCleanup(context, { now: new Date(familyTestNow.getTime() + 31 * 86_400_000) });
  assert.equal(context.bucket.objects.has(ticket.path), true);
  assert.equal(context.rows.get(`_taskRewardImageUploads/${ticket.uploadId}`).state, 'attached');
});

test('catalogue access changes are copied atomically to the image ticket; an unassigned child gets no path', async () => {
  const { context, ticket } = await uploadedReward(familyMemoryContext({ 'members/other-child': { ...fixtureChild, personKey: 'other-person' } }));
  await manageTasksAction(context, draft({ imageUploadId: ticket.uploadId }), now);
  assert.deepEqual((await manageTasksAction(context.as('other-child'), { action: 'state' })).rewards, []);
  await manageTasksAction(context, draft({ people: ['other-person'], active: false }), now);
  const image = context.rows.get(`_taskRewardImageUploads/${ticket.uploadId}`);
  assert.deepEqual(image.people, ['other-person']);
  assert.equal(image.active, false);
  assert.deepEqual((await manageTasksAction(context.as('child'), { action: 'state' })).rewards, []);
  assert.equal(context.bucket.objects.has(ticket.path), true);
});

test('wrong reward, uploader, incomplete bytes and expired reservations cannot become catalogue images', async () => {
  for (const scenario of ['wrong-reward', 'wrong-uploader', 'incomplete', 'signature', 'expired']) {
    const { context, ticket } = await uploadedReward();
    let request = draft({ imageUploadId: ticket.uploadId }); let at = now;
    if (scenario === 'wrong-reward') request = { ...request, id: 'another-reward' };
    if (scenario === 'wrong-uploader') context.rows.get(`_taskRewardImageUploads/${ticket.uploadId}`).uid = 'child';
    if (scenario === 'incomplete') context.bucket.objects.delete(ticket.path);
    if (scenario === 'signature') context.bucket.objects.get(ticket.path).bytes = Buffer.from('not an image');
    if (scenario === 'expired') at = { now: new Date(familyTestNow.getTime() + 31 * 60_000) };
    await assert.rejects(manageTasksAction(context, request, at));
    assert.equal(context.rows.has('taskRewards/reward-image'), false, scenario);
    assert.equal(context.rows.get(`_taskRewardImageUploads/${ticket.uploadId}`).state, 'open', scenario);
  }
});

test('removing a reward image revokes reads immediately and retries actual Storage deletion after failure', async () => {
  const { context, ticket } = await uploadedReward();
  await manageTasksAction(context, draft({ imageUploadId: ticket.uploadId }), now);
  context.bucket.controls.failDeletes = 1;
  await manageTasksAction(context, draft({ removeImage: true }), now);
  assert.equal(context.rows.get('taskRewards/reward-image').imagePath, undefined);
  assert.equal(context.rows.get(`_taskRewardImageUploads/${ticket.uploadId}`).state, 'revoked');
  assert.equal(context.bucket.objects.has(ticket.path), true);
  await runTaskPhotoCleanup(context, { now: new Date(familyTestNow.getTime() + 3_600_000) });
  assert.equal(context.bucket.objects.has(ticket.path), false);
  assert.equal(context.rows.get(`_taskRewardImageUploads/${ticket.uploadId}`).state, 'deleted');
});

test('orphan cleanup removes unattached reward uploads and approval removes proof while leaving the reward image intact', async () => {
  const { context, ticket } = await uploadedReward();
  await manageTasksAction(context, draft({ imageUploadId: ticket.uploadId }), now);
  const orphan = await uploadedReward(context);
  await runTaskPhotoCleanup(context, { now: new Date(familyTestNow.getTime() + 2 * 86_400_000) });
  assert.equal(context.bucket.objects.has(orphan.ticket.path), false);
  assert.equal(context.bucket.objects.has(ticket.path), true);
  context.rows.set('tasks/photo-task', { title: 'Zadanie ze zdjęciem', person: 'child-person', points: 3, verificationMode: 'photo', requireApproval: true,
    done: false, approvalStatus: 'none', repeat: 'none', familyId: 'fixture-family' });
  const child = context.as('child');
  const proof = await manageTasksAction(child, { action: 'begin-photo', taskId: 'photo-task', contentType: 'image/png', size: png.length }, now);
  context.bucket.objects.set(proof.path, { bytes: png, metadata: { contentType: 'image/png', size: png.length,
    metadata: { taskId: 'photo-task', uploadId: proof.uploadId, uploaderUid: 'child' } } });
  await manageTasksAction(child, { action: 'submit', taskId: 'photo-task', uploadId: proof.uploadId }, now);
  await manageTasksAction(context, { action: 'approve', taskId: 'photo-task' }, now);
  assert.equal(context.bucket.objects.has(proof.path), false);
  assert.equal(context.rows.get('tasks/photo-task').proofPath, undefined);
  assert.equal(context.bucket.objects.has(ticket.path), true);
});
