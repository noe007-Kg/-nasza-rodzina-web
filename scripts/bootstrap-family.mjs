#!/usr/bin/env node
/**
 * Private administrator tool. It NEVER runs in the browser or during npm build.
 * Dry run is the default; --apply authorizes writes. No passwords are accepted.
 */
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const options = {};
const flags = new Set(['apply', 'migrate', 'migrate-files', 'emulators', 'help']);
for (let i = 2; i < process.argv.length; i += 1) {
  const argument = process.argv[i];
  if (!argument.startsWith('--')) throw new Error(`Nieznany argument: ${argument}`);
  const key = argument.slice(2);
  if (flags.has(key)) options[key] = true;
  else if (['project', 'members', 'bucket'].includes(key) && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) options[key] = process.argv[++i];
  else throw new Error(`Nieznany lub niepełny argument: ${argument}`);
}

if (options.help) {
  console.log('node scripts/bootstrap-family.mjs --project PROJECT --members PRIVATE.json [--bucket BUCKET] [--migrate] [--migrate-files] [--apply] [--emulators]');
  console.log('Domyślnie tylko plan. --apply zapisuje profile/konta. --migrate uzupełnia stare pola. --migrate-files kopiuje dokumenty i unieważnia stare publiczne linki zdrowotne.');
  process.exit(0);
}
if (!options.project) throw new Error('Podaj jawnie --project. Skrypt nie wybiera projektu produkcyjnego automatycznie.');
if (!options.members && !options.migrate) throw new Error('Podaj --members lub --migrate.');
if (options['migrate-files'] && !options.migrate) throw new Error('--migrate-files wymaga --migrate.');
if (options.project.startsWith('demo-') && !options.emulators) throw new Error('Projekt demo wymaga --emulators.');
if (options.emulators && !options.project.startsWith('demo-')) throw new Error('Emulatory używają projektu demo-*; nie używaj identyfikatora produkcyjnego.');

if (options.emulators) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199';
} else if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  throw new Error('Wykryto zmienne emulatora bez --emulators. Ujednolić konfigurację przed uruchomieniem.');
}

const people = ['Sebastian', 'Dominika', 'Paweł', 'Nikodem', 'Layla'];
const apply = options.apply === true;
const definitions = options.members ? JSON.parse(await readFile(options.members, 'utf8')) : [];
if (!Array.isArray(definitions)) throw new Error('Plik --members musi zawierać tablicę profili.');
const seenPeople = new Set();
const seenEmails = new Set();
const seenUids = new Set();
for (const definition of definitions) {
  if (definition.password || definition.haslo) throw new Error('Nie zapisuj haseł w pliku profili. Konta korzystają z resetu hasła.');
  const personKey = definition.personKey || definition.name;
  if (!people.includes(personKey) || definition.name !== personKey) throw new Error('name i personKey muszą wskazywać tę samą osobę z rodziny.');
  if (!['parent', 'child'].includes(definition.role)) throw new Error(`Niepoprawna rola dla ${personKey}.`);
  if (seenPeople.has(personKey)) throw new Error(`Powtórzony profil osoby ${personKey}.`);
  seenPeople.add(personKey);
  if (definition.email) {
    if (typeof definition.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(definition.email)) throw new Error('Niepoprawny e-mail.');
    const normalizedEmail = definition.email.trim().toLowerCase();
    if (seenEmails.has(normalizedEmail)) throw new Error('Powtórzony e-mail.');
    seenEmails.add(normalizedEmail);
  }
  if (definition.canLogin !== false && !definition.email) throw new Error(`${personKey}: konto logujące się wymaga e-maila.`);
  if (definition.uid) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(definition.uid) || seenUids.has(definition.uid)) throw new Error('UID musi być unikalne, bez dwukropka/ukośnika.');
    seenUids.add(definition.uid);
  }
  if (definition.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(definition.birthDate)) throw new Error('birthDate: wymagany format RRRR-MM-DD.');
}
if (definitions.length && !definitions.some((profile) => profile.role === 'parent' && profile.active !== false && profile.canLogin !== false)) throw new Error('Plik musi zawierać przynajmniej jednego aktywnego rodzica mogącego się zalogować.');

initializeApp({
  projectId: options.project,
  storageBucket: options.bucket || process.env.FIREBASE_STORAGE_BUCKET || `${options.project}.firebasestorage.app`,
  ...(options.emulators ? {} : { credential: applicationDefault() }),
});
const auth = getAuth();
const db = getFirestore();
const bucket = getStorage().bucket();
console.log(`${apply ? 'ZAPIS' : 'PLAN bez zapisu'}: projekt ${options.project}; profile: ${definitions.length}; migracja: ${Boolean(options.migrate)}; pliki: ${Boolean(options['migrate-files'])}.`);

