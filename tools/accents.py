import json, colorsys

d = json.load(open("logos.json"))
raw = d["colors"]

def hex2rgb(h): h = h.lstrip("#"); return tuple(int(h[i:i+2],16)/255 for i in (0,2,4))
def rgb2hex(r): return "#%02x%02x%02x" % tuple(max(0,min(255,round(c*255))) for c in r)
def lum(rgb):
    f = lambda c: c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4
    r,g,b = (f(c) for c in rgb)
    return 0.2126*r + 0.7152*g + 0.0722*b
def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la,lb), min(la,lb)
    return (hi+0.05)/(lo+0.05)

PAPER = hex2rgb("#edefea")     # light ground
NIGHT = hex2rgb("#12150f")     # dark ground

def clamp(hex_in, ground, lo, hi):
    """Keep the hue and saturation, move lightness into a band that reads on `ground`."""
    h, l, s = colorsys.rgb_to_hls(*hex2rgb(hex_in))
    if s < 0.12:                      # achromatic (black/white/grey): no hue to preserve
        return None
    l = max(lo, min(hi, l))
    for _ in range(24):
        rgb = colorsys.hls_to_rgb(h, l, max(s, 0.45))
        if contrast(rgb, ground) >= 3.4: return rgb2hex(rgb)
        l = l - 0.03 if lum(ground) > 0.5 else l + 0.03
        if not (0 < l < 1): break
    return rgb2hex(colorsys.hls_to_rgb(h, max(lo, min(hi, l)), max(s, 0.45)))

out = {}
for ab, (prim, alt) in sorted(raw.items()):
    picks = []
    for ground, lo, hi in ((PAPER, 0.24, 0.44), (NIGHT, 0.50, 0.70)):
        best = None
        for cand in (prim, alt):
            got = clamp(cand, ground, lo, hi)
            if got: best = got; break
        if not best:                   # both achromatic -> a neutral that still reads
            best = "#5c635a" if ground is PAPER else "#9aa295"
        picks.append(best)
    out[ab] = picks

bad = [(a, c, round(contrast(hex2rgb(c[0]), PAPER),2), round(contrast(hex2rgb(c[1]), NIGHT),2))
       for a, c in out.items()
       if contrast(hex2rgb(c[0]), PAPER) < 3.0 or contrast(hex2rgb(c[1]), NIGHT) < 3.0]
print("teams below 3.0 contrast:", bad or "none")
print(" ".join("%s %s/%s" % (a, c[0], c[1]) for a, c in list(out.items())[:10]))
d["accents"] = out
json.dump(d, open("logos.json","w"), separators=(",",":"))
print("saved", len(out), "accent pairs")
