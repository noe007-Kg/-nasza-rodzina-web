import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { manageTasksAction } from '../server/tasks-service.mjs';
import { familyMemoryContext, familyTestNow, fixtureChild, fixtureParent, memoryBucket } from './family-v2-test-helpers.mjs';

const family = 'fixture-family';
const otherFamily = 'other-family';
const digest = value => createHash('sha256').update(value).digest('hex');
const code = expected => error => error?.code === expected;
const task = changes => ({ title: 'Syntetyczne zadanie', person: 'child-person', points: 9, verificationMode: 'trust', repeat: 'none',
  done: false, archived: false, approvalStatus: 'none', familyId: family, createdBy: 'parent', ...changes });
const save = changes => ({ action: 'save-task', id: 'own-task', title: 'Zadanie', person: 'child-person', points: 9,
  note: '', dueDate: '', priority: 'normal', verificationMode: 'trust', repeat: 'none', ...changes });
const reward = changes => ({ action: 'save-reward', id: 'own-reward', title: 'Nagroda', note: 'Opis', cost: 3, people: ['child-person'], active: true, ...changes });
const context = changes => familyMemoryContext({
  'members/second-parent': { ...fixtureParent, personKey: 'parent-two' },
  'members/other-parent': { ...fixtureParent, personKey: 'other-parent-person', familyId: otherFamily },
  'members/other-child': { ...fixtureChild, familyId: otherFamily },
  'members/sibling': { ...fixtureChild, personKey: 'sibling-person' },
  ...changes,
});
const rows = ctx => [...ctx.rows.entries()];
const list = (ctx, name) => rows(ctx).filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2);
const at = { now: familyTestNow };

test('missing, malformed and __legacy__ family IDs fail closed for reads and all task operations', async () => {
  for (const familyId of [undefined, null, '', '__legacy__', ' household', 'household/other']) {
    const ctx = context({ 'members/parent': { ...fixtureParent, familyId } });
    for (const body of [{ action: 'state' }, save(), reward(), { action: 'submit', taskId: 'own-task' },
      { action: 'archive-task', taskId: 'own-task', confirmed: true }]) {
      await assert.rejects(manageTasksAction(ctx, body), code('TASK_MEMBER_REQUIRED'));
    }
    assert.equal(ctx.calls.length, 0);
  }
});

test('fresh actor family changes reject a stale API context without accessing another household', async () => {
  const ctx = context({ 'tasks/own-task': task({}) });
  ctx.rows.get('members/parent').familyId = otherFamily;
  for (const body of [{ action: 'state' }, save()]) await assert.rejects(manageTasksAction(ctx, body), code('TASK_MEMBER_REQUIRED'));
  assert.equal(ctx.calls.length, 0);
});

test('other-household parents cannot read details or mutate tasks through submit, edit, archive, approval or rework', async () => {
  const ctx = context({ 'tasks/own-task': task({ approvalStatus: 'pending', submittedBy: 'child' }) });
  const before = rows(ctx);
  for (const body of [save(), { action: 'submit', taskId: 'own-task' }, { action: 'approve', taskId: 'own-task' },
    { action: 'rework', taskId: 'own-task', comment: '' }, { action: 'archive-task', taskId: 'own-task', confirmed: true }]) {
    await assert.rejects(manageTasksAction(ctx.as('other-parent'), body), code('TASK_NOT_FOUND'));
  }
  assert.deepEqual(rows(ctx), before);
  const state = await manageTasksAction(ctx.as('other-parent'), { action: 'state' });
  assert.equal(state.balances.length, 2);
  assert.deepEqual(state.history, []);
});

test('both household parents retain task management, but foreign assignees and caller-chosen family IDs are rejected', async () => {
  const ctx = context({ 'members/foreign-person': { ...fixtureChild, personKey: 'foreign-person', familyId: otherFamily } });
  await manageTasksAction(ctx, save());
  await manageTasksAction(ctx.as('second-parent'), save({ title: 'Poprawione zadanie' }));
  assert.equal(ctx.rows.get('tasks/own-task').familyId, family);
  assert.equal(ctx.rows.get('tasks/own-task').title, 'Poprawione zadanie');
  await assert.rejects(manageTasksAction(ctx, save({ person: 'foreign-person' })), code('TASK_INVALID_PERSON'));
  await assert.rejects(manageTasksAction(ctx, save({ familyId: otherFamily })), code('TASK_INVALID_REQUEST'));
});

