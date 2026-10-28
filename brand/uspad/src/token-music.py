"""Original score for the "$USPAD is live" trailer, synthesised with musiclib.py (no samples, no
licences), and muxed into the video.

Usage (repo root, after token-video.cjs):  python3 brand/uspad/src/token-music.py brand/uspad
It replaces the audio of brand/uspad/social/uspad-token-1920x1080.mp4 (the video stream is copied).

120 BPM in A minor, so every scene of token-video.cjs (44 s) starts on a bar. A sub drone and a clock
in the dark under the macro shot, a glint of air along the rim, a riser into a braam and an impact as
the coin turns to face the camera at 6 s, and the title decoding letter by letter in bursts of ticks.
The letterbox opens on the drop at 12 s for the tour of the site, a whoosh on every whip and a hit as
each station lands. A ding for each stock coin in the orbit (28 s), a breakdown at 34 s with ticks on
every arc of the fee ring, and a last braam at 38 s into a wide C that rings out under the title.
"""

import os
import sys

import numpy as np

from musiclib import SR, Track, at, clap, ding, env, hat, impact, kick, midi, mux, pluck, saw, sine, sweep, tick

DUR = 44.0
BEAT = 0.5
BAR = 4 * BEAT
REVEAL = 6.0
DROP = 12.0
ORBIT = 28.0
SPLIT = 34.0
END = 38.0
WHIPS = (16.0, 20.0, 24.0)
tr = Track(DUR)

AM, F, C, G = (57, 60, 64, 71), (53, 57, 60, 67), (55, 60, 64, 67), (55, 59, 62, 69)
ROOT = {AM: 33, F: 29, C: 36, G: 31}
ARP = {AM: (69, 72, 76, 79), F: (65, 69, 72, 76), C: (67, 72, 76, 79), G: (67, 71, 74, 79)}


def braam(root, dur=3.6):
    """A trailer horn: detuned saws an octave and a fifth over a sub, opening fast and decaying slowly."""
    n = at(dur)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m, g in ((root, 1.0), (root + 7, 0.6), (root + 12, 0.7), (root + 19, 0.25)):
        for cents in (-12, 0, 12):
            out += g * saw(midi(m) * 2 ** (cents / 1200), n, 900 + 1400 * (m - root) / 19)
    out = np.tanh(1.6 * out / 6) + 0.8 * np.sin(2 * np.pi * midi(root - 12) * t)
    return out * np.minimum(1, t / 0.03) * np.exp(-t / (dur * 0.45))


def decode(t0, letters, step, gain):
    """Ticks for each letter of a decoding title (token-video.cjs decode): 8 glyphs, then it locks."""
    for i in range(letters):
        s, d = t0 + i * step, 0.55 + i * 0.05
        pan = -0.5 + i / max(1, letters - 1)
        for j in range(8):
            tr.place(tr.fx, tick(2600 + 1700 * (((i * 7 + j * 11) % 13) / 13)), s + j * d / 8, gain, pan)
        tr.place(tr.fx, tick(1800), s + d, gain * 1.6, pan)


def shimmer(t0, dur, gain):
    """Air along the rim, for the light that sweeps across the coin."""
    sh = sweep(dur, 2400, 11000, swell=False) * np.hanning(at(dur))
    tr.place(tr.fx, sh, t0, gain)
    tr.place(tr.send, sh, t0, gain * 1.4)


def riser(t0, t1, gain):
    r = sweep(t1 - t0, 200, 8000)
    tr.place(tr.fx, r, t0, gain)
    tr.place(tr.send, r, t0, gain * 0.6)


def hit(t, gain):
    tr.place(tr.fx, impact(), t, gain)
    tr.place(tr.send, impact(), t, gain * 0.35)


def roll(start, end):
    s = start
    while s < end:
        tr.place(tr.drums, clap(), s, 0.08 + 0.3 * (s - start) / (end - start))
        s += BEAT / 8 if s > end - BEAT else BEAT / 4


