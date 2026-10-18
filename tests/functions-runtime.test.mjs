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
  assert.equal(exportedEndpoints.length, 17);
  assert.deepEqual(exportedEndpoints, ['notifyCalendar', 'notifyPrivateCalendar', 'notifyTasks', 'notifyShopping', 'notifyHealth', 'notifySchool',
    'notifySchoolParents', 'notifySchoolStudent', 'notifyChat', 'notifySchoolSync', 'eduVulcanSchoolHours', 'eduVulcanOffHours', 'medicineReminders', 'googleCalendarHourly', 'taskPhotoCleanup', 'healthDocumentReminders', 'financeReminders'].sort());
});


test('v2 maintenance remains separate from SP4 and health expiry never deletes files', () => {
  for (const [name, cron] of [['taskPhotoCleanup', '0 * * * *'], ['healthDocumentReminders', '0 8 * * *']]) {
    const endpoint = functions[name].__endpoint;
    assert.equal(endpoint.platform, 'gcfv2');
    assert.deepEqual(endpoint.region, ['europe-west1']);
    assert.equal(endpoint.scheduleTrigger.schedule, cron);
    assert.equal(endpoint.scheduleTrigger.timeZone, 'Europe/Warsaw');
    assert.equal(endpoint.maxInstances, 1);
    assert.equal(endpoint.concurrency, 1);
  }
});

test('task cleanup stays inert when its independent switch is off, even with the global V2 switch on', async () => {
  const names = ['FAMILY_TASKS_WRITES_ENABLED', 'FAMILY_V2_WRITES_ENABLED', 'FIREBASE_STORAGE_BUCKET'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.FAMILY_TASKS_WRITES_ENABLED = 'false';
    process.env.FAMILY_V2_WRITES_ENABLED = 'true';
    process.env.FIREBASE_STORAGE_BUCKET = 'demo-no-storage-request.appspot.com';
    // Without the task-only gate this would reach Storage/Firestore and fail:
    // this runtime-contract test never starts an emulator or accesses the cloud.
    await functions.taskPhotoCleanup.run({});
  } finally {
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }
});

test('finance reminders use one independent Warsaw daily job without any secret or Storage dependency', () => {
  const endpoint = functions.financeReminders.__endpoint;
  assert.equal(endpoint.platform, 'gcfv2');
  assert.deepEqual(endpoint.region, ['europe-west1']);
  assert.equal(endpoint.scheduleTrigger.schedule, '0 9 * * *');
  assert.equal(endpoint.scheduleTrigger.timeZone, 'Europe/Warsaw');
  assert.equal(endpoint.scheduleTrigger.retryConfig.retryCount, 3);
  assert.equal(endpoint.maxInstances, 1);
  assert.equal(endpoint.concurrency, 1);
  assert.deepEqual(endpoint.secretEnvironmentVariables || [], []);
});

test('finance reminders stay inert with their switch off even when the global V2 flag is on', async () => {
  const names = ['FAMILY_FINANCE_WRITES_ENABLED', 'FAMILY_V2_WRITES_ENABLED'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.FAMILY_FINANCE_WRITES_ENABLED = 'false';
    process.env.FAMILY_V2_WRITES_ENABLED = 'true';
    // A regression would try Firestore here. This test has no cloud credentials.
    await functions.financeReminders.run({});
  } finally {
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }
});
