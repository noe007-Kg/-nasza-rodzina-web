import assert from 'node:assert/strict';
import test from 'node:test';
import { endOfDay, generateOccurrences, startOfDay } from '../src/calendar-utils';
import type { FamilyMemberProfile } from '../src/family-members';
import {
  buildFamilyTime, countdownText, latestConversations, shoppingPreview,
  type StartCalendarOccurrence, type StartChatMessage, type StartQuickProduct,
  type StartSchoolRecord, type StartShoppingItem,
} from '../src/features/start-tile-projections';

const at = (hours: number, minutes = 0) => new Date(2026, 9, 7, hours, minutes);
const now = at(9);
const profile = (person: string, extra: Partial<FamilyMemberProfile> = {}): FamilyMemberProfile => ({ id: person, personKey: person, name: person, ...extra });
const occurrence = (person: string, end: number, extra: Partial<StartCalendarOccurrence> = {}): StartCalendarOccurrence => ({
  key: `${person}-${end}`, source: { id: `${person}-${end}`, person, allDay: false }, date: at(8), endDate: at(end), ...extra,
});
const lesson = (person: string, extra: Partial<StartSchoolRecord> = {}): StartSchoolRecord => ({
  id: person, person, type: 'lesson', date: '', weekday: 3, time: '08:00', endTime: '12:00', note: '', ...extra,
});
const message = (id: string, channel = 'family', extra: Partial<StartChatMessage> = {}): StartChatMessage => ({
  id, channel, text: `Treść ${id}`, name: 'Autor', uid: 'me', createdAt: at(10), ...extra,
});
const shoppingItem = (id: string, title = id, extra: Partial<StartShoppingItem> = {}): StartShoppingItem => ({
  id, title, category: 'inne', quantity: '', unit: '', done: false, ...extra,
});
const product = (id: string, title = id, extra: Partial<StartQuickProduct> = {}): StartQuickProduct => ({
  id, title, category: 'inne', icon: '📦', ...extra,
});

test('family time uses every active dynamic profile, including members without login, and deduplicates identities', () => {
  const people = Array.from({ length: 7 }, (_, index) => profile(`person-${index}`, { canLogin: index !== 6 }));
  const profiles = [profile('old', { personKey: 'person-0', active: false }), ...people,
    profile('duplicate', { personKey: 'person-1' }), profile('archived', { archived: true }), profile('disabled', { disabled: true })];
  const events = people.map((person, index) => occurrence(person.personKey!, 12 + index));
  const result = buildFamilyTime(profiles, [...events, occurrence('archived', 23)], [], now);
  assert.deepEqual(result.members.map(member => member.profile.id), people.map(person => person.id));
  assert.equal(result.members[6].profile.canLogin, false);
  assert.equal(result.members[6].endAt?.getTime(), at(18).getTime());
  assert.equal(result.endAt?.getTime(), at(18).getTime());
  assert.equal(result.incomplete, false);
  assert.equal(profiles.length, 11);
});

test('empty visible plans and an empty directory stay unknown instead of claiming everyone is free', () => {
  const result = buildFamilyTime([profile('p')], [], [], now);
  assert.deepEqual(result.members[0], { profile: profile('p'), endAt: null, incomplete: true, hasPlan: false });
  assert.equal(result.endAt, null);
  assert.equal(result.incomplete, true);
  assert.deepEqual(buildFamilyTime([], [], [], now), { members: [], endAt: null, incomplete: true });
  assert.equal(countdownText(result.endAt, now), 'Brak danych o planie');
});

test('all-day, invalid and incomplete events keep the known end separate from uncertainty', () => {
  const profiles = ['timed', 'all-day', 'missing', 'invalid', 'no-plan'].map(person => profile(person));
  const result = buildFamilyTime(profiles, [
    occurrence('timed', 14),
    occurrence('all-day', 23, { source: { person: 'all-day', allDay: true } }),
    occurrence('missing', 15, { endDate: undefined }),
    occurrence('invalid', 16, { date: new Date(Number.NaN) }),
  ], [], now);
  assert.equal(result.endAt?.getTime(), at(14).getTime());
  assert.equal(result.incomplete, true);
  for (const member of result.members.slice(1, 4)) {
    assert.equal(member.hasPlan, true);
    assert.equal(member.incomplete, true);
    assert.equal(member.endAt, null);
  }
  assert.equal(result.members[4].hasPlan, false);
});

