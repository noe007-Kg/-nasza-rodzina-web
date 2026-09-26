import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
export const firebaseConfig={apiKey:'AIzaSyCXPjIYKQo94oYcHDDwJTjiDVvpAGcCB4Q',authDomain:'nasza-rodzina.firebaseapp.com',projectId:'nasza-rodzina',storageBucket:'nasza-rodzina.firebasestorage.app',messagingSenderId:'340731425852',appId:'1:340731425852:web:c3b27185641dc190443f39',measurementId:'G-H4YCZ9NT03'};
const app=initializeApp(firebaseConfig); export const auth=getAuth(app); export const db=getFirestore(app);
