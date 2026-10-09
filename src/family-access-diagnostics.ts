import { schoolReadAccess } from './school/read-access';

export type FamilyQuerySource = 'family.calendar.shared' | 'family.calendar.private' | 'family.tasks' | 'family.school';
type DiagnosticProfile = Parameters<typeof schoolReadAccess>[0];
const codes = new Set(['permission-denied', 'unauthenticated', 'unavailable', 'resource-exhausted', 'failed-precondition', 'cancelled']);
const labels: Record<FamilyQuerySource, string> = {
  'family.calendar.shared': 'Rodzina — kalendarz rodzinny',
  'family.calendar.private': 'Rodzina — mój kalendarz prywatny',
  'family.tasks': 'Rodzina — zadania',
  'family.school': 'Rodzina — plan szkolny',
};

/** Never serialize an error or profile: diagnostics intentionally contain no identity or payload. */
export function familyAccessDiagnostic(source: FamilyQuerySource, error: unknown, profile: DiagnosticProfile) {
  const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : '';
  const normalized = typeof rawCode === 'string' ? rawCode.replace(/^firestore\//, '') : '';
  const code = codes.has(normalized) ? normalized : 'unknown';
  const role = profile?.role === 'parent' || profile?.role === 'child' ? profile.role : 'unknown';
  return { source, code, role, active: profile?.active === true, canLogin: profile?.canLogin === true,
    schoolIdentityValid: schoolReadAccess(profile) !== null };
}

export function familyAccessErrorMessage(diagnostic: ReturnType<typeof familyAccessDiagnostic>): string {
  const reason = diagnostic.code === 'permission-denied' || diagnostic.code === 'unauthenticated'
    ? 'Brak uprawnień do odczytu. Sprawdź dostęp swojego profilu.'
    : diagnostic.code === 'unavailable' ? 'Nie udało się połączyć. Sprawdź internet i spróbuj ponownie.'
    : 'Nie udało się odczytać danych. Spróbuj ponownie.';
  return `${labels[diagnostic.source]}. ${reason} Kod diagnostyczny: ${diagnostic.source}/${diagnostic.code}.`;
}
