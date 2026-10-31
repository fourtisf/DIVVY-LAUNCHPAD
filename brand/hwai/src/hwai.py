"""hwai.ai brand (owner, 2026-10-31): a square-holed cash coin mark with a custom-drawn "hwai" / "hwai.ai" wordmark.

Usage: python3 -I brand/hwai/src/hwai.py brand/hwai
Letters: a geometric system (x-height 40, stems 8), every one a filled path, so no font file is needed.
Same geometric system as the divvy concept wordmark: x-height 40, baseline 80, ascender 12,
descender 100, stems 8. Every letter is a filled path, so no font file or license is needed.
"""
import math
import os
import sys

OUT = sys.argv[1]
BG, TEXT, INK, MUTED, MUTED_INK = "#0A0F0D", "#EAFBF1", "#03140A", "#97ACA2", "#5B7065"
FOIL = [(0, "#C9FFE0"), (.26, "#86EFAC"), (.52, "#E4FFA6"), (.76, "#7EF2D8"), (1, "#C9FFE0")]
DEEP_FOIL = [(0, "#14532D"), (.3, "#16A34A"), (.52, "#4ADE80"), (.76, "#15803D"), (1, "#14532D")]
W, XH, BASE, ASC, DESC, O = 8.0, 40.0, 80.0, 12.0, 100.0, 1.3


def f(n):
    s = f"{n:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def poly(pts):
    return "M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts) + "Z"


def rect(x0, y0, x1, y1):
    return poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])


def circle(cx, cy, r, ccw=False):
    s = 0 if ccw else 1
    return f"M{f(cx - r)} {f(cy)}A{f(r)} {f(r)} 0 1 {s} {f(cx + r)} {f(cy)}A{f(r)} {f(r)} 0 1 {s} {f(cx - r)} {f(cy)}Z"


def ring(cx, cy, r_out, r_in):
    return circle(cx, cy, r_out) + circle(cx, cy, r_in, ccw=True)


