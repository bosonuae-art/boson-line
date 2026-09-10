/* Firebase project config for the shared pick sheet.

   These values identify the project; they do not grant access. What a caller may
   read or write is decided entirely by firestore.rules in the repo root, which
   confines anyone to the 18 week documents of the 2026 season. Firebase web
   config is designed to ship in client code, which is why this is committed.

   Set this back to null and the app quietly runs on this device only. */

export const firebaseConfig = {
  apiKey: "AIzaSyAAeO9pn0a6-xQFYK1fj4iv8CTv6micg0M",
  authDomain: "boson-line.firebaseapp.com",
  projectId: "boson-line"
};
