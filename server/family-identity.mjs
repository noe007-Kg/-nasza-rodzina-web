/** An explicit household ID from a trusted member/bill snapshot, never a default
 * group for unassigned accounts. Whitespace is not normalized into another ID. */
export function explicitFamilyId(profile) {
  const value = profile?.familyId;
  return typeof value === 'string' && value !== '__legacy__'
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : null;
}