test('final member endpoints use actual occurrence ends and school ends, including completed plans', () => {
  const result = buildFamilyTime([profile('parent'), profile('child')], [
    occurrence('parent', 17), occurrence('parent', 12), occurrence('child', 11),
  ], [lesson('child', { endTime: '18:30' })], at(19));
  assert.deepEqual(result.members.map(member => member.endAt?.getTime()), [at(17).getTime(), at(18, 30).getTime()]);
  assert.equal(result.endAt?.getTime(), at(18, 30).getTime());
  assert.equal(countdownText(result.endAt, at(19)), 'już wolni');
  assert.equal(result.incomplete, false);
});

test('whole-family obligations apply to every profile, and an all-day family plan is unknown', () => {
  const profiles = [profile('a'), profile('b')];
  const timed = buildFamilyTime(profiles, [occurrence('family', 16)], [], now);
  assert.ok(timed.members.every(member => member.endAt?.getTime() === at(16).getTime() && !member.incomplete));
  const allDay = buildFamilyTime(profiles, [occurrence('family', 23, { source: { person: 'family', allDay: true } })], [], now);
  assert.ok(allDay.members.every(member => member.hasPlan && member.incomplete && member.endAt === null));
});

test('an exact school date takes precedence over weekday and only lesson/activity entries block time', () => {
  const result = buildFamilyTime([profile('p')], [], [
    lesson('p', { id: 'other-day', date: '2026-10-08', weekday: 3, endTime: '23:00' }),
    lesson('p', { id: 'today', date: '2026-10-07', weekday: 1, endTime: '14:00' }),
    lesson('p', { id: 'weekly', date: '', weekday: 3, endTime: '15:00' }),
    lesson('p', { id: 'homework', type: 'homework', endTime: '22:00' }),
    lesson('p', { id: 'activity', type: 'activity', endTime: '16:00' }),
  ], now);
  assert.equal(result.endAt?.getTime(), at(16).getTime());
  assert.equal(result.incomplete, false);
});

test('school never invents a duration when hours are missing, invalid, equal or reversed', () => {
  for (const times of [
    { time: '', endTime: '12:00' }, { time: '08:00', endTime: '' },
    { time: '08:00', endTime: '25:00' }, { time: '8:00', endTime: '12:00' },
    { time: '12:00', endTime: '12:00' }, { time: '12:00', endTime: '11:30' },
  ]) {
    const result = buildFamilyTime([profile('p')], [], [lesson('p', times)], now);
    assert.equal(result.endAt, null, JSON.stringify(times));
    assert.equal(result.members[0].hasPlan, true);
    assert.equal(result.incomplete, true);
  }
});

test('only the exact first nonempty eduVULCAN note line cancels a lesson', () => {
  const cases = [
    { source: 'eduvulcan', note: '\n  \nLekcja odwołana\nZastępstwo', cancelled: true },
    { source: 'manual', note: 'Lekcja odwołana', cancelled: false },
    { source: undefined, note: 'Lekcja odwołana', cancelled: false },
    { source: 'eduvulcan', note: 'Informacja\nLekcja odwołana', cancelled: false },
    { source: 'eduvulcan', note: 'Lekcja odwołana przez nauczyciela', cancelled: false },
    { source: 'eduvulcan', note: 'lekcja odwołana', cancelled: false },
  ];
  for (const row of cases) {
    const result = buildFamilyTime([profile('p')], [], [lesson('p', row)], now);
    assert.equal(result.members[0].hasPlan, !row.cancelled, row.note);
    assert.equal(result.endAt?.getTime() ?? null, row.cancelled ? null : at(12).getTime(), row.note);
  }
});

