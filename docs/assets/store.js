/* The shared ledger.

   Picks live in Firestore at seasons/2026/weeks/w1 .. w18, so both phones see
   the same sheet and updates arrive live. If config.js has no project in it the
   whole thing stays quiet and the app runs on localStorage alone - the page is
   fully usable either way, which is why every failure here degrades instead of
   throwing. */
import { firebaseConfig } from "../config.js";

const SDK = "https://www.gstatic.com/firebasejs/11.10.0/";
const SEASON = "2026";

function weekOf(id){
  const n = Number(String(id).replace(/^w/, ""));
  return (n >= 1 && n <= 18) ? n : null;
}

export async function connect(opts){
  const onWeek = opts.onWeek, onStatus = opts.onStatus, seed = opts.seed;

  if (!firebaseConfig || !firebaseConfig.projectId){
    onStatus("local", "On this device");
    return null;
  }
  onStatus("local", "Connecting");

  let fs, db, colRef;
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-auth.js"),
      import(SDK + "firebase-firestore.js")
    ]);
    fs = fsMod;
    const app = appMod.initializeApp(firebaseConfig);
    await authMod.signInAnonymously(authMod.getAuth(app));
    db = fsMod.getFirestore(app);
    colRef = fsMod.collection(db, "seasons", SEASON, "weeks");
  } catch (e){
    onStatus("error", "Shared sheet unreachable");
    return null;
  }

  const docFor = function(wk){ return fs.doc(db, "seasons", SEASON, "weeks", "w" + wk); };

  async function write(wk, field, body){
    const payload = {updatedAt: fs.serverTimestamp()};
    payload[field] = body;
    await fs.setDoc(docFor(wk), payload, {merge: true});
  }

  async function savePicks(wk, obj){
    const picks = {};
    Object.keys(obj).forEach(function(k){
      const patch = obj[k];
      if (patch === null){ picks[k] = fs.deleteField(); return; }
      const cell = {};
      Object.keys(patch).forEach(function(who){
        cell[who] = patch[who] ? patch[who] : fs.deleteField();
      });
      picks[k] = cell;
    });
    return write(wk, "picks", picks);
  }
  async function saveResult(wk, key, val){
    const results = {};
    results[key] = (val === null) ? fs.deleteField() : val;
    return write(wk, "results", results);
  }

  let seeded = false;
  fs.onSnapshot(colRef, function(snap){
    let remoteHasPicks = false;
    snap.forEach(function(d){
      const wk = weekOf(d.id);
      if (!wk) return;
      const data = d.data() || {};
      if (data.picks && Object.keys(data.picks).length) remoteHasPicks = true;
      onWeek(wk, data);
    });
    onStatus("live", snap.metadata.fromCache ? "Shared, offline" : "Shared sheet");

    /* First real snapshot: if the shared sheet is still empty but this device is
       carrying a season, push it up once so nothing is lost moving over. */
    if (!seeded && !snap.metadata.fromCache){
      seeded = true;
      if (!remoteHasPicks && typeof seed === "function"){
        const local = seed() || {};
        Object.keys(local).forEach(function(wk){
          const obj = {};
          Object.keys(local[wk]).forEach(function(k){ obj[k] = local[wk][k]; });
          if (Object.keys(obj).length) savePicks(Number(wk), obj).catch(function(){});
        });
      }
    }
  }, function(){
    onStatus("error", "Shared sheet unreachable");
  });

  return {savePicks: savePicks, saveResult: saveResult};
}
