import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schoolReadAccess } from '../src/school/read-access';
import { familyAccessDiagnostic, familyAccessErrorMessage } from '../src/family-access-diagnostics';

const child = { role: 'child', active: true, canLogin: true, name: 'Nikodem' };

test('an active parent reads school records without requiring a student identity', () => {
  assert.deepEqual(schoolReadAccess({ role: 'parent', active: true, canLogin: true }), { scope: 'parent' });
});

test('a legacy child without personKey retains its exact own-name school scope', () => {
  assert.deepEqual(schoolReadAccess(child), { scope: 'student', person: 'Nikodem' });
});

test('a valid dynamic student identity takes precedence over its display name', () => {
  const person = 'member-0123456789abcdef01234567';
  assert.deepEqual(schoolReadAccess({ ...child, personKey: person }), { scope: 'student', person });
});

for (const [label, personKey] of [['empty', ''], ['null', null], ['undefined', undefined], ['invalid', 'member-invalid'], ['family aggregator', 'family']] as const) {
  test(`an explicit ${label} student key never falls back to the valid display name`, () => {
    assert.equal(schoolReadAccess({ ...child, personKey }), null);
  });
}

test('missing identities, non-members and disabled accounts do not start a school query', () => {
  for (const profile of [null, {}, { ...child, name: '' }, { ...child, role: 'adult' }, { ...child, active: false }, { ...child, canLogin: false }]) {
    assert.equal(schoolReadAccess(profile), null);
  }
});

test('family query diagnostics expose an allowlisted code and scope, never credentials or raw error/profile contents', () => {
  const secret = 'sensitive-placeholder-not-for-diagnostics';
  const error = { code: 'firestore/permission-denied', message: secret, stack: secret, token: secret };
  const profile = { ...child, uid: secret, login: secret, password: secret, cookie: secret };
  const diagnostic = familyAccessDiagnostic('family.school', error, profile);
  assert.deepEqual(diagnostic, { source: 'family.school', code: 'permission-denied', role: 'child', active: true, canLogin: true, schoolIdentityValid: true });
  const message = familyAccessErrorMessage(diagnostic);
  assert.match(message, /family\.school\/permission-denied/);
  assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  assert.equal(message.includes(secret), false);
});

test('unknown error codes and roles are redacted rather than copied into diagnostics', () => {
  const secret = 'untrusted-sensitive-placeholder';
  const diagnostic = familyAccessDiagnostic('family.tasks', { code: secret, message: secret }, { role: secret });
  assert.equal(diagnostic.code, 'unknown');
  assert.equal(diagnostic.role, 'unknown');
  assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  assert.equal(familyAccessErrorMessage(diagnostic).includes(secret), false);
});
