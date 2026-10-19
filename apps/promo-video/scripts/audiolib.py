"""Small numpy-only DSP helpers shared by make-music.py and make-sfx.py."""
import json
import subprocess
import tempfile
import os
import wave

import numpy as np

SR = 44100


def t_axis(dur, sr=SR):
    return np.arange(int(round(dur * sr))) / sr


def write_wav(path, x, sr=SR):
    """Write float array (n,) or (n, 2) in [-1, 1] as 16-bit PCM."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x[:, None]
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def fft_filter(x, mag_fn, sr=SR):
    """Zero-phase filter a whole signal with a magnitude response mag_fn(freqs)."""
    x = np.asarray(x, dtype=np.float64)
    n = x.shape[0]
    nfft = 1 << int(np.ceil(np.log2(n + 16)))
    f = np.fft.rfftfreq(nfft, 1 / sr)
    m = mag_fn(f)
    X = np.fft.rfft(x, nfft, axis=0)
    if x.ndim == 2:
        m = m[:, None]
    return np.fft.irfft(X * m, nfft, axis=0)[:n]


def lp_mag(f, fc, order=2):
    return 1.0 / np.sqrt(1.0 + (f / max(fc, 1e-3)) ** (2 * order))


def hp_mag(f, fc, order=2):
    r = (f / max(fc, 1e-3)) ** (2 * order)
    return np.sqrt(r / (1.0 + r))


def bp_mag(f, lo, hi, order=2):
    return hp_mag(f, lo, order) * lp_mag(f, hi, order)


def tv_filter(x, mag_fn_t, frame=2048, sr=SR):
    """Time-varying filter via 50%-overlap Hann STFT; mag_fn_t(freqs, t_seconds)."""
    x = np.asarray(x, dtype=np.float64)
    mono = x.ndim == 1
    if mono:
        x = x[:, None]
    hop = frame // 2
    n = x.shape[0]
    pad = np.zeros((n + 2 * frame, x.shape[1]))
    pad[frame:frame + n] = x
    out = np.zeros_like(pad)
    win = np.hanning(frame + 1)[:-1][:, None]  # periodic Hann: sums to 1 at 50%
    f = np.fft.rfftfreq(frame, 1 / sr)
    for start in range(0, pad.shape[0] - frame, hop):
        seg = pad[start:start + frame] * win
        tc = (start + frame / 2 - frame) / sr
        m = mag_fn_t(f, tc)[:, None]
        out[start:start + frame] += np.fft.irfft(np.fft.rfft(seg, axis=0) * m, frame, axis=0)
    y = out[frame:frame + n]
    return y[:, 0] if mono else y


def convolve(x, ir):
    """FFT convolution, x (n,) or (n,c); ir same channel layout. Output length n+len(ir)-1."""
    x = np.asarray(x, dtype=np.float64)
    ir = np.asarray(ir, dtype=np.float64)
    n = x.shape[0] + ir.shape[0] - 1
    nfft = 1 << int(np.ceil(np.log2(n)))
    Y = np.fft.rfft(x, nfft, axis=0) * np.fft.rfft(ir, nfft, axis=0)
    return np.fft.irfft(Y, nfft, axis=0)[:n]


def reverb_ir(rt60=2.2, seconds=None, predelay=0.012, bright=6000, seed=7, sr=SR):
    """Stereo IR: exponentially decaying decorrelated noise that darkens over time."""
    rng = np.random.default_rng(seed)
    seconds = seconds or rt60 * 1.2
    n = int(seconds * sr)
    t = np.arange(n) / sr
    env = np.exp(-6.9 * t / rt60)
    noise = rng.standard_normal((n, 2))
    # darken the tail: split early (bright) / late (dark) and crossfade
    early = fft_filter(noise, lambda f: lp_mag(f, bright, 1))
    late = fft_filter(noise, lambda f: lp_mag(f, bright / 3, 1))
    mix = np.clip(t / (seconds * 0.5), 0, 1)[:, None]
    ir = (early * (1 - mix) + late * mix) * env[:, None]
    ir = fft_filter(ir, lambda f: hp_mag(f, 150, 1))
    fade_in = np.clip(t / 0.004, 0, 1)[:, None]
    ir *= fade_in
    pd = int(predelay * sr)
    ir = np.vstack([np.zeros((pd, 2)), ir])
    ir /= np.sqrt(np.sum(ir ** 2) / 2)
    return ir


def to_stereo(x, pan=0.0):
    """Equal-power pan, pan in [-1, 1]."""
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1) * np.sqrt(2)


def peak_normalize(x, dbfs):
    p = np.max(np.abs(x))
    return x * (10 ** (dbfs / 20) / p) if p > 0 else x


def measure_lufs(x, sr=SR):
    """Integrated loudness measured with ffmpeg's loudnorm analyzer."""
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        write_wav(path, np.clip(x, -1, 1), sr)
        r = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af",
             "loudnorm=print_format=json", "-f", "null", "-"],
            capture_output=True, text=True,
        )
        txt = r.stderr
        j = json.loads(txt[txt.rindex("{"):txt.rindex("}") + 1])
        return float(j["input_i"]), float(j["input_tp"])
    finally:
        os.remove(path)


def limiter(x, ceiling_db=-1.3, block=64, release_s=0.08, sr=SR):
    """Simple look-ahead block limiter (never exceeds the ceiling)."""
    thr = 10 ** (ceiling_db / 20)
    x2 = x if x.ndim == 2 else x[:, None]
    n = x2.shape[0]
    nb = int(np.ceil(n / block))
    padded = np.zeros((nb * block, x2.shape[1]))
    padded[:n] = x2
    bmax = np.abs(padded).reshape(nb, block, -1).max(axis=(1, 2))
    need = np.minimum(1.0, thr / np.maximum(bmax, 1e-12))
    need = np.minimum(need, np.minimum(np.roll(need, 1), np.roll(need, -1)))
    # look-ahead: start reducing gain a few blocks before a peak
    for k in range(1, 4):
        need = np.minimum(need, np.concatenate([need[k:], np.ones(k)]) ** (1 - k / 4))
    rel = block / (release_s * sr)
    g = np.empty(nb)
    cur = 1.0
    for i in range(nb):
        cur = min(need[i], cur + rel * (1 - cur) + 1e-9)
        g[i] = cur
    centers = np.arange(nb) * block + block / 2
    gs = np.interp(np.arange(n), centers, g)
    y = x2 * gs[:, None]
    y = np.clip(y, -thr, thr)
    return y if x.ndim == 2 else y[:, 0]
