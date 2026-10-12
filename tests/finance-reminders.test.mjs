import assert from 'node:assert/strict';
import test from 'node:test';
import { financeReminderEvent, runFinanceReminders } from '../server/finance-reminders.mjs';
import { familyMemoryContext, fixtureParent, fixtureChild } from './family-v2-test-helpers.mjs';
import { manageFinanceAction } from '../server/finance-service.mjs';
import { enqueueInAppEvents } from '../server/notification-inbox.mjs';

const now = new Date('2026-10-12T07:00:00Z');
const value = changes => ({ status: 'unpaid', dueDate: '2026-10-19', familyId: 'fixture-family', recurrence: 'none',
  periodIndex: 0, sharedWith: [], amountGrosze: 12345, bankAccount: 'PRIVATE_ACCOUNT', title: 'PRIVATE_PAYEE', ...changes });
const inbox = (context, uid) => [...context.rows.entries()].filter(([path]) => path.startsWith(`notificationInbox/${uid}/items/`));

test('reminders occur exactly 7, 3, 0 and one day after due date, never daily overdue spam', () => {
  for (const dueDate of ['2026-10-19', '2026-10-15', '2026-10-12', '2026-10-11']) assert.ok(financeReminderEvent('bill-one', value({ dueDate }), now));
  for (const dueDate of ['2026-10-20', '2026-10-16', '2026-10-13', '2026-10-10']) assert.equal(financeReminderEvent('bill-one', value({ dueDate }), now), null);
  assert.equal(financeReminderEvent('bill-one', value({ status: 'paid' }), now), null);
  assert.equal(financeReminderEvent('bill-one', value({ archived: true }), now), null);
  const event = financeReminderEvent('bill-one', value({}), now);
  assert.equal(event.id, 'finance:due:bill-one:2026-10-19:7');
  assert.equal(JSON.stringify({ title: event.title, body: event.body }).includes('PRIVATE_'), false);
});
test('real inbox flow is idempotent, private by default, respects preferences and stops after payment', async () => {
  const context = familyMemoryContext({ 'members/mother': fixtureParent,
    'members/foreign-parent': { ...fixtureParent, familyId: 'foreign-family' },
    'members/sibling': { ...fixtureChild, name: 'Rodzeństwo testowe' },
    'userPreferences/mother': { notifications: { categories: { important: false } } },
    'financeBills/bill-one': value({}) });
  const first = await runFinanceReminders(context, now);
  assert.equal(first.delivered, 1);
  assert.equal(inbox(context, 'parent').length, 1);
  for (const uid of ['child', 'adult', 'sibling', 'mother', 'foreign-parent']) assert.equal(inbox(context, uid).length, 0);
  assert.equal((await runFinanceReminders(context, now)).delivered, 0);
  await manageFinanceAction(context, { action: 'markPaid', billId: 'bill-one' });
  assert.equal((await runFinanceReminders(context, new Date('2026-10-16T07:00:00Z'))).delivered, 0);
  assert.equal(inbox(context, 'parent').length, 1);
});
test('shared child receives only that specific reminder while sibling and other family are excluded', async () => {
  const context = familyMemoryContext({ 'members/sibling': { ...fixtureChild, name: 'Rodzeństwo testowe' },
    'members/foreign-child': { ...fixtureChild, familyId: 'foreign-family' },
    'financeBills/bill-shared': value({ sharedWith: ['child', 'foreign-child'] }),
    'financeBills/bill-private': value({}) });
  assert.equal((await runFinanceReminders(context, now)).delivered, 3); // parent two, authorized child one.
  assert.equal(inbox(context, 'child').length, 1);
  assert.equal(inbox(context, 'sibling').length, 0);
  assert.equal(inbox(context, 'foreign-child').length, 0);
});
test('queued reminder revalidates payment and deadline changes before inbox creation', async () => {
  for (const changed of [{ status: 'paid' }, { dueDate: '2026-11-19' }]) {
    const previous = value({});
    const event = financeReminderEvent('bill-queued', previous, now);
    const context = familyMemoryContext({ 'financeBills/bill-queued': { ...previous, ...changed } });
    assert.equal((await enqueueInAppEvents(context, [event], { revalidateSource: true })).created, 0);
    assert.equal(inbox(context, 'parent').length, 0);
  }
});
test('revoking sharing after producer query denies queued reminders to the formerly authorized child', async () => {
  const previous = value({ sharedWith: ['child'] });
  const event = financeReminderEvent('bill-revoked', previous, now);
  const context = familyMemoryContext({ 'financeBills/bill-revoked': { ...previous, sharedWith: [] } });
  const result = await enqueueInAppEvents(context, [event], { revalidateSource: true });
  assert.equal(result.created, 1); // Same-household parent still authorized.
  assert.equal(inbox(context, 'child').length, 0);
});
