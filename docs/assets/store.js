/* The shared ledger.

   Picks live in Firestore at seasons/2026/weeks/w1 .. w18, so both phones see
   the same sheet and updates arrive live. If config.js has no project in it the
   whole thing stays quiet and the app runs on localStorage alone - the page is
   fully usable either way, which is why every failure here degrades instead of
   throwing.

   Every save also stamps touch[who] with the server clock. That is what lets a
   phone say "Dad picked four minutes ago" instead of just "connected", which is
   the difference between believing the sync works and hoping it does. */
import { firebaseConfig } from "../config.js";

const SDK = "https://www.gstatic.com/firebasejs/11.10.0/";
const SEASON = "2026";

function weekOf(id){
  const n = Number(String(id).replace(/^w/, ""));
  return (n >= 1 && n <= 18) ? n : null;
}

export async function connect(opts){
  const onWeek = opts.onWeek, onStatus = opts.onStatus, onSave = opts.onSave || function(){};
  const seed = opts.seed;

  if (!firebaseConfig || !firebaseConfig.projectId){
    onStatus("local", "On this device");
    return null;
  }
  onStatus("local", "Connecting");

  let fs, db, colRef;
  try {
    const [appMod, fsMod] = await Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-firestore.js")
    ]);
    fs = fsMod;
    const app = appMod.initializeApp(firebaseConfig);
    db = fsMod.getFirestore(app);
    colRef = fsMod.collection(db, "seasons", SEASON, "weeks");
  } catch (e){
    onStatus("error", "Shared sheet unreachable");
    return null;
  }

  const docFor = function(wk){ return fs.doc(db, "seasons", SEASON, "weeks", "w" + wk); };

  /* Failed writes go on a queue and are retried with backoff rather than
     dropped. A pick the app has already drawn on screen must eventually reach
     the other phone or be reported as lost - quietly forgetting it is the one
     outcome that makes the sheet untrustworthy. */
  const queue = [];
  let draining = false, backoff = 2000;

  function inflight(){ return queue.length; }

  async function push(job){
    const payload = {updatedAt: fs.serverTimestamp()};
    payload[job.field] = job.body;
    if (job.who){
      const t = {};
      t[job.who] = fs.serverTimestamp();
      payload.touch = t;
    }
    await fs.setDoc(docFor(job.wk), payload, {merge: true});
  }

  async function drain(){
    if (draining) return;
    draining = true;
    while (queue.length){
      const job = queue[0];
      try {
        await push(job);
        queue.shift();
        backoff = 2000;
        onSave("saved", inflight());
      } catch (e){
        onSave("retrying", inflight());
        await new Promise(function(r){ setTimeout(r, backoff); });
        backoff = Math.min(backoff * 2, 30000);
      }
    }
    draining = false;
    onSave("idle", 0);
  }

  function enqueue(job){
    queue.push(job);
    onSave("saving", inflight());
    drain();
    return Promise.resolve();
  }

  function savePicks(wk, obj, who){
    const picks = {};
    Object.keys(obj).forEach(function(k){
      const patch = obj[k];
      if (patch === null){ picks[k] = fs.deleteField(); return; }
      const cell = {};
      Object.keys(patch).forEach(function(w){
        cell[w] = patch[w] ? patch[w] : fs.deleteField();
      });
      picks[k] = cell;
    });
    return enqueue({wk: wk, field: "picks", body: picks, who: who || null});
  }
  function saveResult(wk, key, val, who){
    const results = {};
    results[key] = (val === null) ? fs.deleteField() : val;
    return enqueue({wk: wk, field: "results", body: results, who: who || null});
  }

  let seeded = false;
  fs.onSnapshot(colRef, function(snap){
    let remoteHasPicks = false;
    /* Firestore echoes a local write back immediately, before the server has
       taken it. Only a snapshot with no writes still in flight proves the shared
       sheet really holds this - which is what the app needs to say "saved". */
    const confirmed = !snap.metadata.hasPendingWrites;
    snap.forEach(function(d){
      const wk = weekOf(d.id);
      if (!wk) return;
      const data = d.data() || {};
      if (data.picks && Object.keys(data.picks).length) remoteHasPicks = true;
      onWeek(wk, data, confirmed);
    });
    onStatus("live", snap.metadata.fromCache ? "Shared, offline" : "In sync");

    /* First real snapshot: if the shared sheet is still empty but this device is
       carrying a season, push it up once so nothing is lost moving over. */
    if (!seeded && !snap.metadata.fromCache){
      seeded = true;
      if (!remoteHasPicks && typeof seed === "function"){
        const local = seed() || {};
        Object.keys(local).forEach(function(wk){
          const obj = {};
          Object.keys(local[wk]).forEach(function(k){ obj[k] = local[wk][k]; });
          if (Object.keys(obj).length) savePicks(Number(wk), obj, null);
        });
      }
    }
  }, function(){
    onStatus("error", "Shared sheet unreachable");
  });

  return {savePicks: savePicks, saveResult: saveResult, pending: inflight};
}
