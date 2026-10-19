"""Probe every generated audio file with ffprobe and (re)write public/audio/timings.json.

Usage: python scripts/verify-audio.py   (run after make-vo.py, make-music.py, make-sfx.py)
"""
import glob
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "public", "audio")
TIMINGS = os.path.join(AUDIO, "timings.json")
VO_ORDER = ["intro", "problem", "parallel", "notch", "compact", "voice", "breaks",
            "insights", "everywhere", "outro", "command"]


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration:stream=sample_rate,channels,codec_name",
                        "-of", "json", path], capture_output=True, text=True)
    if r.returncode != 0 or os.path.getsize(path) == 0:
        return None
    j = json.loads(r.stdout)
    s = j["streams"][0]
    return round(float(j["format"]["duration"]), 3), s["codec_name"], s["sample_rate"], s["channels"]


data = json.load(open(TIMINGS, encoding="utf-8")) if os.path.exists(TIMINGS) else {}
ok = True
vo = {}
for vid in VO_ORDER:
    p = os.path.join(AUDIO, "vo", f"{vid}.mp3")
    info = probe(p) if os.path.exists(p) else None
    print(f"vo/{vid}.mp3", info)
    ok &= info is not None
    if info:
        vo[vid] = info[0]
sfx = {}
for p in sorted(glob.glob(os.path.join(AUDIO, "sfx", "*.wav"))):
    info = probe(p)
    print(os.path.relpath(p, AUDIO), info)
    ok &= info is not None
    if info:
        sfx[os.path.splitext(os.path.basename(p))[0]] = info[0]
m = probe(os.path.join(AUDIO, "music.wav"))
print("music.wav", m)
ok &= m is not None

out = {"vo": vo, "music": m[0] if m else None, "voice": data.get("voice"),
       "commandVoice": data.get("commandVoice"), "sfx": sfx}
with open(TIMINGS, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2)
print("OK" if ok else "MISSING/EMPTY FILES")
sys.exit(0 if ok else 1)
