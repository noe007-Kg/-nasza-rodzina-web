import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyFamilyProfiles, memberCanLogin, memberSchoolEnabled, schoolMemberProfiles } from '../src/family-members.ts';
import { parseSchoolFile } from '../src/school-import.ts';

test('legacy school metadata enables existing pupils without enabling Layla or creating accounts', () => {
  const defaults = legacyFamilyProfiles();
  assert.deepEqual(schoolMemberProfiles(defaults).map((member) => member.personKey), ['Paweł', 'Nikodem']);
  assert.equal(memberCanLogin(defaults.find((member) => member.personKey === 'Layla')), false);
  assert.equal(memberCanLogin(defaults.find((member) => member.personKey === 'Dominika')), true);
  assert.ok(defaults.every((member) => !member.uid));
});

test('explicit schoolEnabled controls eligibility independently from a pupil name', () => {
  assert.equal(memberSchoolEnabled({ personKey: 'Paweł', role: 'child', schoolEnabled: false }), false);
  assert.equal(memberSchoolEnabled({ personKey: 'New pupil', role: 'child', schoolEnabled: true }), true);
  assert.equal(memberSchoolEnabled({ personKey: 'Layla', role: 'child', schoolEnabled: true }), true);
  assert.equal(memberSchoolEnabled({ personKey: 'Unknown', role: 'child' }), false);
  assert.equal(memberSchoolEnabled({ personKey: 'Sebastian', role: 'parent', schoolEnabled: true }), false);
});

test('school roster excludes inactive profiles and collapses duplicate person identities', () => {
  const roster = schoolMemberProfiles([
    { id: 'old', personKey: 'Nikodem', active: false, schoolEnabled: true },
    { id: 'own-uid', personKey: 'Nikodem', schoolEnabled: true },
    { id: 'duplicate-profile', personKey: 'Nikodem', schoolEnabled: true },
    { id: 'archived', personKey: 'Paweł', archived: true, schoolEnabled: true },
    { id: 'disabled', personKey: 'Layla', disabled: true, schoolEnabled: true },
  ]);
  assert.equal(roster.length, 1);
  assert.equal(roster[0].id, 'own-uid');
});

test('roster-aware school imports reject a disabled pupil before any write', () => {
  const row = { person: 'Layla', type: 'homework', title: 'Historical entry', subject: '', date: '2026-10-02', time: '', endTime: '', weekday: 0, note: '' };
  assert.throws(() => parseSchoolFile(JSON.stringify([row]), 'json', ['Paweł', 'Nikodem']), /Nieznana osoba/);
  // Compatibility parsing remains available; historic data is not rewritten or deleted.
  assert.equal(parseSchoolFile(JSON.stringify([row]), 'json')[0].person, 'Layla');
});
