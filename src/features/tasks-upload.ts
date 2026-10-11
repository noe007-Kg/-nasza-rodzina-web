export const TASK_PHOTO_LIMIT = 8 * 1024 * 1024;
export type TaskUploadPhase = 'idle' | 'preparing' | 'uploading' | 'saving' | 'submitted' | 'error';
export type TaskUploadProgress = { phase: TaskUploadPhase; percent: number };
export function validateTaskPhoto(file: Pick<File, 'type' | 'size'>) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > TASK_PHOTO_LIMIT) throw new Error('Wybierz zdjęcie JPG, PNG lub WebP do 8 MB.');
}
type ObservableTask = { on: (event: 'state_changed', next: (snapshot: { bytesTransferred: number; totalBytes: number }) => void,
  failure: (error: Error) => void, complete: () => void) => unknown };
export function uploadTaskPhoto(task: ObservableTask, change: (progress: TaskUploadProgress) => void): Promise<void> {
  change({ phase: 'uploading', percent: 0 });
  return new Promise((resolve, reject) => {
    let percent = 0;
    task.on('state_changed', snapshot => {
      percent = snapshot.totalBytes > 0 ? Math.max(0, Math.min(99, Math.floor(snapshot.bytesTransferred / snapshot.totalBytes * 100))) : 0;
      change({ phase: 'uploading', percent });
    }, error => { change({ phase: 'error', percent }); reject(error); }, () => { change({ phase: 'saving', percent: 100 }); resolve(); });
  });
}