def arc_band(cx, cy, rx_o, ry_o, rx_i, ry_i, a0, a1, n=96):
    """Filled band between two concentric ellipses from angle a0 to a1 (degrees, clockwise on screen)."""
    pts = []
    for k in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        pts.append((cx + rx_o * math.cos(a), cy + ry_o * math.sin(a)))
    for k in range(n, -1, -1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        pts.append((cx + rx_i * math.cos(a), cy + ry_i * math.sin(a)))
    return poly(pts)


R_BOWL = (BASE - XH) / 2 + O  # round letters overshoot x-height and baseline
R_IN = R_BOWL - W * 1.06


def g_u(x):
    r = 17.0
    cy = BASE + O - r
    ri = r - W * 1.04
    return rect(x, XH, x + W, cy) + arc_band(x + r, cy, r, r, ri, ri, 0, 180) + rect(x + 2 * r - W, XH, x + 2 * r, BASE), 2 * r


def g_n(x):
    r = 17.0
    cy = XH - O + r
    ri = r - W * 1.04
    return rect(x, XH, x + W, BASE) + arc_band(x + r, cy, r, r, ri, ri, 180, 360) + rect(x + 2 * r - W, cy, x + 2 * r, BASE), 2 * r


def g_s(x):
    rcy = (BASE - XH + 2 * O - W) / 4
    rcx = rcy * 1.2
    cx = x + rcx + W / 2
    top, bot = XH - O + W / 2 + rcy, BASE + O - W / 2 - rcy
    band = lambda cy, a0, a1: arc_band(cx, cy, rcx + W / 2, rcy + W / 2, rcx - W / 2, rcy - W / 2, a0, a1)
    return band(top, 90, 332) + band(bot, -90, 152), 2 * rcx + W


def g_p(x):
    cx = x + R_BOWL
    return ring(cx, (BASE + XH) / 2, R_BOWL, R_IN) + rect(x, XH, x + W, DESC), 2 * R_BOWL


def g_a(x):
    cx = x + R_BOWL
    return ring(cx, (BASE + XH) / 2, R_BOWL, R_IN) + rect(cx + R_BOWL - W, XH, cx + R_BOWL, BASE), 2 * R_BOWL


def g_d(x):
    cx = x + R_BOWL
    return ring(cx, (BASE + XH) / 2, R_BOWL, R_IN) + rect(cx + R_BOWL - W, ASC, cx + R_BOWL, BASE), 2 * R_BOWL


def g_f(x):
    rh = 9.0
    xs = x + 4.0  # room on the left for the crossbar
    cy = ASC + W / 2 + rh
    hook = arc_band(xs + W / 2 + rh, cy, rh + W / 2, rh + W / 2, rh - W / 2, rh - W / 2, 180, 292)
    stem = rect(xs, cy, xs + W, BASE)
    bar = rect(x, XH, xs + W + 8.5, XH + W * .85)
    return hook + stem + bar, xs + W + 8.5 + 2 - x


def dot(x):
    r = W * .8
    return (x + r, BASE - r, r), 2 * r




def g_h(x):
    """n with the left stem rising to the ascender."""
    r = 17.0
    cy = XH - O + r
    ri = r - W * 1.04
    return rect(x, ASC, x + W, BASE) + arc_band(x + r, cy, r, r, ri, ri, 180, 360) + rect(x + 2 * r - W, cy, x + 2 * r, BASE), 2 * r


def g_i(x):
    """A stem with a round dot; the dot matches the period's coin in size."""
    return rect(x, XH, x + W, BASE) + circle(x + W / 2, ASC + W * .8, W * .8), W


def g_w(x):
    """Four straight strokes, flat-topped and flat-bottomed like the other letters' stem ends.
    Diagonals are widened so they read as heavy as the vertical stems."""
    ww, t = 56.0, W * 1.2
    tops = [x + t / 2, x + ww / 2, x + ww - t / 2]
    bots = [(tops[0] + tops[1]) / 2, (tops[1] + tops[2]) / 2]
    pairs = [(tops[0], bots[0]), (tops[1], bots[0]), (tops[1], bots[1]), (tops[2], bots[1])]
    return "".join(poly([(a - t / 2, XH), (a + t / 2, XH), (b + t / 2, BASE), (b - t / 2, BASE)]) for a, b in pairs), ww

GLYPHS = {"u": g_u, "s": g_s, "p": g_p, "a": g_a, "d": g_d, "f": g_f, "n": g_n, "h": g_h, "i": g_i, "w": g_w}
GAP = {"hw": 3.5, "wa": 3.0, "ai": 5.0, "i.": 4.5, ".a": 3.0}


def wordmark(text):
    """Returns (main path, tail path, dot (cx, cy, r) or None, width). The tail is everything after '.'."""
    x, main, tail, coin, after_dot, prev = 0.0, "", "", None, False, None
    for ch in text:
        if prev:
            x += GAP.get(prev + ch, 5.0)
        if ch == ".":
            coin, w = dot(x)
            after_dot = True
        else:
            d, w = GLYPHS[ch](x)
            if after_dot:
                tail += d
            else:
                main += d
        x += w
        prev = ch
    return main, tail, coin, x


def lin(id_, stops):
    st = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return f'<linearGradient id="{id_}" x1="0" y1=".2" x2="1" y2=".8">{st}</linearGradient>'


def foil_defs(p, light=False):
    return (lin(f"{p}-foil", DEEP_FOIL if light else FOIL)
            + f'<radialGradient id="{p}-sheen" cx=".32" cy=".22" r=".75"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".55"/><stop offset=".45" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>')


def square(cx, cy, h, ccw=False):
    pts = [(cx - h, cy - h), (cx + h, cy - h), (cx + h, cy + h), (cx - h, cy + h)]
    return poly(pts[::-1] if ccw else pts)


def mark(p, mono=None):
    """The hwai mark (owner, 2026-10-31): a square-holed cash coin (方孔钱), money and China in one shape.
    Foil like the prototype's coins, with an engraved rim and an engraved frame round the hole."""
    fill = mono or f"url(#{p}-foil)"
    body = circle(50, 50, 42) + square(50, 50, 12, ccw=True)
    if mono:
        return f'<path d="{body}" fill="{fill}"/>'
    return (f'<path d="{body}" fill="{fill}"/>'
            f'<circle cx="50" cy="50" r="34.5" fill="none" stroke="{INK}" stroke-opacity=".28" stroke-width="1.8"/>'
            f'<path d="{square(50, 50, 18)}" fill="none" stroke="{INK}" stroke-opacity=".28" stroke-width="1.8"/>'
            f'<circle cx="50" cy="50" r="40.6" fill="none" stroke="#FFFFFF" stroke-opacity=".45" stroke-width="1.1"/>'
            f'<path d="{body}" fill="url(#{p}-sheen)"/>')


def svg(vw, vh, body, defs="", w=None, h=None, title="hwai.ai"):
    size = f' width="{f(w)}" height="{f(h)}"' if w else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(vw)} {f(vh)}"{size} role="img" aria-label="{title}"><title>{title}</title><defs>{defs}</defs>{body}</svg>\n'


