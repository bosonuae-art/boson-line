/* The roster, as a value.

   Who is playing and what they are called is shared, so two phones can be
   editing it at the same moment. Writing the whole list back is the obvious way
   to save that, and it is wrong: the slower phone silently deletes whatever the
   other one just added. On a sheet where a missing player is a missing column of
   picks, that reads as lost data even though the picks are still there.

   So an edit here is not a list. It is an op - rename this id, add that one,
   retire the other - applied to whatever the shared sheet holds at the moment it
   lands. Two edits merge instead of one erasing the other, and an op made with
   no signal can sit in a queue for an hour and still apply correctly. Every op
   is idempotent, which is what lets a queued one be replayed without first
   working out whether it already went through.

   Removing somebody is retirement, not deletion: they move to a second list and
   their picks are left exactly where they are, so any phone can put them back
   and the column returns intact. Nothing in this file deletes anything. */

export const MAX_PLAYERS = 8;
export const MAX_RETIRED = 12;
const NAME_MAX = 24;

function cleanId(v){
  if (typeof v !== "string") return "";
  return v.slice(0, 24).replace(/[^A-Za-z0-9_-]/g, "");
}
function cleanName(v, fallback){
  const s = String(v == null ? "" : v).slice(0, NAME_MAX).trim();
  return s || fallback;
}

/* Anything arriving from the shared sheet is another device's idea of the
   roster. So is anything arriving from this device's own storage - written by an
   older build, a half-finished edit, or by hand - and "it came from
   localStorage" is not the same as "it is well formed". A 500-character name
   stretched the scoreline to 3851px and a duplicated id drew the same player
   twice, both from that path. Bounded and scrubbed at every boundary. */
export function cleanRoster(list, cap){
  if (!Array.isArray(list)) return null;
  const max = cap || MAX_PLAYERS;
  const out = [], seen = {};
  for (let i = 0; i < list.length; i++){
    const p = list[i];
    if (!p || typeof p !== "object") continue;
    const id = cleanId(p.id);
    if (!id || seen[id] || out.length >= max) continue;
    seen[id] = 1;
    out.push({id: id, name: cleanName(p.name, id)});
  }
  return out.length ? out : null;
}

export function cleanDoc(doc){
  const d = (doc && typeof doc === "object") ? doc : {};
  const players = cleanRoster(d.players) || [];
  const seen = {};
  players.forEach(function(p){ seen[p.id] = 1; });
  const retired = [];
  (cleanRoster(d.retired, MAX_RETIRED) || []).forEach(function(p){
    if (seen[p.id]) return;                 /* nobody is playing and retired at once */
    seen[p.id] = 1;
    retired.push(p);
  });
  return {players: players, retired: retired};
}

function find(list, id){
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function without(list, id){
  return list.filter(function(p){ return p.id !== id; });
}

/* op is one of:
     {t:"rename",  id, name}
     {t:"add",     id, name}
     {t:"remove",  id}          - retires them, keeps their picks
     {t:"restore", id}          - brings a retired player back
     {t:"seed",    players}     - first publish only; never overwrites a roster
   Returns a new {players, retired}. Unknown or impossible ops return the doc
   unchanged rather than throwing, because these run against a sheet that may
   have moved on since the op was made. */
export function applyOp(doc, op){
  const cur = cleanDoc(doc);
  if (!op || typeof op !== "object") return cur;
  const players = cur.players, retired = cur.retired;
  const id = cleanId(op.id);

  if (op.t === "rename"){
    if (!id) return cur;
    const name = cleanName(op.name, "");
    if (!name) return cur;
    const swap = function(p){ return p.id === id ? {id: id, name: name} : p; };
    return {players: players.map(swap), retired: retired.map(swap)};
  }

  if (op.t === "add"){
    if (!id || players.length >= MAX_PLAYERS || find(players, id)) return cur;
    return {players: players.concat([{id: id, name: cleanName(op.name, id)}]),
            retired: without(retired, id)};
  }

  if (op.t === "remove"){
    const gone = find(players, id);
    /* The last player standing cannot be removed - an empty sheet has no way
       back to a column, and no phone should be able to leave the others with
       one. */
    if (!gone || players.length <= 1) return cur;
    return {players: without(players, id),
            retired: [gone].concat(without(retired, id)).slice(0, MAX_RETIRED)};
  }

  if (op.t === "restore"){
    const back = find(retired, id);
    if (!back || find(players, id) || players.length >= MAX_PLAYERS) return cur;
    return {players: players.concat([back]), retired: without(retired, id)};
  }

  if (op.t === "seed"){
    if (players.length) return cur;         /* a sheet with a roster keeps it */
    const seeded = cleanRoster(op.players);
    if (!seeded) return cur;
    return {players: seeded, retired: retired};
  }

  return cur;
}

export function applyOps(doc, ops){
  let out = cleanDoc(doc);
  (ops || []).forEach(function(op){ out = applyOp(out, op); });
  return out;
}
