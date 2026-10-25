import { useEffect, useState } from 'react';
import { auth } from '../firebase';
import { healthDocumentAction, HEALTH_DOCUMENTS_CHANGED } from './health-api';
import { parseHealthDocument, type ProtectedHealthDocument } from './document-model';

export type SharedCopyFolder = { ownerProfileId: string; ownerPersonKey: string; memberUids: string[] };

/** The backend checks UID ACLs and new-document family scope; a global Firestore list cannot prove both. */
export function useProtectedHealthDocuments(uid: string) {
  const [state, setState] = useState<{ uid: string; rows: ProtectedHealthDocument[]; copyFolders: SharedCopyFolder[]; configured: boolean; writesEnabled: boolean; error: string }>({
    uid: '', rows: [], copyFolders: [], configured: false, writesEnabled: false, error: '' });
  useEffect(() => {
    let active = true;
    let pending: Promise<void> | null = null;
    let reloadAfterPending = false;
    setState({ uid, rows: [], copyFolders: [], configured: false, writesEnabled: false, error: '' });
    const load = () => {
      if (auth.currentUser?.uid !== uid || document.visibilityState !== 'visible') return;
      if (pending) { reloadAfterPending = true; return; }
      pending = healthDocumentAction<{ documents?: Array<Record<string, unknown>>; copyFolders?: SharedCopyFolder[]; writesEnabled?: boolean }>({ operation: 'state' }).then(result => {
        if (!active || auth.currentUser?.uid !== uid) return;
        const rows = (Array.isArray(result.documents) ? result.documents : []).flatMap(value => {
          const parsed = typeof value.id === 'string' ? parseHealthDocument(value.id, value) : null;
          return parsed ? [parsed] : [];
        }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.issuedOn.localeCompare(a.issuedOn));
        setState({ uid, rows, copyFolders: Array.isArray(result.copyFolders) ? result.copyFolders : [], writesEnabled: result.writesEnabled === true, configured: true, error: '' });
      }).catch(() => {
        if (active) setState({ uid, rows: [], copyFolders: [], configured: false, writesEnabled: false,
          error: 'Nie udało się odczytać chronionych dokumentów. Sprawdź połączenie i konfigurację backendu. Dotychczasowe wpisy pozostają dostępne.' });
      }).finally(() => { pending = null; if (active && reloadAfterPending) { reloadAfterPending = false; load(); } });
    };
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    window.addEventListener(HEALTH_DOCUMENTS_CHANGED, load);
    return () => { active = false; window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load);
      window.removeEventListener(HEALTH_DOCUMENTS_CHANGED, load); };
  }, [uid]);
  return state.uid === uid ? state : { uid, rows: [], copyFolders: [], configured: false, writesEnabled: false, error: '' };
}