# ---- Macro (0-6 s): a sub drone and a dark pad in the dark, a clock, air along the rim.
n = at(REVEAL)
drone = sine(midi(33), n) * env(n, 2.5, REVEAL - 0.4, 0.3)
tr.place(tr.music, drone, 0, 0.4)
tr.pad(0.0, REVEAL, (45, 52, 57, 60), 520, 0.32, 2.0)
for i in range(int((REVEAL - 1.0) / BEAT)):
    tr.place(tr.fx, tick(5200 if i % 2 else 4300), 1.0 + i * BEAT, 0.035 + 0.004 * i, (-0.35, 0.35)[i % 2])
shimmer(1.6, 3.0, 0.07)
d = ding(76, 1.6)
tr.place(tr.send, d, 2.0, 0.22)
riser(3.8, REVEAL - 0.08, 0.28)

# ---- Reveal (6-12 s): braam and impact as it turns, the glint, the title decoding, then the pulse.
tr.place(tr.music, braam(33), REVEAL, 0.55)
hit(REVEAL, 0.8)
tr.pad(REVEAL, DROP - BAR, AM, 1300, 0.42, 0.8)
tr.pad(DROP - BAR, DROP, G, 2600, 0.42, 0.4)
shimmer(REVEAL + 1.5, 1.6, 0.1)
decode(REVEAL + 1.4, 6, 0.07, 0.05)
for i, m in enumerate((76, 81, 88)):
    d = ding(m, 0.9)
    tr.place(tr.fx, d, REVEAL + 2.1 + i * 0.12, 0.12, (-0.3, 0, 0.3)[i])
    tr.place(tr.send, d, REVEAL + 2.1 + i * 0.12, 0.3)
for i in range(4):
    tr.place(tr.drums, kick(soft=True), 8.0 + i * BEAT * 2, 0.2 + 0.04 * i)
for i in range(4):
    tr.place(tr.drums, kick(soft=True), 10.0 + i * BEAT, 0.3 + 0.06 * i)
riser(9.6, DROP - 0.15, 0.3)
roll(DROP - BAR / 2, DROP - 0.15)

# ---- The tour (12-28 s) and the orbit (28-34 s): the groove, Am F C G on every bar.
chords = []
t, k = DROP, 0
while t < SPLIT - 1e-6:
    chords.append((t, t + BAR, (AM, F, C, G)[k % 4]))
    t += BAR
    k += 1
for t0, t1, notes in chords:
    tr.pad(t0, t1, notes, 3800 if t0 >= ORBIT else 3200, 0.48 if t0 >= ORBIT else 0.42, 0.06)
    f = midi(ROOT[notes] + 12)
    s, i = t0, 0
    while s < t1 - 1e-6:
        ff = f * (2 if i % 4 == 3 else 1)
        m = at(0.24)
        x = np.sin(2 * np.pi * ff * np.arange(m) / SR) + 0.4 * saw(ff, m, 900)
        tr.place(tr.music, x * env(m, 0.004, 0.15, 0.05), s, 0.34)
        s += BEAT / 2
        i += 1

arp = np.zeros((2, tr.n))
for t0, t1, notes in chords:
    if t0 < DROP + BAR:
        continue
    s, i = t0, 0
    while s < t1 - 1e-6:
        tr.place(arp, pluck(ARP[notes][(0, 2, 1, 3, 2, 1, 3, 2)[i % 8]], 4200, 0.1), s, 0.13, -0.35 if i % 2 else 0.35)
        s += BEAT / 4
        i += 1
echo = tr.echo(arp, BEAT * 0.75)
tr.music += echo
tr.send += 0.35 * echo

