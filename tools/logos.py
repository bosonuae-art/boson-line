import json, urllib.request, io, base64, time, sys
from PIL import Image

ABBR = {"WSH": "WAS"}
SIZE = 48

def get(url, tries=3):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for a in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=25) as r: return r.read()
        except Exception:
            if a == tries - 1: raise
            time.sleep(1.2)

def shrink(raw):
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2), im)
    out = io.BytesIO()
    canvas.save(out, format="PNG", optimize=True)
    return out.getvalue()

teams = json.load(open("teams.json"))["sports"][0]["leagues"][0]["teams"]
light, dark, colors = {}, {}, {}
for entry in teams:
    t = entry["team"]
    ab = ABBR.get(t["abbreviation"], t["abbreviation"])
    slug = t["abbreviation"].lower()
    colors[ab] = ["#" + (t.get("color") or "666666"), "#" + (t.get("alternateColor") or "ffffff")]
    for label, url, store in (
        ("light", "https://a.espncdn.com/i/teamlogos/nfl/500/%s.png" % slug, light),
        ("dark",  "https://a.espncdn.com/i/teamlogos/nfl/500-dark/%s.png" % slug, dark)):
        try:
            store[ab] = "data:image/png;base64," + base64.b64encode(shrink(get(url))).decode()
        except Exception as e:
            print("MISS", ab, label, e, file=sys.stderr)
    print(".", end="", flush=True)

print()
assert len(colors) == 32 and len(light) == 32, (len(colors), len(light), len(dark))
json.dump({"light": light, "dark": dark, "colors": colors}, open("logos.json", "w"), separators=(",", ":"))
kb = lambda d: sum(len(v) for v in d.values()) // 1024
print("light %dKB  dark %dKB  (dark missing: %s)" % (kb(light), kb(dark), sorted(set(light) - set(dark))))
