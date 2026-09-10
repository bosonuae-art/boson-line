/* The Boson Line - 2026 NFL pick sheet.
   Static page: odds and scores are fetched straight from ESPN in the browser,
   picks live in a shared Firestore ledger when one is configured and in
   localStorage either way. */
import { SCHED, BYES, ACCENTS, SLUG, SEED, SEED_AT } from "./data.js";
import { connect } from "./store.js";
import { buildDemo, DEMO_WEEK } from "./demo.js";

/* ------------------------------------------------------------------ static */
const TEAMS = {
ARI:["Cardinals","NFC West"],ATL:["Falcons","NFC South"],BAL:["Ravens","AFC North"],BUF:["Bills","AFC East"],
CAR:["Panthers","NFC South"],CHI:["Bears","NFC North"],CIN:["Bengals","AFC North"],CLE:["Browns","AFC North"],
DAL:["Cowboys","NFC East"],DEN:["Broncos","AFC West"],DET:["Lions","NFC North"],GB:["Packers","NFC North"],
HOU:["Texans","AFC South"],IND:["Colts","AFC South"],JAX:["Jaguars","AFC South"],KC:["Chiefs","AFC West"],
LAC:["Chargers","AFC West"],LAR:["Rams","NFC West"],LV:["Raiders","AFC West"],MIA:["Dolphins","AFC East"],
MIN:["Vikings","NFC North"],NE:["Patriots","AFC East"],NO:["Saints","NFC South"],NYG:["Giants","NFC East"],
NYJ:["Jets","AFC East"],PHI:["Eagles","NFC East"],PIT:["Steelers","AFC North"],SEA:["Seahawks","NFC West"],
SF:["49ers","NFC West"],TB:["Buccaneers","NFC South"],TEN:["Titans","AFC South"],WAS:["Commanders","NFC East"]
};
const NAME = {bo:"Bo", dad:"Dad"};

const GAMES = SCHED.map(function(r){
  return {wk:r[0], a:r[1], h:r[2], fav:r[3], sp:(typeof r[4]==="number"?r[4]:null), day:r[5],
          note:r[6]||null, key:r[1]+"@"+r[2]};
});
const BY_WEEK = {};
GAMES.forEach(function(g){ (BY_WEEK[g.wk] = BY_WEEK[g.wk] || []).push(g); });
const WEEKS = Object.keys(BY_WEEK).map(Number).sort(function(a,b){ return a-b; });
const KEYS_BY_WEEK = {};
WEEKS.forEach(function(w){
  KEYS_BY_WEEK[w] = {};
  BY_WEEK[w].forEach(function(g){ KEYS_BY_WEEK[w][g.key] = true; });
});

function mark(t, px){
  const s = SLUG[t];
  if (!s) return "";
  const attr = ' width="' + px + '" height="' + px + '" alt="" aria-hidden="true" loading="lazy" decoding="async">';
  return '<img class="lg lt" src="https://a.espncdn.com/i/teamlogos/nfl/500/' + s + '.png"' + attr +
         '<img class="lg dk" src="https://a.espncdn.com/i/teamlogos/nfl/500-dark/' + s + '.png"' + attr;
}

