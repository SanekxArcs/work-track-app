"""Synthesize subtle UI sound effects into public/audio/sfx/ (numpy only).

Usage: python scripts/make-sfx.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audiolib import (SR, bp_mag, convolve, fft_filter, hp_mag, lp_mag,  # noqa: E402
                      peak_normalize, reverb_ir, t_axis, tv_filter, write_wav)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "audio", "sfx")
rng = np.random.default_rng(11)


def fades(x, fin=0.002, fout=0.01):
    n = x.shape[0]
    t = np.arange(n) / SR
    env = np.clip(t / fin, 0, 1) * np.clip((n / SR - t) / fout, 0, 1)
    return x * (env[:, None] if x.ndim == 2 else env)


def verb(x, rt60=1.2, wet=0.25, bright=6000, seed=3):
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    ir = reverb_ir(rt60=rt60, bright=bright, seed=seed)
    w = convolve(x, ir)[: x.shape[0]]
    return x * (1 - wet) + w * wet * 0.5


def pad_tail(x, sec):
    z = np.zeros((int(sec * SR),) + x.shape[1:])
    return np.concatenate([x, z])


def whoosh(dur, lo=250, hi=5000, seed=0):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    x = r.standard_normal((n, 2))
    peak_t = dur * 0.55

    def mag(f, tc):
        p = np.clip(tc / peak_t, 0, 1) if tc < peak_t else np.clip(1 - (tc - peak_t) / (dur - peak_t), 0, 1)
        c = lo * (hi / lo) ** (np.sin(p * np.pi / 2) ** 1.5)
        return bp_mag(f, c * 0.5, c * 1.8, 2)

    y = tv_filter(x, mag, frame=1024)
    y = fft_filter(y, lambda f: lp_mag(f, 8000, 1) * (f + 1) ** -0.35)  # tame hiss (pinker tilt)
    t = np.arange(n) / SR
    env = np.where(t < peak_t, (t / peak_t) ** 2.0, np.exp(-(t - peak_t) / ((dur - peak_t) / 3.5)))
    # slight L/R motion for an airy pass-by
    pan = 0.5 + 0.35 * np.sin(np.pi * (t / dur - 0.5))
    y = y * env[:, None]
    y[:, 0] *= np.sqrt(1 - pan) * 1.2
    y[:, 1] *= np.sqrt(pan) * 1.2
    return fades(y, 0.005, 0.03)


def click():
    t = t_axis(0.06)
    body = np.sin(2 * np.pi * (1800 + 900 * np.exp(-t / 0.004)) * t) * np.exp(-t / 0.006)
    tick_noise = fft_filter(rng.standard_normal(len(t)), lambda f: bp_mag(f, 2000, 7000, 1)) * np.exp(-t / 0.0015)
    low = np.sin(2 * np.pi * 420 * t) * np.exp(-t / 0.012) * 0.6
    y = body * 0.6 + tick_noise * 0.25 + low
    y = fft_filter(y, lambda f: lp_mag(f, 7000, 1))
    return fades(np.stack([y, y], 1), 0.0005, 0.01)


def pop():
    t = t_axis(0.15)
    f = 380 + 700 * (1 - np.exp(-t / 0.018))  # upward "bubble" glide
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t / 0.035) * np.clip(t / 0.002, 0, 1)
    y += 0.25 * np.sin(2 * ph) * np.exp(-t / 0.02)
    y = fft_filter(y, lambda fr: lp_mag(fr, 5000, 1))
    return fades(np.stack([y, y], 1), 0.001, 0.02)


def bell(f0, dur, decay=0.6):
    t = t_axis(dur)
    # soft marimba / bell partials
    parts = ((1, 1.0, 1.0), (2.0, 0.22, 0.45), (3.0, 0.08, 0.3), (4.0, 0.12, 0.18), (5.4, 0.04, 0.12))
    y = np.zeros_like(t)
    for ratio, amp, dk in parts:
        y += amp * np.sin(2 * np.pi * f0 * ratio * t) * np.exp(-t / (decay * dk))
    return y * np.clip(t / 0.003, 0, 1)


def chime():
    dur = 1.2
    n = int(dur * SR)
    y = np.zeros(n)
    a = bell(659.25, dur, 0.55)  # E5
    b = bell(880.0, dur - 0.14, 0.6)  # A5
    y += a
    y[int(0.14 * SR):] += b[: n - int(0.14 * SR)] * 0.85
    y += np.concatenate([np.zeros(int(0.14 * SR)), bell(523.25, dur - 0.14, 0.5)])[:n] * 0.35  # C5 underneath
    st = verb(y, 1.4, 0.3, 7000)
    return fades(st, 0.001, 0.15)


def shimmer():
    dur = 1.2
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros((n, 2))
    scale = [72, 76, 79, 83, 84, 88, 91, 95, 96, 100]  # Cmaj7 pentatonic-ish, rising
    count = 26
    for i in range(count):
        p = i / (count - 1)
        start = 0.85 * p ** 1.3 + rng.uniform(0, 0.02)
        m = scale[min(len(scale) - 1, int(p * len(scale) + rng.integers(-1, 2)))]
        f = 440 * 2 ** ((m - 69) / 12)
        g = bell(f, 0.5, 0.25) * (0.45 + 0.55 * p) * rng.uniform(0.6, 1.0)
        pan = rng.uniform(-0.8, 0.8)
        a = (pan + 1) * np.pi / 4
        i0 = int(start * SR)
        j = min(n, i0 + len(g))
        y[i0:j, 0] += g[: j - i0] * np.cos(a)
        y[i0:j, 1] += g[: j - i0] * np.sin(a)
    air = whoosh(dur, 2000, 10000, seed=5) * 0.25
    y = y + air * (t / dur)[:, None]
    y = verb(y, 1.6, 0.4, 9000, seed=8)
    env = np.clip(t / 0.05, 0, 1) * np.clip((dur - t) / 0.35, 0, 1)
    return y * env[:, None]


def boom():
    dur = 2.5
    t = t_axis(dur)
    f = 38 + 55 * np.exp(-t / 0.09)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sub = np.sin(ph) * np.exp(-t / 0.75) * np.clip(t / 0.004, 0, 1)
    sub += 0.15 * np.sin(2 * ph) * np.exp(-t / 0.3)
    body = fft_filter(rng.standard_normal(len(t)), lambda fr: bp_mag(fr, 60, 900, 1)) * np.exp(-t / 0.25) * 0.25
    y = np.tanh(1.4 * (sub + body)) / np.tanh(1.4)
    st = verb(y, 2.2, 0.25, 2500, seed=9)
    tt = t_axis(st.shape[0] / SR)
    return fades(st * np.clip((dur - tt) / 0.8, 0, 1)[:, None] ** 1.5, 0.002, 0.05)


def tick():
    t = t_axis(0.03)
    y = np.sin(2 * np.pi * 3200 * t) * np.exp(-t / 0.0025)
    y += 0.3 * fft_filter(rng.standard_normal(len(t)), lambda f: bp_mag(f, 3000, 9000, 1)) * np.exp(-t / 0.001)
    y = fft_filter(y, lambda f: hp_mag(f, 800, 1))
    return fades(np.stack([y, y], 1), 0.0003, 0.008)


SFX = {
    "whoosh": (lambda: whoosh(0.7, 220, 3200, seed=1), -6),
    "whoosh-soft": (lambda: whoosh(0.45, 300, 2800, seed=2), -6),
    "click": (click, -6),
    "pop": (pop, -6),
    "chime": (chime, -6),
    "shimmer": (shimmer, -6),
    "boom": (boom, -3),
    "tick": (tick, -6),
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, (fn, db) in SFX.items():
        y = fn()
        if name == "whoosh-soft":
            db = -9  # quieter variant
        y = peak_normalize(y, db)
        write_wav(os.path.join(OUT, f"{name}.wav"), y)
        print(f"{name}: {y.shape[0] / SR:.3f}s peak {20 * np.log10(np.max(np.abs(y))):.1f} dBFS")
