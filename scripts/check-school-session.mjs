#!/usr/bin/env node
/** Read-only production diagnostics. Never reads envelopes, cookies or secret values. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const project = 'nasza-rodzina';
const region = 'europe-west1';
const functions = ['eduVulcanSchoolHours', 'eduVulcanOffHours'];
const schedules = ['*/10 8-14 * * *', '0 0-7,15-23 * * *'];
const fields = ['state', 'reconnectRequired', 'expiresAt', 'lastSuccessfulSyncAt', 'lastSyncAttemptAt',
  'lastErrorCode', 'sessionConfirmedAt', 'lease.expiresAt'];
const functionFields = 'name,state,updateTime,buildConfig.runtime,serviceConfig.secretEnvironmentVariables(key,secret)';
const jobFields = 'name,state,schedule,timeZone,lastAttemptTime,status(code)';
const query = new URLSearchParams();
for (const field of fields) query.append('mask.fieldPaths', field);
const connectionUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/_eduConnections/family?${query}`;
const functionUrls = functions.map(name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}?fields=${encodeURIComponent(functionFields)}`);
const jobUrls = functions.map(name => `https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/${region}/jobs/firebase-schedule-${name}-${region}?fields=${encodeURIComponent(jobFields)}`);
const allowedUrls = new Set([connectionUrl, ...functionUrls, ...jobUrls]);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const code = error => ({ 401: 'AUTHENTICATION_REQUIRED', 403: 'READ_PERMISSION_DENIED', 404: 'RESOURCE_NOT_FOUND' }[
  Number(error?.response?.status || error?.statusCode || error?.code)] || 'READ_FAILED');

export function schoolReadOnlyTransport(client) {
  return async url => {
    if (!allowedUrls.has(url)) throw new Error('READ_URL_FORBIDDEN');
    return (await client.request({ method: 'GET', url, maxRedirects: 0, timeout: 20000, maxContentLength: 1024 * 1024 })).data;
  };
}

