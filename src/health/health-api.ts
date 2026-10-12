import { familyAction } from '../family-v2-client';
import type { HealthDocumentMetadata } from './document-model';
import type { VisitAttachmentSession } from './visit-attachment';

export const HEALTH_DOCUMENTS_CHANGED = 'health-documents-changed';
export async function healthDocumentAction<T>(body: Record<string, unknown>): Promise<T> {
  const result = await familyAction<T>('health', body);
  if (!['state', 'status', 'prepare', 'prepare-visit-attachment'].includes(String(body.operation))) {
    window.dispatchEvent(new CustomEvent(HEALTH_DOCUMENTS_CHANGED));
  }
  return result;
}
export function prepareHealthDocument(ownerProfileId: string, metadata: HealthDocumentMetadata, file: File) {
  return healthDocumentAction<{ documentId: string; storagePath: string }>({ operation: 'prepare', ownerProfileId, metadata,
    mimeType: file.type, size: file.size, fileName: file.name });
}

export function prepareVisitAttachment(session: VisitAttachmentSession, metadata: HealthDocumentMetadata) {
  return healthDocumentAction<{ documentId: string; recordId: string; storagePath: string }>({ operation: 'prepare-visit-attachment',
    documentId: session.documentId, recordId: session.recordId, ownerProfileId: session.ownerProfileId,
    privateToParents: session.privateToParents, metadata, mimeType: session.file.type, size: session.file.size, fileName: session.file.name });
}
export function finalizeVisitAttachment(session: VisitAttachmentSession, record: Record<string, unknown>, addToCalendar: boolean) {
  return healthDocumentAction({ operation: 'finalize-visit-attachment', documentId: session.documentId, recordId: session.recordId, record, addToCalendar });
}
export function discardVisitAttachment(documentId: string) {
  return healthDocumentAction({ operation: 'discard-visit-attachment', documentId });
}