for (const definition of definitions) {
  let account;
  if (definition.email) {
    try { account = await auth.getUserByEmail(definition.email.trim()); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    if (account && definition.uid && account.uid !== definition.uid) throw new Error(`UID nie zgadza się z istniejącym kontem ${definition.name}.`);
    if (!account && apply) {
      account = await auth.createUser({
        ...(definition.uid ? { uid: definition.uid } : {}),
        email: definition.email.trim(), displayName: definition.name,
        password: randomBytes(32).toString('base64url'),
        disabled: definition.active === false || definition.canLogin === false,
      });
    }
    if (account && apply) await auth.updateUser(account.uid, { displayName: definition.name, disabled: definition.active === false || definition.canLogin === false });
  }
  const uid = account?.uid || definition.uid || `profile-${definition.personKey || definition.name}`;
  const personKey = definition.personKey || definition.name;
  const birthDate = definition.birthDate || '';
  const birthday = birthDate ? new Date(`${birthDate}T12:00:00Z`) : null;
  const adultFromAge = birthday && new Date(birthday).setUTCFullYear(birthday.getUTCFullYear() + 18) <= Date.now();
  const profile = {
    name: definition.name, personKey, role: definition.role,
    active: definition.active !== false, canLogin: definition.canLogin !== false,
    adult: definition.role === 'parent' || adultFromAge === true,
    ...(birthDate ? { birthDate } : {}),
    ...(typeof definition.photoURL === 'string' ? { photoURL: definition.photoURL } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
  console.log(`${apply ? 'Profil zapisany' : 'Profil do zapisania'}: ${personKey}; rola ${definition.role}; konto ${account ? 'istnieje' : definition.email ? 'nowe' : 'bez logowania'}.`);
  if (apply) await db.collection('members').doc(uid).set(profile, { merge: true });
}

async function removeDownloadTokens(file) {
  const [metadata] = await file.getMetadata();
  if (!metadata.metadata?.firebaseStorageDownloadTokens) return;
  if (apply) await file.setMetadata({ metadata: { ...metadata.metadata, firebaseStorageDownloadTokens: null } });
}

function storagePathFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (url.hostname !== 'firebasestorage.googleapis.com' || !match || decodeURIComponent(match[1]) !== bucket.name) return null;
    const path = decodeURIComponent(match[2]);
    return path.startsWith('health/') ? path : null;
  } catch { return null; }
}

if (options.migrate) {
  // A collection scan is intentional in this private administrator tool.
  const messages = await db.collection('familyMessages').get();
  let messagesChanged = 0;
  for (const document of messages.docs) {
    const data = document.data();
    const channel = data.channel || 'family';
    const participants = channel === 'family' ? [] : /^private:[^:]+:[^:]+$/.test(channel) ? channel.slice(8).split(':') : null;
    if (!participants || (participants.length && (!participants.includes(data.uid) || participants[0] === participants[1]))) {
      console.warn(`Niepoprawny kanał wiadomości ${document.id}; nie migrowano.`);
      continue;
    }
    if (JSON.stringify(data.participants) === JSON.stringify(participants) && data.channel === channel) continue;
    messagesChanged += 1;
    if (apply) await document.ref.update({ channel, participants });
  }

  const health = await db.collection('healthRecords').get();
  let healthChanged = 0;
  let filesCopied = 0;
  for (const document of health.docs) {
    const data = document.data();
    const patch = {};
    if (typeof data.privateToParents !== 'boolean') patch.privateToParents = false;
    if (options['migrate-files'] && (data.documentURL || data.documentPath)) {
      const sourcePath = data.documentPath || storagePathFromUrl(data.documentURL);
      if (!sourcePath || !people.concat('family').includes(data.person)) {
        console.warn(`Dokument zdrowotny ${document.id}: nieznany adres/osoba. Wymaga ręcznego przeniesienia; link nie został odczytany ani zmieniony.`);
      } else {
        const safeName = sourcePath.split('/').at(-1).replace(/[^a-zA-Z0-9._-]/g, '-');
        const visibility = data.privateToParents === true ? 'parents' : 'shared';
        const destination = sourcePath.startsWith(`health/${visibility}/${data.person}/`) ? sourcePath : `health/${visibility}/${data.person}/migration/${document.id}-${safeName}`;
        if (apply) {
          if (destination !== sourcePath) await bucket.file(sourcePath).copy(bucket.file(destination));
          await removeDownloadTokens(bucket.file(destination));
          await removeDownloadTokens(bucket.file(sourcePath));
        }
        patch.documentPath = destination;
        patch.documentURL = '';
        filesCopied += 1;
      }
    }
    if (Object.keys(patch).length) {
      healthChanged += 1;
      if (apply) await document.ref.update(patch);
    }
  }
  if (options['migrate-files']) {
    // Also revoke orphaned old health links, retaining the original objects.
    const [files] = await bucket.getFiles({ prefix: 'health/' });
    for (const file of files) await removeDownloadTokens(file);
    console.log(`Obiekty zdrowotne sprawdzone pod kątem publicznych tokenów: ${files.length}.`);
  }
  console.log(`Migracja: wiadomości ${messagesChanged}; kartoteki ${healthChanged}; dokumenty do przeniesienia/sprawdzenia ${filesCopied}.`);
}

console.log(apply ? 'Zakończono. Nowe konta ustawiają hasło przez ekran „Nie pamiętam hasła” lub Firebase Authentication.' : 'Plan gotowy. Uruchom tę samą komendę z --apply po sprawdzeniu projektu i kopii danych.');
