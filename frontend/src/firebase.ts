import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: 'AIzaSyAlr1EjhqBKm6LyaJgiRU1BUfSyPtlPtTY',
  authDomain: 'meta-yen-487714-j8.firebaseapp.com',
  projectId: 'meta-yen-487714-j8',
  storageBucket: 'meta-yen-487714-j8.firebasestorage.app',
  messagingSenderId: '1044825593780',
  appId: '1:1044825593780:web:8d603a4012e0586dea04e1',
  measurementId: 'G-VQ181MY9B4',
};

// Initialize Firebase once for the app lifecycle
export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const analytics = getAnalytics(firebaseApp);
