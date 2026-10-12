import type { HealthDocumentMetadata } from './document-model';

export type VisitAttachmentSession = {
  uid: string; ownerProfileId: string; recordId: string; documentId: string;
  privateToParents: boolean; file: File; storagePath?: string; uploaded: boolean; attempted?: boolean;
};
export type VisitAttachmentStage = 'preparing' | 'uploading' | 'saving' | 'saved';
type Services = {
  prepare(session: VisitAttachmentSession, metadata: HealthDocumentMetadata): Promise<{ storagePath: string }>;
  upload(file: File, path: string): Promise<void>;
  finalize(session: VisitAttachmentSession, record: Record<string, unknown>, addToCalendar: boolean): Promise<unknown>;
  probe?(session: VisitAttachmentSession): Promise<boolean>;
};

export async function assertHealthWriteAccess(status: () => Promise<{ writesEnabled?: boolean }>) {
  const state = await status();
  if (state.writesEnabled !== true) throw new Error('Zapis zdrowia jest wyłączony w tej wersji. Dane formularza nie zostały zapisane. Preview chroni dane produkcyjne.');
}

export function sameVisitAttachment(session: VisitAttachmentSession, next: Pick<VisitAttachmentSession, 'uid' | 'ownerProfileId' | 'recordId' | 'privateToParents' | 'file'>) {
  return session.uid === next.uid && session.ownerProfileId === next.ownerProfileId && session.recordId === next.recordId
    && session.privateToParents === next.privateToParents && session.file === next.file;
}

/** One upload ticket and record ID survive both transfer failure and an ambiguous save response. */
export async function saveVisitAttachment(session: VisitAttachmentSession, metadata: HealthDocumentMetadata,
  record: Record<string, unknown>, addToCalendar: boolean, services: Services, stage: (value: VisitAttachmentStage) => void) {
  if (!session.storagePath) {
    stage('preparing');
    session.storagePath = (await services.prepare(session, metadata)).storagePath;
  }
  if (!session.uploaded) {
    stage('uploading');
    // A lost completion response can leave a full object in create-only Storage.
    // Only the authorized backend may confirm it; never overwrite it to retry.
    if (!(session.attempted && services.probe && await services.probe(session))) {
      session.attempted = true;
      await services.upload(session.file, session.storagePath);
    }
    session.uploaded = true;
  }
  stage('saving');
  await services.finalize(session, record, addToCalendar);
  stage('saved');
}
