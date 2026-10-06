import type { HealthUploadProgress } from './health-upload';

export function HealthUploadStatus({ progress, fileName, error }: {
  progress: HealthUploadProgress;
  fileName: string;
  error?: string;
}) {
  if (progress.phase === 'idle') return null;
  const label = progress.phase === 'uploaded' ? '✓ Przesłano' : progress.phase === 'error' ? 'Nie udało się przesłać dokumentu' : 'Przesyłanie dokumentu';
  return (
    <div className="health-upload-status field-wide" data-testid="health-upload-progress" data-phase={progress.phase} role="status" aria-live="polite">
      <div className="health-upload-title"><strong>{label}</strong><span>{progress.percent}%</span></div>
      <progress max={100} value={progress.percent} aria-label="Postęp przesyłania dokumentu" />
      <small>{error || fileName}</small>
      {progress.phase === 'error' && <small>Plik nadal jest wybrany. Możesz spróbować ponownie.</small>}
    </div>
  );
}
