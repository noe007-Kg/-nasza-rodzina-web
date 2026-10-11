import { useEffect, useRef, useState } from 'react';
import { getBlob, ref } from 'firebase/storage';
import { auth, storage } from '../firebase';
import { Modal } from '../app-shared';

export type HealthPreviewFile = { title: string; path: string; fileName?: string; mimeType?: string };

/** Blob URLs exist only for this authorized session and are revoked when the viewer closes. */
export function HealthDocumentViewer({ file, uid, onClose }: { file: HealthPreviewFile; uid: string; onClose(): void }) {
  const [url, setURL] = useState('');
  const [mime, setMime] = useState(file.mimeType || '');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let active = true; let blobURL = '';
    setURL(''); setError(''); setZoom(1);
    void getBlob(ref(storage, file.path), 10 * 1024 * 1024).then(blob => {
      if (!active || auth.currentUser?.uid !== uid) return;
      blobURL = URL.createObjectURL(blob); setMime(file.mimeType || blob.type); setURL(blobURL);
    }).catch(() => { if (active) setError('Nie udało się otworzyć pliku. Sprawdź połączenie i uprawnienia do dokumentu.'); });
    return () => { active = false; if (blobURL) URL.revokeObjectURL(blobURL); };
  }, [file.path, file.mimeType, uid]);
  async function fullscreen() {
    try {
      if (container.current?.requestFullscreen) await container.current.requestFullscreen();
      else {
        const apple = container.current as HTMLDivElement & { webkitRequestFullscreen?(): void };
        if (apple?.webkitRequestFullscreen) apple.webkitRequestFullscreen();
        else if (url) window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch { setError('Pełny ekran jest niedostępny. Możesz otworzyć plik w osobnej karcie.'); }
  }
  function print() {
    if (!url) return;
    if (mime === 'application/pdf') {
      // The native PDF viewer provides Print/AirPrint on browsers that cannot print an embedded PDF.
      const preview = window.open(url, '_blank', 'noopener,noreferrer');
      if (preview) preview.addEventListener('load', () => { try { preview.print(); } catch { /* Native browser Print remains available. */ } }, { once: true });
      return;
    }
    try { frame.current?.contentWindow?.print(); } catch { window.open(url, '_blank', 'noopener,noreferrer'); }
  }
  return <Modal title={file.title} onClose={onClose} wide>
    <div className="health-document-viewer" ref={container}>
      <div className="health-document-toolbar" aria-label="Podgląd dokumentu">
        <button type="button" disabled={!url} onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>Otwórz</button>
        <button type="button" disabled={!url} onClick={() => setZoom(value => Math.min(3, value + .25))}>Powiększ +</button>
        <button type="button" disabled={!url || zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))}>Pomniejsz −</button>
        <button type="button" disabled={!url} onClick={() => void fullscreen()}>Pełny ekran</button>
        {url && <a href={url} download={file.fileName || file.title}>Pobierz</a>}
        <button type="button" disabled={!url} onClick={print}>Drukuj / AirPrint</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!url && !error && <p role="status">Otwieranie chronionego dokumentu…</p>}
      {url && <div className="health-document-preview">
        {mime === 'application/pdf'
          ? <iframe title={`PDF: ${file.title}`} src={`${url}#zoom=${Math.round(zoom * 100)}`} />
          : <img src={url} alt={file.title} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} />}
      </div>}
      {url && mime !== 'application/pdf' && <iframe ref={frame} className="health-document-print-frame" title="Wersja do druku" src={url} aria-hidden="true" tabIndex={-1} />}
      <small>Drukowanie korzysta z systemowego okna urządzenia, w tym AirPrint na urządzeniach Apple.</small>
    </div>
  </Modal>;
}