def word_body(text, main_color, tail_color, p):
    main, tail, coin, width = wordmark(text)
    out = f'<path fill="{main_color}" d="{main}"/>'
    if tail:
        out += f'<path fill="{tail_color}" d="{tail}"/>'
    if coin:
        cx, cy, r = coin
        out += f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="url(#{p}-foil)"/>'
    return out, width


def lockup(text, light, p):
    color, tail = (INK, MUTED_INK) if light else (TEXT, MUTED)
    body, width = word_body(text, color, tail, p)
    m, gap = 84, 22
    mcy = (ASC + BASE) / 2 + 2
    top, bot = min(ASC, mcy - m / 2), max(DESC, mcy + m / 2)
    inner = f'<g transform="translate(0 {f(mcy - m / 2)}) scale({m / 100})">{mark(p)}</g><g transform="translate({m + gap} 0)">{body}</g>'
    return svg(m + gap + width, bot - top, f'<g transform="translate(0 {f(-top)})">{inner}</g>', foil_defs(p, light))


def word_only(text, light, p):
    color, tail = (INK, MUTED_INK) if light else (TEXT, MUTED)
    body, width = word_body(text, color, tail, p)
    return svg(width, DESC - ASC + 4, f'<g transform="translate(0 {f(-ASC + 2)})">{body}</g>', foil_defs(p, light))


def app_icon(p):
    defs = foil_defs(p) + f'<radialGradient id="{p}-bg" cx=".5" cy=".38" r=".75"><stop offset="0" stop-color="#14301F"/><stop offset="1" stop-color="{BG}"/></radialGradient>'
    return svg(512, 512, f'<rect width="512" height="512" rx="112" fill="url(#{p}-bg)"/><g transform="translate(96 96) scale(3.2)">{mark(p)}</g>', defs, 512, 512)


os.makedirs(OUT, exist_ok=True)
files = {
    "mark.svg": svg(100, 100, mark("hwm"), foil_defs("hwm"), 256, 256),
    "mark-light.svg": svg(100, 100, mark("hwk"), foil_defs("hwk", True), 256, 256),
    "mark-mono.svg": svg(100, 100, mark("hwx", TEXT), "", 256, 256),
    "mark-ink.svg": svg(100, 100, mark("hwi", INK), "", 256, 256),
    "lockup-dark.svg": lockup("hwai", False, "hwld"),
    "lockup-light.svg": lockup("hwai", True, "hwll"),
    "lockup-ai-dark.svg": lockup("hwai.ai", False, "hwad"),
    "lockup-ai-light.svg": lockup("hwai.ai", True, "hwal"),
    "wordmark-dark.svg": word_only("hwai.ai", False, "hwwd"),
    "wordmark-light.svg": word_only("hwai.ai", True, "hwwl"),
    "app-icon.svg": app_icon("hwa"),
}
for name, body in files.items():
    open(os.path.join(OUT, name), "w").write(body)
print("ok", round(wordmark("hwai")[3], 1), round(wordmark("hwai.ai")[3], 1))