test('children cannot submit sibling tasks; own and shared family tasks still complete', async () => {
  const ctx = context({ 'tasks/own-task': task({}), 'tasks/sibling-task': task({ person: 'sibling-person' }),
    'tasks/shared-task': task({ person: 'family', points: 4 }) });
  await assert.rejects(manageTasksAction(ctx.as('child'), { action: 'submit', taskId: 'sibling-task' }), code('TASK_FORBIDDEN'));
  await manageTasksAction(ctx.as('child'), { action: 'submit', taskId: 'own-task' });
  await manageTasksAction(ctx.as('child'), { action: 'submit', taskId: 'shared-task' });
  assert.equal(list(ctx, 'taskPointBalances').find(([, row]) => row.person === 'child-person')[1].balance, 13);
});

test('identical person keys in two families have independent namespaced balances and duplicate retries award once', async () => {
  const ctx = context({ 'tasks/own-task': task({}), 'tasks/other-task': task({ familyId: otherFamily, createdBy: 'other-parent', points: 21 }) });
  await Promise.all([manageTasksAction(ctx.as('child'), { action: 'submit', taskId: 'own-task' }),
    manageTasksAction(ctx.as('child'), { action: 'submit', taskId: 'own-task' }),
    manageTasksAction(ctx.as('other-child'), { action: 'submit', taskId: 'other-task' })]);
  const balances = list(ctx, 'taskPointBalances');
  assert.equal(balances.length, 2);
  assert.equal(balances.find(([, row]) => row.familyId === family)[1].balance, 9);
  assert.equal(balances.find(([, row]) => row.familyId === otherFamily)[1].balance, 21);
  assert.notEqual(balances[0][0], balances[1][0]);
});

test('a migrated legacy balance is retained unchanged in identity; a foreign legacy balance is never overwritten', async () => {
  const legacyPath = `taskPointBalances/person-${digest('child-person')}`;
  const own = context({ [legacyPath]: { familyId: family, person: 'child-person', balance: 30, earned: 30, spent: 0 }, 'tasks/own-task': task({}) });
  await manageTasksAction(own.as('child'), { action: 'submit', taskId: 'own-task' });
  assert.equal(own.rows.get(legacyPath).balance, 39);
  assert.equal(list(own, 'taskPointBalances').length, 1);
  const foreignBalance = { familyId: otherFamily, person: 'child-person', balance: 88, earned: 88, spent: 0 };
  const collision = context({ [legacyPath]: foreignBalance, 'tasks/own-task': task({}) });
  await manageTasksAction(collision.as('child'), { action: 'submit', taskId: 'own-task' });
  assert.deepEqual(collision.rows.get(legacyPath), foreignBalance);
  assert.equal(list(collision, 'taskPointBalances').find(([, row]) => row.familyId === family)[1].balance, 9);
});

test('unknown legacy balances, duplicated same-person balances and mismatched linked accounting records abort atomically', async () => {
  const legacyPath = `taskPointBalances/person-${digest('child-person')}`;
  const scopedPath = `taskPointBalances/family-${digest(`${family}:child-person`)}`;
  for (const [initial, expected] of [
    [{ [legacyPath]: { person: 'child-person', balance: 3 } }, 'TASK_MIGRATION_REQUIRED'],
    [{ [legacyPath]: { familyId: family, person: 'child-person', balance: 3 }, [scopedPath]: { familyId: family, person: 'child-person', balance: 4 } }, 'TASK_BALANCE_CONFLICT'],
    [{ 'taskCompletions/own-task': { familyId: otherFamily, taskId: 'own-task', person: 'child-person' } }, 'TASK_FORBIDDEN'],
    [{ [`taskPointLedger/${digest('task:own-task')}`]: { familyId: otherFamily, taskId: 'own-task', person: 'child-person' } }, 'TASK_FORBIDDEN'],
    [{ [scopedPath]: { familyId: family, person: 'sibling-person', balance: 4 } }, 'TASK_FORBIDDEN'],
  ]) {
    const ctx = context({ 'tasks/own-task': task({}), ...initial }); const before = rows(ctx);
    await assert.rejects(manageTasksAction(ctx.as('child'), { action: 'submit', taskId: 'own-task' }), code(expected));
    assert.deepEqual(rows(ctx), before);
  }
});

