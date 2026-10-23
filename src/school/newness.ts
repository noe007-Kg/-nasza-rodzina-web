export type SchoolNewnessRecord = {id: string; source?: string; createdAt?: Date; importedAt?: number};
/** syncedAt changes on every sync; createdAt is preserved by the import transaction. */
export function schoolRecordIsNew(row: SchoolNewnessRecord, baseline: number | null, seen: ReadonlySet<string>): boolean {
  return baseline !== null && row.source === 'eduvulcan' && (row.importedAt ?? row.createdAt?.getTime() ?? -Infinity) > baseline && !seen.has(row.id);
}