test('a visible linked occurrence supplies school timing while an absent link keeps the school fallback', () => {
  const linked = occurrence('p', 15, { source: { id: 'event', person: 'p', allDay: false } });
  const missingHours = lesson('p', { calendarEventId: 'event', time: '', endTime: '' });
  const result = buildFamilyTime([profile('p')], [linked], [missingHours], now);
  assert.equal(result.endAt?.getTime(), at(15).getTime());
  assert.equal(result.incomplete, false);
  const allDay = buildFamilyTime([profile('p')], [{ ...linked, source: { ...linked.source, allDay: true } }], [lesson('p', { calendarEventId: 'event' })], now);
  assert.equal(allDay.endAt, null);
  assert.equal(allDay.incomplete, true);
  const absent = buildFamilyTime([profile('p')], [], [lesson('p', { calendarEventId: 'not-visible' })], now);
  assert.equal(absent.endAt?.getTime(), at(12).getTime());
  assert.equal(absent.incomplete, false);
});

test('an explicitly linked canceled provider lesson also removes its own calendar obligation', () => {
  const result = buildFamilyTime([profile('p')], [occurrence('p', 15, { source: { id: 'event', person: 'p' } })], [
    lesson('p', { source: 'eduvulcan', note: 'Lekcja odwołana', calendarEventId: 'event' }),
  ], now);
  assert.equal(result.endAt, null);
  assert.equal(result.members[0].hasPlan, false);
});

test('cancelled imported events remain in the calendar but no longer delay family availability', () => {
  const plan = [
    { id: 'work', person: 'p', date: at(8), endDate: at(14), allDay: false, repeat: 'none' as const, repeatUntil: null },
    { id: 'cancelled-google', person: 'family', date: at(16), endDate: at(19), allDay: false, repeat: 'none' as const, repeatUntil: null, cancelled: true },
  ];
  const occurrences = plan.flatMap(event => generateOccurrences(event, startOfDay(now), endOfDay(now)));
  assert.equal(occurrences.length, 2);
  const result = buildFamilyTime([profile('p')], occurrences, [], now);
  assert.equal(result.endAt?.getTime(), at(14).getTime()); assert.equal(result.incomplete, false);
  assert.equal(occurrences.length, 2); assert.equal(plan[1].cancelled, true);
});

test('a cancelled all-day source event does not turn a known timed plan into an incomplete day', () => {
  const result = buildFamilyTime([profile('p')], [occurrence('p', 14), occurrence('family', 23, {
    source: { id: 'cancelled-all-day', person: 'family', allDay: true, cancelled: true },
  })], [], now);
  assert.equal(result.endAt?.getTime(), at(14).getTime()); assert.equal(result.incomplete, false);
  assert.equal(buildFamilyTime([profile('p')], [occurrence('p', 14)], [], now).endAt?.getTime(), result.endAt?.getTime());
});

test('calendar projections consume generated recurrence exceptions and moved occurrence times/persons', () => {
  const original = at(10);
  const base = {
    id: 'weekly', person: 'p', date: new Date(2026, 8, 30, 10), endDate: new Date(2026, 8, 30, 11),
    allDay: false, repeat: 'weekly' as const, repeatUntil: null,
  };
  const excluded = generateOccurrences({ ...base, recurrenceExceptions: [original.toISOString()] }, startOfDay(now), endOfDay(now));
  assert.equal(buildFamilyTime([profile('p')], excluded, [], now).members[0].hasPlan, false);
  const moved = generateOccurrences({ ...base, recurrenceOverrides: { [original.toISOString()]: { date: at(14), endDate: at(16), person: 'q' } } }, startOfDay(now), endOfDay(now));
  const result = buildFamilyTime([profile('p'), profile('q')], moved, [], now);
  assert.equal(result.members[0].hasPlan, false);
  assert.equal(result.members[1].endAt?.getTime(), at(16).getTime());
});

