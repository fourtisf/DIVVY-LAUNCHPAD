"""Divvy premium logo concepts: custom geometric wordmark + six marks, all as plain SVG paths."""
import math, os, sys

OUT = sys.argv[1]
BG, S1, TEXT, INK = "#0A0F0D", "#0F1714", "#EAFBF1", "#03140A"
G, GHI, GDEEP = "#4ADE80", "#86EFAC", "#16A34A"
FOIL = [(0, "#C9FFE0"), (.26, "#86EFAC"), (.52, "#E4FFA6"), (.76, "#7EF2D8"), (1, "#C9FFE0")]
# The same foil, struck darker, for light backgrounds where the pale foil would wash out.
DEEP_FOIL = [(0, "#14532D"), (.3, "#16A34A"), (.52, "#4ADE80"), (.76, "#15803D"), (1, "#14532D")]


def f(n):
    s = f"{n:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def poly(pts):
    return "M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts) + "Z"


def circle(cx, cy, r, ccw=False):
    s = 0 if ccw else 1
    return f"M{f(cx - r)} {f(cy)}A{f(r)} {f(r)} 0 1 {s} {f(cx + r)} {f(cy)}A{f(r)} {f(r)} 0 1 {s} {f(cx - r)} {f(cy)}Z"


def lin(id_, stops, x1=0, y1=.2, x2=1, y2=.8, units=None):
    u = f' gradientUnits="{units}"' if units else ""
    st = "".join(f'<stop offset="{o}" stop-color="{c}"{"" if len(s) == 2 else f" stop-opacity=\"{s[2]}\""}/>' for s in stops for o, c in [s[:2]])
    return f'<linearGradient id="{id_}" x1="{f(x1)}" y1="{f(y1)}" x2="{f(x2)}" y2="{f(y2)}"{u}>{st}</linearGradient>'


def rad(id_, stops, cx=.3, cy=.25, r=.9):
    st = "".join(f'<stop offset="{o}" stop-color="{c}"{"" if len(s) == 2 else f" stop-opacity=\"{s[2]}\""}/>' for s in stops for o, c in [s[:2]])
    return f'<radialGradient id="{id_}" cx="{cx}" cy="{cy}" r="{r}">{st}</radialGradient>'


# ---------------------------------------------------------------- wordmark
# Units: baseline 80, x-height 40, ascender 12, descender 100. Stems 8.5, diagonals 7.8.
W, WD, XH, BASE, ASC, DESC = 8.0, 7.3, 40.0, 80.0, 12.0, 100.0


def v_shape(xl, span, tip=82.0, descender=False):
    xr, xc = xl + span, xl + span / 2
    slope = (tip - XH) / (xc - xl)
    a = WD * math.sqrt(1 + slope * slope) / slope  # horizontal thickness for perpendicular weight WD
    if not descender:
        yi = tip - a * slope
        return poly([(xl, XH), (xl + a, XH), (xc, yi), (xr - a, XH), (xr, XH), (xc, tip)])
    # y: the right arm runs on to the descender with a flat cut; the left arm stops inside it.
    xo = xr - (DESC - XH) / slope
    right = poly([(xr - a, XH), (xr, XH), (xo, DESC), (xo - a, DESC)])
    # The left arm stops where its outer edge meets the right arm's inner edge.
    yj = XH + ((xr - a) - xl) * slope / 2
    xj = xl + (yj - XH) / slope
    left = poly([(xl, XH), (xl + a, XH), (xc, tip - a * slope), (xj, yj)])
    return left + right


def wordmark():
    """Returns (letters path, dot circle (cx, cy, r), width)."""
    o = 1.3
    R = (BASE - XH) / 2 + o
    cx, cy = R, (BASE + XH) / 2
    r_in = R - W * 1.06
    d = circle(cx, cy, R) + circle(cx, cy, r_in, ccw=True)
    stem_l = cx + R - W
    d_stem = poly([(stem_l, ASC), (cx + R, ASC), (cx + R, BASE), (stem_l, BASE)])
    x = cx + R + 7.5
    i = poly([(x, XH), (x + W, XH), (x + W, BASE), (x, BASE)])
    dot = (x + W / 2, XH - 13.5, W * .72)
    x += W + 5.5
    span = 33.0
    v1 = v_shape(x, span)
    x += span + 1.2
    v2 = v_shape(x, span)
    x += span + 1.2
    y = v_shape(x, span, descender=True)
    x += span
    return d + d_stem + i + v1 + v2 + y, d, d_stem, dot, x


