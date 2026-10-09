import test from 'node:test';
import assert from 'node:assert/strict';
process.env.GCLOUD_PROJECT = 'demo-nasza-rodzina';
const functions = await import('../functions/index.mjs');

test('deployed scheduler contracts use two Warsaw crons, the existing secret and a deadline shorter than the shared lease', () => {
  for (const [name, cron] of [['eduVulcanSchoolHours', '*/10 8-14 * * *'], ['eduVulcanOffHours', '0 0-7,15-23 * * *']]) {
    const endpoint = functions[name].__endpoint;
    assert.equal(endpoint.scheduleTrigger.schedule, cron);
    assert.equal(endpoint.scheduleTrigger.timeZone, 'Europe/Warsaw');
    assert.equal(endpoint.scheduleTrigger.retryConfig.retryCount, 0);
    assert.equal(endpoint.timeoutSeconds, 110);
    assert.equal(endpoint.maxInstances, 1); assert.equal(endpoint.concurrency, 1);
    assert.deepEqual(endpoint.secretEnvironmentVariables, [{ key: 'EDUVULCAN_ENCRYPTION_KEY_BASE64' }]);
  }
});

test('chat is an immediate created-document trigger and medicine retains its five-minute schedule', () => {
  assert.equal(functions.notifyChat.__endpoint.eventTrigger.eventType, 'google.cloud.firestore.document.v1.created');
  assert.equal(functions.notifyChat.__endpoint.eventTrigger.eventFilterPathPatterns.document, 'familyMessages/{id}');
  assert.equal(functions.medicineReminders.__endpoint.scheduleTrigger.schedule, 'every 5 minutes');
  assert.equal(functions.medicineReminders.__endpoint.scheduleTrigger.timeZone, 'Europe/Warsaw');
  assert.equal(functions.notifySchoolSync.__endpoint.eventTrigger.eventFilterPathPatterns.document, '_notificationEvents/{connectionHash}/schoolSyncs/{batchId}');
});

test('existing school trigger names remain while no active Functions export enables FCM delivery', () => {
  for (const name of ['notifySchool', 'notifySchoolParents', 'notifySchoolStudent']) {
    assert.equal(functions[name].__endpoint.eventTrigger.eventType, 'google.cloud.firestore.document.v1.written');
  }
  assert.equal(functions.deliverPush, undefined);
});


test('Google Calendar adds one independent Gen2 hourly Warsaw job using separate calendar secrets', () => {
  const endpoint = functions.googleCalendarHourly.__endpoint;
  assert.equal(endpoint.platform, 'gcfv2');
  assert.deepEqual(endpoint.region, ['europe-west1']);
  assert.equal(endpoint.scheduleTrigger.schedule, '0 * * * *');
  assert.equal(endpoint.scheduleTrigger.timeZone, 'Europe/Warsaw');
  assert.equal(endpoint.scheduleTrigger.retryConfig.retryCount, 0);
  assert.equal(endpoint.timeoutSeconds, 540); assert.equal(endpoint.maxInstances, 1); assert.equal(endpoint.concurrency, 1);
  assert.deepEqual(endpoint.secretEnvironmentVariables, [{ key: 'CALENDAR_ENCRYPTION_KEY_BASE64' }, { key: 'GOOGLE_CALENDAR_CLIENT_SECRET' }]);
  const exportedEndpoints = Object.entries(functions).filter(([, value]) => value?.__endpoint).map(([name]) => name).sort();
  assert.equal(exportedEndpoints.length, 14);
  assert.deepEqual(exportedEndpoints, ['notifyCalendar', 'notifyPrivateCalendar', 'notifyTasks', 'notifyShopping', 'notifyHealth', 'notifySchool',
    'notifySchoolParents', 'notifySchoolStudent', 'notifyChat', 'notifySchoolSync', 'eduVulcanSchoolHours', 'eduVulcanOffHours', 'medicineReminders', 'googleCalendarHourly'].sort());
});