test('countdown uses hours and minutes, rounds future seconds up, and stays neutral without a valid end', () => {
  assert.equal(countdownText(at(13, 18), now), 'za 4 godz. 18 min');
  assert.equal(countdownText(at(10), now), 'za 1 godz.');
  assert.equal(countdownText(new Date(now.getTime() + 1), now), 'za 1 min');
  assert.equal(countdownText(now, now), 'już wolni');
  assert.equal(countdownText(null, now), 'Brak danych o planie');
  assert.equal(countdownText(new Date(Number.NaN), now), 'Brak danych o planie');
});

test('private conversation labels and avatars use the other participant for outgoing and incoming messages', () => {
  const me = profile('my-profile', { uid: 'me', name: 'Ja' });
  const other = profile('other-profile', { uid: 'other', name: 'Dominika', photoURL: '/dom.png' });
  for (const sender of ['me', 'other']) {
    const result = latestConversations([message('private', 'private:me:other', { uid: sender, name: sender, participants: ['other', 'me'] })], [me, other], 'me');
    assert.equal(result[0].label, 'Dominika');
    assert.equal(result[0].profile, other);
  }
  const family = latestConversations([message('family', 'family', { uid: 'other' })], [me, other], 'me');
  assert.equal(family[0].label, 'Rodzina');
  assert.equal(family[0].profile, other);
});

test('legacy private channels can identify a counterpart without participants; unknown profiles keep a neutral label', () => {
  const result = latestConversations([message('legacy', 'private:me:unknown')], [profile('me')], 'me');
  assert.equal(result[0].label, 'Rozmowa prywatna');
  assert.equal(result[0].profile, undefined);
});

test('malformed private channels, participant mismatches and conversations excluding the current UID are omitted', () => {
  const malformed = [
    message('outsider', 'private:other:third', { uid: 'other', participants: ['other', 'third'] }),
    message('wrong-channel', 'private:me:other', { participants: ['me', 'third'] }),
    message('self', 'private:me:me', { participants: ['me', 'me'] }),
    message('too-many', 'private:me:other', { participants: ['me', 'other', 'third'] }),
    message('author', 'private:me:other', { uid: 'third', participants: ['me', 'other'] }),
    message('missing', 'private:me:'), message('extra', 'private:me:other:third'),
    message('unsorted', 'private:other:me'), message('unknown', 'other-channel'),
  ];
  assert.deepEqual(latestConversations(malformed, [profile('me')], 'me'), []);
});

test('chat deduplicates IDs before grouping and orders the three newest conversations by timestamp then ID', () => {
  const messages = [
    message('dup', 'private:me:other', { createdAt: at(8) }),
    message('dup', 'family', { createdAt: at(12) }),
    message('older-family', 'family', { createdAt: at(11) }),
    message('z', 'private:me:z', { createdAt: at(10) }),
    message('a', 'private:a:me', { createdAt: at(10) }),
    message('old', 'private:me:old', { createdAt: at(9) }),
    message('z', 'private:me:z', { createdAt: at(10) }),
  ];
  const result = latestConversations(messages, [], 'me');
  assert.deepEqual(result.map(row => row.message.id), ['dup', 'z', 'a']);
  assert.deepEqual(latestConversations([...messages].reverse(), [], 'me').map(row => row.message.id), ['dup', 'z', 'a']);
  assert.equal(messages[0].createdAt?.getTime(), at(8).getTime());
});

