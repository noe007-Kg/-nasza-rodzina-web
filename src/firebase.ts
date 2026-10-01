import { getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
export const usingEmulators = env.VITE_USE_EMULATORS === 'true';

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || (usingEmulators ? 'demo-api-key' : 'AIzaSyCXPjIYKQo94oYcHDDwJTjiDVvpAGcCB4Q'),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'nasza-rodzina.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || (usingEmulators ? 'demo-nasza-rodzina' : 'nasza-rodzina'),
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || (usingEmulators ? 'demo-nasza-rodzina.appspot.com' : 'nasza-rodzina.firebasestorage.app'),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '340731425852',
  appId: env.VITE_FIREBASE_APP_ID || '1:340731425852:web:c3b27185641dc190443f39',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-H4YCZ9NT03',
};

const app = getApps()[0] || initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

if (usingEmulators) {
  const host = env.VITE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, 9199);
}
