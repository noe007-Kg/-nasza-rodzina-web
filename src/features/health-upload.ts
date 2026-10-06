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
  if (file.size > HEALTH_FILE_MAX_BYTES || !(HEALTH_FILE_TYPES as readonly string[]).includes(file.type)) {
    throw new Error('Wybierz PDF lub zdjęcie do 10 MB.');
  }
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
