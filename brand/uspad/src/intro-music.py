"""Original soundtrack for the uspad intro video, synthesised with musiclib.py (no samples, no licences),
and muxed into the video.

Usage (repo root, after intro-video.cjs):  python3 brand/uspad/src/intro-music.py brand/uspad
It replaces the audio of brand/uspad/social/uspad-intro-1920x1080.mp4 (the video stream is copied).

109.09 BPM, so a bar is 2.2 s and the drop lands on "Meet uspad" at 8.8 s. Cues follow the scenes in
intro-video.cjs: a click per typed letter of the hashtag, a dark pad and a riser under "pays you
nothing", the drop, whooshes into each scene, clock ticks and a coin ding per "Sent" row, and an
impact into the closing C chord.
"""

import os
import sys

import numpy as np

from musiclib import SR, Track, at, clap, ding, env, hat, impact, key_click, kick, midi, mux, pluck, rng, saw, sweep, tick

DUR = 34.0
BEAT = 0.55
BAR = 4 * BEAT
DROP = 8.8
END_GROOVE = 29.6
tr = Track(DUR)

AM, F, C, G = (57, 60, 64, 71), (53, 57, 60, 64), (55, 60, 64, 67), (55, 59, 62, 67)
ROOT = {AM: 33, F: 29, C: 36, G: 31}
ARP = {AM: (69, 72, 76, 81), F: (65, 69, 72, 77), C: (67, 72, 76, 79), G: (67, 71, 74, 79)}

# Chords: Am for the hashtag, F and G under "pays you nothing", then Am F C G from the drop.
chords = [(0.0, 4.4, AM, 700), (4.4, 6.6, F, 900), (6.6, 8.8, G, 1200)]
t, k = DROP, 0
while t < END_GROOVE - 1e-6:
    chords.append((t, min(t + BAR, END_GROOVE), (AM, F, C, G)[k % 4], 3200))
    t += BAR
    k += 1

for t0, t1, notes, cut in chords:
    tr.pad(t0, t1, notes, cut, 0.55, 0.9 if t0 < DROP else 0.12)

# Bass: whole notes before the drop, eighths after.
for t0, t1, notes, _ in chords:
    f = midi(ROOT[notes] + 12)
    if t0 < DROP:
        n = at(t1 - t0)
        tr.place(tr.music, (np.sin(2 * np.pi * f * np.arange(n) / SR) + 0.15 * saw(f, n, 500)) * env(n, 0.3, t1 - t0 - 0.3, 0.1), t0, 0.28)
        continue
    s = t0
    while s < t1 - 1e-6:
        n = at(0.26)
        x = np.sin(2 * np.pi * f * np.arange(n) / SR) + 0.35 * saw(f, n, 900)
        tr.place(tr.music, x * env(n, 0.004, 0.16, 0.05), s, 0.32)
        s += BEAT / 2

# Arp, from the second bar after the drop: 16ths through the chord tones, ping-pong.
arp = np.zeros((2, tr.n))
for t0, t1, notes, _ in chords:
    if t0 < DROP + BAR:
        continue
    s, i = t0, 0
    while s < t1 - 1e-6:
        tr.place(arp, pluck(ARP[notes][(0, 1, 2, 3, 2, 1, 2, 3)[i % 8]]), s, 0.16, -0.35 if i % 2 else 0.35)
        s += BEAT / 4
        i += 1
echo = tr.echo(arp, BEAT * 0.75)
tr.music += echo
tr.send += 0.35 * echo

# Drums from the drop until the closing scene; a soft pulse and a snare build before it.
kicks = []
t, beat = DROP, 0
while t < END_GROOVE - 1e-6:
    kicks.append(t)
    tr.place(tr.drums, kick(), t, 0.95)
    if beat % 2 == 1:
        c = clap()
        tr.place(tr.drums, c, t, 0.42)
        tr.place(tr.send, c, t, 0.25)
    tr.place(tr.drums, hat(), t + BEAT / 2, 0.16, 0.25)
    if t >= 13.8:
        for q in (1, 3):
            tr.place(tr.drums, hat(0.02), t + q * BEAT / 4, 0.07, -0.25)
    t += BEAT
    beat += 1
for i in range(8):
    tr.place(tr.drums, kick(soft=True), 4.4 + i * BEAT, 0.45)
# Snare roll into the drop: 16ths, then 32nds, getting louder; silence for the last 0.15 s.
s, step = 6.6 + BAR / 2, BEAT / 4
while s < DROP - 0.16:
    if s > DROP - BEAT:
        step = BEAT / 8
    tr.place(tr.drums, clap(), s, 0.08 + 0.3 * (s - 6.6) / (DROP - 6.6))
    s += step

# The hashtag typed letter by letter (intro-video.cjs: 0.55 s + 0.06 s per letter).
for i in range(15):
    tr.place(tr.fx, key_click(), 0.55 + i * 0.06, 0.32 * rng.uniform(0.75, 1.0), rng.uniform(-0.2, 0.2))

# Riser under "Until now." into the drop, and impacts on the drop and the closing scene.
r = sweep(DROP - 0.16 - 6.6, 250, 7000)
tr.place(tr.fx, r, 6.6, 0.28)
tr.place(tr.send, r, 6.6, 0.15)
for t_hit, g in ((DROP, 0.9), (END_GROOVE, 0.8)):
    tr.place(tr.fx, impact(), t_hit, g)
    tr.place(tr.send, impact(), t_hit, 0.35)

# Whooshes into the fee, hourly and fair scenes.
for t_scene in (13.8, 19.4, 24.8):
    w = sweep(0.55, 600, 5000)
    tr.place(tr.fx, w, t_scene - 0.55, 0.14)
    tr.place(tr.send, w, t_scene - 0.55, 0.12)

# The clock: tick-tock on eighths while the hand spins (19.4 + 0.6 s, three turns of 1.5 s).
t, i = 20.0, 0
while t < 24.5:
    tr.place(tr.fx, tick(2100 if i % 2 == 0 else 1550), t, 0.11, 0.3 if i % 2 else -0.3)
    t += BEAT / 2
    i += 1
# A coin ding for each "Sent" row (19.4 + 1.3 s + 1.1 s each).
for i in range(3):
    d = ding(88 + (0, 3, 7)[i])
    tr.place(tr.fx, d, 19.4 + 1.3 + i * 1.1 + 0.15, 0.22)
    tr.place(tr.send, d, 19.4 + 1.3 + i * 1.1 + 0.15, 0.3)

# Closing scene: a wide C add9 and a bell arpeggio, ringing out.
tr.pad(END_GROOVE, DUR, (48, 55, 60, 64, 67, 74), 2600, 0.75, 0.05)
n = at(DUR - END_GROOVE)
tr.place(tr.music, np.sin(2 * np.pi * midi(36) * np.arange(n) / SR) * env(n, 0.01, 1.6, 1.2), END_GROOVE, 0.4)
for i, m in enumerate((72, 76, 79, 84, 88)):
    d = ding(m, 0.9)
    tr.place(tr.fx, d, END_GROOVE + 0.2 + i * BEAT / 2, 0.16, (-0.4, 0.4)[i % 2])
    tr.place(tr.send, d, END_GROOVE + 0.2 + i * BEAT / 2, 0.35)

tr.duck(kicks)
video = os.path.join(sys.argv[1], "social", "uspad-intro-1920x1080.mp4")
mux(tr.render(fade_from=32.2, gaps=[(DROP - 0.16, DROP)]), video)
print(video)
