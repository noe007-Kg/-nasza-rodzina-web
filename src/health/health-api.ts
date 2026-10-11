import { familyAction } from '../family-v2-client';
import type { HealthDocumentMetadata } from './document-model';

export const healthDocumentAction = <T,>(body: Record<string, unknown>) => familyAction<T>('health', body);
export function prepareHealthDocument(ownerProfileId: string, metadata: HealthDocumentMetadata, file: File) {
  return healthDocumentAction<{ documentId: string; storagePath: string }>({ operation: 'prepare', ownerProfileId, metadata,
    mimeType: file.type, size: file.size, fileName: file.name });
}