WM, D_RING, D_STEM, DOT, WM_W = wordmark()


def d_glyph(cx, cy, h, fill):
    """The wordmark's d, scaled so ascender-to-baseline = h, centred at (cx, cy)."""
    s = h / (BASE - ASC)
    w = (D_W := 2 * ((BASE - XH) / 2 + 1.3)) * s
    tx, ty = cx - w / 2, cy - h / 2 - ASC * s
    return f'<path transform="translate({f(tx)} {f(ty)}) scale({f(s)})" fill="{fill}" fill-rule="evenodd" d="{D_RING}{D_STEM}"/>'


# ---------------------------------------------------------------- marks (100 x 100)

def foil_defs(p, light=False):
    return (lin(f"{p}-foil", DEEP_FOIL if light else FOIL)
            + rad(f"{p}-sheen", [(0, "#FFFFFF", .55), (.45, "#FFFFFF", 0)], .32, .22, .75)
            + lin(f"{p}-deep", [(0, "#1F5236"), (.55, "#0D2819"), (1, "#06150D")], 0, 0, .6, 1)
            + f'<filter id="{p}-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4"/></filter>')


def half_disc(cx, cy, r, side, closed=True):
    # side -1 left half, +1 right half; flat edge on x = cx
    sweep = 0 if side < 0 else 1
    return f"M{f(cx)} {f(cy - r)}A{f(r)} {f(r)} 0 0 {sweep} {f(cx)} {f(cy + r)}" + ("Z" if closed else "")


def mark_split(p, mono=None):
    """Koin belah: one coin cut in two, the right half lifted. Dividing value, and a lowercase d."""
    fill = mono or f"url(#{p}-foil)"
    g, r, lift = 3.2, 40, 7
    L = half_disc(50 - g, 50 + lift / 2, r, -1)
    Rr = half_disc(50 + g, 50 - lift / 2, r, 1)
    eng = "" if mono else (
        f'<path d="{half_disc(50 - g, 50 + lift / 2, r - 9, -1, False)}{half_disc(50 + g, 50 - lift / 2, r - 9, 1, False)}" fill="none" stroke="{INK}" stroke-opacity=".28" stroke-width="1.6"/>'
        f'<path d="{half_disc(50 - g, 50 + lift / 2, r - 1.2, -1, False)}{half_disc(50 + g, 50 - lift / 2, r - 1.2, 1, False)}" fill="none" stroke="#FFFFFF" stroke-opacity=".45" stroke-width="1.1"/>'
        f'<path d="{L}{Rr}" fill="url(#{p}-sheen)"/>')
    return f'<path d="{L}{Rr}" fill="{fill}"/>{eng}'


def wedge(cx, cy, r, a0, a1):
    x0, y0 = cx + r * math.cos(math.radians(a0)), cy + r * math.sin(math.radians(a0))
    x1, y1 = cx + r * math.cos(math.radians(a1)), cy + r * math.sin(math.radians(a1))
    large = 1 if (a1 - a0) % 360 > 180 else 0
    return f"M{f(cx)} {f(cy)}L{f(x0)} {f(y0)}A{f(r)} {f(r)} 0 {large} 1 {f(x1)} {f(y1)}Z"


def mark_share(p, mono=None):
    """Potongan: a coin with its holders' slice lifted out. Your share, every hour."""
    cx, cy, r, a0, a1, off = 46, 54, 38, -90, -30, 7.5
    bis = math.radians((a0 + a1) / 2)
    dx, dy = off * math.cos(bis), off * math.sin(bis)
    body = wedge(cx, cy, r, a1, a0 + 360)
    slice_ = wedge(cx + dx, cy + dy, r, a0, a1)
    if mono:
        return f'<path d="{body}" fill="{mono}" fill-opacity=".38"/><path d="{slice_}" fill="{mono}"/>'
    return (f'<path d="{body}" fill="url(#{p}-deep)"/>'
            f'<path d="{body}" fill="none" stroke="url(#{p}-foil)" stroke-width="2.2" stroke-linejoin="round"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r - 8}" fill="none" stroke="{GHI}" stroke-opacity=".16" stroke-width="1"/>'
            f'<path d="{slice_}" fill="url(#{p}-foil)"/><path d="{slice_}" fill="url(#{p}-sheen)"/>')


