import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyAIWau_5YATDBFgOosDbbJwsi_T4mb3kxI",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "azyaa-0uiv4k.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "azyaa-0uiv4k",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "azyaa-0uiv4k.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "657966459097",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:657966459097:web:8bfc90e3c2975019a8f6c8",
};

let app: FirebaseApp | undefined;
let db: Firestore | undefined;

export function getFirebase() {
  if (!app) {
    app = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  if (!db) {
    // IndexedDB cache makes revisits and reloads render from disk before the network answers.
    try {
      db =
        typeof window === "undefined"
          ? getFirestore(app)
          : initializeFirestore(app, {
              localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
            });
    } catch {
      db = getFirestore(app);
    }
  }
  return {
    app,
    auth: getAuth(app),
    db,
    storage: getStorage(app),
    functions: getFunctions(app),
  };
}

export { firebaseConfig };
