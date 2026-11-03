const LIMIT = 160_000;
/** Re-encode locally: strip metadata and keep private QR images within API limits. */
export async function pickupImage(file: File): Promise<string> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Wybierz zdjęcie PNG, JPEG lub WebP, np. zrzut ekranu kodu QR.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Zdjęcie może mieć maksymalnie 10 MB.');
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();image.src=url;
    try { await image.decode(); } catch { throw new Error('Nie udało się odczytać zdjęcia. Wybierz inny plik.'); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50_000_000) throw new Error('Wybierz mniejszy obraz lub zrzut ekranu kodu QR.');
    const canvas=document.createElement('canvas');
    const context=canvas.getContext('2d');
    if (!context) throw new Error('Ta przeglądarka nie może przygotować zdjęcia.');
    for (const size of [1200,1000,800,600]) {
      const scale=Math.min(1,size/Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
      const png=canvas.toDataURL('image/png');if (png.length<=LIMIT) return png;
      for (const quality of [0.92,0.8]) {const jpeg=canvas.toDataURL('image/jpeg',quality);if (jpeg.length<=LIMIT) return jpeg;}
    }
    throw new Error('Zdjęcie jest zbyt duże. Przytnij je do samego kodu QR i spróbuj ponownie.');
  } finally { URL.revokeObjectURL(url); }
}