/* ------------------------------------------------------------------ state */
const LS = {
  get:function(k,d){ try{ const v = localStorage.getItem(k); return v===null ? d : JSON.parse(v); }catch(e){ return d; } },
  set:function(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const state = {
  me: LS.get("bl.me", null),
  sealed: LS.get("bl.sealed", true),
  tab: "picks",
  week: null,
  resMode: false,
  book: {},
  imported: LS.get("bl.imported", {}),
  shared: false,
  saving: "idle",
  now: Date.now()
};

/* live ESPN data: the shipped seed, then anything cached from a real fetch */
let LIVE = {};
Object.keys(SEED).forEach(function(w){ LIVE[w] = SEED[w]; });
(function(){
  const c = LS.get("bl.live", null);
  if (!c) return;
  Object.keys(c).forEach(function(w){ if (c[w] && c[w].games) LIVE[w] = c[w]; });
})();

/* ------------------------------------------------------------------ sample season
   A setting swaps the whole sheet for a fabricated week 10 so it can be shown to
   someone in September. Two things must hold while it is on: the real season has
   to survive untouched underneath, and not one byte may reach the shared sheet.
   Both are enforced here rather than trusted to the caller - `real` holds the
   genuine ledger, every write path checks demo.on, and the demo clock replaces
   Date.now() everywhere the season's own sense of time is read. */
const demo = {on: false, now: 0};
const real = {live: null, book: null, touch: null};

function nowMs(){ return demo.on ? demo.now : Date.now(); }
/* Picks and results always persist against the genuine ledger, never the sample. */
function realBook(){ return demo.on ? real.book : state.book; }

function setDemo(on, silent){
  on = !!on;
  if (on === demo.on) return;
  if (on){
    const d = buildDemo(SEED, BY_WEEK, WEEKS);
    real.live = LIVE;
    real.book = state.book;
    real.touch = {bo: TOUCH.bo, dad: TOUCH.dad};
    demo.on = true;
    demo.now = d.now;
    LIVE = d.live;
    state.book = d.book;
    TOUCH.bo = d.touch.bo; TOUCH.dad = d.touch.dad;
    state.week = DEMO_WEEK;
  } else {
    demo.on = false;
    LIVE = real.live || {};
    state.book = real.book || {};
    TOUCH.bo = (real.touch && real.touch.bo) || 0;
    TOUCH.dad = (real.touch && real.touch.dad) || 0;
    real.live = real.book = real.touch = null;
    state.week = defaultWeek();
  }
  state.now = nowMs();
  LS.set("bl.demo", demo.on);
  if (!silent) render();
  if (!demo.on) pullWeek(state.week, true);
}

const SEASON_START = Date.parse("2026-09-09T00:00:00Z");
function weekEnd(wk){ return SEASON_START + (wk * 7) * 86400000; }
function weekByDate(){
  const days = Math.floor((nowMs() - SEASON_START) / 86400000);
  return Math.min(18, Math.max(1, Math.floor(days / 7) + 1));
}
function defaultWeek(){
  for (let i=0;i<WEEKS.length;i++){
    const w = WEEKS[i], gs = BY_WEEK[w];
    let last = 0;
    for (let j=0;j<gs.length;j++){
      const lv = liveOf(w, gs[j].key);
      if (lv && lv.k){ const t = Date.parse(lv.k); if (t > last) last = t; }
    }
    if (last && nowMs() < last + 4*3600*1000) return w;
  }
  return weekByDate();
}

/* ------------------------------------------------------------------ ESPN */
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ABBR_FIX = {WSH:"WAS"};
const lastPull = {};
let pulling = 0;

function weekIsLive(wk){
  const d = LIVE[wk];
  if (!d || !d.games) return false;
  return Object.keys(d.games).some(function(k){ return d.games[k].st === "in"; });
}
function parseEvent(e, wk){
  const c = e.competitions && e.competitions[0];
  if (!c || !c.competitors) return null;
  const by = {};
  c.competitors.forEach(function(x){ by[x.homeAway] = x; });
  if (!by.away || !by.home || !by.away.team || !by.home.team) return null;
  const aw = ABBR_FIX[by.away.team.abbreviation] || by.away.team.abbreviation;
  const hm = ABBR_FIX[by.home.team.abbreviation] || by.home.team.abbreviation;
  const key = aw + "@" + hm;
  if (!KEYS_BY_WEEK[wk] || !KEYS_BY_WEEK[wk][key]) return null;

  const st = (c.status && c.status.type) || {};
  const g = {k:c.date, st:st.state};
  if (st.shortDetail) g.det = String(st.shortDetail);
  if (g.st === "in" || g.st === "post"){
    const as = parseInt(by.away.score, 10), hs = parseInt(by.home.score, 10);
    g.as = isNaN(as) ? 0 : as;
    g.hs = isNaN(hs) ? 0 : hs;
    if (g.st === "post" && st.completed){
      if (g.as !== g.hs){ g.w = g.as > g.hs ? aw : hm; g.by = Math.abs(g.as - g.hs); }
      else { g.w = "TIE"; g.by = 0; }
    }
  }
  const odds = (c.odds || []).slice().sort(function(a,b){
    return ((a.provider||{}).priority || 99) - ((b.provider||{}).priority || 99);
  });
  if (odds.length){
    const o = odds[0];
    if (typeof o.spread === "number" && o.spread !== 0){
      g.fav = o.spread < 0 ? hm : aw;
      g.sp = Math.abs(o.spread);
    }
    if (typeof o.overUnder === "number") g.ou = o.overUnder;
  }
  const names = [];
  (c.broadcasts || []).forEach(function(b){
    (b.names || []).forEach(function(n){ if (names.indexOf(n) < 0) names.push(n); });
  });
  if (names.length) g.tv = names.join("/").slice(0, 24);
  return {key:key, g:g};
}
function setPulling(delta){
  pulling = Math.max(0, pulling + delta);
  const el = document.getElementById("pulling");
  if (el) el.classList.toggle("on", pulling > 0);
}
async function pullWeek(wk, force){
  if (demo.on) return;            /* the sample never phones ESPN */
  const at = lastPull[wk];
  const maxAge = weekIsLive(wk) ? 25000 : 600000;
  if (!force && at && Date.now() - at < maxAge) return;
  lastPull[wk] = Date.now();
  setPulling(1);
  try {
    const r = await fetch(ESPN + "?dates=2026&seasontype=2&week=" + wk, {cache:"no-store"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    const games = {};
    (d.events || []).forEach(function(e){
      const p = parseEvent(e, wk);
      if (p) games[p.key] = p.g;
    });
    if (Object.keys(games).length){
      LIVE[wk] = {week:wk, fetched:new Date().toISOString(), games:games};
      LS.set("bl.live", LIVE);
      render();
    }
  } catch(e){
    lastPull[wk] = Date.now() - maxAge + 30000;   // let it retry sooner than a success would
  } finally {
    setPulling(-1);
  }
}

/* ------------------------------------------------------------------ reading */
function esc(s){ return String(s).replace(/[&<>"']/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; }); }
function half(n){
  if (typeof n !== "number" || isNaN(n)) return "";
  const w = Math.floor(Math.abs(n)), f = Math.abs(n) - w;
  const s = (f >= 0.5) ? (w ? w : "") + "½" : String(w);
  return (n < 0 ? "-" : "") + s;
}
function liveOf(wk, key){ const d = LIVE[wk]; return d && d.games ? d.games[key] : null; }
function bookOf(wk){ return state.book[wk] || {}; }
function pickOf(wk, key, who){
  const b = bookOf(wk), p = b.picks && b.picks[key], v = p && p[who];
  return v ? v : null;
}
function resultOf(wk, key){
  const b = bookOf(wk), m = b.results && b.results[key];
  if (m && m.w) return {w:m.w, by:(typeof m.by === "number" ? m.by : null), src:"manual"};
  const lv = liveOf(wk, key);
  if (lv && lv.st === "post" && lv.w)
    return {w:lv.w, by:(typeof lv.by === "number" ? lv.by : null), src:"espn", as:lv.as, hs:lv.hs};
  return null;
}
function kickoff(wk, key){ const lv = liveOf(wk, key); return lv && lv.k ? Date.parse(lv.k) : null; }
function isLocked(wk, key){
  const lv = liveOf(wk, key);
  if (lv && (lv.st === "in" || lv.st === "post")) return true;
  const k = kickoff(wk, key);
  if (k !== null) return state.now >= k;
  return state.now >= weekEnd(wk);
}
function marketLine(g){
  const lv = liveOf(g.wk, g.key);
  if (lv && lv.fav && typeof lv.sp === "number") return {fav:lv.fav, sp:lv.sp, src:"live", ou:lv.ou};
  if (g.fav) return {fav:g.fav, sp:g.sp, src:"sheet"};
  return null;
}
function atsOf(g, res){
  if (!res || res.by === null || res.w === "TIE") return null;
  const m = marketLine(g);
  if (!m || typeof m.sp !== "number") return null;
  if (m.sp === 0) return res.w === m.fav ? "cov" : "no";
  const margin = (res.w === m.fav) ? res.by : -res.by;
  return margin > m.sp ? "cov" : margin < m.sp ? "no" : "push";
}
const DAY3 = {Sunday:"SUN",Monday:"MON",Thursday:"THU",Friday:"FRI",Saturday:"SAT",Tuesday:"TUE",Wednesday:"WED"};
function whenLabel(g){
  const k = kickoff(g.wk, g.key);
  if (k === null) return DAY3[g.day] || (g.day || "").slice(0,3).toUpperCase();
  const d = new Date(k);
  const day = ["SUN","MON","TUE","WED","THU","FRI","SAT"][d.getDay()];
  let h = d.getHours(); const ap = h >= 12 ? "p" : "a"; h = h % 12 || 12;
  const mm = d.getMinutes();
  return day + " " + h + (mm ? ":" + String(mm).padStart(2,"0") : "") + ap;
}
function isSealed(g, who){
  if (!state.sealed) return false;
  if (resultOf(g.wk, g.key) || isLocked(g.wk, g.key)) return false;
  if (!state.me) return true;
  if (who === state.me) return false;
  return !pickOf(g.wk, g.key, state.me);
}

/* ------------------------------------------------------------------ scoring */
function weekStats(wk){
  const gs = BY_WEEK[wk] || [];
  const s = {games:gs.length, decided:0, bo:0, dad:0, veg:0, boIn:0, dadIn:0,
             cov:0, no:0, push:0, h2hBo:0, h2hDad:0, agreed:0};
  for (let i=0;i<gs.length;i++){
    const g = gs[i];
    const pb = pickOf(wk,g.key,"bo"), pd = pickOf(wk,g.key,"dad");
    if (pb) s.boIn++;
    if (pd) s.dadIn++;
    const res = resultOf(wk, g.key);
    if (!res) continue;
    s.decided++;
    if (pb === res.w) s.bo++;
    if (pd === res.w) s.dad++;
    if (g.fav === res.w) s.veg++;
    if (pb && pd){
      if (pb === pd) s.agreed++;
      else { if (pb === res.w) s.h2hBo++; if (pd === res.w) s.h2hDad++; }
    }
    const a = atsOf(g, res);
    if (a === "cov") s.cov++; else if (a === "no") s.no++; else if (a === "push") s.push++;
  }
  return s;
}
function seasonStats(){
  const t = {games:0, decided:0, bo:0, dad:0, veg:0, boIn:0, dadIn:0,
             cov:0, no:0, push:0, h2hBo:0, h2hDad:0, agreed:0, weeks:[]};
  const keys = ["games","decided","bo","dad","veg","boIn","dadIn","cov","no","push","h2hBo","h2hDad","agreed"];
  WEEKS.forEach(function(w){
    const s = weekStats(w); s.wk = w; t.weeks.push(s);
    keys.forEach(function(k){ t[k] += s[k]; });
  });
  return t;
}
function pct(n, d){ return d ? (n / d * 100).toFixed(1) + "%" : "-"; }
function ago(ms){
  const d = nowMs() - ms;
  if (d < 0 || d < 45000) return "just now";
  if (d < 90000) return "a minute ago";
  if (d < 3600000) return Math.round(d / 60000) + " min ago";
  if (d < 7200000) return "an hour ago";
  if (d < 86400000) return Math.round(d / 3600000) + " hr ago";
  if (d < 172800000) return "yesterday";
  return new Date(ms).toLocaleDateString(undefined, {month:"short", day:"numeric"});
}
function tsMillis(v){
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}
function clockLabel(ms){
  const d = new Date(ms);
  let h = d.getHours(); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12;
  return h + ":" + String(d.getMinutes()).padStart(2, "0") + ap;
}
function signed(n){ return (n >= 0 ? "+" : "") + n; }

/* What is actually happening in a week right now, which is the one thing the
   sheet could not tell you at a glance: you had to read 16 rows to find out. */
function liveSummary(wk){
  const gs = BY_WEEK[wk] || [];
  const s = {games:gs.length, live:0, final:0, ahead:0, next:null, inplay:[]};
  for (let i=0;i<gs.length;i++){
    const g = gs[i], lv = liveOf(wk, g.key);
    if (lv && lv.st === "in"){ s.live++; s.inplay.push(g); continue; }
    if (resultOf(wk, g.key)){ s.final++; continue; }
    s.ahead++;
    const k = kickoff(wk, g.key);
    if (k !== null && (s.next === null || k < s.next)) s.next = k;
  }
  return s;
}
/* ESPN's shortDetail reads "9:12 - 2nd Quarter". In a column this narrow that
   wraps into nonsense, and "Quarter" carries nothing "2nd" doesn't. */
function periodText(det){
  return String(det || "")
    .replace(/\s*-\s*/, " ")
    .replace(/\s*Quarter\b/i, "")
    .replace(/^End of /i, "End ")
    .trim();
}
function liveWeek(){
  for (let i=0;i<WEEKS.length;i++){
    const w = WEEKS[i], d = LIVE[w];
    if (!d || !d.games) continue;
    const ks = Object.keys(d.games);
    for (let j=0;j<ks.length;j++) if (d.games[ks[j]].st === "in") return w;
  }
  return null;
}

/* ------------------------------------------------------------------ writing */
let store = null;
function persist(){ LS.set("bl.book", realBook()); }

/* Edits this device has made but has not yet seen come back from the shared
   sheet. mergeRemote replaces a week wholesale, so without this a pick made
   while the connection was still opening - or while the phone was on a train -
   would be drawn on screen, then silently erased by the next snapshot. Pending
   edits sit on top of whatever arrives until the server echoes them back. */
const PEND = LS.get("bl.pend", {}) || {};
/* Every pending edit carries the moment it was made. Without that stamp there is
   no way to tell a genuine unsent edit from an intent the sheet has long since
   moved past - and replaying the latter on load silently overwrites whatever the
   other person did in between. Anything older than this is not anyone's live
   intention any more. */
const PEND_MAX_AGE = 12 * 3600 * 1000;
function pendSave(){ LS.set("bl.pend", PEND); }
function pendVal(cell, who){
  const e = cell && cell[who];
  if (e === undefined) return undefined;
  return (e && typeof e === "object" && "v" in e) ? e.v : (e || null);
}
function pendAt(cell, who){
  const e = cell && cell[who];
  return (e && typeof e === "object" && typeof e.t === "number") ? e.t : 0;
}
function pendMark(wk, key, who, val){
  if (demo.on) return;            /* sample edits are never sent anywhere */
  const w = PEND[wk] = PEND[wk] || {};
  const c = w[key] = w[key] || {};
  c[who] = {v: val || null, t: Date.now()};
  pendSave();
}
function pendCount(){
  let n = 0;
  Object.keys(PEND).forEach(function(wk){
    Object.keys(PEND[wk]).forEach(function(k){ n += Object.keys(PEND[wk][k]).length; });
  });
  return n;
}
function pendReconcile(wk, remotePicks, remoteAt){
  const w = PEND[wk];
  if (!w) return;
  const now = Date.now();
  Object.keys(w).forEach(function(key){
    const cell = w[key];
    Object.keys(cell).forEach(function(who){
      const want = pendVal(cell, who) || null;
      const at = pendAt(cell, who);
      const remote = (remotePicks[key] && remotePicks[key][who]) || null;
      /* Drop it when the sheet already agrees; when the sheet was written after
         this edit was made, in which case the sheet is the newer intention and
         wins; or when it is simply too old to be anybody's intention. Entries
         saved before stamps existed have at = 0 and fall out here. */
      const confirmed  = (want === remote);
      const superseded = remoteAt > 0 && remoteAt > at;
      const stale      = (now - at) > PEND_MAX_AGE;
      if (confirmed || superseded || stale) delete cell[who];
    });
    if (!Object.keys(cell).length) delete w[key];
  });
  if (!Object.keys(w).length) delete PEND[wk];
  pendSave();
}
function pendApply(wk, picks){
  const w = PEND[wk];
  if (!w) return picks;
  Object.keys(w).forEach(function(key){
    if (!KEYS_BY_WEEK[wk] || !KEYS_BY_WEEK[wk][key]) return;
    const cell = Object.assign({}, picks[key]);
    Object.keys(w[key]).forEach(function(who){
      const v = pendVal(w[key], who);
      if (v) cell[who] = v; else delete cell[who];
    });
    if (Object.keys(cell).length) picks[key] = cell; else delete picks[key];
  });
  return picks;
}
/* No shared sheet at all - nothing can ever be sent, so stop tracking sends.
   The picks themselves stay put; only the outbound ledger is dropped. */
function purgePending(){
  Object.keys(PEND).forEach(function(k){ delete PEND[k]; });
  pendSave();
}
/* Only ever called once the shared sheet has been read and pending edits have
   been reconciled against it, so what goes up is what genuinely has not landed. */
function flushPending(){
  if (!store) return;
  Object.keys(PEND).forEach(function(wk){
    const obj = {};
    Object.keys(PEND[wk]).forEach(function(key){
      const cell = {};
      Object.keys(PEND[wk][key]).forEach(function(who){ cell[who] = pendVal(PEND[wk][key], who); });
      if (Object.keys(cell).length) obj[key] = cell;
    });
    if (Object.keys(obj).length) store.savePicks(Number(wk), obj, state.me).catch(function(){});
  });
}
function applyPicks(wk, obj){
  const b = state.book[wk] = state.book[wk] || {week:wk, picks:{}, results:{}};
  b.picks = b.picks || {};
  Object.keys(obj).forEach(function(k){
    const patch = obj[k];
    if (patch === null){ delete b.picks[k]; return; }
    const merged = Object.assign({}, b.picks[k], patch);
    Object.keys(merged).forEach(function(f){ if (!merged[f]) delete merged[f]; });
    if (Object.keys(merged).length) b.picks[k] = merged; else delete b.picks[k];
  });
  persist();
}
function setPicks(wk, obj){
  applyPicks(wk, obj);
  Object.keys(obj).forEach(function(k){
    const patch = obj[k];
    if (patch === null) return;
    Object.keys(patch).forEach(function(who){ pendMark(wk, k, who, patch[who]); });
  });
  render();
  if (store && !demo.on) store.savePicks(wk, obj, state.me).catch(function(){});
}
function setResult(wk, key, val){
  const b = state.book[wk] = state.book[wk] || {week:wk, picks:{}, results:{}};
  b.results = b.results || {};
  if (val === null) delete b.results[key]; else b.results[key] = val;
  persist(); render();
  if (store && !demo.on) store.saveResult(wk, key, val, state.me).catch(function(){});
}
let flashTimer = null;
let undoAction = null;
/* An offer to undo, where the message alone would leave you stuck. Cheaper than
   a confirm on every press, and it does not put a dialog between you and a
   button you meant to hit ninety-nine times out of a hundred. */
function flash(msg, undoLabel, fn){
  const n = document.getElementById("notice");
  undoAction = fn || null;
  n.innerHTML = '<div class="flash">' + esc(msg) +
    (fn ? ' <button type="button" data-act="undo">' + esc(undoLabel || "Undo") + '</button>' : '') +
    '</div>';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(function(){
    flashTimer = null; undoAction = null; n.innerHTML = ""; render();
  }, fn ? 15000 : 5000);
}
document.getElementById("notice").addEventListener("click", function(e){
  if (!e.target.closest('button[data-act="undo"]')) return;
  const fn = undoAction;
  undoAction = null;
  if (fn) fn();
});

/* ------------------------------------------------------------------ pick codes */
function b64(bytes){
  let s = "";
  for (let i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function unb64(str){
  const s = atob(str.replace(/-/g,"+").replace(/_/g,"/"));
  const out = [];
  for (let i=0;i<s.length;i++) out.push(s.charCodeAt(i));
  return out;
}
function encodePicks(who){
  const vals = GAMES.map(function(g){
    const p = pickOf(g.wk, g.key, who);
    return p === g.a ? 1 : p === g.h ? 2 : 0;
  });
  const bytes = [];
  for (let i=0;i<vals.length;i+=5){
    let v = 0;
    for (let j=4;j>=0;j--) v = v * 3 + (vals[i+j] || 0);
    bytes.push(v);
  }
  return "BL1" + (who === "bo" ? "B" : "D") + b64(bytes);
}
function decodePicks(code){
  const c = String(code || "").trim().replace(/\s+/g, "");
  if (c.slice(0,3) !== "BL1") return null;
  const tag = c.charAt(3);
  const who = tag === "B" ? "bo" : tag === "D" ? "dad" : null;
  if (!who) return null;
  let bytes;
  try { bytes = unb64(c.slice(4)); } catch(e){ return null; }
  if (bytes.length < Math.ceil(GAMES.length / 5)) return null;
  const vals = [];
  for (let i=0;i<bytes.length;i++){
    let v = bytes[i];
    for (let j=0;j<5;j++){ vals.push(v % 3); v = Math.floor(v / 3); }
  }
  const byWeek = {};
  let n = 0;
  GAMES.forEach(function(g, i){
    if (!vals[i]) return;
    (byWeek[g.wk] = byWeek[g.wk] || {})[g.key] = vals[i] === 1 ? g.a : g.h;
    n++;
  });
  return {who:who, byWeek:byWeek, count:n};
}
function applyCode(code){
  const d = decodePicks(code);
  if (!d){ flash("That code didn't read right. Copy the whole thing and try again."); return; }
  Object.keys(d.byWeek).forEach(function(wk){
    const w = Number(wk), obj = {};
    Object.keys(d.byWeek[wk]).forEach(function(k){
      const p = {}; p[d.who] = d.byWeek[wk][k]; obj[k] = p;
    });
    applyPicks(w, obj);
    if (store) store.savePicks(w, obj).catch(function(){});
  });
  state.imported[d.who] = new Date().toISOString();
  LS.set("bl.imported", state.imported);
  flash(NAME[d.who] + "'s sheet loaded - " + d.count + " picks across the season.");
  render();
}

/* ------------------------------------------------------------------ render: masthead */
function renderScoreline(){
  const s = seasonStats();
  const lead = s.decided === 0 || s.bo === s.dad ? null : (s.bo > s.dad ? "bo" : "dad");
  document.getElementById("scoreline").innerHTML =
    [["bo","Bo",s.bo],["dad","Dad",s.dad],["veg","Vegas",s.veg]].map(function(r){
      return '<span class="sc ' + r[0] + (lead === r[0] ? " lead" : "") + '">' +
        '<span class="n">' + r[1] + '</span>' +
        '<span class="v">' + r[2] + '-' + (s.decided - r[2]) + '</span></span>';
    }).join("") + '<span class="pulling" id="pulling">pulling</span>';
  let anyLive = false;
  Object.keys(LIVE).forEach(function(w){
    const d = LIVE[w];
    if (d && d.games) Object.keys(d.games).forEach(function(k){ if (d.games[k].st === "in") anyLive = true; });
  });
  const lp = document.getElementById("live");
  lp.classList.toggle("on", anyLive);
  lp.disabled = !anyLive;
  if (pulling > 0){ const p = document.getElementById("pulling"); if (p) p.classList.add("on"); }
}

/* ------------------------------------------------------------------ render: picks */
function renderWeeks(){
  const el = document.getElementById("weeks");
  el.innerHTML = WEEKS.map(function(w){
    const s = weekStats(w);
    const done = s.games && s.decided === s.games;
    return '<button type="button" data-w="' + w + '"' + (done ? ' class="done"' : '') +
           ' aria-current="' + (w === state.week) + '">' + w + '</button>';
  }).join("");
  /* The strip is wider than a phone from week nine on, and it opens at week one,
     so the week you are actually in scrolls off the end. Centre it. */
  const cur = el.querySelector('button[aria-current="true"]');
  if (cur) el.scrollLeft = Math.max(0, cur.offsetLeft - (el.clientWidth - cur.offsetWidth) / 2);
}
function renderWeekHead(){
  const wk = state.week, s = weekStats(wk);
  document.getElementById("weekTitle").textContent = "Week " + wk;
  const byes = Object.keys(BYES).filter(function(t){ return BYES[t] === wk; }).sort();
  const bits = [s.games + " games"];
  if (state.me) bits.push((state.me === "bo" ? s.boIn : s.dadIn) + " of " + s.games + " picked");
  if (s.decided) bits.push("Bo " + s.bo + ", Dad " + s.dad + ", Vegas " + s.veg);
  if (byes.length) bits.push("bye: " + byes.join(", "));
  /* The number that drives the visit - how many games still want a pick - leads
     the line, because on a phone it is the only part of it anyone reads. */
  const left = state.me ? s.games - (state.me === "bo" ? s.boIn : s.dadIn) : 0;
  const lead = left > 0 ? '<b class="todo">' + left + ' to pick</b>' : "";
  document.getElementById("weekSaid").innerHTML = lead + esc(bits.join(" · "));
  const i = WEEKS.indexOf(wk);
  document.getElementById("weekPrev").disabled = (i <= 0);
  document.getElementById("weekNext").disabled = (i >= WEEKS.length - 1);
}
/* ------------------------------------------------------------------ live strip
   Everything the sheet knows about right now, in one line: what is on, what the
   score is, how old the numbers are, and a way to go get fresh ones. */
function renderLiveBar(){
  const wk = state.week, s = liveSummary(wk);
  const cls = ["livebar"];
  if (s.live) cls.push("on");

  let phrase;
  if (s.live) phrase = s.live + (s.live === 1 ? " game under way" : " games under way");
  else if (s.games && s.final === s.games) phrase = "All " + s.games + " final";
  else if (s.final) phrase = s.final + " final, " + s.ahead + " to come";
  else if (s.next !== null) phrase = "First kickoff " + whenAbs(s.next);
  else phrase = s.games + " games, none played";

  const chips = s.inplay.map(function(g){
    const lv = liveOf(wk, g.key);
    const sc = (typeof lv.as === "number") ? lv.as + "&ndash;" + lv.hs : "";
    return '<span class="chip">' + esc(g.a) + ' <b>' + sc + '</b> ' + esc(g.h) +
      (lv.det ? '<i>' + esc(periodText(lv.det)) + '</i>' : "") + '</span>';
  }).join("");

  const d = LIVE[wk], at = d && d.fetched ? Date.parse(d.fetched) : NaN;
  const fresh = isNaN(at) ? "not yet pulled" : '<span class="src">ESPN</span> ' + esc(ago(at));

  document.getElementById("livebar").className = cls.join(" ");
  document.getElementById("livebar").innerHTML =
    '<div class="lb-state"><i></i><span>' + esc(phrase) + '</span></div>' +
    (chips ? '<div class="lb-scores">' + chips + '</div>' : '') +
    '<div class="lb-meta">' +
      '<span class="fresh" id="freshTxt">' + fresh + '</span>' +
      '<button type="button" class="refresh" id="refreshBtn">Refresh</button>' +
    '</div>' +
    '<div class="lb-sync" id="lbSync"></div>';
  renderSync();
}
function whenAbs(ms){
  const d = new Date(ms);
  const day = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
  return day + " " + clockLabel(ms);
}
/* The sync line answers the question the status dot could not: has the other
   person actually seen any of this? */
function renderSync(){
  const el = document.getElementById("lbSync");
  if (!el) return;
  const bits = [];
  /* The sample stands in for a working shared sheet, so it reports its own
     state rather than whatever the real connection happens to be doing behind
     it. The banner above already says none of this is real. */
  if (!state.shared && !demo.on){
    el.className = "lb-sync off";
    el.innerHTML = '<b>Not shared.</b> Picks are saved on this device only &mdash; ' +
      'use the codes at the bottom to swap sheets by text.';
    return;
  }
  el.className = "lb-sync";
  const pending = pendCount();
  if (state.saving === "retrying")
    bits.push('<b class="warn">Can&rsquo;t reach the sheet.</b> Still trying &mdash; your picks are safe here.');
  else if (pending)
    bits.push('<b>Saving ' + pending + '&hellip;</b>');
  else
    bits.push('<b class="ok">Everything saved.</b>');

  /* Count what is actually on the sheet rather than trusting the clock: picks
     made before touch existed carry no timestamp, and reporting those as "hasn't
     picked yet" while their column is full is worse than saying nothing. */
  const ws = weekStats(state.week);
  ["bo","dad"].forEach(function(w){
    const you = (w === state.me);
    const label = you ? "You" : NAME[w];
    const n = (w === "bo") ? ws.boIn : ws.dadIn;
    /* The week is named directly above, so "this week" is noise. A timestamp on
       your own row is noise too - you know when you last touched it; what you
       cannot know without being told is when the other person did. */
    const when = (!you && TOUCH[w]) ? ", " + ago(TOUCH[w]) : "";
    if (n) bits.push(label + " " + n + " of " + ws.games + when);
    else if (TOUCH[w] && !you) bits.push(label + " none here yet, last active " + ago(TOUCH[w]));
    else bits.push(label + " nothing yet");
  });
  el.innerHTML = bits.join(' <span class="dot">&middot;</span> ');
}

/* Each cell carries its own label rather than leaning on nth-child pseudo-elements,
   which is what let the phone layout reflow a table into labelled fragments - the
   pattern that reads as a broken table rather than as anything designed. The label
   shows on a phone, where there are no column heads, and hides on the desktop,
   where there are. Your own column hides on a phone too: the button you tapped is
   already lit, so repeating it costs a third of the row for nothing. */
function ledgerCell(g, res){
  return '<div class="ledger">' + ["bo","dad","veg"].map(function(who){
    const cls = ["who", who];
    if (who === state.me) cls.push("self");
    const label = (who === "veg") ? "Vegas" : NAME[who];
    let body;
    if (who === "veg"){
      body = !g.fav ? '<span class="none">-</span>'
        : '<b class="' + (res ? (g.fav === res.w ? "hit" : "miss") : "") + '">' + esc(g.fav) + '</b>';
    } else if (isSealed(g, who)){
      body = '<span class="seal" title="Sealed until you pick">·</span>';
    } else {
      const p = pickOf(g.wk, g.key, who);
      body = !p ? '<span class="none">-</span>'
        : '<b class="' + (res ? (p === res.w ? "hit" : "miss") : "") + '">' + esc(p) + '</b>';
    }
    return '<span class="' + cls.join(" ") + '"><i>' + esc(label) + '</i>' + body + '</span>';
  }).join("") + '</div>';
}
function lineCell(g, res){
  const m = marketLine(g);
  if (!m || !m.fav) return '<div class="line"><span class="sub">no line</span></div>';
  const head = typeof m.sp !== "number" ? esc(m.fav)
             : m.sp === 0 ? esc(m.fav) + " PK"
             : esc(m.fav) + " -" + half(m.sp);
  const sub = [];
  if (typeof m.ou === "number") sub.push("o" + half(m.ou));
  if (m.src === "live" && g.fav){
    const moved = (g.fav !== m.fav) || (typeof g.sp === "number" && g.sp !== m.sp);
    if (moved) sub.push("was " + esc(g.fav) + (typeof g.sp === "number" && g.sp ? " -" + half(g.sp) : " PK"));
  }
  const a = atsOf(g, res);
  if (a === "cov") sub.push('<span class="cov">covered</span>');
  else if (a === "no") sub.push("no cover");
  else if (a === "push") sub.push("push");
  const subs = sub.map(function(x){ return '<span class="b">' + x + '</span>'; }).join(" ");
  return '<div class="line">' + head + (sub.length ? '<span class="sub">' + subs + '</span>' : "") + '</div>';
}
function scoreCell(g, res){
  const wk = g.wk, lv = liveOf(wk, g.key);
  if (state.resMode){
    const man = (bookOf(wk).results || {})[g.key] || {};
    const cur = man.w || "";
    const id = "by-" + wk + "-" + g.key.replace("@","-");
    return '<div class="resedit">' +
      '<button type="button" data-act="res" data-t="' + g.a + '" aria-pressed="' + (cur===g.a) + '">' + g.a + '</button>' +
      '<button type="button" data-act="res" data-t="' + g.h + '" aria-pressed="' + (cur===g.h) + '">' + g.h + '</button>' +
      '<button type="button" data-act="res" data-t="TIE" aria-pressed="' + (cur==="TIE") + '">TIE</button>' +
      '<input type="number" min="1" max="99" step="1" id="' + id + '" data-act="by" aria-label="Winning margin"' +
        ' placeholder="by" value="' + (typeof man.by === "number" && man.by ? man.by : "") + '">' +
    '</div>';
  }
  if (res){
    const score = res.w === "TIE" ? "tied"
      : (typeof res.as === "number" && typeof res.hs === "number")
        ? esc(res.w) + " " + res.as + "-" + res.hs
        : esc(res.w) + (res.by ? " by " + res.by : "");
    return '<div class="score">' + score +
           (res.src === "manual" ? '<span class="sub">by hand</span>' : "") + '</div>';
  }
  if (lv && lv.st === "in"){
    const sc = (typeof lv.as === "number") ? lv.as + "-" + lv.hs : "under way";
    return '<div class="score now"><i class="pulse"></i><b>' + sc + '</b>' +
      (lv.det ? '<span class="sub">' + esc(periodText(lv.det)) + '</span>' : "") + '</div>';
  }
  if (isLocked(wk, g.key)) return '<div class="score"><span class="none">kicked off</span></div>';
  return '<div class="score"><span class="none">-</span></div>';
}
function renderGames(){
  const wk = state.week;
  document.getElementById("games").innerHTML = (BY_WEEK[wk] || []).map(function(g){
    const res = resultOf(wk, g.key), lv = liveOf(wk, g.key), locked = isLocked(wk, g.key);
    const mine = state.me ? pickOf(wk, g.key, state.me) : null;
    const cls = ["game"];
    if (res) cls.push("final");
    else if (lv && lv.st === "in") cls.push("inplay");
    if (isFresh(wk, g.key)) cls.push("justin");

    function side(team){
      const c = ["pk"];
      if (mine === team) c.push("mine", state.me);
      if (res && res.w !== "TIE"){ if (res.w === team) c.push("won"); else c.push("lost"); }
      const dis = (!state.me || locked || state.resMode) ? " disabled" : "";
      const title = locked ? "Locked at kickoff" : state.me ? "Pick " + team : "Say who you are first";
      return '<button type="button" class="' + c.join(" ") + '" data-act="pick" data-t="' + team + '"' + dis +
        ' aria-pressed="' + (mine === team) + '" title="' + title + '">' + mark(team, 26) +
        '<span class="code">' + team + '</span>' +
        '<span class="nick">' + esc(TEAMS[team] ? TEAMS[team][0] : team) + '</span></button>';
    }
    const when = ['<span>' + whenLabel(g) + '</span>'];
    if (lv && lv.tv) when.push('<span class="b">' + esc(lv.tv) + '</span>');
    if (g.note) when.push('<span class="note">' + esc(g.note) + '</span>');

    return '<div class="' + cls.join(" ") + '" data-k="' + g.key + '">' +
      '<div class="when">' + when.join("") + '</div>' +
      '<div class="matchup">' + side(g.a) + '<span class="at">@</span>' + side(g.h) + '</div>' +
      ledgerCell(g, res) + lineCell(g, res) + scoreCell(g, res) +
    '</div>';
  }).join("");
}
function renderDemoBar(){
  const el = document.getElementById("demobar");
  el.hidden = !demo.on;
  if (!demo.on) return;
  el.innerHTML =
    '<span class="tag">Sample</span>' +
    '<span class="txt"><b>Made-up season.</b> Week ' + DEMO_WEEK + ' of a year that has not happened, ' +
    'so the sheet can be shown full. Nothing here is saved or shared.</span>' +
    '<button type="button" id="demoOff">Back to the real sheet</button>';
}
function renderNotice(){
  if (flashTimer) return;
  /* One banner at a time: in the sample, the sample explains itself. */
  document.getElementById("notice").innerHTML = (state.me || demo.on) ? "" :
    '<div class="nudge">Say whether you&rsquo;re <b>Bo</b> or <b>Dad</b> up top to start picking. ' +
    'Until then both columns stay sealed.</div>';
  document.getElementById("mast").classList.toggle("unset", !state.me);
}
function renderSwap(){
  const s = seasonStats(), bits = ["Bo has " + s.boIn + " of " + s.games + " in, Dad has " + s.dadIn + "."];
  ["bo","dad"].forEach(function(w){
    if (state.imported[w]) bits.push(NAME[w] + "'s code loaded " + stamp(state.imported[w]) + ".");
  });
  document.getElementById("swapSaid").textContent = bits.join(" ");
}

/* ------------------------------------------------------------------ standings */
function renderStandings(){
  const s = seasonStats();
  const chart = s.decided
    ? '<section class="sec"><h3>Running total</h3><p class="cap">Correct picks, adding up week by week.</p>' +
      lineChart(s) + '</section>'
    : '<section class="sec"><h3>Running total</h3><p class="cap">Nothing settled yet &mdash; the line starts ' +
      'moving once Week 1 finals land. Until then the ledger below shows who has picks in.</p></section>';
  const rows = s.weeks.map(function(w){
    const done = w.decided > 0;
    let leader = "-", by = "";
    if (done){
      if (w.bo === w.dad) leader = "tied";
      else { leader = w.bo > w.dad ? "Bo" : "Dad"; by = "+" + Math.abs(w.bo - w.dad); }
    }
    return '<tr' + (done ? "" : ' class="wait"') + '><td>Week ' + w.wk + '</td>' +
      '<td class="n">' + w.decided + '/' + w.games + '</td>' +
      '<td class="n">' + (done ? w.bo : "-") + '</td><td class="n">' + (done ? w.dad : "-") + '</td>' +
      '<td class="n">' + (done ? w.veg : "-") + '</td>' +
      '<td>' + leader + '</td><td class="n">' + by + '</td></tr>';
  }).join("");
  const tot = '<tr class="tot"><td>Season</td><td class="n">' + s.decided + '/' + s.games + '</td>' +
    '<td class="n">' + s.bo + '</td><td class="n">' + s.dad + '</td><td class="n">' + s.veg + '</td>' +
    '<td>' + (s.decided ? (s.bo === s.dad ? "tied" : (s.bo > s.dad ? "Bo" : "Dad")) : "-") + '</td>' +
    '<td class="n">' + (s.decided && s.bo !== s.dad ? "+" + Math.abs(s.bo - s.dad) : "") + '</td></tr>';
  const ledger = '<section class="sec"><h3>The ledger</h3>' +
    '<p class="cap">Every week of the season, and where it left the three of you.</p>' +
    '<div class="tblwrap"><table><thead><tr><th>Week</th><th>Played</th>' +
    '<th class="bocol">Bo</th><th class="dadcol">Dad</th><th class="vegcol">Vegas</th>' +
    '<th>Leader</th><th>By</th></tr></thead><tbody>' + rows + tot + '</tbody></table></div></section>';
  const dl = '<section class="sec"><h3>Against the book</h3>' +
    '<p class="cap">Vegas picks the preseason favorite in all 272 games, so it is the pace to beat.</p>' +
    '<div class="dl">' +
      row2("Bo", s.bo + "-" + (s.decided - s.bo) + "  " + pct(s.bo, s.decided)) +
      row2("Dad", s.dad + "-" + (s.decided - s.dad) + "  " + pct(s.dad, s.decided)) +
      row2("Vegas", s.veg + "-" + (s.decided - s.veg) + "  " + pct(s.veg, s.decided)) +
      row2("Bo against Vegas", signed(s.bo - s.veg)) +
      row2("Dad against Vegas", signed(s.dad - s.veg)) +
      row2("Head to head", s.h2hBo + "-" + s.h2hDad) +
      row2("Picked the same way", s.agreed + " games") +
      row2("Favorites against the spread", s.cov + "-" + s.no + (s.push ? "-" + s.push : "")) +
    '</div><div class="swap"><button type="button" class="btn" id="csvBtn">Download the season as CSV</button></div>' +
    '</section>';
  document.getElementById("pane-standings").innerHTML = chart + ledger + dl;
  const b = document.getElementById("csvBtn");
  if (b) b.addEventListener("click", downloadCsv);
}
function row2(k, v){ return '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; }
function lineChart(s){
  const pts = {bo:[], dad:[], veg:[]}, labels = [];
  let cb = 0, cd = 0, cv = 0;
  s.weeks.forEach(function(w){
    if (!w.decided) return;
    cb += w.bo; cd += w.dad; cv += w.veg;
    labels.push(w.wk); pts.bo.push(cb); pts.dad.push(cd); pts.veg.push(cv);
  });
  const W = 660, H = 240, L = 40, R = 16, T = 16, B = 30;
  const maxY = Math.max(4, cb, cd, cv), n = labels.length;
  const x = function(i){ return L + (n === 1 ? (W-L-R)/2 : i * (W-L-R) / (n-1)); };
  const y = function(v){ return H - B - (v / maxY) * (H - T - B); };
  const path = function(a){ return a.map(function(v,i){ return (i?"L":"M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" "); };
  let g = "";
  [0, Math.round(maxY/2), maxY].filter(function(v,i,a){ return a.indexOf(v) === i; }).forEach(function(t){
    g += '<line x1="' + L + '" y1="' + y(t).toFixed(1) + '" x2="' + (W-R) + '" y2="' + y(t).toFixed(1) +
         '" stroke="currentColor" stroke-opacity=".13"></line>' +
         '<text x="' + (L-8) + '" y="' + (y(t)+4).toFixed(1) + '" text-anchor="end" font-size="10" ' +
         'fill="currentColor" fill-opacity=".5">' + t + '</text>';
  });
  labels.forEach(function(w,i){
    if (n > 10 && i % 2) return;
    g += '<text x="' + x(i).toFixed(1) + '" y="' + (H-9) + '" text-anchor="middle" font-size="10" ' +
         'fill="currentColor" fill-opacity=".5">' + w + '</text>';
  });
  [["veg","var(--gold)"],["dad","var(--dad)"],["bo","var(--bo)"]].forEach(function(sr){
    g += '<path d="' + path(pts[sr[0]]) + '" fill="none" stroke="' + sr[1] +
         '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>';
    const i = pts[sr[0]].length - 1;
    g += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(pts[sr[0]][i]).toFixed(1) + '" r="3.2" fill="' + sr[1] + '"></circle>';
  });
  return '<div class="tblwrap"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H +
    '" role="img" aria-label="Cumulative correct picks by week">' + g + '</svg></div>' +
    '<div class="legend"><span><i style="background:var(--bo)"></i>Bo ' + cb + '</span>' +
    '<span><i style="background:var(--dad)"></i>Dad ' + cd + '</span>' +
    '<span><i style="background:var(--gold)"></i>Vegas ' + cv + '</span></div>';
}

/* ------------------------------------------------------------------ teams */
function renderTeams(){
  const rows = Object.keys(TEAMS).map(function(t){
    let fav = 0, bo = 0, dad = 0, w = 0, l = 0;
    GAMES.forEach(function(g){
      if (g.a !== t && g.h !== t) return;
      if (g.fav === t) fav++;
      if (pickOf(g.wk,g.key,"bo") === t) bo++;
      if (pickOf(g.wk,g.key,"dad") === t) dad++;
      const res = resultOf(g.wk, g.key);
      if (res){ if (res.w === t) w++; else if (res.w !== "TIE") l++; }
    });
    return {t:t, nick:TEAMS[t][0], div:TEAMS[t][1], bye:BYES[t], fav:fav, bo:bo, dad:dad, w:w, l:l};
  }).sort(function(a,b){ return b.fav - a.fav || a.t.localeCompare(b.t); });
  const played = rows.some(function(r){ return r.w + r.l > 0; });
  const body = rows.map(function(r){
    const c = ACCENTS[r.t] || ["#888","#888"];
    return '<tr style="--tcl:' + c[0] + ';--tcd:' + c[1] + '">' +
      '<td><span class="tname">' + mark(r.t, 20) + '<b>' + r.t + '</b>' +
        '<span style="color:var(--ink3)">' + esc(r.nick) + '</span></span></td>' +
      '<td style="color:var(--ink3)">' + esc(r.div) + '</td>' +
      '<td class="n">' + r.bye + '</td><td class="n">' + r.fav + '</td>' +
      '<td class="barcell"><span class="bar" style="width:' + (r.fav / 17 * 100).toFixed(1) + '%"></span></td>' +
      '<td class="n">' + r.bo + '</td><td class="n">' + r.dad + '</td>' +
      '<td class="n">' + (played ? r.w + "-" + r.l : "-") + '</td></tr>';
  }).join("");
  document.getElementById("pane-teams").innerHTML =
    '<section class="sec"><h3>How Vegas sees 2026</h3>' +
    '<p class="cap">How many of its 17 games each team was favored in when the lines opened, in club colors. ' +
    'The Rams are favored in 16 and the Cardinals in none &mdash; the bar runs the full 17.</p>' +
    '<div class="tblwrap"><table><thead><tr><th>Team</th><th>Division</th><th>Bye</th>' +
    '<th>Favored</th><th class="barcell"></th><th class="bocol">Bo backs</th>' +
    '<th class="dadcol">Dad backs</th><th>Record</th></tr></thead><tbody>' + body + '</tbody></table></div></section>';
}

/* ------------------------------------------------------------------ csv */
function downloadCsv(){
  const out = [["Week","Away","Home","Kickoff","Vegas preseason","Preseason line","Line now","Total",
                "Bo","Dad","Winner","By","Favorite covered"].join(",")];
  GAMES.forEach(function(g){
    const m = marketLine(g), res = resultOf(g.wk,g.key), lv = liveOf(g.wk,g.key), a = atsOf(g,res);
    out.push([g.wk, g.a, g.h, lv && lv.k ? lv.k : "", g.fav || "", g.sp === null ? "" : g.sp,
      m && m.src === "live" ? m.fav + " -" + m.sp : "", m && typeof m.ou === "number" ? m.ou : "",
      pickOf(g.wk,g.key,"bo") || "", pickOf(g.wk,g.key,"dad") || "",
      res ? res.w : "", res && res.by !== null ? res.by : "",
      a === "cov" ? "yes" : a === "no" ? "no" : a === "push" ? "push" : ""].join(","));
  });
  const blob = new Blob([out.join("\n")], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "boson-line-2026.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}
async function copyText(text, ok, bad){
  try { await navigator.clipboard.writeText(text); flash(ok); return true; }
  catch(e){
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly",""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let done = false;
    try { done = document.execCommand("copy"); } catch(e2){}
    document.body.removeChild(ta);
    if (done){ flash(ok); return true; }
    flash(bad); return false;
  }
}

/* ------------------------------------------------------------------ render */
let queued = false;
function render(){
  if (queued) return;
  queued = true;
  /* A hidden tab never runs requestAnimationFrame, so a render queued there sits
     unpainted and, worse, blocks every later render behind `queued`. Fall back to
     a timer when hidden so the DOM always agrees with state, looked at or not. */
  const schedule = document.hidden
    ? function(fn){ setTimeout(fn, 16); }
    : function(fn){ requestAnimationFrame(fn); };
  schedule(function(){
    queued = false;
    document.getElementById("who-bo").setAttribute("aria-pressed", String(state.me === "bo"));
    document.getElementById("who-dad").setAttribute("aria-pressed", String(state.me === "dad"));
    const sb = document.getElementById("sealBtn");
    sb.setAttribute("aria-pressed", String(state.sealed));
    sb.textContent = state.sealed ? "Sealed" : "Open";
    const rb = document.getElementById("resBtn");
    rb.setAttribute("aria-pressed", String(state.resMode));
    rb.textContent = state.resMode ? "Done" : "Enter results";
    const db = document.getElementById("demoBtn");
    db.setAttribute("aria-pressed", String(demo.on));
    db.textContent = demo.on ? "Hide sample" : "Show sample";

    renderScoreline();
    renderDemoBar();
    renderNotice();
    if (state.tab === "picks"){
      renderWeeks(); renderWeekHead(); renderLiveBar(); renderSwap();
      const ae = document.activeElement, gel = document.getElementById("games");
      if (!(ae && ae.tagName === "INPUT" && gel.contains(ae))) renderGames();
    }
    else if (state.tab === "standings") renderStandings();
    else renderTeams();

    let newest = SEED_AT;
    Object.keys(LIVE).forEach(function(w){
      const f = LIVE[w] && LIVE[w].fetched;
      if (f && f > newest) newest = f;
    });
    document.getElementById("stamp").textContent = "Odds and scores pulled from ESPN " + stamp(newest) + ".";
  });
}
function stamp(iso){
  const t = Date.parse(iso);
  if (isNaN(t)) return "recently";
  return new Date(t).toLocaleString(undefined, {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"});
}

/* ------------------------------------------------------------------ events */
function setTab(name){
  state.tab = name;
  ["picks","standings","teams"].forEach(function(t){
    document.getElementById("tab-" + t).setAttribute("aria-selected", String(t === name));
    document.getElementById("pane-" + t).hidden = (t !== name);
  });
  render();
}
["picks","standings","teams"].forEach(function(t){
  document.getElementById("tab-" + t).addEventListener("click", function(){ setTab(t); });
});
document.getElementById("who-bo").addEventListener("click", function(){ setMe("bo"); });
document.getElementById("who-dad").addEventListener("click", function(){ setMe("dad"); });
function setMe(who){ state.me = (state.me === who) ? null : who; LS.set("bl.me", state.me); render(); }
document.getElementById("sealBtn").addEventListener("click", function(){
  state.sealed = !state.sealed; LS.set("bl.sealed", state.sealed); render();
});
document.getElementById("resBtn").addEventListener("click", function(){
  state.resMode = !state.resMode; render();
});
document.getElementById("livebar").addEventListener("click", function(e){
  if (!e.target.closest("#refreshBtn")) return;
  const f = document.getElementById("freshTxt");
  if (f) f.textContent = "checking…";
  pullWeek(state.week, true);
});
document.getElementById("live").addEventListener("click", function(){
  const w = liveWeek();
  if (w === null) return;
  setTab("picks");
  state.week = w; render(); pullWeek(w, true);
});
function goWeek(w){
  if (WEEKS.indexOf(w) < 0) return;
  state.week = w;
  closeWeekGrid();
  render();
  pullWeek(w);
}
function closeWeekGrid(){
  document.getElementById("weeks").classList.remove("open");
  document.getElementById("weekAll").setAttribute("aria-expanded", "false");
}
document.getElementById("weeks").addEventListener("click", function(e){
  const b = e.target.closest("button[data-w]");
  if (b) goWeek(Number(b.dataset.w));
});
document.getElementById("weekPrev").addEventListener("click", function(){
  goWeek(WEEKS[Math.max(0, WEEKS.indexOf(state.week) - 1)]);
});
document.getElementById("weekNext").addEventListener("click", function(){
  goWeek(WEEKS[Math.min(WEEKS.length - 1, WEEKS.indexOf(state.week) + 1)]);
});
document.getElementById("weekAll").addEventListener("click", function(){
  const el = document.getElementById("weeks");
  const open = el.classList.toggle("open");
  this.setAttribute("aria-expanded", String(open));
});
document.getElementById("demoBtn").addEventListener("click", function(){ setDemo(!demo.on); });
document.getElementById("demobar").addEventListener("click", function(e){
  if (e.target.closest("#demoOff")) setDemo(false);
});
document.getElementById("games").addEventListener("click", function(e){
  const btn = e.target.closest("button[data-act]"), row = e.target.closest(".game");
  if (!btn || !row) return;
  const wk = state.week, key = row.dataset.k;
  if (btn.dataset.act === "pick"){
    if (!state.me || isLocked(wk, key)) return;
    const team = btn.dataset.t, cur = pickOf(wk, key, state.me), o = {}, p = {};
    p[state.me] = (cur === team) ? null : team;
    o[key] = p;
    setPicks(wk, o);
  } else if (btn.dataset.act === "res"){
    const cur = (bookOf(wk).results || {})[key] || {}, team = btn.dataset.t;
    if (cur.w === team) setResult(wk, key, null);
    else if (team === "TIE") setResult(wk, key, {w:"TIE", by:0});
    else setResult(wk, key, {w:team, by:(typeof cur.by === "number" ? cur.by : null)});
  }
});
document.getElementById("games").addEventListener("change", function(e){
  const inp = e.target.closest("input[data-act='by']"), row = e.target.closest(".game");
  if (!inp || !row) return;
  const wk = state.week, key = row.dataset.k;
  const cur = (bookOf(wk).results || {})[key] || {};
  if (!cur.w){ flash("Pick the winner first, then the margin."); inp.value = ""; return; }
  if (cur.w === "TIE"){ inp.value = ""; return; }
  const v = parseInt(inp.value, 10);
  setResult(wk, key, {w:cur.w, by:(isNaN(v) || v <= 0) ? null : v});
});
document.getElementById("games").addEventListener("focusout", function(){ setTimeout(render, 0); });
document.getElementById("fillFav").addEventListener("click", function(){
  if (!state.me){ flash("Say who you are first."); return; }
  const wk = state.week, o = {};
  let n = 0;
  (BY_WEEK[wk] || []).forEach(function(g){
    if (isLocked(wk, g.key) || pickOf(wk, g.key, state.me)) return;
    const m = marketLine(g);
    if (!m || !m.fav) return;
    const p = {}; p[state.me] = m.fav; o[g.key] = p; n++;
  });
  if (!n){ flash("Nothing left open this week."); return; }
  setPicks(wk, o);
});
document.getElementById("clearWk").addEventListener("click", function(){
  if (!state.me){ flash("Say who you are first."); return; }
  const wk = state.week, me = state.me, o = {}, prev = {};
  let n = 0;
  (BY_WEEK[wk] || []).forEach(function(g){
    if (isLocked(wk, g.key) || !pickOf(wk, g.key, me)) return;
    prev[g.key] = pickOf(wk, g.key, me);
    const p = {}; p[me] = null; o[g.key] = p; n++;
  });
  if (!n){ flash("No open picks to clear this week."); return; }
  setPicks(wk, o);
  flash("Cleared " + n + " pick" + (n === 1 ? "" : "s") + " in week " + wk + ".", "Undo", function(){
    const back = {};
    Object.keys(prev).forEach(function(k){ const p = {}; p[me] = prev[k]; back[k] = p; });
    setPicks(wk, back);
    flash("Put back " + n + " pick" + (n === 1 ? "" : "s") + ".");
  });
});
document.getElementById("copyMine").addEventListener("click", function(){
  if (!state.me){ flash("Say who you are first - the code is stamped with your name."); return; }
  const code = encodePicks(state.me), inp = document.getElementById("theirCode");
  copyText(code, "Your code is copied - text it over.", "Copy didn't work; the code is in the box, select it and copy.")
    .then(function(ok){ if (!ok){ inp.value = code; inp.select(); } });
});
document.getElementById("loadTheirs").addEventListener("click", function(){
  const inp = document.getElementById("theirCode"), v = inp.value.trim();
  if (!v){ flash("Paste their code into the box first."); return; }
  applyCode(v);
  inp.value = "";
});
document.getElementById("theirCode").addEventListener("keydown", function(e){
  if (e.key === "Enter"){ e.preventDefault(); document.getElementById("loadTheirs").click(); }
});

/* ------------------------------------------------------------------ shared ledger */
function setStatus(kind, txt){
  const el = document.getElementById("status");
  el.className = "status " + kind;
  el.querySelector(".txt").textContent = txt;
}
/* When each person last changed anything, straight off the server clock. */
const TOUCH = {bo:0, dad:0};
/* Rows the other phone changed in the last few seconds, so the change is
   visible as it lands instead of just quietly being there. */
const FRESH = {};
let freshTimer = null;
function isFresh(wk, key){
  const t = FRESH[wk + "|" + key];
  return !!t && (Date.now() - t) < 6000;
}
function markFresh(wk, key){
  FRESH[wk + "|" + key] = Date.now();
  if (!freshTimer) freshTimer = setTimeout(function(){ freshTimer = null; render(); }, 6200);
}

function mergeRemote(wk, doc, confirmed){
  const picks = {}, results = {};
  const p = (doc && doc.picks) || {}, r = (doc && doc.results) || {};
  Object.keys(p).forEach(function(k){
    if (!KEYS_BY_WEEK[wk] || !KEYS_BY_WEEK[wk][k]) return;
    const clean = {};
    ["bo","dad"].forEach(function(w){ if (p[k] && p[k][w]) clean[w] = p[k][w]; });
    if (Object.keys(clean).length) picks[k] = clean;
  });
  Object.keys(r).forEach(function(k){
    if (!KEYS_BY_WEEK[wk] || !KEYS_BY_WEEK[wk][k]) return;
    if (r[k] && r[k].w) results[k] = r[k];
  });

  const t = (doc && doc.touch) || {};
  const marks = demo.on ? real.touch : TOUCH;
  ["bo","dad"].forEach(function(w){
    const ms = tsMillis(t[w]);
    if (marks && ms > marks[w]) marks[w] = ms;
  });

  /* Anything the other person changed since the last snapshot gets a moment of
     highlight. Only theirs - your own taps do not need announcing back to you. */
  const target = realBook();
  const before = (target[wk] && target[wk].picks) || {};
  const them = state.me === "bo" ? "dad" : state.me === "dad" ? "bo" : null;
  if (them && !demo.on){
    const seen = {};
    Object.keys(picks).concat(Object.keys(before)).forEach(function(k){
      if (seen[k]) return;
      seen[k] = 1;
      const a = (before[k] || {})[them] || null, b = (picks[k] || {})[them] || null;
      if (a !== b) markFresh(wk, k);
    });
  }

  if (confirmed) pendReconcile(wk, picks, tsMillis(doc && doc.updatedAt));
  target[wk] = {week:wk, picks:pendApply(wk, picks), results:results};
  persist();
}
function localPicksByWeek(){
  const out = {}, src = realBook();
  WEEKS.forEach(function(w){
    const b = src[w];
    if (!b || !b.picks) return;
    const keys = Object.keys(b.picks);
    if (keys.length) out[w] = b.picks;
  });
  return out;
}
function onSwapCopyChange(connected){
  const cap = document.getElementById("swapCap");
  cap.textContent = connected
    ? "Picks sync between the two of you automatically. These codes are a backup - handy for moving a season onto a new phone, or if the shared sheet is ever unreachable."
    : "Your picks live on this device. Copy your code, text it over, and paste theirs to fill in their column - it carries the whole season, so one swap catches you up.";
}

/* ------------------------------------------------------------------ boot */
function start(){
  state.book = LS.get("bl.book", {}) || {};
  state.week = defaultWeek();

  /* ?demo=1 makes the sample linkable, so it can be sent rather than demonstrated
     over someone's shoulder. Otherwise it is remembered from last time. */
  let asked = false;
  try { asked = new URLSearchParams(location.search).get("demo") === "1"; } catch(e){}
  if (asked || location.hash === "#demo" || LS.get("bl.demo", false) === true) setDemo(true, true);

  render();
  pullWeek(state.week, true);
  setInterval(function(){ state.now = nowMs(); render(); }, 30000);
  setInterval(function(){ if (state.tab === "picks") pullWeek(state.week); }, 20000);
  document.addEventListener("visibilitychange", function(){
    if (document.hidden) return;
    /* Coming back to the tab: redraw before waiting on the network. A page that
       first loaded in the background has no frame yet, because requestAnimationFrame
       does not run there, and the clock has moved on regardless. */
    state.now = nowMs();
    render();
    pullWeek(state.week);
  });

  /* Snapshot what this device is carrying BEFORE any remote snapshot lands.
     mergeRemote replaces a week wholesale, so reading local picks lazily would
     read them back after they had already been overwritten. */
  const carried = localPicksByWeek();
  let flushed = false;
  connect({
    seed: function(){ return carried; },
    onWeek: function(wk, doc, confirmed){
      mergeRemote(wk, doc, confirmed);
      /* Wait for the sheet to have been read before sending anything up. Flushing
         on connect - before any snapshot - meant a stale local edit was pushed
         with nothing to check it against, which is how a cleared week came back
         from the dead and wiped a restored one. */
      if (confirmed && !flushed){
        flushed = true;
        setTimeout(flushPending, 0);
      }
      render();
    },
    onStatus: function(kind, txt){
      state.shared = (kind === "live");
      setStatus(kind, txt);
      onSwapCopyChange(state.shared);
      render();
    },
    onSave: function(kind){ state.saving = kind; render(); }
  }).then(function(s){
    store = s;
    if ("serviceWorker" in navigator){
      navigator.serviceWorker.register("./sw.js").catch(function(){});
    }
    if (!s) purgePending();
    render();
  }).catch(function(){ purgePending(); render(); });
}
start();