test('foreign reward catalogue and requests cannot be edited, assigned, requested or decided', async () => {
  const ctx = context({ 'taskRewards/foreign-reward': { title: 'Obca nagroda', note: 'Opis', familyId: otherFamily, cost: 3, people: [], active: true },
    'taskRewardRequests/foreign-request': { familyId: otherFamily, person: 'child-person', rewardId: 'foreign-reward', state: 'pending', cost: 3 } });
  const before = rows(ctx);
  await assert.rejects(manageTasksAction(ctx, reward({ id: 'foreign-reward' })), code('TASK_FORBIDDEN'));
  await assert.rejects(manageTasksAction(ctx.as('child'), { action: 'request-reward', rewardId: 'foreign-reward' }), code('TASK_REWARD_NOT_AVAILABLE'));
  await assert.rejects(manageTasksAction(ctx, { action: 'decide-reward', requestId: 'foreign-request', approved: false }), code('TASK_REWARD_REQUEST_NOT_FOUND'));
  assert.deepEqual(rows(ctx), before);
});

test('pending reward requests and balances are separate even when person names match across households', async () => {
  const ctx = context({ 'tasks/own-task': task({}), 'tasks/other-task': task({ familyId: otherFamily, points: 21 }) });
  await manageTasksAction(ctx.as('child'), { action: 'submit', taskId: 'own-task' });
  await manageTasksAction(ctx.as('other-child'), { action: 'submit', taskId: 'other-task' });
  await manageTasksAction(ctx, reward());
  await manageTasksAction(ctx.as('other-parent'), reward({ id: 'other-reward' }));
  const own = await manageTasksAction(ctx.as('child'), { action: 'request-reward', rewardId: 'own-reward' });
  const foreign = await manageTasksAction(ctx.as('other-child'), { action: 'request-reward', rewardId: 'other-reward' });
  await Promise.all([manageTasksAction(ctx.as('second-parent'), { action: 'decide-reward', requestId: own.requestId, approved: true }),
    manageTasksAction(ctx.as('second-parent'), { action: 'decide-reward', requestId: own.requestId, approved: true })]);
  assert.equal(list(ctx, 'taskPointBalances').find(([, row]) => row.familyId === family)[1].balance, 6);
  assert.equal(list(ctx, 'taskPointBalances').find(([, row]) => row.familyId === otherFamily)[1].balance, 21);
  assert.equal(ctx.rows.get(`taskRewardRequests/${foreign.requestId}`).state, 'pending');
  assert.equal(list(ctx, '_taskRewardPending').length, 1);
});

test('a pending pointer to a foreign reward request cannot leak its ID or be removed', async () => {
  const pendingPath = `_taskRewardPending/${digest(`${family}:child-person:own-reward`)}`;
  const ctx = context({ 'taskRewards/own-reward': { familyId: family, title: 'Nagroda', people: [], cost: 3, active: true },
    [pendingPath]: { familyId: family, person: 'child-person', rewardId: 'own-reward', requestId: 'foreign-request' },
    'taskRewardRequests/foreign-request': { familyId: otherFamily, person: 'child-person', rewardId: 'own-reward', state: 'pending' } });
  const before = rows(ctx);
  await assert.rejects(manageTasksAction(ctx.as('child'), { action: 'request-reward', rewardId: 'own-reward' }), code('TASK_FORBIDDEN'));
  assert.deepEqual(rows(ctx), before);
});

test('state limits private point history and requests to the child while preserving same-household ranking', async () => {
  const ctx = context({
    'taskPointLedger/own': { familyId: family, person: 'child-person', delta: 4, title: 'Moje', kind: 'earned' },
    'taskPointLedger/sibling': { familyId: family, person: 'sibling-person', delta: 8, title: 'Prywatna historia rodzeństwa', kind: 'earned' },
    'taskPointLedger/foreign': { familyId: otherFamily, person: 'child-person', delta: 900, title: 'Obce', kind: 'earned' },
    'taskRewardRequests/sibling': { familyId: family, person: 'sibling-person', state: 'pending', title: 'Prywatna prośba' },
    'taskPointBalances/foreign': { familyId: otherFamily, person: 'child-person', balance: 900 },
  });
  const state = await manageTasksAction(ctx.as('child'), { action: 'state' });
  assert.deepEqual(state.history.map(item => item.title), ['Moje']);
  assert.deepEqual(state.requests, []);
  assert.equal(state.balances.some(item => item.person === 'sibling-person'), true);
  assert.equal(state.balances.some(item => item.balance === 900), false);
});

