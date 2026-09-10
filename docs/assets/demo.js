/* The sample season.

   A setting in the About panel swaps the sheet for a fabricated week 10, so the
   thing can be shown to someone in September and still look like November. The
   results are invented; everything structural - schedule, kickoffs, lines,
   totals, byes, broadcast - is the real 2026 data already in data.js.

   It is generated here rather than shipped as a second dataset: a fixed seed
   means both phones see the same sample, and the whole file costs a few KB
   instead of another 60. Nothing in here is ever written to the shared sheet. */

export const DEMO_WEEK = 10;

/* mulberry32: small, fast, and seeded, so the sample never changes under you. */
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rnd){
  let u = 0, v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const WINNING = [17,20,20,21,23,24,24,26,27,28,30,31,34];

export function buildDemo(SEED, BY_WEEK, WEEKS){
  const rnd = mulberry32(20261115);

  /* "Now" is the afternoon of the demo week: take the slot the most games
     kick off in - the one o'clock window - and stand three and three quarter
     hours into it, so the early games are final and the late ones are live. */
  const dw = (SEED[DEMO_WEEK] && SEED[DEMO_WEEK].games) || {};
  const count = {};
  Object.keys(dw).forEach(function(k){
    const t = Date.parse(dw[k].k);
    if (!isNaN(t)) count[t] = (count[t] || 0) + 1;
  });
  let slot = 0, best = -1;
  Object.keys(count).forEach(function(t){
    const n = count[t];
    if (n > best || (n === best && Number(t) < slot)){ best = n; slot = Number(t); }
  });
  const now = (slot || Date.now()) + (3 * 60 + 45) * 60000;

  const live = {}, book = {};

  WEEKS.forEach(function(wk){
    const src = (SEED[wk] && SEED[wk].games) || {};
    const games = {}, picks = {};

    (BY_WEEK[wk] || []).forEach(function(g){
      const s = src[g.key];
      if (!s) return;

      /* Carry the real fixture across; invent only the outcome. */
      const out = {k: s.k, st: "pre"};
      ["fav","sp","ou","tv","bk"].forEach(function(f){ if (f in s) out[f] = s[f]; });

      if (wk > DEMO_WEEK){ games[g.key] = out; return; }

      const market = s.fav || g.fav;
      const dog = market === g.a ? g.h : g.a;
      const winner = (market && rnd() < 0.64) ? market : dog;
      const margin = Math.max(1, Math.min(35, Math.floor(Math.abs(gauss(rnd) * 10)) + 1));
      const ws = WINNING[Math.floor(rnd() * WINNING.length)];
      const ls = Math.max(0, ws - margin);
      const as = winner === g.a ? ws : ls;
      const hs = winner === g.a ? ls : ws;

      const kick = Date.parse(s.k);
      const done = wk < DEMO_WEEK || (!isNaN(kick) && kick + 3.25 * 3600000 <= now);
      const started = !isNaN(kick) && kick <= now;

      if (done){
        out.st = "post"; out.as = as; out.hs = hs; out.w = winner; out.by = margin;
        out.det = "Final";
      } else if (started){
        const mins = Math.floor((now - kick) / 60000);
        const part = mins < 45 ? "1st" : mins < 85 ? "2nd" : "3rd";
        const frac = 0.35 + rnd() * 0.35;
        out.st = "in";
        out.as = Math.floor(as * frac);
        out.hs = Math.floor(hs * frac);
        out.det = (1 + Math.floor(rnd() * 14)) + ":" +
                  String(Math.floor(rnd() * 60)).padStart(2, "0") + " - " + part + " Quarter";
      }
      games[g.key] = out;

      /* Both of them back the favourite most weeks, Dad a shade more than Bo,
         and neither has got to the Monday night game yet. Vegas takes every
         favourite, so it should finish a little ahead of both - which is what
         happens in a real pool, and what the About panel already claims. */
      if (!(wk === DEMO_WEEK && !isNaN(kick) && kick > now + 6 * 3600000)){
        picks[g.key] = {
          bo:  (market && rnd() < 0.78) ? market : dog,
          dad: (market && rnd() < 0.83) ? market : dog
        };
      }
    });

    live[wk] = {week: wk, fetched: new Date(now - 60000).toISOString(), games: games};
    if (Object.keys(picks).length) book[wk] = {week: wk, picks: picks, results: {}};
  });

  return {
    now: now,
    live: live,
    book: book,
    touch: {bo: now - 2 * 3600000, dad: now - 26 * 60000}
  };
}
