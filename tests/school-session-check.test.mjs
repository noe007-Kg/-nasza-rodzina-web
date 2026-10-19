import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSchoolSession, schoolReadOnlyTransport } from '../scripts/check-school-session.mjs';

const now = Date.parse('2026-10-19T12:00:00Z');
const stamp = offset => ({ timestampValue: new Date(now + offset).toISOString() });
function clientFixture({ expired = false, forbidden = false, paused = false } = {}) {
  const requests = [];
  return { requests, async request(options) {
    requests.push(options);
    assert.equal(options.method, 'GET');
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.data, undefined);
    if (forbidden) throw { response: { status: 403 }, message: 'SYNTHETIC_SECRET_MUST_NOT_APPEAR' };
    if (options.url.includes('firestore.googleapis.com')) {
      const url = new URL(options.url);
      assert.ok(url.searchParams.getAll('mask.fieldPaths').includes('sessionConfirmedAt'));
      assert.ok(!url.searchParams.getAll('mask.fieldPaths').some(value => /envelope|cookie|students|connectedByUid/.test(value)));
      return { data: { fields: { expiresAt: stamp(expired ? -60000 : 23 * 3600000),
        lastSuccessfulSyncAt: stamp(expired ? -25 * 3600000 : -60000),
        sessionConfirmedAt: stamp(-60000), lastSyncAttemptAt: stamp(-60000) } } };
    }
    if (options.url.includes('cloudfunctions.googleapis.com')) return { data: {
      state: 'ACTIVE', buildConfig: { runtime: 'nodejs22' }, updateTime: new Date(now - 86400000).toISOString(),
      serviceConfig: { secretEnvironmentVariables: [{ key: 'EDUVULCAN_ENCRYPTION_KEY_BASE64', secret: 'EDUVULCAN_ENCRYPTION_KEY_BASE64' }] } } };
    return { data: { state: paused ? 'PAUSED' : 'ENABLED',
      schedule: options.url.includes('SchoolHours') ? '*/10 8-14 * * *' : '0 0-7,15-23 * * *',
      timeZone: 'Europe/Warsaw', lastAttemptTime: new Date(now - 60000).toISOString(), status: { code: 0 } } };
  } };
}

test('school check uses only five allowlisted metadata GETs and never claims deployed source verification', async () => {
  const client = clientFixture(); const report = await checkSchoolSession(client, now);
  assert.equal(client.requests.length, 5);
  assert.equal(report.productionWrites, 0);
  assert.equal(report.secretValuesRead, false);
  assert.equal(report.deployedRenewalCodeVerified, false);
  assert.deepEqual(report.findings, ['DEPLOYED_RENEWAL_SOURCE_NOT_VERIFIED']);
  assert.ok(report.functions.every(fn => fn.active && fn.node22 && fn.existingEncryptionSecretBound));
  assert.ok(report.jobs.every(job => job.enabled && job.scheduleMatches));
});

test('expired retention and a paused Scheduler are reported without attempting login or sync', async () => {
  const client = clientFixture({ expired: true, paused: true }); const report = await checkSchoolSession(client, now);
  assert.ok(report.findings.includes('LOCAL_SESSION_EXPIRED'));
  assert.ok(report.findings.includes('NO_SUCCESSFUL_SYNC_WITHIN_23_HOURS'));
  assert.equal(report.jobs.filter(job => !job.enabled).length, 2);
  assert.equal(client.requests.length, 5);
});

test('metadata permission errors leave independent checks unverified and never expose raw errors', async () => {
  const report = await checkSchoolSession(clientFixture({ forbidden: true }), now);
  assert.equal(report.connection.error, 'READ_PERMISSION_DENIED');
  assert.equal(report.functions.length, 2);
  assert.equal(report.jobs.length, 2);
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_SECRET'));
  assert.ok(report.findings.includes('CONNECTION_NOT_VERIFIED'));
});

test('metadata transport rejects unmasked documents, Secret Manager and arbitrary URLs before requesting', async () => {
  let calls = 0;
  const request = schoolReadOnlyTransport({ request: async () => { calls++; return { data: {} }; } });
  for (const url of ['https://secretmanager.googleapis.com/v1/projects/nasza-rodzina/secrets/key/versions/latest:access',
    'https://firestore.googleapis.com/v1/projects/nasza-rodzina/databases/(default)/documents/_eduConnections/family',
    'https://example.com/', 'http://firestore.googleapis.com/']) {
    await assert.rejects(request(url), /READ_URL_FORBIDDEN/);
  }
  assert.equal(calls, 0);
});