export async function checkSchoolSession(client, now = Date.now()) {
  const read = schoolReadOnlyTransport(client);
  const report = { project, productionWrites: 0, secretValuesRead: false, checkedAt: new Date(now).toISOString(),
    connection: {}, functions: [], jobs: [], findings: [], deployedRenewalCodeVerified: false };
  try {
    const row = (await read(connectionUrl)).fields || {};
    const date = name => timestamp(row[name]?.timestampValue);
    report.connection = { state: ['connected', 'needs_profile', 'needs_reconnect'].includes(row.state?.stringValue) ? row.state.stringValue : 'unknown',
      reconnectRequired: row.reconnectRequired?.booleanValue === true, expiresAt: date('expiresAt'),
      lastSuccessfulSyncAt: date('lastSuccessfulSyncAt'), lastSyncAttemptAt: date('lastSyncAttemptAt'),
      sessionConfirmedAt: date('sessionConfirmedAt'), leaseExpiresAt: timestamp(row.lease?.mapValue?.fields?.expiresAt?.timestampValue),
      lastErrorCode: /^EDU_[A-Z0-9_]{1,76}$/.test(row.lastErrorCode?.stringValue || '') ? row.lastErrorCode.stringValue : null };
    if (report.connection.reconnectRequired) report.findings.push('PARENT_RECONNECT_REQUIRED');
    if (!report.connection.expiresAt) report.findings.push('SESSION_EXPIRY_NOT_VERIFIED');
    else if (Date.parse(report.connection.expiresAt) <= now) report.findings.push('LOCAL_SESSION_EXPIRED');
    if (!report.connection.lastSuccessfulSyncAt) report.findings.push('SUCCESSFUL_SYNC_NOT_VERIFIED');
    else if (now - Date.parse(report.connection.lastSuccessfulSyncAt) >= 23 * 3600000) report.findings.push('NO_SUCCESSFUL_SYNC_WITHIN_23_HOURS');
    else if (now - Date.parse(report.connection.lastSuccessfulSyncAt) > 75 * 60000) report.findings.push('SYNC_OVERDUE_FOR_EXISTING_SCHEDULE');
    if (!report.connection.sessionConfirmedAt) report.findings.push('AUTHORIZED_SESSION_RENEWAL_NOT_VERIFIED');
  } catch (error) { report.connection = { error: code(error) }; report.findings.push('CONNECTION_NOT_VERIFIED'); }
  for (const [index, name] of functions.entries()) {
    try {
      const fn = await read(functionUrls[index]);
      const keyBound = (fn.serviceConfig?.secretEnvironmentVariables || []).some(value =>
        value.key === 'EDUVULCAN_ENCRYPTION_KEY_BASE64' && value.secret === 'EDUVULCAN_ENCRYPTION_KEY_BASE64');
      report.functions.push({ name, active: fn.state === 'ACTIVE', node22: fn.buildConfig?.runtime === 'nodejs22',
        updatedAt: timestamp(fn.updateTime), existingEncryptionSecretBound: keyBound });
      if (fn.state !== 'ACTIVE' || fn.buildConfig?.runtime !== 'nodejs22' || !keyBound) report.findings.push(`${name}:FUNCTION_CONFIGURATION_NOT_VERIFIED`);
    } catch (error) { report.functions.push({ name, error: code(error) }); report.findings.push(`${name}:FUNCTION_NOT_VERIFIED`); }
    try {
      const job = await read(jobUrls[index]);
      const matches = job.schedule === schedules[index] && job.timeZone === 'Europe/Warsaw';
      report.jobs.push({ name, enabled: job.state === 'ENABLED', scheduleMatches: matches,
        schedule: job.schedule === schedules[index] ? schedules[index] : 'different-or-missing',
        timeZone: job.timeZone === 'Europe/Warsaw' ? 'Europe/Warsaw' : 'different-or-missing',
        lastAttemptAt: timestamp(job.lastAttemptTime), lastStatusCode: Number.isInteger(job.status?.code) ? job.status.code : null });
      if (job.state !== 'ENABLED' || !matches) report.findings.push(`${name}:SCHEDULE_NOT_VERIFIED`);
      if (!timestamp(job.lastAttemptTime)) report.findings.push(`${name}:SCHEDULER_EXECUTION_NOT_VERIFIED`);
      if (Number.isInteger(job.status?.code) && job.status.code !== 0) report.findings.push(`${name}:SCHEDULER_LAST_ATTEMPT_ERROR`);
    } catch (error) { report.jobs.push({ name, error: code(error) }); report.findings.push(`${name}:SCHEDULE_NOT_VERIFIED`); }
  }
  // Metadata cannot prove which renewal implementation is deployed or provider viability.
  report.findings.push('DEPLOYED_RENEWAL_SOURCE_NOT_VERIFIED');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2 || ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST'].some(name => process.env[name])) {
    console.error('Uruchom bez parametrów, w autoryzowanym Cloud Shell bez zmiennych emulatorów. Zapisów produkcyjnych: 0.');
    process.exitCode = 2;
  } else {
    try {
      // Existing local ADC only. No interactive login, credential file, token
      // logging or npm dependency installation is required for this check.
      const { stdout } = await promisify(execFile)('gcloud', ['auth', 'application-default', 'print-access-token'],
        { timeout: 30000, maxBuffer: 65536 });
      const token = stdout.trim();
      if (!token || /\s/.test(token)) throw new Error('AUTHENTICATION_REQUIRED');
      const client = { request: async ({ url, method }) => {
        if (method !== 'GET' || !allowedUrls.has(url)) throw new Error('READ_URL_FORBIDDEN');
        const response = await fetch(url, { method: 'GET', redirect: 'error',
          signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw Object.assign(new Error('READ_FAILED'), { statusCode: response.status });
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 1024 * 1024) throw new Error('READ_FAILED');
          chunks.push(chunk);
        }
        return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
      } };
      const report = await checkSchoolSession(client);
      console.log(JSON.stringify(report, null, 2));
      console.log('Odczyt metadanych: bez logowania do dziennika, bez sesji/sekretów, bez synchronizacji i wdrożenia.');
      process.exitCode = report.findings.length ? 2 : 0;
    } catch { console.error('Nie udało się uwierzytelnić kontroli. Zaloguj ADC wyłącznie we własnym Cloud Shell. Zapisów produkcyjnych: 0.'); process.exitCode = 2; }
  }
}
