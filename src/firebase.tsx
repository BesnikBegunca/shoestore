// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDhnNdRexEK6v945slZ3QC27vYS-lwx4uw",
  authDomain: "shoestoreferizaj-7380a.firebaseapp.com",
  projectId: "shoestoreferizaj-7380a",
  storageBucket: "shoestoreferizaj-7380a.appspot.com",
  messagingSenderId: "314103969365",
  appId: "1:314103969365:web:e299ecd846b77f992086dc",
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
