"""Synthesis kit for uspad's video soundtracks (intro-music.py, live-music.py): no samples, nothing to
license. Sounds are numpy arrays at 44.1 kHz; a Track mixes them on four buses (drums, music, fx and
a reverb send), ducks the music under the kick, and masters the result. mux() normalises it to
-14 LUFS (true peak -1.5 dB) with ffmpeg and puts it into a video, whose picture is copied.
"""

import json
import os
import subprocess
import tempfile
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(7)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def at(t):
    return int(round(t * SR))


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


def sine(freq, n):
    return np.sin(2 * np.pi * freq * np.arange(n) / SR)


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


def pluck(m, cutoff=5000, decay=0.12):
    n = at(0.32)
    t = np.arange(n) / SR
    return saw(midi(m), n, cutoff) * np.exp(-t / decay) * np.minimum(1, t / 0.003)


# ---------------------------------------------------------------------------------------------------
# Mixing


class Track:
    """Four stereo buses for a soundtrack of `dur` seconds."""

    def __init__(self, dur):
        self.dur = dur
        self.n = at(dur)
        self.drums, self.music, self.fx, self.send = (np.zeros((2, self.n)) for _ in range(4))

    def place(self, dst, sig, t, gain=1.0, pan=0.0):
        """Adds a mono or stereo signal at time t, panned (-1 left, 1 right) with constant power."""
        i = at(t)
        if i >= self.n:
            return
        if sig.ndim == 1:
            a = (pan + 1) * np.pi / 4
            sig = np.vstack([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)
        n = min(sig.shape[1], self.n - i)
        dst[:, i : i + n] += gain * sig[:, :n]

    def pad(self, t0, t1, notes, cutoff, gain, attack, release=0.35):
        """Three detuned, spread saws per note, held from t0 to t1."""
        n = at(t1 - t0 + 0.8)
        for m in notes:
            for cents, pan in ((-9, -0.7), (0, 0), (9, 0.7)):
                v = saw(midi(m) * 2 ** (cents / 1200), n, cutoff) * env(n, attack, t1 - t0, release)
                self.place(self.music, v, t0, gain / len(notes), pan)

    def echo(self, sig, delay, feedback=0.38, repeats=5):
        """Ping-pong echoes of a stereo bus."""
        out = sig.copy()
        d = at(delay)
        for r in range(1, repeats + 1):
            shifted = np.zeros_like(sig)
            shifted[:, d * r :] = sig[:, : self.n - d * r]
            out += (feedback**r) * (shifted[::-1] if r % 2 else shifted)
        return out

    def duck(self, kick_times, depth=0.55, release=0.11, span=0.5):
        """Sidechain: the music dips under every kick."""
        g = np.ones(self.n)
        for t in kick_times:
            i = at(t)
            seg = np.arange(min(at(span), self.n - i)) / SR
            g[i : i + len(seg)] = np.minimum(g[i : i + len(seg)], 1 - depth * np.exp(-seg / release))
        self.music *= g

    def render(self, fade_from, gaps=()):
        """Reverb on the send bus, the mix, gaps (start, end) dipped to near silence, a fade, and the master."""
        send = self.send + 0.3 * self.music
        ir_n = at(2.2)
        ir_t = np.arange(ir_n) / SR
        ir = np.vstack([band(rng.standard_normal(ir_n), 200, 7000) * np.exp(-ir_t / 0.5) for _ in range(2)])
        ir[:, : at(0.02)] = 0
        nfft = 1 << int(np.ceil(np.log2(self.n + ir_n)))
        wet = np.vstack([np.fft.irfft(np.fft.rfft(send[c], nfft) * np.fft.rfft(ir[c], nfft), nfft)[: self.n] for c in range(2)])
        wet /= np.abs(wet).max() + 1e-9
        mix = 0.9 * self.drums + 0.75 * self.music + self.fx + 0.32 * wet
        for a, b in gaps:
            mix[:, at(a) : at(b)] *= np.linspace(0.25, 0.05, at(b) - at(a))
        fade = np.ones(self.n)
        fade[at(fade_from) :] = np.linspace(1, 0, self.n - at(fade_from)) ** 1.5
        mix *= fade
        return np.tanh(1.2 * mix / np.abs(mix).max()) / np.tanh(1.2) * 0.95


def mux(mix, video):
    """Writes the mix, normalises it to -14 LUFS (true peak -1.5 dB) and puts it into the video in place."""
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
