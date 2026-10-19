"""Generate voiceover lines with edge-tts, trim silence, loudness-normalize.

Usage: python scripts/make-vo.py
Outputs: public/audio/vo/<id>.mp3 and updates public/audio/timings.json ("vo", "voice").
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "audio", "vo")
TIMINGS = os.path.join(ROOT, "public", "audio", "timings.json")

NARRATOR_VOICES = [
    "en-US-AndrewMultilingualNeural",
    "en-US-AndrewNeural",
    "en-US-BrianMultilingualNeural",
    "en-US-AvaMultilingualNeural",
]
COMMAND_VOICES = ["en-US-EmmaMultilingualNeural", "en-US-JennyNeural"]
RATE = "-4%"

LINES = {
    "intro": "Your workday never happens one thing at a time.",
    "problem": "Meetings. Reviews. That one bug that just won't quit. So why does your time tracker make you pick just one?",
    "parallel": "Meet Work Buddy. It tracks everything, in parallel. Start a task, add another, switch with a single click. Every second lands where it belongs.",
    "notch": "Tuck it into a slim notch at the top of your screen. Hover, and your whole day unfolds.",
    "compact": "Prefer it smaller? Collapse it into a single bar, or dock it to the edge. Out of your way. Never out of reach.",
    "voice": "Too busy to type? Just say it. Gemini turns your voice into a perfectly named task, project included.",
    "breaks": "And when it's time to breathe, it nudges you. Like a friend, not HR.",
    "insights": "See your real day. True work time, parallel overlap, every branch of your timeline. And six months of rhythm, at a glance.",
    "everywhere": "It's in Chrome, too. Local first, private by design, and it works offline.",
    "outro": "Work Buddy. Your workday sidekick.",
}
COMMAND = "Reviewing the checkout pull request for the Northwind store."

# Trim leading + trailing silence keeping ~50ms (areverse trick for the tail).
TRIM = (
    "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,"
    "areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse"
)


async def tts(text, voice, path, rate=RATE):
    await edge_tts.Communicate(text, voice, rate=rate).save(path)


async def tts_fallback(text, voices, path, rate=RATE):
    last = None
    min_dur = 0.035 * len(text)  # guard against truncated responses
    for v in voices:
        for attempt in range(4):
            try:
                await tts(text, v, path, rate)
                d = duration(path)
                if d >= min_dur:
                    return v
                last = RuntimeError(f"truncated audio ({d}s < {min_dur:.2f}s)")
            except Exception as e:  # noqa: BLE001
                last = e
            print(f"  voice {v} attempt {attempt + 1} failed: {last}", file=sys.stderr)
    raise RuntimeError(f"All voices failed: {last}")


def _loudnorm_stats(path, chain):
    r = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af",
         chain + ",loudnorm=print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    )
    t = r.stderr
    return json.loads(t[t.rindex("{"):t.rindex("}") + 1])


def process(src, dst, lufs, extra=""):
    """Trim silence + optional processing to a temp WAV, then two-pass linear loudnorm."""
    chain = TRIM + ("," + extra if extra else "")
    mid = os.path.splitext(src)[0] + ".proc.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af", chain,
                    "-ar", "44100", "-ac", "1", mid], check=True)
    m = _loudnorm_stats(mid, "anull")
    if m["input_i"] in ("-inf", "inf"):
        raise RuntimeError(f"loudness measurement failed for {src}: {m}")
    ln = (f"loudnorm=I={lufs}:TP=-1.5:LRA=20:linear=true"
          f":measured_I={m['input_i']}:measured_TP={m['input_tp']}"
          f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}"
          f":offset={m['target_offset']}")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", mid, "-af", ln,
         "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "192k", dst],
        check=True,
    )


def duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return round(float(out), 3)


async def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp()
    durs = {}
    # Pick the narrator voice once (first that works) and use it for every line.
    narrator = None
    for lid, text in LINES.items():
        raw = os.path.join(tmp, f"{lid}.mp3")
        voices = [narrator] if narrator else NARRATOR_VOICES
        narrator = await tts_fallback(text, voices, raw)
        dst = os.path.join(OUT, f"{lid}.mp3")
        process(raw, dst, -16, "highpass=f=70,acompressor=threshold=-22dB:ratio=3:attack=5:release=90:makeup=2,alimiter=limit=0.7:attack=2:release=40:level=false")
        durs[lid] = duration(dst)
        print(f"{lid}: {durs[lid]}s ({narrator})")

    raw = os.path.join(tmp, "command.mp3")
    cmd_voice = await tts_fallback(COMMAND, COMMAND_VOICES, raw, rate="+0%")
    dst = os.path.join(OUT, "command.mp3")
    process(raw, dst, -20, "highpass=f=180,lowpass=f=7000")
    durs["command"] = duration(dst)
    print(f"command: {durs['command']}s ({cmd_voice})")

    data = {}
    if os.path.exists(TIMINGS):
        with open(TIMINGS, encoding="utf-8") as f:
            data = json.load(f)
    data["vo"] = durs
    data["voice"] = narrator
    data["commandVoice"] = cmd_voice
    with open(TIMINGS, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


if __name__ == "__main__":
    asyncio.run(main())