def mark_dial(p, mono=None):
    """Jam: a watch dial. Twelve hours, twelve payouts; the coin sits at the top of the hour."""
    c = mono or f"url(#{p}-foil)"
    out = []
    if not mono:
        out.append(f'<circle cx="50" cy="50" r="46" fill="url(#{p}-deep)"/>')
    out.append(f'<circle cx="50" cy="50" r="45" fill="none" stroke="{c}" stroke-width="3"/>')
    for k in range(12):
        if k == 0:
            continue
        a = math.radians(k * 30 - 90)
        major = k % 3 == 0
        r1, r2, wdt = 38.5, (30.5 if major else 33.5), (3.2 if major else 2)
        x1, y1, x2, y2 = 50 + r1 * math.cos(a), 50 + r1 * math.sin(a), 50 + r2 * math.cos(a), 50 + r2 * math.sin(a)
        out.append(f'<line x1="{f(x1)}" y1="{f(y1)}" x2="{f(x2)}" y2="{f(y2)}" stroke="{c}" stroke-width="{wdt}" stroke-linecap="butt"/>')
    for k in range(60):
        if k % 5 == 0:
            continue
        a = math.radians(k * 6 - 90)
        x1, y1, x2, y2 = 50 + 40.6 * math.cos(a), 50 + 40.6 * math.sin(a), 50 + 38.8 * math.cos(a), 50 + 38.8 * math.sin(a)
        out.append(f'<line x1="{f(x1)}" y1="{f(y1)}" x2="{f(x2)}" y2="{f(y2)}" stroke="{c}" stroke-opacity=".55" stroke-width=".7"/>')
    out.append(f'<circle cx="50" cy="13.5" r="5.2" fill="{c}"/>')
    out.append(d_glyph(50, 53, 33, mono or TEXT))
    return "".join(out)


def mark_seal(p, mono=None):
    """Segel: an engraved medallion, like the seal on a share certificate."""
    c = mono or f"url(#{p}-foil)"
    out = []
    if not mono:
        out.append(f'<circle cx="50" cy="50" r="47" fill="url(#{p}-deep)"/>')
    # bead border, as on a struck coin
    out.append(f'<circle cx="50" cy="50" r="46.6" fill="none" stroke="{c}" stroke-width="1.4"/>')
    beads = "".join(circle(50 + 43.6 * math.cos(math.pi * 2 * k / 64), 50 + 43.6 * math.sin(math.pi * 2 * k / 64), 1.15) for k in range(64))
    out.append(f'<path d="{beads}" fill="{c}"/>')
    out.append(f'<circle cx="50" cy="50" r="40.4" fill="none" stroke="{c}" stroke-width="1.2"/>')
    # guilloche rosette between r 22 and 40
    lines = []
    for i in range(10):
        ph = i * math.pi * 2 / 10
        q = []
        for t in range(0, 361):
            th = t / 360 * math.pi * 2
            rr = 30.8 + 6.4 * math.sin(8 * th + ph)
            q.append((50 + rr * math.cos(th), 50 + rr * math.sin(th)))
        lines.append("M" + "L".join(f"{f(x)} {f(y)}" for x, y in q) + "Z")
    out.append(f'<path d="{"".join(lines)}" fill="none" stroke="{c}" stroke-opacity="{".9" if mono else ".8"}" stroke-width=".55"/>')
    out.append(f'<circle cx="50" cy="50" r="21" fill="{mono and "none" or INK}" stroke="{c}" stroke-width="1.6"/>')
    out.append(d_glyph(50, 52, 26, c))
    return "".join(out)