test('linked foreign photo tickets abort before any Storage read, token revocation or task mutation', async () => {
  const uploadId = '00112233-4455-6677-8899-aabbccddeeff';
  const proof = `taskProof/own-task/child/${uploadId}.png`;
  const ctx = context({ 'tasks/own-task': task({ verificationMode: 'photo' }),
    [`_taskPhotoUploads/${uploadId}`]: { familyId: otherFamily, taskId: 'own-task', uid: 'child', person: 'child-person', state: 'open', path: proof } });
  let touched = false; ctx.bucket = { file: () => { touched = true; throw new Error('must not access'); } };
  await assert.rejects(manageTasksAction(ctx.as('child'), { action: 'submit', taskId: 'own-task', uploadId }), code('TASK_PHOTO_FORBIDDEN'));
  await assert.rejects(manageTasksAction(ctx, { action: 'archive-task', taskId: 'own-task', confirmed: true }), code('TASK_FORBIDDEN'));
  assert.equal(touched, false);
  assert.equal(ctx.rows.get('tasks/own-task').archived, false);
});

test('new task/photo/reward/pending/accounting records carry only the trusted current family', async () => {
  const ctx = context(); ctx.bucket = memoryBucket();
  await manageTasksAction(ctx, save({ verificationMode: 'photo' }));
  await manageTasksAction({ ...ctx.as('child'), bucket: ctx.bucket }, { action: 'begin-photo', taskId: 'own-task', contentType: 'image/png', size: 12 }, at);
  await manageTasksAction(ctx, reward());
  await manageTasksAction(ctx.as('child'), { action: 'request-reward', rewardId: 'own-reward' });
  await manageTasksAction(ctx, { action: 'begin-reward-image', rewardId: 'own-reward', contentType: 'image/png', size: 12 }, at);
  for (const name of ['tasks', '_taskPhotoUploads', 'taskRewards', '_taskRewardPending', 'taskRewardRequests', '_taskRewardImageUploads']) {
    assert.ok(list(ctx, name).length > 0, name);
    assert.equal(list(ctx, name).every(([, row]) => row.familyId === family), true, name);
  }
});

test('foreign legacy pending pointers are left untouched while a household creates its own request', async () => {
  const legacyPath = `_taskRewardPending/${digest('child-person:own-reward')}`;
  const foreignPending = { familyId: otherFamily, person: 'child-person', rewardId: 'own-reward', requestId: 'foreign-request' };
  const ctx = context({ [legacyPath]: foreignPending, 'taskRewards/own-reward': { familyId: family, title: 'Nagroda', people: [], cost: 3, active: true } });
  const request = await manageTasksAction(ctx.as('child'), { action: 'request-reward', rewardId: 'own-reward' });
  assert.notEqual(request.requestId, 'foreign-request');
  assert.deepEqual(ctx.rows.get(legacyPath), foreignPending);
  assert.equal(list(ctx, '_taskRewardPending').length, 2);
});

test('reward state never publishes a file path borrowed from another household ticket', async () => {
  const uploadId = '00112233-4455-6677-8899-aabbccddeeff';
  const path = `taskRewardImages/own-reward/other-parent/${uploadId}.png`;
  const ctx = context({ 'taskRewards/own-reward': { familyId: family, title: 'Nagroda', people: [], cost: 3, active: true, imagePath: path, imageUploadId: uploadId },
    [`_taskRewardImageUploads/${uploadId}`]: { familyId: otherFamily, rewardId: 'own-reward', uid: 'other-parent', state: 'attached', path, people: [], active: true } });
  for (const actor of ['parent', 'child']) {
    const state = await manageTasksAction(ctx.as(actor), { action: 'state' });
    assert.equal(state.rewards[0].imagePath, undefined);
  }
  await assert.rejects(manageTasksAction(ctx, reward({ removeImage: true })), code('TASK_FORBIDDEN'));
  assert.equal(ctx.rows.get(`_taskRewardImageUploads/${uploadId}`).state, 'attached');
});

test('disabled or archived actors and assignees get no task management rights; passive profiles can still own tasks', async () => {
  for (const change of [{ disabled: true }, { archived: true }]) {
    const ctx = context({ 'members/child': { ...fixtureChild, ...change } });
    await assert.rejects(manageTasksAction(ctx.as('child'), { action: 'state' }), code('TASK_MEMBER_REQUIRED'));
    await assert.rejects(manageTasksAction(ctx, save()), code('TASK_INVALID_PERSON'));
  }
  const passive = context({ 'members/child': { ...fixtureChild, canLogin: false } });
  await manageTasksAction(passive, save());
  assert.equal(passive.rows.get('tasks/own-task').person, 'child-person');
  await assert.rejects(manageTasksAction(passive.as('child'), { action: 'state' }), code('TASK_MEMBER_REQUIRED'));
});
