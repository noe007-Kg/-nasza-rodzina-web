import { getBlob, getMetadata, type FullMetadata, type StorageReference } from 'firebase/storage';

function fileType(metadata: Pick<FullMetadata, 'size' | 'contentType'>, maximum: number, allowPdf: boolean) {
  const mime = metadata.contentType || '';
  if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > maximum
    || !(/^image\/(jpeg|png|webp|gif)$/.test(mime) || allowPdf && mime === 'application/pdf')) {
    throw new Error('Nieprawidłowy typ lub rozmiar chronionego pliku.');
  }
  return mime;
}

export function typedPrivateBlob(blob: Blob, metadata: Pick<FullMetadata, 'size' | 'contentType'>, maximum: number, allowPdf = false) {
  const mime = fileType(metadata, maximum, allowPdf);
  if (blob.size !== metadata.size) throw new Error('Nie udało się pobrać całego pliku.');
  // Firebase 12's bounded getBlob calls slice() without its MIME argument.
  // Safari needs the original authorized type; the bytes remain unchanged.
  return new Blob([blob], {type: mime});
}

export async function getPrivateStorageBlob(target: StorageReference, maximum: number, allowPdf = false) {
  const metadata = await getMetadata(target);
  fileType(metadata, maximum, allowPdf);
  return typedPrivateBlob(await getBlob(target, maximum), metadata, maximum, allowPdf);
}
