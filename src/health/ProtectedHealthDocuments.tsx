import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from '../firebase';
import { Modal, type Member, type PersonKey, type User } from '../app-shared';
import { useFamilyDirectory } from '../family-directory';
import { memberPersonKey } from '../family-members';
import { HealthUploadStatus } from '../features/HealthUploadStatus';
import { observeHealthUpload, type HealthUploadProgress } from '../features/health-upload';
import { HEALTH_DOCUMENT_KINDS, documentValidity, emptyHealthDocument,
  type HealthDocumentKind, type HealthDocumentMetadata, type ProtectedHealthDocument } from './document-model';
import { documentPagesFile } from './document-pages';
import { healthDocumentAction, prepareHealthDocument } from './health-api';
import { HealthDocumentViewer } from './HealthDocumentViewer';
import { familyV2WritesAllowed } from '../family-v2-client';
import { useProtectedHealthDocuments } from './useProtectedHealthDocuments';
import { householdFamilyId } from '../household-scope';
import './health-documents.css';

export function ProtectedHealthDocuments({ user, member, person }: { user: User; member: Member | null; person: PersonKey }) {
  const directory = useFamilyDirectory();
  const profiles = directory.filter(profile => profile.active !== false && !profile.archived && !profile.disabled && !profile.id.startsWith('legacy:'));
  const own = profiles.find(profile => profile.id === user.uid);
  const selectedProfile = profiles.find(profile => memberPersonKey(profile) === person);
  const documentState = useProtectedHealthDocuments(user.uid);
  const documents = documentState.rows;
  const accessError = documentState.error;
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProtectedHealthDocument | null>(null);
  const [ownerProfileId, setOwnerProfileId] = useState(user.uid);
  const [metadata, setMetadata] = useState<HealthDocumentMetadata>(emptyHealthDocument);
  const [pages, setPages] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const uploaded = useRef<{ file: File; documentId: string; storagePath: string } | null>(null);
  const [progress, setProgress] = useState<HealthUploadProgress>({ phase: 'idle', percent: 0 });
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [previewState, setPreviewState] = useState<{ uid: string; document: ProtectedHealthDocument } | null>(null);
  const preview = previewState?.uid === user.uid ? previewState.document : null;
  const setPreview = (document: ProtectedHealthDocument | null) => setPreviewState(document ? { uid: user.uid, document } : null);
  const [showConsent, setShowConsent] = useState(false);
  const [grantee, setGrantee] = useState('');
  const [grantUIDs, setGrantUIDs] = useState<string[]>([]);
  const familyId = householdFamilyId(member);
  const writeState = { uid: user.uid, enabled: documentState.writesEnabled, configured: documentState.configured };
  const writesEnabled = documentState.writesEnabled && familyV2WritesAllowed();
  const consentRecipients = profiles.filter(profile => profile.id !== user.uid && profile.canLogin === true && ['parent', 'adult'].includes(profile.role || ''));
  useEffect(() => {
    if (!showConsent || !familyId) return;
    return onSnapshot(query(collection(db, 'healthDocumentGrants'), where('familyId', '==', familyId), where('ownerUid', '==', user.uid)), snapshot => {
      setGrantUIDs(snapshot.docs.flatMap(document => (document.data().authorizedUids || []) as string[]));
    }, () => setError('Nie udało się odczytać zgód. Nowe funkcje wymagają przygotowania Firebase.'));
  }, [showConsent, user.uid, familyId]);

  const visible = documents.filter(document => person === 'family' || document.ownerPersonKey === person);
  const owner = profiles.find(profile => profile.id === ownerProfileId);
  const ownerName = owner?.name || owner?.personKey || 'właścicielowi';
  const importantKinds = Object.entries(HEALTH_DOCUMENT_KINDS).filter(([kind]) => kind !== 'general') as Array<[HealthDocumentKind, string]>;
  function reset() {
    setPages([]); uploaded.current = null; setProgress({ phase: 'idle', percent: 0 }); setStage(''); setError(''); setSuccess('');
  }
  function addDocument(kind: HealthDocumentKind = 'general') {
    reset(); setEditing(null); setOwnerProfileId(member?.role === 'parent' ? selectedProfile?.id || user.uid : user.uid);
    setMetadata({ ...emptyHealthDocument(), documentType: kind, pinned: kind !== 'general' }); setShowForm(true);
  }
  function edit(document: ProtectedHealthDocument) {
    reset(); setEditing(document); setOwnerProfileId(document.ownerProfileId);
    setMetadata({ title: document.title, documentType: document.documentType, issuedOn: document.issuedOn, expiresOn: document.expiresOn,
      indefinite: document.indefinite, number: document.number, note: document.note, pinned: document.pinned, shareOwner: document.shareOwner }); setShowForm(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (savingRef.current || !writesEnabled) return;
    savingRef.current = true; setSaving(true); setError(''); setSuccess('');
    try {
      if (editing) await healthDocumentAction({ operation: 'update', documentId: editing.id, metadata });
      else {
        let completed = uploaded.current;
        if (!completed) {
          setStage('Przygotowywanie dokumentu');
          const file = await documentPagesFile(pages, setStage);
          const ticket = await prepareHealthDocument(ownerProfileId, metadata, file);
          setStage('Przesyłanie dokumentu');
          await observeHealthUpload(uploadBytesResumable(ref(storage, ticket.storagePath), file, { contentType: file.type }), setProgress);
          completed = { ...ticket, file }; uploaded.current = completed;
        }
        setStage('Zapisywanie dokumentu i sprawdzanie dostępności');
        await healthDocumentAction({ operation: 'save', documentId: completed.documentId });
        // A retry may include edited metadata; it never creates another uploaded file.
        await healthDocumentAction({ operation: 'update', documentId: completed.documentId, metadata });
      }
      setShowForm(false); setSuccess('✓ Dokument zapisany i dostępny dla wskazanych osób.');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Nie udało się zapisać dokumentu. Spróbuj ponownie.');
      setStage(uploaded.current ? 'Plik przesłany. Zapis dokumentu wymaga ponowienia.' : 'Nie udało się zapisać dokumentu.');
    } finally { savingRef.current = false; setSaving(false); }
  }
  async function remove(document: ProtectedHealthDocument) {
    if (!writesEnabled || !window.confirm(`Usunąć dokument „${document.title}” oraz jego plik?`)) return;
    try {
      const result = await healthDocumentAction<{ deleted: boolean; deletionPending?: boolean }>({ operation: 'delete', documentId: document.id, confirm: true });
      setSuccess(result.deleted ? 'Dokument i plik zostały usunięte.' : 'Zlecono usunięcie. Serwer ponowi usuwanie pliku.');
    } catch (value) { setError(value instanceof Error ? value.message : 'Nie udało się usunąć dokumentu.'); }
  }
  async function changeConsent(uid: string, revoke: boolean) {
    if (savingRef.current || !uid || !writesEnabled) return;
    if (revoke && !window.confirm('Wycofać upoważnienie i dostęp tej osoby do dotychczasowych dokumentów?')) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      await healthDocumentAction({ operation: revoke ? 'revoke' : 'grant', ownerProfileId: user.uid, granteeUid: uid, canEdit: true });
      setSuccess(revoke ? 'Wycofano upoważnienie do dokumentów.' : 'Zapisano świadomą zgodę na zarządzanie dokumentami.');
    } catch (value) { setError(value instanceof Error ? value.message : 'Nie udało się zapisać zgody.'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <section className="health-protected-documents" aria-label="Chronione dokumenty zdrowotne">
    <header><div><strong>📌 Ważne dokumenty</strong><small>Osobne uprawnienia dla każdego dokumentu.</small></div><button type="button" onClick={() => addDocument()}>Dodaj dokument +</button></header>
    {accessError && <p className="health-doc-access-note" role="status">{accessError}</p>}
    {!writesEnabled && <p className="health-doc-access-note" role="status">{writeState.uid === user.uid && writeState.configured ? 'Podgląd 2.0: zapis dokumentów i zmiany upoważnień są wyłączone, aby chronić dane produkcyjne.' : 'Zapis chronionych dokumentów wymaga konfiguracji backendu i reguł Firebase 2.0. Możesz obejrzeć formularz bez zapisywania danych.'}</p>}
    <p className="health-doc-access-note">Dokumenty osoby dorosłej wymagają jej zgody lub potwierdzonego umocowania prawnego. Sama rola rodzica nie daje dostępu. Starsze dokumenty zachowują dotychczasowe uprawnienia i wymagają osobnego przeglądu zgód.</p>
    {person !== 'family' && <div className="health-important-document-types">{importantKinds.map(([kind, label]) => {
      const document = visible.find(value => value.documentType === kind);
      return <button type="button" key={kind} onClick={() => document ? setPreview(document) : addDocument(kind)}><span>📄</span><strong>{label}</strong><small>{document ? document.title : 'Nie dodano dokumentu'}</small></button>;
    })}</div>}
    {success && <p role="status">{success}</p>}{error && !showForm && <p role="alert">{error}</p>}
    <div className="health-protected-document-list">{visible.length === 0 ? <p>Brak dokumentów udostępnionych w tej kartotece.</p> : visible.map(document => {
      const status = documentValidity(document);
      return <article key={document.id} className="health-protected-document-row">
        <div><strong>{document.pinned ? '📌 ' : ''}{document.title}</strong><small>{document.ownerPersonKey} · {HEALTH_DOCUMENT_KINDS[document.documentType]}</small><span className={`health-document-status ${status.tone}`}>{status.label}</span>
          {document.expiresOn && !document.indefinite && <small>Ważny do: {document.expiresOn}</small>}
          <details><summary>Szczegóły dokumentu</summary>{document.issuedOn && <p>Data wydania: {document.issuedOn}</p>}{document.number && <p>Numer: {document.number}</p>}{document.note && <p>{document.note}</p>}<small>Plik: {document.fileName}</small></details></div>
        <div className="health-document-row-actions"><button type="button" onClick={() => setPreview(document)}>Otwórz</button>{document.editors.includes(user.uid) && <><button type="button" onClick={() => edit(document)}>Edytuj</button><button type="button" disabled={!writesEnabled} onClick={() => void remove(document)}>Usuń</button></>}</div>
      </article>;
    })}</div>
    {own && <details className="health-consent-settings" onToggle={event => setShowConsent(event.currentTarget.open)}><summary>Moje upoważnienia do dokumentów</summary>
      <p>Możesz świadomie upoważnić wybraną osobę do dodawania dokumentów w Twojej kartotece. Widoczność konkretnego dokumentu ustala się osobno. Potwierdzone umocowanie prawne wymaga niezależnej weryfikacji administratora.</p>
      <label>Upoważniona osoba<select value={grantee} onChange={event => setGrantee(event.target.value)}><option value="">Wybierz osobę</option>{consentRecipients.map(profile => <option key={profile.id} value={profile.id}>{profile.name || profile.personKey}</option>)}</select></label>
      <button type="button" disabled={!grantee || saving || !writesEnabled} onClick={() => void changeConsent(grantee, false)}>Upoważnij za moją zgodą</button>
      {grantUIDs.map(uid => <div key={uid}><span>{profiles.find(profile => profile.id === uid)?.name || 'Upoważniona osoba'}</span><button type="button" disabled={saving || !writesEnabled} onClick={() => void changeConsent(uid, true)}>Wycofaj upoważnienie</button></div>)}
    </details>}
    {showForm && <Modal title={editing ? 'Edytuj dokument' : 'Nowy chroniony dokument'} wide onClose={() => { if (!saving) setShowForm(false); }}>
      <form className="form-grid health-protected-document-form" onSubmit={event => void save(event)}>
        <fieldset disabled={saving} className="health-document-fields field-wide">
          <label className="field"><span>Właściciel dokumentu</span><select required disabled={!!editing || member?.role !== 'parent' || !!uploaded.current} value={ownerProfileId} onChange={event => setOwnerProfileId(event.target.value)}>{profiles.filter(profile => member?.role === 'parent' || profile.id === user.uid).map(profile => <option key={profile.id} value={profile.id}>{profile.name || profile.personKey}</option>)}</select></label>
          <label className="field"><span>Typ dokumentu</span><select value={metadata.documentType} onChange={event => setMetadata(value => ({ ...value, documentType: event.target.value as HealthDocumentKind }))}>{Object.entries(HEALTH_DOCUMENT_KINDS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
          <label className="field field-wide"><span>Dokładna nazwa dokumentu</span><input required maxLength={300} value={metadata.title} onChange={event => setMetadata(value => ({ ...value, title: event.target.value }))} placeholder="Nazwa wynikająca z rzeczywiście dodanego dokumentu" /></label>
          <label className="field"><span>Data wydania</span><input type="date" value={metadata.issuedOn} onChange={event => setMetadata(value => ({ ...value, issuedOn: event.target.value }))} /></label>
          <label className="field"><span>Data ważności — opcjonalnie</span><input type="date" disabled={metadata.indefinite} value={metadata.expiresOn} onChange={event => setMetadata(value => ({ ...value, expiresOn: event.target.value }))} /></label>
          <label className="checkbox-field field-wide"><input type="checkbox" checked={metadata.indefinite} onChange={event => setMetadata(value => ({ ...value, indefinite: event.target.checked, expiresOn: event.target.checked ? '' : value.expiresOn }))} /><span>Bezterminowy — bez przypomnień o wygaśnięciu</span></label>
          <label className="field"><span>Numer dokumentu — opcjonalnie</span><input maxLength={200} value={metadata.number} onChange={event => setMetadata(value => ({ ...value, number: event.target.value }))} /></label>
          <label className="field field-wide"><span>Uwagi</span><textarea maxLength={4000} rows={2} value={metadata.note} onChange={event => setMetadata(value => ({ ...value, note: event.target.value }))} /></label>
          <label className="checkbox-field field-wide"><input type="checkbox" checked={metadata.pinned} onChange={event => setMetadata(value => ({ ...value, pinned: event.target.checked }))} /><span>Przypnij dokument</span></label>
          {ownerProfileId !== user.uid && owner?.canLogin === true && <label className="checkbox-field field-wide"><input type="checkbox" checked={metadata.shareOwner} onChange={event => setMetadata(value => ({ ...value, shareOwner: event.target.checked }))} /><span>Udostępnij dokument osobie: {ownerName}</span></label>}
          {!editing && <><label className="field field-wide"><span>PDF lub strony JPG / PNG / WebP</span><input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={!!uploaded.current} onChange={event => { uploaded.current = null; setProgress({ phase: 'idle', percent: 0 }); setPages(Array.from(event.target.files || [])); }} /></label>
            <label className="field field-wide"><span>Sfotografuj kolejną stronę / tył dokumentu</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!!uploaded.current} onChange={event => { const file = event.target.files?.[0]; if (file) setPages(value => [...value, file]); event.target.value = ''; }} /></label>
            <ol className="health-document-pages field-wide">{pages.map((file, index) => <li key={`${index}:${file.name}`}><span>{index + 1}. {file.name}</span><button type="button" disabled={index === 0 || !!uploaded.current} aria-label={`Przesuń stronę ${index + 1} wyżej`} onClick={() => setPages(value => { const copy = [...value]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy; })}>↑</button><button type="button" disabled={!!uploaded.current} onClick={() => setPages(value => value.filter((_, current) => current !== index))}>Usuń stronę</button></li>)}</ol>
            {pages.length > 1 && <small className="field-wide">Zdjęcia zostaną połączone w jeden PDF na tym urządzeniu. Jeden plik zachowuje swój oryginalny format.</small>}</>}
        </fieldset>
        <HealthUploadStatus progress={progress} fileName={uploaded.current?.file.name || pages[0]?.name || ''} error={progress.phase === 'error' ? error : undefined} />
        {stage && <p className="field-wide" role="status">{stage}</p>}{error && <p className="field-wide" role="alert">{error}</p>}
        {!writesEnabled && <p className="field-wide" role="status">Podgląd formularza — zapisywanie jest wyłączone.</p>}
        <div className="form-actions field-wide"><button type="button" className="secondary-button" disabled={saving} onClick={() => setShowForm(false)}>Anuluj</button><button className="primary-button" disabled={!writesEnabled || saving || !editing && pages.length === 0}>{saving ? 'Zapisuję…' : 'Zapisz dokument'}</button></div>
      </form>
    </Modal>}
    {preview && <HealthDocumentViewer uid={user.uid} file={{ title: preview.title, path: preview.storagePath, fileName: preview.fileName, mimeType: preview.mimeType }} onClose={() => setPreview(null)} />}
  </section>;
}
