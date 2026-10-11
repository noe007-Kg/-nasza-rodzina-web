export const HEALTH_DOCUMENT_KINDS = {
  general: 'Dokument zdrowotny', disability_certificate: 'Orzeczenie o niepełnosprawności',
  court_document: 'Dokument sądowy dotyczący ubezwłasnowolnienia', disability_card: 'Legitymacja osoby niepełnosprawnej',
} as const;
export type HealthDocumentKind = keyof typeof HEALTH_DOCUMENT_KINDS;
export type HealthDocumentMetadata = {
  title: string; documentType: HealthDocumentKind; issuedOn: string; expiresOn: string; indefinite: boolean;
  number: string; note: string; pinned: boolean; shareOwner: boolean;
};
export type ProtectedHealthDocument = HealthDocumentMetadata & {
  id: string; ownerProfileId: string; ownerUid: string | null; ownerPersonKey: string;
  readers: string[]; editors: string[]; createdBy: string; state: 'ready';
  storagePath: string; mimeType: string; fileName: string; size: number;
};
export function emptyHealthDocument(): HealthDocumentMetadata {
  return { title: '', documentType: 'general', issuedOn: '', expiresOn: '', indefinite: false, number: '', note: '', pinned: false, shareOwner: false };
}
export function validDocumentDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function documentExpiryDays(expiresOn: string, now = new Date()): number | null {
  if (!validDocumentDate(expiresOn)) return null;
  const pieces = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) => pieces.find(piece => piece.type === name)?.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  return Math.round((Date.parse(`${expiresOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
}
export function documentValidity(document: Pick<HealthDocumentMetadata, 'expiresOn' | 'indefinite'>, now = new Date()) {
  if (document.indefinite) return { label: 'Bezterminowy', tone: 'valid' as const };
  const days = documentExpiryDays(document.expiresOn, now);
  if (days === null) return { label: 'Bez daty ważności', tone: 'unknown' as const };
  if (days < 0) return { label: 'Termin upłynął', tone: 'expired' as const };
  if (days <= 90) return { label: days === 0 ? 'Ważny do dzisiaj' : `Kończy się ważność · ${days} dni`, tone: 'soon' as const };
  return { label: 'Ważny', tone: 'valid' as const };
}
export function parseHealthDocument(id: string, value: Record<string, unknown>): ProtectedHealthDocument | null {
  if (value.state !== 'ready' || typeof value.ownerProfileId !== 'string' || typeof value.storagePath !== 'string'
    || !value.storagePath.startsWith(`healthDocuments/${id}/`) || !Array.isArray(value.readers) || !Array.isArray(value.editors)) return null;
  const string = (name: string) => typeof value[name] === 'string' ? value[name] as string : '';
  return { id, title: string('title'), documentType: Object.hasOwn(HEALTH_DOCUMENT_KINDS, string('documentType')) ? string('documentType') as HealthDocumentKind : 'general',
    issuedOn: string('issuedOn'), expiresOn: string('expiresOn'), indefinite: value.indefinite === true, number: string('number'), note: string('note'),
    pinned: value.pinned === true, shareOwner: value.shareOwner === true, ownerProfileId: value.ownerProfileId,
    ownerUid: typeof value.ownerUid === 'string' ? value.ownerUid : null, ownerPersonKey: string('ownerPersonKey'),
    readers: value.readers.filter((uid): uid is string => typeof uid === 'string'), editors: value.editors.filter((uid): uid is string => typeof uid === 'string'),
    createdBy: string('createdBy'), state: 'ready', storagePath: value.storagePath, mimeType: string('mimeType'), fileName: string('fileName'), size: Number(value.size) || 0 };
}