kicks = []
t, beat = DROP, 0
while t < SPLIT - 1e-6:
    kicks.append(t)
    tr.place(tr.drums, kick(), t, 0.95)
    if beat % 2 == 1:
        c = clap()
        tr.place(tr.drums, c, t, 0.4)
        tr.place(tr.send, c, t, 0.25)
    tr.place(tr.drums, hat(), t + BEAT / 2, 0.15, 0.25)
    if t >= DROP + 2 * BAR:
        for q in (1, 3):
            tr.place(tr.drums, hat(0.02), t + q * BEAT / 4, 0.07, -0.25)
    t += BEAT
    beat += 1

hit(DROP, 0.85)
# A whoosh on every whip between stations, and a hit as each lands.
for t_land in WHIPS:
    w = sweep(0.6, 400, 7000)
    tr.place(tr.fx, w, t_land - 0.6, 0.2, -0.3)
    tr.place(tr.send, w, t_land - 0.6, 0.12)
    tr.place(tr.fx, impact(), t_land, 0.32)
# The last whip into the orbit, and a swell under it.
riser(ORBIT - 1.6, ORBIT - 0.05, 0.22)
hit(ORBIT, 0.6)
for i in range(6):
    d = ding((81, 84, 88, 91, 93, 96)[i], 0.5)
    tr.place(tr.fx, d, ORBIT + 0.45 + 0.1 * i, 0.14, (-0.6, 0.6, -0.36, 0.36, -0.12, 0.12)[i])
    tr.place(tr.send, d, ORBIT + 0.45 + 0.1 * i, 0.3)
shimmer(ORBIT + 1.6, 1.4, 0.06)

# ---- The split (34-38 s): the drums drop out, a tick run on each arc of the fee ring, a pluck per row.
hit(SPLIT, 0.45)
tr.pad(SPLIT, SPLIT + BAR, F, 2000, 0.5, 0.3)
tr.pad(SPLIT + BAR, END, G, 2600, 0.5, 0.3)
tr.place(tr.music, sine(midi(29), at(BAR)) * env(at(BAR), 0.05, BAR - 0.2, 0.2), SPLIT, 0.4)
tr.place(tr.music, sine(midi(31), at(BAR)) * env(at(BAR), 0.05, BAR - 0.2, 0.2), SPLIT + BAR, 0.4)
for i in range(4):
    s, gap = SPLIT + 0.35 + 0.28 * i, 0.03
    while s < SPLIT + 0.35 + 0.28 * i + 0.9:
        tr.place(tr.fx, tick(3000 + 500 * i), s, 0.045, -0.4 + 0.27 * i)
        s += gap
        gap *= 1.12
    p = pluck((72, 76, 79, 84)[i], 5200, 0.16)
    tr.place(tr.fx, p, SPLIT + 0.55 + 0.28 * i, 0.16, 0.4)
    tr.place(tr.send, p, SPLIT + 0.55 + 0.28 * i, 0.25)
riser(36.0, END - 0.15, 0.3)
roll(END - BAR / 2, END - 0.15)

# ---- The end (38-44 s): a last braam and impact, the title decoding, a wide C ringing out.
tr.place(tr.music, braam(36, 5.0), END, 0.55)
hit(END, 0.9)
tr.pad(END, DUR, (36, 48, 55, 60, 64, 67, 74), 2900, 0.8, 0.25, release=1.4)
decode(END + 0.6, 6, 0.07, 0.05)
shimmer(END + 1.7, 1.4, 0.08)
for i, mm in enumerate((72, 76, 79, 84, 88, 91)):
    d = ding(mm, 1.0)
    tr.place(tr.fx, d, END + 1.6 + i * BEAT / 2, 0.13, (-0.4, 0.4)[i % 2])
    tr.place(tr.send, d, END + 1.6 + i * BEAT / 2, 0.35)

tr.duck(kicks)
video = os.path.join(sys.argv[1], "social", "uspad-token-1920x1080.mp4")
mux(tr.render(fade_from=42.0, gaps=[(DROP - 0.15, DROP), (END - 0.15, END)]), video)
print(video)
