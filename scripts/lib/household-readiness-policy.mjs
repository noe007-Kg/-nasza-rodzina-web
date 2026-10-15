/** Evidence is supplied by the control runner, never inferred from warning counts. */
export function assessHouseholdReadiness(input = {}) {
  const checks = [];
  const add = (id, verified, code) => checks.push({ id, status: verified ? 'verified' : 'missing-or-failed', code: verified ? null : code });
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const archiveHash = input.backup?.archiveDigestSha256;
  add('migration-plan', input.plan?.canApply === false && input.plan?.blockers?.length === 0 && input.plan?.writesPerformed === 0, 'PLAN_NOT_VERIFIED');
  add('complete-backup', input.backup?.complete === true && input.backup?.manifestHashesVerified === true && hash(archiveHash), 'FULL_BACKUP_NOT_VERIFIED');
  add('restore', input.restore?.verified === true && input.restore?.safetyVerified === true
    && /^demo-household-restore-/.test(input.restore?.targetProjectId || '')
    && input.restore?.sourceProjectId === input.plan?.projectId && input.restore?.archiveDigestSha256 === archiveHash
    && input.restore?.emulatorExitCode === 0 && hash(archiveHash), 'RESTORE_NOT_VERIFIED');
  add('rollback-rehearsal', input.restore?.rollback?.verified === true && input.restore.rollback.concurrentChangeRejected === true
    && input.restore.rollback.postApplyReceiptIsDemoOnly === true, 'ROLLBACK_REHEARSAL_NOT_VERIFIED');
  for (const service of ['firestore', 'storage']) add(`production-rules-${service}`,
    input.rules?.[service]?.verified === true && input.rules[service].status === 'matched'
      && hash(input.rules[service].sha256) && input.rules[service].sha256 === input.rules[service].localSha256,
    `PRODUCTION_${service.toUpperCase()}_RULES_NOT_VERIFIED`);
  add('capture-consistency', input.consistency?.firestore?.stable === true && input.consistency?.storage?.stable === true && input.consistency?.auth?.stable === true, 'CAPTURE_CHANGED_OR_NOT_RECHECKED');
  add('eu-primary-storage', input.locations?.firestore?.verified === true && input.locations.firestore.europeanUnion === true
    && input.locations?.storage?.verified === true && input.locations.storage.europeanUnion === true, 'PRIMARY_DATA_EU_LOCATION_NOT_VERIFIED');
  add('external-files', Array.isArray(input.externalFiles) && input.externalFiles.every(item => item.status === 'captured' && hash(item.sha256)), 'EXTERNAL_FILES_NOT_FULLY_CAPTURED');
  add('household-confirmation', input.household?.ownerReviewed === true && input.household?.boundPlanDigest === input.planDigest
    && hash(input.planDigest), 'OWNER_HOUSEHOLD_REVIEW_REQUIRED');
  add('household-isolation', input.isolation?.fullMultiHouseholdVerified === true, 'LEGACY_HOUSEHOLD_ISOLATION_NOT_VERIFIED');
  add('private-download-tokens', input.tokens?.scanVerified === true && input.tokens.privateTokenCount === 0
    && input.tokens.productTokenCount === 0, 'PRIVATE_DOWNLOAD_TOKENS_REQUIRE_REVIEW');
  add('account-and-key-recovery', input.recovery?.authRecoveryVerified === true && input.recovery?.providerKeysRetainedVerified === true,
    'AUTH_AND_PROVIDER_KEY_RECOVERY_NOT_VERIFIED');
  add('backup-custody', input.custody?.secondCopyVerified === true && input.custody?.secondCopyArchiveDigest === archiveHash
    && input.custody?.keyStoredSeparately === true && hash(archiveHash), 'SECOND_BACKUP_COPY_AND_SEPARATE_KEY_NOT_VERIFIED');
  const blockers = checks.filter(item => item.code).map(item => item.code);
  return { schemaVersion: 1, status: blockers.length ? 'blocked' : 'evidence-prepared-requires-approval',
    canApply: false, migrationExecutable: false, writesPerformed: 0, checks, blockers,
    warnings: ['CAPTURE_IS_NOT_A_CROSS_SERVICE_ATOMIC_SNAPSHOT', 'AUTH_PASSWORDS_AND_SECRET_MANAGER_KEYS_ARE_NOT_BACKED_UP',
      'BACKUP_SECOND_COPY_AND_KEY_CUSTODY_REQUIRE_OWNER_CONFIRMATION', 'ALL_DATA_EU_RESIDENCY_NOT_PROVEN'] };
}
