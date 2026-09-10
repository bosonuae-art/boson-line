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
import { cleanDoc, applyOp } from "./roster.js";

const SDK = "https://www.gstatic.com/firebasejs/11.10.0/";
const SEASON = "2026";

/* Whether this build has a shared sheet at all. connect() returns null both when
   there is no project configured and when the SDK cannot be fetched, and the two
   mean opposite things to anything holding unsent work. */
export function configured(){
  return !!(firebaseConfig && firebaseConfig.projectId);
}

function weekOf(id){
  const n = Number(String(id).replace(/^w/, ""));
  return (n >= 1 && n <= 18) ? n : null;
}

export async function connect(opts){
  const onWeek = opts.onWeek, onStatus = opts.onStatus, onSave = opts.onSave || function(){};
  const onRoster = opts.onRoster || function(){};
  const onRosterFail = opts.onRosterFail || function(){};
  const seed = opts.seed, rosterSeed = opts.rosterSeed;

  if (!configured()){
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
  /* The roster is shared for the same reason the picks are: a player one phone
     adds has to exist on the others, or they each see columns the rest cannot. */
  const rosterRef = fs.doc(db, "seasons", SEASON, "meta", "roster");

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
    /* Also not from cache. A cache-only snapshot carries no news from the
        server, and treating it as confirmation let the app reconcile unsent
        picks against stale data and burn its one-shot flush on nothing. */
    const confirmed = !snap.metadata.hasPendingWrites && !snap.metadata.fromCache;
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

  /* Roster edits are ops, not lists.

     Writing the whole list back is what a two-player sheet gets away with. With
     more than two it means the slower phone deletes whoever the other one just
     added, and a phone that is still holding last week's list - one that has not
     had its first snapshot yet, or has been in a tunnel - deletes them for
     everybody. So each edit is applied inside a transaction to whatever the
     sheet holds at the moment it lands, and edits merge instead of racing.

     A transaction needs the network, unlike the picks queue, which Firestore
     will hold offline. An op that cannot go now therefore waits here and is
     replayed later; every op is idempotent, so replaying one that already landed
     changes nothing. After six failed attempts it is given up on and said so,
     rather than spinning forever against a rule that will never accept it. */
  /* Kept on disk, not just in memory. A rename made in a tunnel used to vanish
     when the tab was closed, and the next snapshot then quietly put the old name
     back with nothing said - the same shape of loss the picks queue was already
     hardened against. */
  const RQ_KEY = "bl.rq";
  function rqLoad(){
    try {
      const v = JSON.parse(localStorage.getItem(RQ_KEY) || "[]");
      return Array.isArray(v) ? v.filter(function(j){ return j && j.op; }) : [];
    } catch (e){ return []; }
  }
  function rqSave(){
    try { localStorage.setItem(RQ_KEY, JSON.stringify(rq)); } catch (e){}
  }
  const rq = rqLoad();
  let rDraining = false, rBackoff = 2000;

  function rosterOp(op){
    rq.push({op: op, tries: 0});
    rqSave();
    drainRoster();
    return Promise.resolve();
  }
  /* What this phone has changed but not yet managed to send. The app replays
     these over an incoming snapshot so an unsent rename stays on screen instead
     of flickering back to the old name until the write lands. */
  function rosterPending(){
    return rq.map(function(j){ return j.op; });
  }

  async function drainRoster(){
    if (rDraining) return;
    rDraining = true;
    while (rq.length){
      const job = rq[0];
      try {
        await fs.runTransaction(db, async function(tx){
          const snap = await tx.get(rosterRef);
          const next = applyOp(cleanDoc(snap.exists() ? snap.data() : null), job.op);
          /* The rules require at least one player, so writing an empty list is
             rejected - and the op would then retry six times and be given up on,
             leaving the roster permanently unwritable. That only happens against
             a missing or malformed document, where the right move is to leave it
             for the seed rather than fight it. */
          if (!next.players.length) return;
          tx.set(rosterRef, {
            players: next.players,
            retired: next.retired,
            updatedAt: fs.serverTimestamp()
          }, {merge: false});
        });
        rq.shift();
        rqSave();
        rBackoff = 2000;
      } catch (e){
        job.tries++;
        rqSave();
        if (job.tries >= 6){
          rq.shift();
          rqSave();
          rBackoff = 2000;
          onRosterFail(job.op);
          continue;
        }
        await new Promise(function(r){ setTimeout(r, rBackoff); });
        rBackoff = Math.min(rBackoff * 2, 30000);
      }
    }
    rDraining = false;
  }

  let rosterSeeded = false;
  fs.onSnapshot(rosterRef, function(snap){
    const doc = cleanDoc(snap.exists() ? (snap.data() || {}) : null);
    if (doc.players.length) onRoster(doc, rosterPending());
    /* Nothing stored yet: publish what this device is carrying, so the next
       phone to open the link starts from the same list rather than a default.
       Only once, only against the server, and the op itself refuses to overwrite
       a sheet that turns out to have a roster after all. */
    else if (!snap.metadata.fromCache && !rosterSeeded){
      rosterSeeded = true;
      if (typeof rosterSeed === "function"){
        const mine = rosterSeed();
        if (mine && mine.length) rosterOp({t: "seed", players: mine});
      }
    }
  }, function(){});

  return {savePicks: savePicks, saveResult: saveResult, rosterOp: rosterOp,
          rosterPending: rosterPending, pending: inflight};
}
