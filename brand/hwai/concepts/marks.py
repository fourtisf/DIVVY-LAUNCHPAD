"""The four mark concepts drawn on 2026-10-31 (marks-2026-10-31.png). A is the one in use (src/hwai.py)."""
FOIL = [(0, "#C9FFE0"), (.26, "#86EFAC"), (.52, "#E4FFA6"), (.76, "#7EF2D8"), (1, "#C9FFE0")]
INK = "#03140A"
def defs(p):
    st = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in FOIL)
    return (f'<linearGradient id="{p}f" x1="0" y1=".2" x2="1" y2=".8">{st}</linearGradient>'
            f'<radialGradient id="{p}s" cx=".32" cy=".22" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></radialGradient>')
def sq(cx, cy, h, ccw=False):
    pts = [(cx-h, cy-h), (cx+h, cy-h), (cx+h, cy+h), (cx-h, cy+h)]
    if ccw: pts = pts[::-1]
    return "M" + "L".join(f"{x:.2f} {y:.2f}" for x, y in pts) + "Z"
def circ(cx, cy, r, ccw=False):
    s = 0 if ccw else 1
    return f"M{cx-r} {cy}A{r} {r} 0 1 {s} {cx+r} {cy}A{r} {r} 0 1 {s} {cx-r} {cy}Z"
def qian(p):
    """A: square-holed cash coin (方孔钱): money and China in one shape."""
    body = circ(50, 50, 42) + sq(50, 50, 12, True)
    return (f'<path d="{body}" fill="url(#{p}f)"/>'
            f'<circle cx="50" cy="50" r="34.5" fill="none" stroke="{INK}" stroke-opacity=".28" stroke-width="1.8"/>'
            f'<path d="{sq(50,50,18)}" fill="none" stroke="{INK}" stroke-opacity=".28" stroke-width="1.8"/>'
            f'<circle cx="50" cy="50" r="40.6" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.1"/>'
            f'<path d="{body}" fill="url(#{p}s)"/>')
def qian_tilt(p):
    """B: the same coin with its hole turned 45 degrees, a diamond that points up."""
    d = "M50 33L67 50L50 67L33 50Z"
    body = circ(50, 50, 42) + "M50 33L33 50L50 67L67 50Z"
    return (f'<path d="{body}" fill="url(#{p}f)" fill-rule="evenodd"/>'
            f'<circle cx="50" cy="50" r="34.5" fill="none" stroke="{INK}" stroke-opacity=".28" stroke-width="1.8"/>'
            f'<path d="M50 25L75 50L50 75L25 50Z" fill="none" stroke="{INK}" stroke-opacity=".28" stroke-width="1.8"/>'
            f'<circle cx="50" cy="50" r="40.6" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.1"/>'
            f'<path d="{body}" fill="url(#{p}s)" fill-rule="evenodd"/>')
def ingot(p):
    """C: a jade ingot (元宝), the classic picture of wealth, in the brand's green foil."""
    boat = "M6 46Q19 39 31 51L69 51Q81 39 94 46Q90 79 50 82Q10 79 6 46Z"
    dome = "M30 51Q30 22 50 22Q70 22 70 51Z"
    return (f'<path d="{dome}" fill="url(#{p}f)"/><path d="{dome}" fill="url(#{p}s)"/>'
            f'<path d="{boat}" fill="url(#{p}f)"/>'
            f'<path d="M14 52Q50 64 86 52" fill="none" stroke="{INK}" stroke-opacity=".25" stroke-width="1.8"/>'
            f'<path d="{boat}" fill="url(#{p}s)"/>')
def seal(p):
    """D: a seal stamp (印章) with a cash coin cut into it."""
    r = 'M20 8H80Q92 8 92 20V80Q92 92 80 92H20Q8 92 8 80V20Q8 8 20 8Z'
    coin = circ(50, 50, 30, True) + sq(50, 50, 9)
    return (f'<path d="{r}{coin}" fill="url(#{p}f)" fill-rule="evenodd"/>'
            f'<path d="{r}" fill="url(#{p}s)"/>')
MARKS = {"A 方孔钱": qian, "B 方孔钱 (diamond)": qian_tilt, "C 玉元宝 ingot": ingot, "D 印章 seal": seal}
