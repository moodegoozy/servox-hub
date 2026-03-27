import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBMAZDUmMrEpuFCSKUYIHRh6NfAPdUV-z8',
  authDomain: 'datahub-44154.firebaseapp.com',
  projectId: 'datahub-44154',
  storageBucket: 'datahub-44154.firebasestorage.app',
  messagingSenderId: '923854285496',
  appId: '1:923854285496:web:cdee6f15d3da5cf74e624d',
};

// Initialize Firebase once for the app lifecycle
export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
