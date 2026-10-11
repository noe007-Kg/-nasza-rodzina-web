import { HEALTH_FILE_MAX_BYTES, validateHealthFile } from '../features/health-upload';

/** Conversion runs locally; documents and camera images never visit a third-party service. */
export async function documentPagesFile(files: readonly File[], onPreparing?: (label: string) => void): Promise<File> {
  if (files.length === 0 || files.length > 20) throw new Error('Wybierz od 1 do 20 stron dokumentu.');
  files.forEach(validateHealthFile);
  if (files.length === 1) return files[0];
  if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) throw new Error('Wielostronicowy PDF możesz utworzyć ze zdjęć JPG, PNG lub WebP. Istniejący PDF wybierz osobno.');
  if (files.reduce((total, file) => total + file.size, 0) > HEALTH_FILE_MAX_BYTES) throw new Error('Wybierz zdjęcia o łącznym rozmiarze do 10 MB.');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (let index = 0; index < files.length; index += 1) {
    onPreparing?.(`Przygotowywanie strony ${index + 1} z ${files.length}`);
    const file = files[index];
    let bytes = new Uint8Array(await file.arrayBuffer());
    let png = file.type === 'image/png';
    if (file.type === 'image/webp') {
      const source = URL.createObjectURL(file);
      try {
        const image = new Image(); image.src = source; await image.decode();
        if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('Zdjęcie jest zbyt duże. Zmniejsz jego rozdzielczość.');
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d'); if (!context) throw new Error('Nie udało się przygotować zdjęcia.');
        context.drawImage(image, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Nie udało się przygotować zdjęcia.')), 'image/png'));
        bytes = new Uint8Array(await blob.arrayBuffer()); png = true;
      } finally { URL.revokeObjectURL(source); }
    }
    const image = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    if (image.width * image.height > 40_000_000) throw new Error('Zdjęcie jest zbyt duże. Zmniejsz jego rozdzielczość.');
    const scale = Math.min(1, 595 / image.width, 842 / image.height);
    const page = pdf.addPage([image.width * scale, image.height * scale]);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  const result = await pdf.save();
  if (result.byteLength > HEALTH_FILE_MAX_BYTES) throw new Error('Przygotowany PDF przekracza 10 MB. Zmniejsz zdjęcia.');
  return new File([Uint8Array.from(result)], 'dokument-wielostronicowy.pdf', { type: 'application/pdf' });
}
