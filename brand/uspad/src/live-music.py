"""Original soundtrack for the "uspad is live" video, synthesised with musiclib.py (no samples, no
licences), and muxed into the video.

Usage (repo root, after live-video.cjs):  python3 brand/uspad/src/live-music.py brand/uspad
It replaces the audio of brand/uspad/social/uspad-live-1920x1080.mp4 (the video stream is copied).

120 BPM in C major, so every scene of live-video.cjs starts on a bar. The logo lands on a soft hit, a
riser builds under "uspad is live." and the groove drops with the first product shot at 6 s. Whooshes
lead into each scene, a coin ding rings for each stock in the dividend scene, and a snare roll and an
impact bring in "Launchpad open to the public." at 34 s, on a wide C chord that rings out.
"""

import os
import sys

import numpy as np

from musiclib import SR, Track, at, clap, ding, env, hat, impact, kick, midi, mux, pluck, saw, sweep

DUR = 42.0
BEAT = 0.5
BAR = 4 * BEAT
DROP = 6.0
OPEN = 34.0
tr = Track(DUR)

C, G, AM, F = (60, 64, 67, 74), (59, 62, 67, 71), (57, 60, 64, 69), (57, 60, 65, 69)
ROOT = {C: 36, G: 31, AM: 33, F: 29}
ARP = {C: (72, 76, 79, 84), G: (71, 74, 79, 83), AM: (69, 72, 76, 81), F: (69, 72, 77, 81)}

# The intro opens dark and brightens into the drop; from the drop, C G Am F on every bar.
chords = [(0.0, 2.0, C, 900), (2.0, 4.0, AM, 1300), (4.0, 5.0, F, 1800), (5.0, DROP, G, 2400)]
t, k = DROP, 0
while t < OPEN - 1e-6:
    chords.append((t, t + BAR, (C, G, AM, F)[k % 4], 3400))
    t += BAR
    k += 1
for t0, t1, notes, cut in chords:
    tr.pad(t0, t1, notes, cut, 0.5, 0.7 if t0 < DROP else 0.1)

# Bass: held notes in the intro, eighths with an octave lift on the offbeat after the drop.
for t0, t1, notes, _ in chords:
    f = midi(ROOT[notes] + 12)
    if t0 < DROP:
        n = at(t1 - t0)
        tr.place(tr.music, (np.sin(2 * np.pi * f * np.arange(n) / SR) + 0.15 * saw(f, n, 500)) * env(n, 0.25, t1 - t0 - 0.2, 0.1), t0, 0.26)
        continue
    s, i = t0, 0
    while s < t1 - 1e-6:
        ff = f * (2 if i % 4 == 3 else 1)
        n = at(0.24)
        x = np.sin(2 * np.pi * ff * np.arange(n) / SR) + 0.35 * saw(ff, n, 900)
        tr.place(tr.music, x * env(n, 0.004, 0.15, 0.05), s, 0.32)
        s += BEAT / 2
        i += 1

# Arp from the second bar after the drop, ping-pong echoes on a dotted eighth.
arp = np.zeros((2, tr.n))
for t0, t1, notes, _ in chords:
    if t0 < DROP + BAR:
        continue
    s, i = t0, 0
    while s < t1 - 1e-6:
        tr.place(arp, pluck(ARP[notes][(0, 2, 1, 3, 2, 1, 3, 2)[i % 8]]), s, 0.15, -0.35 if i % 2 else 0.35)
        s += BEAT / 4
        i += 1
echo = tr.echo(arp, BEAT * 0.75)
tr.music += echo
tr.send += 0.35 * echo

# Drums: a soft pulse building in the intro, the full groove from the drop to the closing scene.
for i in range(8):
    tr.place(tr.drums, kick(soft=True), 2.0 + i * BEAT, 0.3 + 0.03 * i)
kicks = []
t, beat = DROP, 0
while t < OPEN - 1e-6:
    kicks.append(t)
    tr.place(tr.drums, kick(), t, 0.95)
    if beat % 2 == 1:
        c = clap()
        tr.place(tr.drums, c, t, 0.4)
        tr.place(tr.send, c, t, 0.25)
    tr.place(tr.drums, hat(), t + BEAT / 2, 0.15, 0.25)
    if t >= 16.0:
        for q in (1, 3):
            tr.place(tr.drums, hat(0.02), t + q * BEAT / 4, 0.07, -0.25)
    t += BEAT
    beat += 1
# Snare rolls into the drop and into the closing scene.
for start, end in ((DROP - BAR / 2, DROP - 0.15), (OPEN - BAR, OPEN - 0.15)):
    s = start
    while s < end:
        step = BEAT / 8 if s > end - BEAT else BEAT / 4
        tr.place(tr.drums, clap(), s, 0.08 + 0.32 * (s - start) / (end - start))
        s += step

# The logo's hit, the riser into the drop, and the impacts.
tr.place(tr.fx, impact(), 0.25, 0.45)
tr.place(tr.send, ding(84, 1.2), 0.3, 0.35)
r = sweep(DROP - 0.15 - 2.6, 250, 7500)
tr.place(tr.fx, r, 2.6, 0.26)
tr.place(tr.send, r, 2.6, 0.15)
for t_hit, g in ((DROP, 0.85), (OPEN, 0.9)):
    tr.place(tr.fx, impact(), t_hit, g)
    tr.place(tr.send, impact(), t_hit, 0.35)

# Whooshes into each scene, and into the pan from the chart to the trade box.
for t_scene in (12.0, 16.0, 20.6, 24.0, 30.0):
    w = sweep(0.55, 600, 5000)
    tr.place(tr.fx, w, t_scene - 0.55, 0.13)
    tr.place(tr.send, w, t_scene - 0.55, 0.12)

# A ding for each stock coin popping in the dividend scene (24 s + 0.9 s + 0.25 s each).
for i in range(6):
    d = ding((84, 86, 88, 91, 93, 96)[i], 0.5)
    tr.place(tr.fx, d, 24.9 + i * 0.25, 0.16, (-0.4, 0.4)[i % 2])
    tr.place(tr.send, d, 24.9 + i * 0.25, 0.3)

# Closing scene: a wide C add9 with a bell arpeggio, ringing out.
tr.pad(OPEN, DUR, (48, 55, 60, 64, 67, 74), 2800, 0.8, 0.05, release=1.2)
n = at(DUR - OPEN)
tr.place(tr.music, np.sin(2 * np.pi * midi(36) * np.arange(n) / SR) * env(n, 0.01, 3.0, 1.6), OPEN, 0.42)
for i, m in enumerate((72, 76, 79, 84, 88, 91)):
    d = ding(m, 1.0)
    tr.place(tr.fx, d, OPEN + 0.5 + i * BEAT / 2, 0.15, (-0.4, 0.4)[i % 2])
    tr.place(tr.send, d, OPEN + 0.5 + i * BEAT / 2, 0.35)

tr.duck(kicks)
video = os.path.join(sys.argv[1], "social", "uspad-live-1920x1080.mp4")
mux(tr.render(fade_from=39.5, gaps=[(DROP - 0.15, DROP), (OPEN - 0.15, OPEN)]), video)
print(video)
