"""Original soundtrack for the "anyone can launch" video, synthesised with musiclib.py (no samples, no
licences), and muxed into the video.

Usage (repo root, after launch-video.cjs):  python3 brand/uspad/src/launch-music.py brand/uspad
It replaces the audio of brand/uspad/social/uspad-launch-1920x1080.mp4 (the video stream is copied).

120 BPM in A minor, so every scene of launch-video.cjs (48 s) starts on a bar. The Koin belah mark
whooshes together on a hit, a sub drone and a dark pad open under the 3D coin, bells ring for each word
of "uspad.fun is live.", and the build under "Anyone can launch a coin." drops into the groove with
step 1 at 14 s. The form types key by key and every click clicks; the approval and each step land on a
hit, a ding rings for each stock coin that drops in, the odometer ticks over a breakdown, and an impact
brings in the call to action at 40 s on a wide F to C that rings out.
"""

import os
import sys

import numpy as np

from musiclib import SR, Track, at, clap, ding, env, hat, impact, kick, midi, mux, pluck, saw, sine, sweep, tick

DUR = 48.0
BEAT = 0.5
BAR = 4 * BEAT
DROP = 14.0
BREAK = 36.0
CTA = 40.0
tr = Track(DUR)

AM, F, C, G = (57, 60, 64, 71), (53, 57, 60, 67), (55, 60, 64, 67), (55, 59, 62, 69)
ROOT = {AM: 33, F: 29, C: 36, G: 31}
ARP = {AM: (69, 72, 76, 79), F: (65, 69, 72, 76), C: (67, 72, 76, 79), G: (67, 71, 74, 79)}

# Dark and slow in the opening, brightening through the build; Am F C G on every bar from the drop.
chords = [(0.0, 4.0, AM, 700), (4.0, 6.0, F, 1000), (6.0, 8.0, AM, 1400), (8.0, 10.0, F, 1800), (10.0, 12.0, AM, 2300), (12.0, DROP, G, 2800)]
t, k = DROP, 0
while t < BREAK - 1e-6:
    chords.append((t, t + BAR, (AM, F, C, G)[k % 4], 3600))
    t += BAR
    k += 1
chords += [(BREAK, BREAK + BAR, F, 2000), (BREAK + BAR, CTA, G, 3000)]
for t0, t1, notes, cut in chords:
    tr.pad(t0, t1, notes, cut, 0.48, 1.2 if t0 < 8 else 0.6 if t0 < DROP else 0.08)

# A sub drone that swells out of the silence and hands over to the bass.
n = at(DROP)
drone = sine(midi(33), n) * env(n, 2.5, DROP - 0.6, 0.3) * np.minimum(1, np.arange(n) / at(5.0))
tr.place(tr.music, drone, 0, 0.42)

# Bass: eighths with an octave lift on the last one of each beat pair, from the drop to the breakdown.
for t0, t1, notes, _ in chords:
    if not DROP <= t0 < BREAK:
        continue
    f = midi(ROOT[notes] + 12)
    s, i = t0, 0
    while s < t1 - 1e-6:
        ff = f * (2 if i % 4 == 3 else 1)
        m = at(0.24)
        x = np.sin(2 * np.pi * ff * np.arange(m) / SR) + 0.4 * saw(ff, m, 900)
        tr.place(tr.music, x * env(m, 0.004, 0.15, 0.05), s, 0.34)
        s += BEAT / 2
        i += 1

# Arp from the second bar after the drop, ping-pong echoes on a dotted eighth.
arp = np.zeros((2, tr.n))
for t0, t1, notes, _ in chords:
    if not DROP + BAR <= t0 < BREAK:
        continue
    s, i = t0, 0
    while s < t1 - 1e-6:
        tr.place(arp, pluck(ARP[notes][(0, 2, 1, 3, 2, 1, 3, 2)[i % 8]], 4200, 0.1), s, 0.14, -0.35 if i % 2 else 0.35)
        s += BEAT / 4
        i += 1
echo = tr.echo(arp, BEAT * 0.75)
tr.music += echo
tr.send += 0.35 * echo

# Drums: a heartbeat under "uspad.fun is live.", a pulse through the build, the full groove from the drop.
for i in range(4):
    tr.place(tr.drums, kick(soft=True), 6.0 + i * BEAT * 2, 0.22 + 0.04 * i)
for i in range(8):
    tr.place(tr.drums, kick(soft=True), 10.0 + i * BEAT, 0.3 + 0.04 * i)
kicks = []
t, beat = DROP, 0
while t < BREAK - 1e-6:
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
# Snare rolls into the drop and into the call to action.
for start, end in ((DROP - BAR / 2, DROP - 0.15), (CTA - BAR / 2, CTA - 0.15)):
    s = start
    while s < end:
        step = BEAT / 8 if s > end - BEAT else BEAT / 4
        tr.place(tr.drums, clap(), s, 0.08 + 0.32 * (s - start) / (end - start))
        s += step

# The sting: the mark's halves whoosh in and meet on a hit with the flash (0.95 s), the word is revealed
# with a bell (2.1 s) and the tagline settles (2.6 s).
w = sweep(0.7, 300, 5000)
tr.place(tr.fx, w, 0.25, 0.16)
tr.place(tr.send, w, 0.25, 0.12)
tr.place(tr.fx, impact(), 0.93, 0.45)
tr.place(tr.send, ding(81, 1.4), 0.98, 0.4)
d = ding(88, 1.0)
tr.place(tr.fx, d, 2.1, 0.1)
tr.place(tr.send, d, 2.1, 0.3)
tr.place(tr.send, ding(76, 1.2), 2.6, 0.2)