def mark_seal_small(p, mono=None):
    """The seal for 32 px and below: rim, one ring and the d; the engraving would only blur."""
    c = mono or f"url(#{p}-foil)"
    out = [] if mono else [f'<circle cx="50" cy="50" r="47" fill="url(#{p}-deep)"/>']
    out.append(f'<circle cx="50" cy="50" r="45" fill="none" stroke="{c}" stroke-width="5"/>')
    out.append(f'<circle cx="50" cy="50" r="31" fill="none" stroke="{c}" stroke-width="4"/>')
    out.append(d_glyph(50, 52, 36, c))
    return "".join(out)


def octagon(cx, cy, r, rot=22.5):
    return [(cx + r * math.cos(math.radians(rot + 45 * k)), cy + r * math.sin(math.radians(rot + 45 * k))) for k in range(8)]


def mark_facet(p, mono=None):
    """Permata: the coin cut like a gem. Facets catch the light the way the foil does."""
    o, t = octagon(50, 50, 46), octagon(50, 50, 27)
    out = []
    tones = ["#E4FFA6", "#86EFAC", "#4ADE80", "#16A34A", "#0F5A2E", "#16A34A", "#7EF2D8", "#C9FFE0"]
    for k in range(8):
        a, b = o[k], o[(k + 1) % 8]
        c_, d_ = t[(k + 1) % 8], t[k]
        if mono:
            out.append(f'<path d="{poly([a, b, c_, d_])}" fill="{mono}" fill-opacity="{[.95, .75, .55, .4, .3, .4, .7, .9][k]}"/>')
        else:
            out.append(f'<path d="{poly([a, b, c_, d_])}" fill="{tones[k]}"/>')
    # star facets: split each band with a line to the table vertex midpoint for sparkle
    if not mono:
        for k in range(8):
            a, b = o[k], o[(k + 1) % 8]
            m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            out.append(f'<path d="{poly([t[k], m, t[(k + 1) % 8]])}" fill="#FFFFFF" fill-opacity=".14"/>')
        out.append(f'<path d="{poly(o)}" fill="none" stroke="#FFFFFF" stroke-opacity=".35" stroke-width=".8" stroke-linejoin="round"/>')
    out.append(f'<path d="{poly(t)}" fill="{mono or f"url(#{p}-foil)"}"/>')
    if not mono:
        out.append(f'<path d="{poly(t)}" fill="url(#{p}-sheen)"/>')
        out.append(f'<path d="{poly(t)}" fill="none" stroke="#FFFFFF" stroke-opacity=".55" stroke-width=".8" stroke-linejoin="round"/>')
    out.append(d_glyph(50, 51, 30, INK if not mono else BG))
    return "".join(out)


def mark_rise(p, mono=None):
    """Naik: the v v of divvy drawn as a rising chart, paid out into a coin."""
    c = mono or f"url(#{p}-foil)"
    out = []
    if not mono:
        out.append(f'<circle cx="50" cy="50" r="46" fill="url(#{p}-deep)"/>')
    out.append(f'<circle cx="50" cy="50" r="45" fill="none" stroke="{c}" stroke-width="3"/>')
    pts = [(17, 58), (30, 70), (45, 47), (57, 58), (70, 36)]
    out.append(f'<path d="M{"L".join(f"{f(x)} {f(y)}" for x, y in pts)}" fill="none" stroke="{c}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>')
    out.append(f'<circle cx="77" cy="26" r="8" fill="{c}"/>')
    if not mono:
        out.append(f'<circle cx="77" cy="26" r="8" fill="url(#{p}-sheen)"/>')
        out.append(f'<circle cx="77" cy="26" r="4.6" fill="none" stroke="{INK}" stroke-opacity=".35" stroke-width="1.2"/>')
    return "".join(out)


MARKS = [
    ("split", "Koin belah", "Satu koin dibelah dua, separuh kanan terangkat: nilai yang dibagi, sekaligus huruf d.", mark_split),
    ("share", "Potongan", "Koin dengan satu potongan terangkat keluar: bagian holder yang dibagikan tiap jam.", mark_share),
    ("dial", "Jam", "Muka jam tangan mewah: 12 jam, 12 kali bayar. Koin duduk di puncak jam.", mark_dial),
    ("seal", "Segel", "Medali berukir guilloche seperti segel sertifikat saham, huruf d di tengah.", mark_seal),
    ("facet", "Permata", "Koin dipotong seperti batu permata; tiap sisi menangkap cahaya seperti foil.", mark_facet),
    ("rise", "Naik", "Grafik yang naik turun lalu naik lagi, dan berakhir di koin: dividen yang terus jalan.", mark_rise),
]


