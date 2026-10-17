"""Compose the original Last Witness score without external music or samples.

Requires numpy; encoding requires ffmpeg or the imageio-ffmpeg package.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

RATE = 44100
BPM = 60
BARS = 16
DURATION = 64.0
COUNT = int(RATE * DURATION)
SEED = 4172026
REPO = Path(__file__).resolve().parents[1]


def ffmpeg_path(explicit: str | None) -> str:
    if explicit:
        return explicit
    if shutil.which("ffmpeg"):
        return shutil.which("ffmpeg")
    temporary_tools = REPO.parent / "audio-source" / "tooling"
    if temporary_tools.exists():
        sys.path.insert(0, str(temporary_tools))
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as exc:
        raise SystemExit("Install ffmpeg or imageio-ffmpeg, or supply --ffmpeg.") from exc


def hz(note: float) -> float:
    return 440.0 * 2.0 ** ((note - 69.0) / 12.0)


def circle_add(target: np.ndarray, event: np.ndarray, start_seconds: float) -> None:
    start = int(round(start_seconds * RATE)) % COUNT
    first = min(len(event), COUNT - start)
    target[start:start + first] += event[:first]
    if first < len(event):
        target[:len(event) - first] += event[first:]


def stereo(signal: np.ndarray, pan: float) -> np.ndarray:
    angle = (pan + 1.0) * math.pi / 4.0
    return np.column_stack((signal * math.cos(angle), signal * math.sin(angle))).astype(np.float32)


def piano(note: int, velocity: float, pan: float, rng: np.random.Generator) -> np.ndarray:
    length = 6.8
    time = np.arange(int(length * RATE), dtype=np.float64) / RATE
    frequency = hz(note)
    signal = np.zeros(len(time), dtype=np.float64)
    for partial, strength in enumerate((1.0, .27, .11, .047, .022, .009), start=1):
        # Mild inharmonicity and quickly decaying upper partials suggest felt piano.
        partial_frequency = frequency * partial * math.sqrt(1 + .000045 * partial ** 2)
        decay = 3.15 / (1 + .43 * (partial - 1))
        signal += strength * np.sin(2 * np.pi * partial_frequency * time) * np.exp(-time / decay)
    signal += .018 * np.sin(2 * np.pi * frequency * 1.0015 * time) * np.exp(-time / 2.6)
    attack = np.sin(np.minimum(time / .022, 1.0) * math.pi / 2) ** 2
    end = np.minimum((length - time) / .18, 1.0)
    signal *= attack * end * velocity
    return stereo(signal, pan)


def pad(note: int, duration: float, amplitude: float, pan: float, voice: int) -> np.ndarray:
    time = np.arange(int(duration * RATE), dtype=np.float64) / RATE
    frequency = hz(note)
    attack = .5 - .5 * np.cos(np.minimum(time / 2.5, 1) * np.pi)
    release = .5 - .5 * np.cos(np.minimum((duration - time) / 3.6, 1) * np.pi)
    envelope = attack * release
    modulation = .91 + .09 * np.sin(2 * np.pi * time / (7.4 + voice * .31) + voice)
    left = np.sin(2 * np.pi * frequency * .9992 * time + voice * .4)
    right = np.sin(2 * np.pi * frequency * 1.0008 * time + voice * .4)
    overtone = .105 * np.sin(2 * np.pi * frequency * 2 * time)
    result = np.column_stack((left + overtone, right + overtone))
    result *= (envelope * modulation * amplitude)[:, None]
    result[:, 0] *= 1 - .15 * pan
    result[:, 1] *= 1 + .15 * pan
    return result.astype(np.float32)


def compose() -> np.ndarray:
    rng = np.random.default_rng(SEED)
    keys = np.zeros((COUNT, 2), dtype=np.float32)
    bed = np.zeros_like(keys)
    # Eight two-bar voicings, with the last suspended dominant easing into D minor.
    chords = [
        ("Dm(add9)", [38, 57, 60, 64, 65]),
        ("Bbmaj7", [34, 53, 57, 62, 65]),
        ("Gm9", [31, 53, 57, 58, 62]),
        ("A7sus4", [33, 55, 57, 62, 64]),
        ("Dm(add9)/F", [41, 57, 60, 62, 64]),
        ("Bbmaj7", [34, 53, 57, 62, 65]),
        ("Em7b5", [40, 55, 58, 62, 64]),
        ("A7(b9)", [33, 55, 58, 61, 64]),
    ]
    for index, (_, notes) in enumerate(chords):
        start = index * 8.0
        for voice, note in enumerate(notes):
            amplitude = .017 if voice == 0 else .0115
            circle_add(bed, pad(note, 11.6, amplitude, (voice - 2) / 3, voice), start)
        # A soft low pulse every two beats: no kick, impacts or sharp transients.
        for beat in (0, 2, 4, 6):
            time = np.arange(int(2.4 * RATE), dtype=np.float64) / RATE
            envelope = (1 - np.exp(-time / .18)) * np.exp(-time / .75)
            envelope *= np.minimum((2.4 - time) / .12, 1)
            pulse = .014 * np.sin(2 * np.pi * hz(notes[0]) * time) * envelope
            circle_add(bed, stereo(pulse, 0), start + beat)

    melody = [
        [(0.35, 69, .115), (2.55, 64, .074)], [(1.20, 65, .09)],
        [(0.45, 62, .10), (2.80, 57, .068)], [(1.45, 60, .082)],
        [(0.40, 62, .096), (2.45, 65, .071)], [(1.25, 69, .079)],
        [(0.60, 67, .085), (2.65, 64, .069)], [(1.40, 62, .075)],
        [(0.40, 65, .095), (2.70, 64, .070)], [(1.15, 62, .082)],
        [(0.55, 57, .082), (2.75, 62, .071)], [(1.45, 65, .076)],
        [(0.40, 64, .086), (2.60, 62, .065)], [(1.15, 58, .072)],
        [(0.65, 61, .075), (2.80, 64, .062)], [(1.35, 69, .070)],
    ]
    for bar, notes in enumerate(melody):
        for offset, note, strength in notes:
            circle_add(keys, piano(note, strength, float(rng.uniform(-.28, .28)), rng), bar * 4 + offset)
        chord_notes = chords[bar // 2][1]
        if bar % 2 == 0:
            circle_add(keys, piano(chord_notes[1], .034, -.34, rng), bar * 4 + 1.65)
        else:
            circle_add(keys, piano(chord_notes[-1] - 12, .030, .32, rng), bar * 4 + 3.10)

    # Circular, soft early reflections and diffuse tails retain continuity at 64 s.
    wet = np.zeros_like(keys)
    for tap in range(1, 29):
        delay = .023 + tap * .113 + float(rng.uniform(-.025, .025))
        weight = .074 * math.exp(-delay / 1.75)
        source = keys[:, ::-1] if tap % 2 else keys
        wet += np.roll(source, int(delay * RATE), axis=0) * weight

    # Periodic colored texture; no recorded sounds or sampled instruments.
    white = rng.normal(0, 1, COUNT).astype(np.float32)
    frequencies = np.fft.rfftfreq(COUNT, 1 / RATE)
    spectrum = np.fft.rfft(white)
    color = 1 / np.sqrt(np.maximum(frequencies, 30))
    color *= (1 - np.exp(-(frequencies / 75) ** 2)) * np.exp(-(frequencies / 2100) ** 2)
    texture = np.fft.irfft(spectrum * color, n=COUNT)
    texture /= np.sqrt(np.mean(texture ** 2))
    phase = np.arange(COUNT, dtype=np.float64) / COUNT
    texture *= .0017 * (.75 + .25 * np.sin(2 * np.pi * 3 * phase))
    bed[:, 0] += texture.astype(np.float32)
    bed[:, 1] += np.roll(texture, 977).astype(np.float32)

    result = .83 * keys + .66 * wet + bed
    result -= result.mean(axis=0, keepdims=True)
    result = np.tanh(result * 1.08) / 1.08
    peak = float(np.max(np.abs(result)))
    rms = float(np.sqrt(np.mean(result.astype(np.float64) ** 2)))
    result *= min(.72 / peak, .105 / rms)
    assert result.shape == (COUNT, 2) and np.isfinite(result).all()
    return result.astype(np.float32)


def metrics(samples: np.ndarray) -> dict:
    difference = np.abs(np.diff(samples, axis=0))
    boundary = np.abs(samples[-1] - samples[0])
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
    return {
        "frames": len(samples), "sampleRate": RATE, "channels": 2,
        "durationSeconds": round(len(samples) / RATE, 6), "finite": bool(np.isfinite(samples).all()),
        "peak": round(peak, 7), "peakDbFS": round(20 * math.log10(max(peak, 1e-12)), 3),
        "rms": round(rms, 7), "rmsDbFS": round(20 * math.log10(max(rms, 1e-12)), 3),
        "clippedSamples": int(np.count_nonzero(np.abs(samples) >= .999)),
        "boundaryJump": [round(float(x), 7) for x in boundary],
        "adjacentDifferenceP99": round(float(np.quantile(difference, .99)), 7),
    }


def encode_and_check(ffmpeg: str, master: Path, output: Path, codec: list[str]) -> dict:
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(master),
                    "-map_metadata", "-1", *codec, "-metadata", "title=Last Witness - Quiet Evidence",
                    "-metadata", "artist=Original procedural score", str(output)], check=True)
    decoded = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(output),
                              "-f", "f32le", "-acodec", "pcm_f32le", "-ar", str(RATE), "-ac", "2", "-"],
                             check=True, capture_output=True)
    samples = np.frombuffer(decoded.stdout, dtype="<f4").reshape(-1, 2)
    result = metrics(samples)
    assert result["finite"] and result["clippedSamples"] == 0 and result["peak"] < .98
    assert abs(result["durationSeconds"] - DURATION) < .05
    assert max(result["boundaryJump"]) < max(.015, 4 * result["adjacentDifferenceP99"])
    result.update({"file": output.name, "bytes": output.stat().st_size,
                   "sha256": hashlib.sha256(output.read_bytes()).hexdigest()})
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg")
    parser.add_argument("--out-dir", type=Path, default=REPO / "public" / "audio")
    parser.add_argument("--master-out", type=Path, default=REPO / "work" / "audio-source" / "witness-noir-loop.wav")
    parser.add_argument("--download-out", type=Path)
    args = parser.parse_args()
    ffmpeg = ffmpeg_path(args.ffmpeg)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    args.master_out.parent.mkdir(parents=True, exist_ok=True)
    samples = compose()
    pcm = np.round(samples * 32767).astype("<i2")
    with wave.open(str(args.master_out), "wb") as output:
        output.setnchannels(2); output.setsampwidth(2); output.setframerate(RATE)
        output.writeframes(pcm.tobytes())
    master_metrics = metrics(pcm.astype(np.float32) / 32768)
    assert master_metrics["clippedSamples"] == 0
    report = {
        "title": "Quiet Evidence / 고요한 증거", "originalComposition": True,
        "provenance": "Composed and synthesized from equations and deterministic noise; no external music, recordings, voices or instrument samples.",
        "seed": SEED, "tempoBpm": BPM, "bars": BARS, "key": "D minor", "loopSeconds": DURATION,
        "structure": "Dm(add9), Bbmaj7, Gm9, A7sus4, Dm(add9)/F, Bbmaj7, Em7b5, A7(b9); two bars each",
        "loopMethod": "Circular placement of every note, pad and reverb tail; periodic texture. No whole-track fade creates a silent seam.",
        "master": {**master_metrics, "format": "WAV PCM16 stereo", "bytes": args.master_out.stat().st_size,
                   "sha256": hashlib.sha256(args.master_out.read_bytes()).hexdigest()},
        "assets": [], "verification": "Numerical/decoded-audio checks only. Browser playback and human listening are separate checks."
    }
    report["assets"].append(encode_and_check(ffmpeg, args.master_out, args.out_dir / "witness-noir-loop.mp3", ["-c:a", "libmp3lame", "-b:a", "160k", "-ar", "44100"]))
    report["assets"].append(encode_and_check(ffmpeg, args.master_out, args.out_dir / "witness-noir-loop.ogg", ["-c:a", "libopus", "-b:a", "112k", "-vbr", "on"]))
    assert report["assets"][0]["bytes"] <= 2_000_000
    if args.download_out:
        args.download_out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.master_out, args.download_out)
    (args.out_dir / "manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"title": report["title"], "duration": DURATION, "masterBytes": report["master"]["bytes"],
                      "assets": [{"file": item["file"], "bytes": item["bytes"], "peak": item["peak"], "rmsDbFS": item["rmsDbFS"], "boundaryJump": item["boundaryJump"]} for item in report["assets"]]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
