import json, io, os, re
data = json.load(open("data2026.json"))
live = {str(wk): json.load(open("live/w%d.json" % wk)) for wk in range(1, 19)}
meta = json.load(open("live/meta.json"))
art = json.load(open("logos.json"))

tpl = io.open(r"C:\Projects\Football\template.html", encoding="utf-8").read()
sub = {
  "__SCHED__":   json.dumps(data["games"], separators=(",", ":")),
  "__BYES__":    json.dumps(data["byes"], separators=(",", ":")),
  "__LIVE__":    json.dumps(live, separators=(",", ":")),
  "__LOGOS__":   json.dumps({"light": art["light"], "dark": art["dark"]}, separators=(",", ":")),
  "__ACCENTS__": json.dumps(art["accents"], separators=(",", ":")),
  "__SYNCED__":  meta["fetched"],
}
out = tpl
for k, v in sub.items():
    out = out.replace(k, v)
assert not any(k in out for k in sub), [k for k in sub if k in out]

ESC = "\\" + "u%04x"
def esc_js(m):
    return "<script>" + "".join(c if ord(c) < 128 else (ESC % ord(c)) for c in m.group(1)) + "</script>"
out = re.sub(r"<script>([\s\S]*?)</script>", esc_js, out)
left = sorted(set(c for c in out if ord(c) > 127))
print("non-ascii outside script:", [hex(ord(c)) for c in left])

io.open(r"C:\Projects\Football\index.html", "w", encoding="utf-8").write(out)
print("index.html %.0f KB | %d games, %d live lines, %d logos, synced %s"
      % (os.path.getsize(r"C:\Projects\Football\index.html")/1024,
         meta["games"], meta["lines"], len(art["light"]), meta["fetched"]))