def svg(view, body, defs="", w=None, h=None, title="Divvy"):
    vb = f"0 0 {f(view[0])} {f(view[1])}"
    size = f' width="{f(w)}" height="{f(h)}"' if w else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"{size} role="img" aria-label="{title}"><title>{title}</title><defs>{defs}</defs>{body}</svg>\n'


def wordmark_svg_body(color, dot):
    cx, cy, r = DOT
    return f'<path fill="{color}" fill-rule="evenodd" d="{WM}"/><circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="{dot}"/>'


def lockup(name, fn, color, p, light=False):
    # mark 84 tall, centred on the wordmark's ascender-to-baseline middle; 22 gap
    m = 84
    mcy = (ASC + BASE) / 2 + 2
    gap = 22
    defs = foil_defs(p, light)
    body = f'<g transform="translate(0 {f(mcy - m / 2)}) scale({m / 100})">{fn(p)}</g>'
    body += f'<g transform="translate({m + gap} 0)">{wordmark_svg_body(color, f"url(#{p}-foil)")}</g>'
    top = min(ASC, mcy - m / 2)
    bot = max(DESC, mcy + m / 2)
    width = m + gap + WM_W
    return svg((width, bot - top + 0), f'<g transform="translate(0 {f(-top)})">{body}</g>', defs, title="Divvy")


def app_icon(fn, p):
    defs = foil_defs(p) + rad(f"{p}-bgglow", [(0, "#14301F"), (1, BG)], .5, .38, .75)
    body = f'<rect width="512" height="512" rx="112" fill="url(#{p}-bgglow)"/><g transform="translate(96 96) scale(3.2)">{fn(p)}</g>'
    return svg((512, 512), body, defs, 512, 512)


os.makedirs(OUT, exist_ok=True)
for key, label, desc, fn in MARKS:
    d = os.path.join(OUT, key)
    os.makedirs(d, exist_ok=True)
    p = f"dv{key}"
    open(os.path.join(d, "mark.svg"), "w").write(svg((100, 100), fn(p), foil_defs(p), 256, 256))
    open(os.path.join(d, "mark-mono.svg"), "w").write(svg((100, 100), fn(p + "m", mono=TEXT), "", 256, 256))
    open(os.path.join(d, "mark-ink.svg"), "w").write(svg((100, 100), fn(p + "i", mono=INK), "", 256, 256))
    open(os.path.join(d, "lockup-dark.svg"), "w").write(lockup(key, fn, TEXT, p + "d"))
    open(os.path.join(d, "lockup-light.svg"), "w").write(lockup(key, fn, INK, p + "l", light=True))
    open(os.path.join(d, "mark-light.svg"), "w").write(svg((100, 100), fn(p + "k"), foil_defs(p + "k", True), 256, 256))
    open(os.path.join(d, "app-icon.svg"), "w").write(app_icon(fn, p + "a"))

open(os.path.join(OUT, "seal", "mark-small.svg"), "w").write(svg((100, 100), mark_seal_small("dvseals"), foil_defs("dvseals"), 32, 32))
open(os.path.join(OUT, "wordmark-dark.svg"), "w").write(svg((WM_W, DESC - ASC + 4), f'<g transform="translate(0 {-ASC + 2})">{wordmark_svg_body(TEXT, "url(#wm-foil)")}</g>', lin("wm-foil", FOIL)))
open(os.path.join(OUT, "wordmark-light.svg"), "w").write(svg((WM_W, DESC - ASC + 4), f'<g transform="translate(0 {-ASC + 2})">{wordmark_svg_body(INK, "url(#wl-foil)")}</g>', lin("wl-foil", DEEP_FOIL)))
import json
json.dump([{"key": k, "label": l, "desc": ds} for k, l, ds, _ in MARKS], open(os.path.join(OUT, "concepts.json"), "w"), indent=1)
print("ok", WM_W)
