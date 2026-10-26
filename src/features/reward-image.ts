export const REWARD_IMAGE_MAX_SIDE = 1600;
export function rewardImageDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > 80_000_000) throw new Error('Zdjęcie ma nieprawidłowy lub zbyt duży rozmiar.');
  const ratio = Math.min(1, REWARD_IMAGE_MAX_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
/** Re-encode before reserving the upload: ticket MIME and size describe the final bytes. */
export async function prepareRewardImage(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 32 * 1024 * 1024) throw new Error('Wybierz zdjęcie JPG, PNG lub WebP do 32 MB. Zmniejszymy je automatycznie.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    try { await image.decode(); } catch { throw new Error('Nie można odczytać zdjęcia. Wybierz inny plik JPG, PNG lub WebP.'); }
    const size = rewardImageDimensions(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas'); Object.assign(canvas, size);
    const context = canvas.getContext('2d'); if (!context) throw new Error('Nie udało się przygotować zdjęcia. Spróbuj w innej przeglądarce.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, size.width, size.height); context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Nie udało się zmniejszyć zdjęcia.')), 'image/jpeg', 0.85));
    if (blob.size > 8 * 1024 * 1024) throw new Error('Zdjęcie po zmniejszeniu nadal jest zbyt duże. Wybierz inne zdjęcie.');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'nagroda'}.jpg`, {type:'image/jpeg'});
  } finally { URL.revokeObjectURL(url); }
}
