"""Synthesize an original minimal electronic / keynote-style music bed (numpy only).

Usage: python scripts/make-music.py [--length 88] [--bpm 100] [--out public/audio/music.wav]

Arrangement (times scale with --length; defaults shown for 88 s @ 100 BPM):
  0-6 s     filtered pad swell + soft arp
  6 s       kick + shaker enter, sidechain pump begins
  12 s      full groove: bass, hats, snap, brighter pad
  ~43-48 s  breakdown: drums out, filter dip then rise with riser
  48 s      groove returns
  ~76-78 s  riser into the final lift (octave arp, open hats)
  ~84 s     final chord, everything else stops, reverb tail to the end
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audiolib import (SR, bp_mag, convolve, fft_filter, hp_mag, limiter, lp_mag,  # noqa: E402
                      measure_lufs, reverb_ir, tv_filter, write_wav)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ap = argparse.ArgumentParser()
ap.add_argument("--length", type=float, default=88.0)
ap.add_argument("--bpm", type=float, default=100.0)
ap.add_argument("--out", default=os.path.join(ROOT, "public", "audio", "music.wav"))
ap.add_argument("--lufs", type=float, default=-14.0)
args = ap.parse_args()

L = args.length
BEAT = 60.0 / args.bpm
BAR = 4 * BEAT
N = int(round(L * SR))
rng = np.random.default_rng(2024)


def snap(sec, grid=BAR):
    return round(sec / grid) * grid


# Section markers (snapped to the bar grid)
T_KICK = snap(6.0, BEAT)
T_FULL = snap(12.0)
T_BREAK = snap(L * 0.49)            # ~43.2 s
T_BACK = T_BREAK + 2 * BAR          # ~48 s
T_END = snap(L - 4.0, BEAT)         # ~84 s final hit
T_LIFT = snap(T_END - 6.0, BEAT)    # ~78 s
T_RISE = T_LIFT - 2.4               # riser into lift

out = np.zeros((N, 2))
send = np.zeros((N, 2))  # reverb send bus


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(buf, x, start, gain=1.0, pan=0.0):
    i = int(round(start * SR))
    if i >= N:
        return
    if x.ndim == 1:
        a = (pan + 1) * np.pi / 4
        x = np.stack([x * np.cos(a), x * np.sin(a)], axis=1) * np.sqrt(2)
    j = min(N, i + x.shape[0])
    buf[i:j] += x[: j - i] * gain


def piecewise(points, t):
    ts, vs = zip(*points)
    return np.interp(t, ts, vs)


t_all = np.arange(N) / SR

# --- automation -------------------------------------------------------------
pad_cut = piecewise([
    (0, 350), (T_KICK, 900), (T_FULL, 2000), (T_BREAK - 0.01, 2300),
    (T_BREAK + 0.6, 380), (T_BACK - BAR, 900), (T_BACK, 2600),
    (T_RISE, 2500), (T_LIFT, 3400), (T_END, 3000), (L, 700)], t_all)

# sidechain pump: dips after each kick
kick_times = [k * BEAT for k in range(int(L / BEAT) + 1)
              if T_KICK - 1e-6 <= k * BEAT < T_END - 1e-6
              and not (T_BREAK - 1e-6 <= k * BEAT < T_BACK - 1e-6)]
kick_times.append(T_END)
since = np.full(N, 10.0)
for kt in kick_times:
    i = int(round(kt * SR))
    j = min(N, i + int(BEAT * SR) + 1)
    since[i:j] = np.minimum(since[i:j], (np.arange(j - i)) / SR)
pump = 1.0 - 0.45 * np.exp(-since / 0.11) * (1 - np.exp(-since / 0.008))

# --- chords -----------------------------------------------------------------
CHORDS = [  # (pad voicing, bass note)
    ((53, 57, 60, 64), 41),       # Fmaj7
    ((55, 57, 60, 64), 45),       # Am7
    ((50, 53, 57, 60, 64), 38),   # Dm9
    ((50, 53, 57, 62), 34),       # Bbmaj7
]
FMAJ7, AM7, DM9, BBMAJ7 = CHORDS
CH_LEN = 2 * BAR
chord_seq = []
tt = 0.0
k = 0
while tt < T_END - 1e-6:
    ch = CHORDS[k % 4]
    if tt + CH_LEN > T_END + 1e-6:  # last partial slot -> IV before resolving
        ch = BBMAJ7
    chord_seq.append((tt, min(CH_LEN, T_END - tt), ch))
    tt += CH_LEN
    k += 1
chord_seq.append((T_END, L - T_END, FMAJ7))


def saw_pad_note(f0, dur, release, cut, detunes=(-8, 0, 8), pans=(-0.7, 0, 0.7)):
    """Additive band-limited saw stack, lowpassed by per-sample cutoff `cut`."""
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    c = cut[:n]
    y = np.zeros((n, 2))
    for d, p in zip(detunes, pans):
        f = f0 * 2 ** (d / 1200)
        ph0 = rng.uniform(0, 2 * np.pi)
        drift = 1 + 0.0015 * np.sin(2 * np.pi * rng.uniform(0.1, 0.3) * t + rng.uniform(0, 6))
        phase = 2 * np.pi * f * np.cumsum(drift) / SR + ph0
        v = np.zeros(n)
        hmax = int(min(40, 14000 / f))
        for h in range(1, hmax + 1):
            amp = (1.0 / h) / np.sqrt(1 + (h * f / c) ** 4)  # saw partial x 2-pole LP
            if np.max(amp) < 2e-4:
                break
            v += amp * np.sin(h * phase)
        a = (p + 1) * np.pi / 4
        y[:, 0] += v * np.cos(a)
        y[:, 1] += v * np.sin(a)
    # warm pure sine body
    s = 0.5 * np.sin(2 * np.pi * f0 * t)
    y += s[:, None]
    att = np.clip(t / 0.35, 0, 1) ** 2
    rel = np.clip((dur + release - t) / release, 0, 1) ** 1.5
    return y * (att * rel)[:, None]


pad = np.zeros((N, 2))
for start, dur, (notes, _) in chord_seq:
    final = start >= T_END - 1e-6
    rel = 0.9 if not final else 0.4
    d = dur if not final else dur - 0.4
    i = int(start * SR)
    cut = pad_cut[i:]
    if len(cut) < int((d + rel) * SR):
        cut = np.concatenate([cut, np.full(int((d + rel) * SR) - len(cut) + 1, cut[-1])])
    for m in notes:
        nt = saw_pad_note(midi_hz(m), d, rel, cut)
        if final:
            nt *= np.exp(-np.arange(nt.shape[0]) / SR / 1.6)[:, None]
        add(pad, nt, start, 0.06)
# Haas widening on pad
haas = int(0.011 * SR)
pad[:, 1] = np.concatenate([np.zeros(haas), pad[:-haas, 1]]) * 0.6 + pad[:, 1] * 0.4
pad_gain = piecewise([(0, 0.0), (1.5, 0.8), (T_FULL, 1.0), (T_BREAK, 1.0), (T_BREAK + 0.5, 1.15),
                      (T_BACK, 1.0), (L, 1.0)], t_all)
pad *= (pad_gain * pump)[:, None]
out += pad
send += pad * 0.45

# --- pluck arpeggio ---------------------------------------------------------
def pluck(f0, dur=0.9, bright=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for h, a in ((1, 1.0), (2, 0.35), (3, 0.18), (4, 0.08), (5, 0.04), (6, 0.02)):
        if h * f0 > 12000:
            break
        y += a * bright ** (h - 1) * np.exp(-t * (4 + 7 * (h - 1))) * np.sin(2 * np.pi * h * f0 * t)
    y *= np.clip(t / 0.003, 0, 1) * np.exp(-t * 2.2)
    return y


arp = np.zeros((N, 2))
PATTERN = [0, 2, 1, 3, 2, 1, 3, 2]
eighth = BEAT / 2
step = 0
tt = BAR  # arp enters after the first bar
while tt < T_END - 1e-6:
    ch = next(c for s, d, c in chord_seq if s <= tt + 1e-6 < s + d)
    tones = sorted(ch[0])[:4]
    m = tones[PATTERN[step % 8] % len(tones)] + 12
    vel = (0.8 if step % 2 else 1.0) * rng.uniform(0.9, 1.0)
    in_break = T_BREAK <= tt < T_BACK
    g = 0.55 if tt < T_KICK else (0.45 if in_break else 0.8)
    pan = 0.35 if step % 2 else -0.35
    add(arp, pluck(midi_hz(m), bright=0.8 if tt < T_FULL else 1.0), tt, 0.09 * vel * g, pan)
    if tt >= T_LIFT:  # octave sparkle layer in the final lift (16ths)
        add(arp, pluck(midi_hz(m + 12), 0.5, 0.7), tt, 0.04 * vel, -pan)
        add(arp, pluck(midi_hz(tones[(PATTERN[step % 8] + 1) % len(tones)] + 24), 0.5, 0.7),
            tt + eighth / 2, 0.028 * vel, pan)
    tt += eighth
    step += 1
# final arp note on the last chord
add(arp, pluck(midi_hz(72), 2.0), T_END, 0.07)
# ping-pong delay (dotted eighth)
dly = int(0.75 * BEAT * SR)
echo = np.zeros_like(arp)
src = arp.copy()
for rep in range(1, 5):
    shifted = np.zeros_like(arp)
    shifted[dly * rep:] = src[:-dly * rep]
    g = 0.38 ** rep
    if rep % 2:
        echo[:, 0] += shifted[:, 1] * g
        echo[:, 1] += shifted[:, 0] * g
    else:
        echo += shifted * g
echo = fft_filter(echo, lambda f: bp_mag(f, 300, 4500, 1))
arp = arp + echo
arp_cut = piecewise([(0, 1800), (T_FULL, 6000), (T_BREAK, 6000), (T_BREAK + 0.5, 1200),
                     (T_BACK, 6000), (L, 6000)], t_all)
arp = tv_filter(arp, lambda f, tc: lp_mag(f, float(np.interp(tc, t_all[::441], arp_cut[::441])), 2))
arp *= (0.75 + 0.25 * pump)[:, None]
out += arp
send += arp * 0.5

# --- bass -------------------------------------------------------------------
bass = np.zeros(N)


def bass_note(f0, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f0 * t) + 0.25 * np.sin(4 * np.pi * f0 * t) + 0.08 * np.sin(6 * np.pi * f0 * t)
    env = np.clip(t / 0.01, 0, 1) * np.clip((dur - t) / 0.04, 0, 1)
    return y * env


for start, dur, (_, root) in chord_seq[:-1]:
    tt = start
    while tt < start + dur - 1e-6:
        if T_FULL - 1e-6 <= tt < T_END and not (T_BREAK - 1e-6 <= tt < T_BACK - 1e-6):
            note = root + 12 if root < 40 else root
            b = bass_note(midi_hz(note), eighth * 0.9)
            i = int(tt * SR)
            j = min(N, i + len(b))
            bass[i:j] += b[: j - i] * (1.0 if (tt / eighth) % 2 > 0.5 else 0.8)
        tt += eighth
# sustained bass on the final chord and during the breakdown (soft)
bass_hold_t = np.arange(int(4.0 * SR)) / SR
b = np.sin(2 * np.pi * midi_hz(41) * bass_hold_t) * np.exp(-bass_hold_t / 1.2) * np.clip(bass_hold_t / 0.01, 0, 1)
bass[int(T_END * SR): int(T_END * SR) + len(b)] += b[: N - int(T_END * SR)]
bass *= pump ** 1.4
out += bass[:, None] * 0.11

# --- drums ------------------------------------------------------------------
def kick(level=1.0):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 46 + 80 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t / 0.28) * np.clip(t / 0.002, 0, 1)
    click = fft_filter(rng.standard_normal(n) * np.exp(-t / 0.004), lambda fr: bp_mag(fr, 800, 3500, 1))
    return (y + 0.08 * click) * level


def noise_hit(dur, lo, hi, decay, attack=0.002):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = fft_filter(rng.standard_normal(n), lambda f: bp_mag(f, lo, hi, 2))
    return x * np.clip(t / attack, 0, 1) * np.exp(-t / decay)


drums = np.zeros((N, 2))
K = kick()
for kt in kick_times:
    lvl = 1.0 if kt >= T_FULL else 0.8
    if abs(kt - T_BACK) < 1e-6 or abs(kt - T_LIFT) < 1e-6 or abs(kt - T_END) < 1e-6:
        lvl = 1.15
    add(drums, K, kt, 0.38 * lvl)

hat_src = [noise_hit(0.12, 7000, 15000, 0.025) for _ in range(4)]
shaker_src = [noise_hit(0.15, 3500, 9000, 0.045, 0.006) for _ in range(4)]
snap_src = noise_hit(0.35, 900, 5000, 0.07, 0.001)
snap_body = np.sin(2 * np.pi * 190 * np.arange(len(snap_src)) / SR) * np.exp(-np.arange(len(snap_src)) / SR / 0.05)
snap_snd = snap_src * 0.8 + snap_body * 0.35
open_hat = noise_hit(0.6, 6000, 14000, 0.18)

sixteenth = BEAT / 4
k = 0
tt = T_KICK
while tt < T_END - 1e-6:
    in_break = T_BREAK - 1e-6 <= tt < T_BACK - 1e-6
    if not in_break:
        pos = k % 4
        swing = 0.012 if pos % 2 else 0.0
        # shaker 16ths
        g = (0.55, 0.3, 0.8, 0.35)[pos]
        add(drums, shaker_src[k % 4], tt + swing, 0.03 * g * (0.7 if tt < T_FULL else 1.0), 0.3)
        if tt >= T_FULL:
            if pos == 2:  # offbeat hat
                h = open_hat if tt >= T_LIFT else hat_src[k % 4]
                add(drums, h, tt, 0.05 if tt >= T_LIFT else 0.06, -0.25)
            beat_idx = int(round(tt / BEAT))
            if pos == 0 and beat_idx % 2 == 1:  # snap on 2 & 4
                add(drums, snap_snd, tt, 0.085, 0.05)
                add(send, snap_snd[:, None].repeat(2, 1), tt, 0.06)
    tt += sixteenth
    k += 1
out += drums

# --- risers / impacts -------------------------------------------------------
def riser(dur, f_lo=300, f_hi=7000):
    n = int(dur * SR)
    x = rng.standard_normal((n, 2))
    y = tv_filter(x, lambda f, tc: bp_mag(f, 0.6 * (f_lo * (f_hi / f_lo) ** min(1, max(0, tc / dur))),
                                          1.6 * (f_lo * (f_hi / f_lo) ** min(1, max(0, tc / dur))), 2))
    t = np.arange(n) / SR
    return y * ((t / dur) ** 2.2)[:, None] * np.clip((dur - t) / 0.03, 0, 1)[:, None]


def impact(dur=2.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = fft_filter(rng.standard_normal((n, 2)), lambda f: lp_mag(f, 5000, 1) * hp_mag(f, 200, 1))
    return x * (np.exp(-t / 0.5) * np.clip(t / 0.003, 0, 1))[:, None]


R1 = riser(T_BACK - (T_BREAK + BAR))
add(out, R1, T_BREAK + BAR, 0.05)
add(send, R1, T_BREAK + BAR, 0.05)
R2 = riser(T_LIFT - T_RISE, 400, 8000)
add(out, R2, T_RISE, 0.06)
add(send, R2, T_RISE, 0.06)
for ti, g in ((T_FULL, 0.03), (T_BACK, 0.045), (T_LIFT, 0.05), (T_END, 0.04)):
    I = impact()
    add(out, I, ti, g)
    add(send, I, ti, g * 1.5)

# --- reverb + master --------------------------------------------------------
ir = reverb_ir(rt60=2.6, bright=5500)
wet = convolve(send, ir)[:N]
mix = out + wet * 0.32

mix = fft_filter(mix, lambda f: hp_mag(f, 28, 2))
# gentle glue: soft saturation on a scaled copy
mix /= np.max(np.abs(mix)) + 1e-12
mix = np.tanh(mix * 1.2) / np.tanh(1.2)

# fade-in from silence and clean ending
fade_in = np.clip(t_all / 0.8, 0, 1) ** 2
fade_out = np.clip((L - t_all) / 2.2, 0, 1) ** 1.5
mix *= (fade_in * fade_out)[:, None]

# loudness: two passes of gain + limiter
gain = 1.0
for _ in range(3):
    y = limiter(mix * gain, -1.3)
    lufs, tp = measure_lufs(y)
    print(f"pass gain={gain:.3f} -> {lufs:.2f} LUFS, TP {tp:.2f} dBTP")
    if abs(lufs - args.lufs) < 0.3:
        break
    gain *= 10 ** ((args.lufs - lufs) / 20)
y = limiter(mix * gain, -1.3)
write_wav(args.out, y)

# --- analysis ---------------------------------------------------------------
peak = 20 * np.log10(np.max(np.abs(y)))
rms = 20 * np.log10(np.sqrt(np.mean(y ** 2)))
mono = y.mean(axis=1)
spec = np.abs(np.fft.rfft(mono)) ** 2
fr = np.fft.rfftfreq(len(mono), 1 / SR)
bands = {"<120": (0, 120), "120-500": (120, 500), "500-2k": (500, 2000),
         "2k-6k": (2000, 6000), "6k-12k": (6000, 12000), ">12k": (12000, 23000)}
tot = spec.sum()
dist = {k: round(100 * spec[(fr >= a) & (fr < b)].sum() / tot, 2) for k, (a, b) in bands.items()}
clipped = int(np.sum(np.abs(y) >= 0.999))
lufs, tp = measure_lufs(y)
print(json.dumps({"peak_dbfs": round(peak, 2), "rms_dbfs": round(rms, 2), "lufs": lufs, "true_peak": tp,
                  "clipped_samples": clipped, "energy_pct": dist, "seconds": len(y) / SR}, indent=2))
sec = {}
for a, b in ((0, T_KICK), (T_KICK, T_FULL), (T_FULL, T_BREAK), (T_BREAK, T_BACK), (T_BACK, T_RISE),
             (T_LIFT, T_END), (T_END, L - 0.5), (L - 0.5, L)):
    seg = y[int(a * SR):int(b * SR)]
    sec[f"{a:.1f}-{b:.1f}"] = round(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12), 1)
print("section RMS dBFS:", sec)