# A bell for each word of "uspad.fun is live." (4 s + 2.4 s + 0.14 s each).
for i, m in enumerate((76, 81, 88)):
    d = ding(m, 0.9)
    tr.place(tr.fx, d, 6.45 + i * 0.14, 0.13, (-0.3, 0, 0.3)[i])
    tr.place(tr.send, d, 6.45 + i * 0.14, 0.3)

# Risers into the drop and into the call to action; whooshes into each scene.
for t0, t1, g in ((11.4, DROP - 0.15, 0.3), (BREAK + 1.6, CTA - 0.15, 0.26)):
    r = sweep(t1 - t0, 220, 8000)
    tr.place(tr.fx, r, t0, g)
    tr.place(tr.send, r, t0, 0.15)
for t_scene in (10.0, 20.0, 24.0, 30.0, BREAK):
    w = sweep(0.6, 500, 6000)
    tr.place(tr.fx, w, t_scene - 0.6, 0.14)
    tr.place(tr.send, w, t_scene - 0.6, 0.12)

# Hits: the drop, the coin going live (step 3) and the call to action.
for t_hit, g in ((DROP, 0.85), (24.0, 0.5), (CTA, 0.9)):
    tr.place(tr.fx, impact(), t_hit, g)
    tr.place(tr.send, impact(), t_hit, 0.3)


def click(t, g=0.2):
    """A mouse click: a short low tick with a brighter one on top."""
    tr.place(tr.fx, tick(1500), t, g)
    tr.place(tr.fx, tick(4200), t + 0.004, g * 0.4)


# Step 1: click into each field, a key for every letter typed (launch-video.cjs nameAt, tickAt), the
# picture lands, then the NVDAx tile is picked and lights up.
for t_c in (14.88, 16.23, 17.43, 18.68):
    click(t_c)
for i in range(8):
    tr.place(tr.fx, tick(2600 + 180 * ((i * 5) % 7)), 14.95 + i * 0.11, 0.07, (-0.15, 0.15)[i % 2])
for i in range(7):
    tr.place(tr.fx, tick(2600 + 180 * ((i * 3) % 7)), 16.3 + i * 0.1, 0.07, (-0.15, 0.15)[i % 2])
for t_d, m, g in ((17.6, 84, 0.1), (18.72, 91, 0.15)):
    d = ding(m, 0.6)
    tr.place(tr.fx, d, t_d, g)
    tr.place(tr.send, d, t_d, 0.3)

# Step 2: Approve is clicked, the approval row lights up, then "Signed by your wallet".
click(21.45, 0.24)
for t_d, m in ((22.0, 88), (22.4, 93)):
    d = ding(m, 0.6)
    tr.place(tr.fx, d, t_d, 0.15)
    tr.place(tr.send, d, t_d, 0.3)

# Step 3: a tick for each promise, then the phone swings up.
for i in range(3):
    tr.place(tr.fx, tick(2400 + 300 * i), 25.0 + i * 0.22, 0.2, (-0.3, 0, 0.3)[i])
w = sweep(0.8, 400, 4000)
tr.place(tr.fx, w, 26.9, 0.12, 0.4)
tr.place(tr.send, w, 26.9, 0.1)

# A ding for each stock coin landing in the row (30 s + 0.25 s + 0.16 s each, landing about 0.6 s in).
for i in range(6):
    d = ding((81, 84, 88, 91, 93, 96)[i], 0.5)
    tr.place(tr.fx, d, 30.85 + i * 0.16, 0.16, (-0.6, -0.36, -0.12, 0.12, 0.36, 0.6)[i])
    tr.place(tr.send, d, 30.85 + i * 0.16, 0.3)

# Breakdown: the odometer ticks fast, then slows into 0.15% with a bell.
s, gap = BREAK + 0.3, 0.035
while s < BREAK + 1.75:
    tr.place(tr.fx, tick(3000 + 600 * ((s * 37) % 1)), s, 0.07, ((s * 13) % 1) - 0.5)
    s += gap
    gap *= 1.07
d = ding(88, 1.0)
tr.place(tr.fx, d, BREAK + 1.85, 0.18)
tr.place(tr.send, d, BREAK + 1.85, 0.35)

# Call to action: F add9 to a wide C add9 with a bell arpeggio, ringing out.
tr.pad(CTA, CTA + BAR, (41, 53, 60, 65, 67, 69), 2600, 0.75, 0.05, release=0.6)
tr.pad(CTA + BAR, DUR, (36, 48, 55, 60, 64, 67, 74), 2900, 0.8, 0.3, release=1.4)
m = at(DUR - CTA)
tr.place(tr.music, np.sin(2 * np.pi * midi(29) * np.arange(at(BAR)) / SR) * env(at(BAR), 0.01, BAR - 0.3, 0.3), CTA, 0.42)
tr.place(tr.music, np.sin(2 * np.pi * midi(36) * np.arange(m - at(BAR)) / SR) * env(m - at(BAR), 0.2, 4.0, 1.6), CTA + BAR, 0.4)
for i, mm in enumerate((72, 76, 79, 84, 88, 91)):
    d = ding(mm, 1.0)
    tr.place(tr.fx, d, CTA + 0.9 + i * BEAT / 2, 0.15, (-0.4, 0.4)[i % 2])
    tr.place(tr.send, d, CTA + 0.9 + i * BEAT / 2, 0.35)
# The button's shine.
sh = sweep(0.9, 3000, 12000, swell=False) * np.hanning(at(0.9))
tr.place(tr.fx, sh, CTA + 2.2, 0.08)
tr.place(tr.send, sh, CTA + 2.2, 0.12)

tr.duck(kicks)
video = os.path.join(sys.argv[1], "social", "uspad-launch-1920x1080.mp4")
mux(tr.render(fade_from=45.0, gaps=[(DROP - 0.15, DROP), (CTA - 0.15, CTA)]), video)
print(video)