test('shopping media matches only a normalized exact title and merges a renamed override by product ID', () => {
  const defaults = [product('cream', 'Śmietana', { imageURL: '/cream.png' }), product('milk', 'Mleko', { imageURL: '/old.png' })];
  const overrides = [{ id: 'milk', title: 'Napój owsiany', imageURL: '/oat.png' }];
  const rows = shoppingPreview([shoppingItem('a', '  SMIETANA  '), shoppingItem('b', 'Śmietana 30%'), shoppingItem('c', 'Napój owsiany')], defaults, overrides, false);
  assert.equal(rows[0].product?.imageURL, '/cream.png');
  assert.equal(rows[1].product, undefined);
  assert.equal(rows[2].product?.id, 'milk');
  assert.equal(rows[2].product?.imageURL, '/oat.png');
  assert.equal(shoppingPreview([shoppingItem('a', 'Mleko')], defaults, overrides, false)[0].product, undefined);
  assert.equal(defaults[1].title, 'Mleko');
  assert.equal(shoppingPreview([shoppingItem('apple', ' JABLKA ')], [product('apples', 'Jabłka', { imageURL: '/apples.png' })], [], false)[0].product?.imageURL, '/apples.png');
});

test('ambiguous, hidden and unavailable adult catalog products provide no image or icon', () => {
  const defaults = [
    product('one', 'Jabłko', { imageURL: '/one.png' }), product('two', ' JABŁKO ', { imageURL: '/two.png' }),
    product('hidden', 'Sekret', { imageURL: '/hidden.png' }), product('adult', 'Wino', { adultOnly: true, imageURL: '/wine.png' }),
  ];
  const items = [shoppingItem('a', 'jabłko'), shoppingItem('b', 'Sekret'), shoppingItem('c', 'Wino')];
  const rows = shoppingPreview(items, defaults, [{ id: 'hidden', hidden: true }], false);
  assert.ok(rows.every(row => row.product === undefined));
  assert.equal(shoppingPreview([items[2]], defaults, [], true)[0].product?.imageURL, '/wine.png');
  assert.equal(rows.length, 3);
});

test('undefined override fields preserve base media and adult restrictions; explicit empty/false fields override them', () => {
  const defaults = [product('wine', 'Wino', { adultOnly: true, imageURL: '/wine.png', icon: '🍷' })];
  const item = shoppingItem('a', 'Wino');
  const absentFields = [{ id: 'wine', imageURL: undefined, adultOnly: undefined, icon: undefined }];
  assert.equal(shoppingPreview([item], defaults, absentFields, false)[0].product, undefined);
  const available = shoppingPreview([item], defaults, absentFields, true)[0].product;
  assert.equal(available?.imageURL, '/wine.png');
  assert.equal(available?.icon, '🍷');
  assert.equal(shoppingPreview([item], defaults, [{ id: 'wine', imageURL: '/new.png' }], false)[0].product, undefined);
  const explicit = shoppingPreview([item], defaults, [{ id: 'wine', adultOnly: false, imageURL: '', icon: '' }], false)[0].product;
  assert.equal(explicit?.adultOnly, false);
  assert.equal(explicit?.imageURL, '');
  assert.equal(explicit?.icon, '');
});

test('shopping previews keep purchase quantities intact, exclude done items, and deterministically cap open documents at three', () => {
  const items = [
    shoppingItem('done', 'Mleko', { done: true, createdAt: at(1), quantity: '100' }),
    shoppingItem('z', 'Mleko', { createdAt: at(10), quantity: '3', unit: 'l' }),
    shoppingItem('b', 'Mleko', { createdAt: at(9), quantity: '', unit: '' }),
    shoppingItem('a', 'Mleko', { createdAt: at(9), quantity: '0', unit: 'opak.' }),
    shoppingItem('last', 'Mleko', { createdAt: at(11), quantity: '999' }),
  ];
  const rows = shoppingPreview(items, [product('milk', 'Mleko', { defaultQuantity: '99', defaultUnit: 'szt.' })], [], false);
  assert.deepEqual(rows.map(row => row.item.id), ['a', 'b', 'z']);
  assert.deepEqual(rows.map(row => [row.item.quantity, row.item.unit]), [['0', 'opak.'], ['', ''], ['3', 'l']]);
  assert.equal(rows[0].item, items[3]);
  assert.equal(rows[0].item.done, false);
  assert.equal('inStock' in rows[0].item, false);
  assert.deepEqual(shoppingPreview([...items].reverse(), [], [], false).map(row => row.item.id), ['a', 'b', 'z']);
});
