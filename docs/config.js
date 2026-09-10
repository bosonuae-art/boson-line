/* Firebase project config.

   Paste the object Firebase gives you at:
     Project settings -> General -> Your apps -> Web app -> SDK setup and configuration

   It is safe to commit. These values identify the project, they do not grant
   access - firestore.rules in the repo root is what decides who may read and
   write. Leave this as null and the app simply runs on this device only. */

export const firebaseConfig = null;

/* Once you have it, the line above becomes something like:

export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "boson-line.firebaseapp.com",
  projectId: "boson-line",
  storageBucket: "boson-line.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:abcdef123456"
};
*/
