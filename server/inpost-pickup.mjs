import { createHash } from 'node:crypto';
import { EduServerError } from './edu-auth.mjs';

export const QR_DATA_LIMIT = 160_000;
const invalid = message => { throw new EduServerError('PARCEL_PICKUP',400,message); };
export function pickupRef(db, familyId, number) {
  return db.collection('_inpostPickup').doc(createHash('sha256').update(JSON.stringify([familyId,number])).digest('hex'));
}
export function pickupFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!['code','phone','note','qr'].includes(k))) invalid('Nieprawidłowe dane odbioru.');
  const {code,phone,note,qr}=value;
  if (typeof code !== 'string' || code !== '' && !/^\d{6}$/.test(code)) invalid('Kod odbioru powinien mieć 6 cyfr.');
  if (typeof phone !== 'string' || phone !== '' && !/^\d{9}$/.test(phone)) invalid('Telefon do odbioru powinien mieć 9 cyfr.');
  if (typeof note !== 'string' || note.length > 600) invalid('Notatka może mieć maksymalnie 600 znaków.');
  if (typeof qr !== 'string' || qr.length > QR_DATA_LIMIT) invalid('Zdjęcie kodu QR jest zbyt duże. Wybierz mniejsze zdjęcie.');
  if (qr) {
    const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(qr);
    if (!match) invalid('Dodaj zdjęcie PNG lub JPEG.');
    const bytes=Buffer.from(match[2],'base64');
    const valid=match[1]==='png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    if (!valid || bytes.toString('base64') !== match[2]) invalid('Nieprawidłowe zdjęcie kodu QR.');
  }
  return {code,phone,note:note.trim(),qr};
}
