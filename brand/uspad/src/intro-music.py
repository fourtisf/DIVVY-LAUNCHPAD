"""Original soundtrack for the uspad intro video, synthesised here (no samples, no licences), and
muxed into the video.

Usage (repo root, after intro-video.cjs):  python3 brand/uspad/src/intro-music.py brand/uspad
It replaces the audio of brand/uspad/social/uspad-intro-1920x1080.mp4 (the video stream is copied).

109.09 BPM, so a bar is 2.2 s and the drop lands on "Meet uspad" at 8.8 s. Cues follow the scenes in
intro-video.cjs: a click per typed letter of the hashtag, a dark pad and a riser under "pays you
nothing", the drop, whooshes into each scene, clock ticks and a coin ding per "Sent" row, and an
impact into the closing C chord.
"""

import os
import subprocess
import sys
import tempfile
import wave
import json

import numpy as np

SR = 44100
DUR = 34.0
N = int(DUR * SR)
BEAT = 0.55
BAR = 4 * BEAT
DROP = 8.8
END_GROOVE = 29.6
rng = np.random.default_rng(7)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def at(t):
    return int(round(t * SR))


def bus():
    return np.zeros((2, N))


def place(dst, sig, t, gain=1.0, pan=0.0):
    """Adds a mono or stereo signal at time t, panned (-1 left, 1 right) with constant power."""
    i = at(t)
    if i >= N:
        return
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        sig = np.vstack([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)
    n = min(sig.shape[1], N - i)
    dst[:, i : i + n] += gain * sig[:, :n]


def band(sig, lo, hi):
    """Zero-phase band limit with an FFT mask (soft edges)."""
    spec = np.fft.rfft(sig)
    f = np.fft.rfftfreq(len(sig), 1 / SR)
    mask = np.ones_like(f)
    if lo:
        mask *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
    if hi:
        mask *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(spec * mask, len(sig))


def saw(freq, n, cutoff):
    """Band-limited saw: harmonics up to the cutoff, so nothing aliases."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    phase = rng.uniform(0, 2 * np.pi)
    for k in range(1, max(1, int(cutoff // freq)) + 1):
        out += np.sin(2 * np.pi * freq * k * t + phase * k) / k
    return out


def env(n, attack, release_at, release):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(attack, 1e-4))
    e *= np.where(t > release_at, np.exp(-(t - release_at) / release), 1)
    return e


# ---------------------------------------------------------------------------------------------------
# Sounds


def kick(soft=False):
    n = at(0.5)
    t = np.arange(n) / SR
    f = 46 + (90 if soft else 125) * np.exp(-t / 0.032)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.2 if soft else 0.26))
    click = band(rng.standard_normal(n), 1500, 6000) * np.exp(-t / 0.002) * (0.1 if soft else 0.35)
    return np.tanh(1.6 * (body + click)) * np.minimum(1, t / 0.0015)


def clap():
    n = at(0.35)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    e = sum(np.where(t >= d, np.exp(-(t - d) / 0.006), 0) for d in (0, 0.011, 0.022))
    e += np.where(t >= 0.03, 0.5 * np.exp(-(t - 0.03) / 0.11), 0)
    return band(noise * e, 900, 3500)


def hat(decay=0.035):
    n = at(0.15)
    t = np.arange(n) / SR
    return band(rng.standard_normal(n), 7000, 16000) * np.exp(-t / decay)


def key_click():
    n = at(0.03)
    t = np.arange(n) / SR
    c = band(rng.standard_normal(n), 1800, 7000) * np.exp(-t / 0.004)
    return c + 0.3 * np.sin(2 * np.pi * rng.uniform(3200, 4200) * t) * np.exp(-t / 0.006)


def tick(freq):
    n = at(0.08)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.018)


def ding(m, decay=0.45):
    n = at(1.6)
    t = np.arange(n) / SR
    f = midi(m)
    out = np.zeros(n)
    for ratio, amp, d in ((1, 1, decay), (2.0, 0.35, decay * 0.6), (3.01, 0.18, decay * 0.4), (4.2, 0.1, decay * 0.25)):
        out += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / d)
    return out * np.minimum(1, t / 0.002)


def impact():
    n = at(2.4)
    t = np.arange(n) / SR
    f = 36 + 40 * np.exp(-t / 0.12)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    crash = band(rng.standard_normal(n), 300, 6000) * np.exp(-t / 0.45) * 0.35
    return np.tanh(1.4 * (boom + crash))


def sweep(dur, f0, f1, swell=True):
    """Noise through a band that glides from f0 to f1 (STFT overlap-add), louder towards the end."""
    n = at(dur)
    size, hop = 2048, 512
    win = np.hanning(size)
    noise = rng.standard_normal(n + size)
    out = np.zeros(n + size)
    norm = np.zeros(n + size)
    freqs = np.fft.rfftfreq(size, 1 / SR)
    for start in range(0, n, hop):
        p = start / n
        fc = f0 * (f1 / f0) ** p
        mask = np.exp(-0.5 * (np.log2(np.maximum(freqs, 1) / fc) / 0.35) ** 2)
        frame = np.fft.irfft(np.fft.rfft(noise[start : start + size] * win) * mask, size)
        out[start : start + size] += frame * win
        norm[start : start + size] += win**2
    out = out[:n] / np.maximum(norm[:n], 1e-3)
    t = np.arange(n) / n
    return out / (np.abs(out).max() + 1e-9) * (t**2 if swell else 1)


# ---------------------------------------------------------------------------------------------------
# Arrangement

drums, music, fx, send = bus(), bus(), bus(), bus()

AM, F, C, G = (57, 60, 64, 71), (53, 57, 60, 64), (55, 60, 64, 67), (55, 59, 62, 67)
ROOT = {AM: 33, F: 29, C: 36, G: 31}
ARP = {AM: (69, 72, 76, 81), F: (65, 69, 72, 77), C: (67, 72, 76, 79), G: (67, 71, 74, 79)}

# Chords: Am for the hashtag, F and G under "pays you nothing", then Am F C G from the drop.
chords = [(0.0, 4.4, AM, 700), (4.4, 6.6, F, 900), (6.6, 8.8, G, 1200)]
t = DROP
k = 0
while t < END_GROOVE - 1e-6:
    chords.append((t, min(t + BAR, END_GROOVE), (AM, F, C, G)[k % 4], 3200))
    t += BAR
    k += 1


def pad(dst, t0, t1, notes, cutoff, gain, attack):
    n = at(t1 - t0 + 0.8)
    for m in notes:
        for cents, pan in ((-9, -0.7), (0, 0), (9, 0.7)):
            v = saw(midi(m) * 2 ** (cents / 1200), n, cutoff) * env(n, attack, t1 - t0, 0.35)
            place(dst, v, t0, gain / len(notes), pan)


for t0, t1, notes, cut in chords:
    pad(music, t0, t1, notes, cut, 0.55, 0.9 if t0 < DROP else 0.12)

# Bass: whole notes before the drop, eighths after.
for t0, t1, notes, _ in chords:
    f = midi(ROOT[notes] + 12)
    if t0 < DROP:
        n = at(t1 - t0)
        place(music, (np.sin(2 * np.pi * f * np.arange(n) / SR) + 0.15 * saw(f, n, 500)) * env(n, 0.3, t1 - t0 - 0.3, 0.1), t0, 0.28)
        continue
    s = t0
    while s < t1 - 1e-6:
        n = at(0.26)
        x = np.sin(2 * np.pi * f * np.arange(n) / SR) + 0.35 * saw(f, n, 900)
        place(music, x * env(n, 0.004, 0.16, 0.05), s, 0.32)
        s += BEAT / 2

# Arp, from the second bar after the drop: 16ths through the chord tones, ping-pong.
arp = bus()
for t0, t1, notes, _ in chords:
    if t0 < DROP + BAR:
        continue
    s, i = t0, 0
    while s < t1 - 1e-6:
        m = ARP[notes][(0, 1, 2, 3, 2, 1, 2, 3)[i % 8]]
        n = at(0.32)
        x = saw(midi(m), n, 5000) * np.exp(-np.arange(n) / SR / 0.12) * np.minimum(1, np.arange(n) / SR / 0.003)
        place(arp, x, s, 0.16, -0.35 if i % 2 else 0.35)
        s += BEAT / 4
        i += 1
echo = arp.copy()
D = at(BEAT * 0.75)
for r in range(1, 6):
    shifted = np.zeros_like(arp)
    shifted[:, D * r :] = arp[:, : N - D * r]
    echo += (0.38**r) * (shifted[::-1] if r % 2 else shifted)
music += echo
send += 0.35 * echo

# Drums from the drop until the closing scene; a soft pulse and a snare build before it.
k = kick()
t = DROP
beat = 0
while t < END_GROOVE - 1e-6:
    place(drums, k, t, 0.95)
    if beat % 2 == 1:
        c = clap()
        place(drums, c, t, 0.42)
        place(send, c, t, 0.25)
    place(drums, hat(), t + BEAT / 2, 0.16, 0.25)
    if t >= 13.8:
        for q in (1, 3):
            place(drums, hat(0.02), t + q * BEAT / 4, 0.07, -0.25)
    t += BEAT
    beat += 1
for i in range(8):
    place(drums, kick(soft=True), 4.4 + i * BEAT, 0.45)
# Snare roll into the drop: 16ths, then 32nds, getting louder; silence for the last 0.15 s.
s = 6.6 + BAR / 2
step = BEAT / 4
while s < DROP - 0.16:
    if s > DROP - BEAT:
        step = BEAT / 8
    p = (s - 6.6) / (DROP - 6.6)
    place(drums, clap(), s, 0.08 + 0.3 * p)
    s += step

# The hashtag typed letter by letter (intro-video.cjs: 0.55 s + 0.06 s per letter).
for i in range(15):
    place(fx, key_click(), 0.55 + i * 0.06, 0.32 * rng.uniform(0.75, 1.0), rng.uniform(-0.2, 0.2))

# Riser under "Until now." into the drop, and impacts on the drop and the closing scene.
r = sweep(DROP - 0.16 - 6.6, 250, 7000)
place(fx, r, 6.6, 0.28)
place(send, r, 6.6, 0.15)
for t_hit, g in ((DROP, 0.9), (END_GROOVE, 0.8)):
    place(fx, impact(), t_hit, g)
    place(send, impact(), t_hit, 0.35)

# Whooshes into the fee, hourly and fair scenes.
for t_scene in (13.8, 19.4, 24.8):
    w = sweep(0.55, 600, 5000)
    place(fx, w, t_scene - 0.55, 0.14)
    place(send, w, t_scene - 0.55, 0.12)

# The clock: tick-tock on eighths while the hand spins (19.4 + 0.6 s, three turns of 1.5 s).
t = 20.0
i = 0
while t < 24.5:
    place(fx, tick(2100 if i % 2 == 0 else 1550), t, 0.11, 0.3 if i % 2 else -0.3)
    t += BEAT / 2
    i += 1
# A coin ding for each "Sent" row (19.4 + 1.3 s + 1.1 s each).
for i in range(3):
    d = ding(88 + (0, 3, 7)[i])
    place(fx, d, 19.4 + 1.3 + i * 1.1 + 0.15, 0.22)
    place(send, d, 19.4 + 1.3 + i * 1.1 + 0.15, 0.3)

# Closing scene: a wide C add9 and a bell arpeggio, ringing out.
pad(music, END_GROOVE, DUR, (48, 55, 60, 64, 67, 74), 2600, 0.75, 0.05)
n = at(DUR - END_GROOVE)
place(music, np.sin(2 * np.pi * midi(36) * np.arange(n) / SR) * env(n, 0.01, 1.6, 1.2), END_GROOVE, 0.4)
for i, m in enumerate((72, 76, 79, 84, 88)):
    d = ding(m, 0.9)
    place(fx, d, END_GROOVE + 0.2 + i * BEAT / 2, 0.16, (-0.4, 0.4)[i % 2])
    place(send, d, END_GROOVE + 0.2 + i * BEAT / 2, 0.35)

# ---------------------------------------------------------------------------------------------------
# Sidechain, reverb, master

duck = np.ones(N)
t = DROP
while t < END_GROOVE - 1e-6:
    i = at(t)
    seg = np.arange(min(at(BEAT), N - i)) / SR
    duck[i : i + len(seg)] = np.minimum(duck[i : i + len(seg)], 1 - 0.55 * np.exp(-seg / 0.11))
    t += BEAT
music *= duck

send += 0.3 * music
ir_n = at(2.2)
ir_t = np.arange(ir_n) / SR
ir = np.vstack([band(rng.standard_normal(ir_n), 200, 7000) * np.exp(-ir_t / 0.5) for _ in range(2)])
ir[:, : at(0.02)] = 0
nfft = 1 << int(np.ceil(np.log2(N + ir_n)))
wet = np.vstack([np.fft.irfft(np.fft.rfft(send[c], nfft) * np.fft.rfft(ir[c], nfft), nfft)[:N] for c in range(2)])
wet /= np.abs(wet).max() + 1e-9

mix = 0.9 * drums + 0.75 * music + fx + 0.32 * wet
# The breath before the drop.
gap = np.ones(N)
gap[at(DROP - 0.16) : at(DROP)] = np.linspace(0.25, 0.05, at(DROP) - at(DROP - 0.16))
mix *= gap
fade = np.ones(N)
fade[at(32.2) :] = np.linspace(1, 0, N - at(32.2)) ** 1.5
mix *= fade
mix = np.tanh(1.2 * mix / np.abs(mix).max()) / np.tanh(1.2)
mix *= 0.95

# ---------------------------------------------------------------------------------------------------
# Write, normalise loudness for X (-14 LUFS, true peak -1.5 dB), and mux into the video.

directory = sys.argv[1]
video = os.path.join(directory, "social", "uspad-intro-1920x1080.mp4")
with tempfile.TemporaryDirectory() as tmp:
    raw = os.path.join(tmp, "music.wav")
    with wave.open(raw, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(mix.T, -1, 1) * 32767).astype("<i2").tobytes())
    probe = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", raw, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
        capture_output=True,
        text=True,
        check=True,
    ).stderr
    m = json.loads(probe[probe.rindex("{") :])
    norm = (
        f"loudnorm=I=-14:TP=-1.5:LRA=11:linear=true:measured_I={m['input_i']}:measured_TP={m['input_tp']}"
        f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}"
    )
    out = os.path.join(tmp, "out.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-i", raw, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
         "-af", norm, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out],
        check=True,
    )
    os.replace(out, video)
print(video)
