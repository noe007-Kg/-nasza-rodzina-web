import { memberPersonKey } from '../family-members';
export const ACCOUNT_ACCENTS = ['auto', 'blue', 'pink'] as const;
export type AccountAccentPreference = typeof ACCOUNT_ACCENTS[number];
export type AccountAccent = 'blue' | 'pink';
export function accountAccentKey(uid: string) { return `nr-account-accent:v1:${encodeURIComponent(uid)}`; }
export function parseAccountAccent(value: unknown): AccountAccentPreference { return value === 'blue' || value === 'pink' ? value : 'auto'; }
/** Explicit defaults for this household's existing person keys, not gender inference. */
export function resolveAccountAccent(preference: AccountAccentPreference, member?: { personKey?: string; name?: string } | null): AccountAccent {
  if (preference !== 'auto') return preference;
  return ['Sebastian', 'Paweł', 'Nikodem'].includes(memberPersonKey(member)) ? 'blue' : 'pink';
}
