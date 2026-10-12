export type HealthUploadProgress = {
  phase: 'idle' | 'uploading' | 'uploaded' | 'error';
  percent: number;
};

type TransferSnapshot = { bytesTransferred: number; totalBytes: number };
type ObservableUpload = {
  on: (
    event: 'state_changed',
    next: (snapshot: TransferSnapshot) => void,
    error: (error: Error) => void,
    complete: () => void,
  ) => () => void;
};

export const HEALTH_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const HEALTH_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

export function validateHealthFile(file: Pick<File, 'type' | 'size'>) {
  if (!Number.isInteger(file.size) || file.size <= 0 || file.size > HEALTH_FILE_MAX_BYTES || !(HEALTH_FILE_TYPES as readonly string[]).includes(file.type)) {
    throw new Error('Wybierz PDF lub zdjęcie do 10 MB.');
  }
}

/** Diagnostic codes are safe; raw SDK messages can contain document paths or URLs. */
export function healthUploadError(error: unknown): { message: string; code: string } {
  const code = String((error as { code?: unknown })?.code || '');
  const messages: Record<string, string> = {
    'storage/unauthorized': 'Nie masz uprawnienia do przesłania tego załącznika. Sprawdź upoważnienie do kartoteki oraz wdrożone reguły Storage.',
    'storage/unauthenticated': 'Sesja Naszej Rodziny wygasła. Zaloguj się ponownie i ponów przesyłanie.',
    'storage/bucket-not-found': 'Magazyn plików nie jest dostępny. Administrator musi sprawdzić konfigurację Firebase Storage.',
    'storage/project-not-found': 'Nie znaleziono projektu magazynu plików. Administrator musi sprawdzić konfigurację Firebase Storage.',
    'storage/no-default-bucket': 'Magazyn plików nie został skonfigurowany.',
    'storage/retry-limit-exceeded': 'Przesyłanie przekroczyło limit czasu. Sprawdź połączenie i spróbuj ponownie.',
    'storage/canceled': 'Przesyłanie przerwano. Wybrany plik i dane formularza pozostają dostępne do ponowienia.',
    'storage/invalid-checksum': 'Nie udało się potwierdzić kompletności pliku. Spróbuj przesłać go ponownie.',
    'storage/quota-exceeded': 'Magazyn plików osiągnął limit. Administrator musi sprawdzić limity Firebase.',
    'storage/unknown': 'Magazyn plików odrzucił przesyłanie. Administrator musi sprawdzić konfigurację Storage i odpowiedź usługi.',
  };
  if (Object.hasOwn(messages, code)) return { message: messages[code], code };
  if (error instanceof Error && error.message.startsWith('Wybierz')) return { message: error.message, code: 'invalid-file' };
  return { message: 'Nie udało się zapisać załącznika. Dane formularza pozostają dostępne. Spróbuj ponownie.', code: '' };
}

export function transferPercent(bytesTransferred: number, totalBytes: number) {
  if (!Number.isFinite(bytesTransferred) || !Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  // All bytes sent is not yet a Storage success confirmation.
  return Math.max(0, Math.min(99, Math.floor((bytesTransferred / totalBytes) * 100)));
}

export function observeHealthUpload(task: ObservableUpload, onProgress: (progress: HealthUploadProgress) => void): Promise<void> {
  onProgress({ phase: 'uploading', percent: 0 });
  return new Promise((resolve, reject) => {
    let percent = 0;
    task.on('state_changed', (snapshot) => {
      percent = transferPercent(snapshot.bytesTransferred, snapshot.totalBytes);
      onProgress({ phase: 'uploading', percent });
    }, (error) => {
      onProgress({ phase: 'error', percent });
      reject(error);
    }, () => {
      onProgress({ phase: 'uploaded', percent: 100 });
      resolve();
    });
  });
}
