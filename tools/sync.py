import json, urllib.request, datetime, sys, os, time

ABBR = {"WSH":"WAS"}
def fix(a): return ABBR.get(a, a)

SCHED = json.load(open("data2026.json"))
sched = {}
for wk, aw, hm, fav, sp, day, *rest in SCHED["games"]:
    sched.setdefault(wk, {})[f"{aw}@{hm}"] = (fav, sp)

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if attempt == 2: raise
            time.sleep(1.5)

now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z")
out = {}
unmatched = []
for wk in range(1, 19):
    d = get(f"https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week={wk}")
    games = {}
    for e in d.get("events", []):
        c = e["competitions"][0]
        cs = {x["homeAway"]: x for x in c["competitors"]}
        aw, hm = fix(cs["away"]["team"]["abbreviation"]), fix(cs["home"]["team"]["abbreviation"])
        key = f"{aw}@{hm}"
        if key not in sched.get(wk, {}):
            unmatched.append((wk, key)); continue
        st = c["status"]["type"]
        state = st["state"]                       # pre | in | post
        g = {"k": c["date"], "st": state}
        if st.get("shortDetail"): g["det"] = st["shortDetail"]
        try: a_s, h_s = int(cs["away"].get("score") or 0), int(cs["home"].get("score") or 0)
        except (TypeError, ValueError): a_s = h_s = 0
        if state in ("in", "post"):
            g["as"], g["hs"] = a_s, h_s
        if state == "post" and st.get("completed"):
            if a_s != h_s:
                g["w"] = aw if a_s > h_s else hm
                g["by"] = abs(a_s - h_s)
            else:
                g["w"] = "TIE"; g["by"] = 0
        odds = (c.get("odds") or [])
        odds = sorted(odds, key=lambda o: (o.get("provider") or {}).get("priority", 99))
        if odds:
            o = odds[0]
            g["bk"] = ((o.get("provider") or {}).get("name") or "").strip() or None
            ao, ho = o.get("awayTeamOdds") or {}, o.get("homeTeamOdds") or {}
            spread = o.get("spread")
            if isinstance(spread, (int, float)) and spread != 0:
                # ESPN spread is relative to the HOME team
                g["fav"] = hm if spread < 0 else aw
                g["sp"] = abs(spread)
            elif ho.get("favorite") or ao.get("favorite"):
                g["fav"] = hm if ho.get("favorite") else aw
                g["sp"] = abs(spread or 0)
            if isinstance(o.get("overUnder"), (int, float)): g["ou"] = o["overUnder"]
            try:
                ml = o.get("moneyline") or {}
                mh = ((ml.get("home") or {}).get("close") or {}).get("odds")
                ma = ((ml.get("away") or {}).get("close") or {}).get("odds")
                if mh: g["mlH"] = str(mh)
                if ma: g["mlA"] = str(ma)
            except Exception: pass
            try:
                ps = (o.get("pointSpread") or {})
                oh = ((ps.get("home") or {}).get("open") or {}).get("line")
                if oh not in (None, ""):
                    v = float(str(oh).replace("+",""))
                    if v != 0:
                        g["ofav"] = hm if v < 0 else aw
                        g["osp"] = abs(v)
            except Exception: pass
        if c.get("broadcasts"):
            names = [n for b in c["broadcasts"] for n in b.get("names", [])]
            if names: g["tv"] = "/".join(dict.fromkeys(names))[:24]
        games[key] = g
    out[wk] = {"week": wk, "fetched": now, "games": games}
    print(f"week {wk}: {len(games)}/{len(sched.get(wk,{}))} matched, "
          f"{sum(1 for g in games.values() if 'sp' in g)} with line, "
          f"{sum(1 for g in games.values() if g.get('st')=='post')} final", file=sys.stderr)

if unmatched: print("UNMATCHED:", unmatched, file=sys.stderr)
os.makedirs("live", exist_ok=True)
for wk, doc in out.items():
    json.dump(doc, open(f"live/w{wk}.json","w"), separators=(",",":"))
tot = sum(len(v["games"]) for v in out.values())
lines = sum(1 for v in out.values() for g in v["games"].values() if "sp" in g)
finals = sum(1 for v in out.values() for g in v["games"].values() if g.get("st")=="post")
print(f"TOTAL {tot} games, {lines} with live line, {finals} final, fetched {now}", file=sys.stderr)
json.dump({"fetched":now,"games":tot,"lines":lines,"finals":finals}, open("live/meta.json","w"))
