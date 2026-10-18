import { EduServerError } from './edu-auth.mjs';
import { explicitFamilyId } from './family-identity.mjs';

/** Server-owned switch; a browser or request body can never enable writes. */
export function familyV2WritesAllowed(context, env = process.env, domain) {
  const projectId = context.app?.options?.projectId || context.db?.projectId || env.FIREBASE_PROJECT_ID;
  if (env.VERCEL_ENV === 'preview') return false;
  const localDemo = typeof projectId === 'string' && projectId.startsWith('demo-')
    && env.FIREBASE_PROJECT_ID === projectId
    && env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'
    && env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && !env.VERCEL;
  if (localDemo) return true;
  if (env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST || String(projectId || '').startsWith('demo-')) return false;
  // Tasks can be released independently. The old global switch must never
  // unlock points or accidentally enable Health/Finance during that release.
  if (domain === 'tasks') return env.FAMILY_TASKS_WRITES_ENABLED === 'true' && explicitFamilyId(context.profile) !== null;
  if (domain === 'finance') return env.FAMILY_FINANCE_WRITES_ENABLED === 'true' && explicitFamilyId(context.profile) !== null;
  return env.FAMILY_V2_WRITES_ENABLED === 'true';
}

export function assertFamilyV2WriteAllowed(context, env = process.env, domain) {
  if (!familyV2WritesAllowed(context, env, domain)) throw new EduServerError('FAMILY_V2_READ_ONLY', 503,
    'Nowe operacje zapisu wymagają konfiguracji i wdrożenia zabezpieczeń Firebase. Wersja Preview nie zmienia danych produkcyjnych.');
}
