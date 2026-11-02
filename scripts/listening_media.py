#!/usr/bin/env python3
"""Phase B: listening media preparation (ffmpeg split + local Whisper SRT).

The module is deliberately independent of the React app. It produces:

  public/audio/private/<exam_id>/<key>.mp3
  content/imports/private/<exam_id>/srt/<key>.srt

`scripts/import_listening.py` calls this module when `--split-audio` or
`--transcribe` is used, then feeds the generated per-passage SRTs back into
the Phase A draft/commit flow.

External requirements:
  - ffmpeg and ffprobe in PATH
  - one of:
      * faster-whisper  (pip install faster-whisper)
      * openai-whisper  (pip install openai-whisper)
      * whisper.cpp CLI (whisper-cli / whisper / main) + a .bin model

The current build environment has no Python, ffmpeg, or Whisper, so the pure
logic is tested through Pyodide and external commands are exercised with
fake runners in the unit tests.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

SRT_TIME_RE = re.compile(
    r"^\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*"
    r"(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})"
)

ABBREVIATIONS = {
    "mr.",
    "mrs.",
    "ms.",
    "dr.",
    "prof.",
    "st.",
    "jr.",
    "sr.",
    "vs.",
    "etc.",
    "e.g.",
    "i.e.",
    "a.m.",
    "p.m.",
    "inc.",
    "ltd.",
    "co.",
    "corp.",
    "dept.",
    "fig.",
    "approx.",
    "no.",
}

Runner = Callable[[list[str]], Any]
Log = Callable[[str], None]


class MediaError(RuntimeError):
    """An ffmpeg/Whisper execution or input error."""


class MediaDependencyError(MediaError):
    """A required external tool or Python package is missing."""


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class SplitResult:
    key: str
    path: Path
    start: float
    end: float
    skipped: bool = False


@dataclass(frozen=True)
class TranscribeResult:
    key: str
    path: Path
    cues: int
    skipped: bool = False


@dataclass(frozen=True)
class PrepareResult:
    audio_dir: Path
    srt_dir: Path | None
    split: list[SplitResult] = field(default_factory=list)
    transcriptions: list[TranscribeResult] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def default_log(message: str) -> None:
    print(message, file=sys.stderr)


def which(name: str) -> str | None:
    return shutil.which(name) or shutil.which(f"{name}.exe")


def run_command(command: list[str], runner: Runner | None = None) -> Any:
    if runner is not None:
        return runner(command)
    return subprocess.run(
        command,
        text=True,
        capture_output=True,
        check=False,
    )


def failure_detail(completed: Any) -> str:
    stderr = getattr(completed, "stderr", "") or ""
    stdout = getattr(completed, "stdout", "") or ""
    text = (stderr or stdout).strip()
    return text[-800:] if text else "no output"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probe_duration(path: Path, ffprobe: str | None = None) -> float | None:
    executable = ffprobe or which("ffprobe")
    if not executable:
        return None
    try:
        completed = subprocess.run(
            [
                executable,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError:
        return None
    if completed.returncode != 0:
        return None
    try:
        return float(completed.stdout.strip())
    except ValueError:
        return None


def format_clock(seconds: float | None) -> str:
    if seconds is None:
        return "-"
    total = int(round(seconds))
    return f"{total // 60}:{total % 60:02d}"


def format_srt_time(seconds: float) -> str:
    milliseconds = max(0, int(round(seconds * 1000)))
    hours = milliseconds // 3_600_000
    milliseconds %= 3_600_000
    minutes = milliseconds // 60_000
    milliseconds %= 60_000
    secs = milliseconds // 1000
    milliseconds %= 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(
        prefix=path.name + ".",
        suffix=".tmp",
        dir=str(path.parent),
        text=True,
    )
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as temp:
            temp.write(text)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    write_text_atomic(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    )


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


# ---------------------------------------------------------------------------
# SRT helpers
# ---------------------------------------------------------------------------


def parse_srt(raw: str) -> list[Cue]:
    normalized = raw.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    cues: list[Cue] = []

    for block in re.split(r"\n\s*\n", normalized):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        if re.fullmatch(r"\d+", lines[0]):
            lines = lines[1:]
        if not lines:
            continue

        match = SRT_TIME_RE.match(lines[0])
        if not match:
            continue

        h1, m1, s1, ms1, h2, m2, s2, ms2 = match.groups()
        start = (
            int(h1 or 0) * 3600
            + int(m1) * 60
            + int(s1)
            + int(ms1.ljust(3, "0")) / 1000
        )
        end = (
            int(h2 or 0) * 3600
            + int(m2) * 60
            + int(s2)
            + int(ms2.ljust(3, "0")) / 1000
        )
        text = re.sub(r"<[^>]+>", "", " ".join(lines[1:])).strip()
        if not text or end <= start:
            continue
        cues.append(Cue(start=start, end=end, text=text))

    cues.sort(key=lambda cue: cue.start)
    return cues


def count_cues(path: Path) -> int:
    try:
        return len(parse_srt(path.read_text(encoding="utf-8-sig")))
    except OSError:
        return 0


def normalize_cues(cues: Iterable[Cue]) -> list[Cue]:
    ordered = sorted(cues, key=lambda cue: (cue.start, cue.end))
    result: list[Cue] = []
    previous_end = 0.0

    for cue in ordered:
        text = re.sub(r"\s+", " ", cue.text).strip()
        if not text:
            continue
        start = max(0.0, cue.start, previous_end)
        end = max(start + 0.05, cue.end)
        result.append(Cue(start=start, end=end, text=text))
        previous_end = end

    return result


def write_srt(cues: Iterable[Cue], path: Path) -> int:
    clean = normalize_cues(cues)
    if not clean:
        raise MediaError("Whisper 沒有產生任何字幕。")

    lines: list[str] = []
    for index, cue in enumerate(clean, start=1):
        lines.append(str(index))
        lines.append(
            f"{format_srt_time(cue.start)} --> {format_srt_time(cue.end)}"
        )
        lines.append(cue.text)
        lines.append("")

    write_text_atomic(path, "\n".join(lines))
    return len(clean)


# ---------------------------------------------------------------------------
# Whisper segments -> sentence-level cues
# ---------------------------------------------------------------------------


def _is_sentence_end(token: str) -> bool:
    stripped = token.strip().strip('"\'”’)]}')
    if not stripped:
        return False
    lowered = stripped.lower()
    if lowered in ABBREVIATIONS:
        return False
    if re.fullmatch(r"[A-Z]\.", stripped):
        return False
    if re.fullmatch(r"(?:[A-Z]\.)+", stripped):
        return False
    return bool(re.search(r"[.!?。！？]$", stripped))


def _join_words(words: list[dict[str, Any]]) -> str:
    text = " ".join(str(word["word"]).strip() for word in words)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\s+'", "'", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _words_to_cue(words: list[dict[str, Any]]) -> Cue:
    start = float(words[0]["start"])
    end = max(float(words[-1]["end"]), start + 0.05)
    return Cue(start=start, end=end, text=_join_words(words))


def _split_long_cue(cue: Cue, max_chars: int) -> list[Cue]:
    if len(cue.text) <= max_chars:
        return [cue]

    words = cue.text.split()
    if len(words) <= 1:
        return [cue]

    chunks: list[str] = []
    current: list[str] = []
    current_length = 0
    for word in words:
        extra = len(word) + (1 if current else 0)
        if current and current_length + extra > max_chars:
            chunks.append(" ".join(current))
            current = [word]
            current_length = len(word)
        else:
            current.append(word)
            current_length += extra
    if current:
        chunks.append(" ".join(current))

    total = sum(max(1, len(chunk)) for chunk in chunks)
    duration = max(0.05, cue.end - cue.start)
    result: list[Cue] = []
    cursor = cue.start
    for index, chunk in enumerate(chunks):
        share = duration * (max(1, len(chunk)) / total)
        end = cue.end if index == len(chunks) - 1 else min(
            cue.end, cursor + share
        )
        if end <= cursor:
            end = cursor + 0.05
        result.append(Cue(start=cursor, end=end, text=chunk))
        cursor = end
    return result


def _expand_long_cues(cues: list[Cue], max_chars: int) -> list[Cue]:
    result: list[Cue] = []
    for cue in cues:
        result.extend(_split_long_cue(cue, max_chars))
    return result


def words_to_cues(
    words: list[dict[str, Any]],
    max_chars: int = 500,
) -> list[Cue]:
    clean: list[dict[str, Any]] = []
    for word in words:
        text = str(word.get("word", "")).strip()
        if not text:
            continue
        start = float(word.get("start", 0.0))
        end = float(word.get("end", start))
        if end <= start:
            end = start + 0.01
        clean.append({"start": start, "end": end, "word": text})
    clean.sort(key=lambda item: item["start"])

    sentences: list[Cue] = []
    current: list[dict[str, Any]] = []
    for word in clean:
        current.append(word)
        if _is_sentence_end(word["word"]):
            sentences.append(_words_to_cue(current))
            current = []
    if current:
        sentences.append(_words_to_cue(current))

    return normalize_cues(_expand_long_cues(sentences, max_chars))


def _segment_text_to_cues(
    text: str,
    start: float,
    end: float,
    max_chars: int,
) -> list[Cue]:
    sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?。！？])\s+", text.strip())
        if sentence.strip()
    ]
    if not sentences:
        return []

    duration = max(0.05 * len(sentences), end - start)
    total = sum(max(1, len(sentence)) for sentence in sentences)
    cues: list[Cue] = []
    cursor = start
    for sentence in sentences:
        share = duration * (max(1, len(sentence)) / total)
        cue_end = cursor + share
        cues.append(Cue(start=cursor, end=cue_end, text=sentence))
        cursor = cue_end

    if cues:
        cues[-1] = Cue(cues[-1].start, max(cues[-1].end, end), cues[-1].text)
    return _expand_long_cues(cues, max_chars)


def segments_to_cues(
    segments: list[dict[str, Any]],
    max_chars: int = 500,
) -> list[Cue]:
    cues: list[Cue] = []
    for segment in segments:
        start = float(segment.get("start", 0.0))
        end = float(segment.get("end", start))
        text = str(segment.get("text", "")).strip()
        words = segment.get("words") or []
        has_words = any(
            str(word.get("word", "")).strip() for word in words
        )
        if has_words:
            cues.extend(words_to_cues(words, max_chars))
        elif text:
            cues.extend(_segment_text_to_cues(text, start, end, max_chars))
    return normalize_cues(cues)


# ---------------------------------------------------------------------------
# ffmpeg split
# ---------------------------------------------------------------------------


def split_audio(
    source: Path,
    audio_dir: Path,
    spans: dict[str, tuple[float, float]],
    *,
    force: bool = False,
    quality: str = "2",
    source_checksum: str | None = None,
    source_duration: float | None = None,
    ffmpeg: str | None = None,
    runner: Runner | None = None,
    log: Log = default_log,
) -> list[SplitResult]:
    if not spans:
        raise MediaError("切段需要 spans（例如 l1=0-128,l2=128-245）。")
    if not source.exists():
        raise MediaError(f"找不到音頻檔：{source}")

    executable = ffmpeg or which("ffmpeg")
    if not executable:
        raise MediaDependencyError(
            "找不到 ffmpeg。Windows 可執行 `winget install Gyan.FFmpeg`，"
            "或把 ffmpeg.exe 加入 PATH。"
        )

    audio_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = audio_dir / "manifest.json"
    manifest = read_json(manifest_path)

    ordered = sorted(spans.items(), key=lambda item: item[1][0])
    rounded = {
        key: [round(value[0], 3), round(value[1], 3)]
        for key, value in spans.items()
    }
    targets = {key: audio_dir / f"{key}.mp3" for key in spans}

    for key, (start, end) in ordered:
        if start < 0 or end <= start:
            raise MediaError(f"span {key} 的時間不正確：{start}-{end}")
        if source_duration is not None and (
            start >= source_duration or end > source_duration + 1.0
        ):
            raise MediaError(
                f"span {key}={start}-{end} 超出音頻長度 "
                f"{source_duration:.1f}s。"
            )

    manifest_spans_raw = manifest.get("spans")
    manifest_spans = (
        manifest_spans_raw if isinstance(manifest_spans_raw, dict) else {}
    )
    same_source = (
        manifest.get("source_sha256") == source_checksum
        and str(manifest.get("quality")) == str(quality)
    )

    mismatched_spans = [
        key
        for key in spans
        if key in manifest_spans and manifest_spans[key] != rounded[key]
    ]
    untracked_existing = [
        key
        for key in spans
        if key not in manifest_spans
        and targets[key].exists()
        and targets[key].stat().st_size > 0
    ]

    if not force:
        if manifest and not same_source:
            raise MediaError(
                "音頻 manifest 的來源或 quality 與目前不同；"
                "請加 --force-audio 重新切段。"
            )
        if mismatched_spans:
            raise MediaError(
                "以下 passage 的 span 與既有 manifest 不同："
                + ", ".join(mismatched_spans)
                + "；請加 --force-audio 重新切段。"
            )
        if untracked_existing:
            raise MediaError(
                "以下 MP3 已存在但 manifest 沒有記錄："
                + ", ".join(untracked_existing)
                + "；請加 --force-audio 重新切段。"
            )

    to_split: list[str] = []
    for key in spans:
        target = targets[key]
        already_ready = (
            key in manifest_spans
            and manifest_spans[key] == rounded[key]
            and target.exists()
            and target.stat().st_size > 0
        )
        if force or not already_ready:
            to_split.append(key)

    if not to_split:
        log("[split] audio clips already prepared; skipping")
        return [
            SplitResult(key=key, path=targets[key], start=start, end=end, skipped=True)
            for key, (start, end) in ordered
        ]

    results_by_key: dict[str, SplitResult] = {}
    for key, (start, end) in ordered:
        target = targets[key]
        if key not in to_split:
            results_by_key[key] = SplitResult(
                key=key,
                path=target,
                start=start,
                end=end,
                skipped=True,
            )
            continue

        duration = end - start
        command = [
            executable,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            str(source),
            "-t",
            f"{duration:.3f}",
            "-vn",
            "-map_metadata",
            "-1",
            "-c:a",
            "libmp3lame",
            "-q:a",
            str(quality),
            str(target),
        ]
        log(
            f"[split] {key} {format_clock(start)}–{format_clock(end)} "
            f"→ {target.name}"
        )
        completed = run_command(command, runner=runner)
        if getattr(completed, "returncode", 0) != 0:
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
            raise MediaError(
                f"ffmpeg 切段失敗（{key}）：{failure_detail(completed)}"
            )
        if not target.exists() or target.stat().st_size == 0:
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
            raise MediaError(f"ffmpeg 沒有產生檔案：{target}")
        results_by_key[key] = SplitResult(
            key=key,
            path=target,
            start=start,
            end=end,
            skipped=False,
        )

    merged_spans = (
        rounded
        if force or not manifest
        else {**manifest_spans, **rounded}
    )
    merged_files = {key: f"{key}.mp3" for key in merged_spans}
    write_json_atomic(
        manifest_path,
        {
            "source": str(source),
            "source_sha256": source_checksum,
            "quality": str(quality),
            "spans": merged_spans,
            "files": merged_files,
        },
    )
    return [results_by_key[key] for key, _ in ordered]


# ---------------------------------------------------------------------------
# Whisper engines
# ---------------------------------------------------------------------------


def has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def find_whisper_cpp_binary(explicit: str | None = None) -> str | None:
    candidates: list[str] = []
    if explicit:
        candidates.append(explicit)
    candidates.extend(["whisper-cli", "whisper", "main"])
    for candidate in candidates:
        found = which(candidate)
        if found:
            return found
    return None


def available_engines(
    whisper_cpp_binary: str | None = None,
) -> dict[str, bool]:
    return {
        "faster-whisper": has_module("faster_whisper"),
        "openai-whisper": has_module("whisper") and has_module("torch"),
        "whisper-cpp": bool(
            find_whisper_cpp_binary(whisper_cpp_binary)
        ),
    }


def select_engine(
    requested: str,
    whisper_cpp_binary: str | None = None,
) -> str:
    engines = available_engines(whisper_cpp_binary)
    if requested == "auto":
        for name in ("faster-whisper", "openai-whisper", "whisper-cpp"):
            if engines[name]:
                return name
        raise MediaDependencyError(
            "找不到本地 Whisper。請安裝 faster-whisper（推薦）、"
            "openai-whisper，或 whisper.cpp。"
        )

    if requested not in engines:
        raise MediaDependencyError(f"未知的 ASR engine：{requested}")
    if not engines[requested]:
        if requested == "faster-whisper":
            raise MediaDependencyError(
                "faster-whisper 未安裝：pip install faster-whisper"
            )
        if requested == "openai-whisper":
            raise MediaDependencyError(
                "openai-whisper 未安裝：pip install openai-whisper"
            )
        raise MediaDependencyError(
            "找不到 whisper.cpp CLI（whisper-cli / whisper / main）。"
        )
    return requested


class FasterWhisperTranscriber:
    def __init__(
        self,
        model_name: str,
        device: str,
        compute_type: str,
        language: str,
        beam_size: int,
        vad_filter: bool,
        max_cue_chars: int,
        log: Log,
    ) -> None:
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except ImportError as error:
            raise MediaDependencyError(
                "faster-whisper 未安裝：pip install faster-whisper"
            ) from error

        self.language = language
        self.beam_size = beam_size
        self.vad_filter = vad_filter
        self.max_cue_chars = max_cue_chars
        self.log = log

        log(f"[asr] loading faster-whisper model {model_name} …")
        try:
            self.model = WhisperModel(
                model_name,
                device=device,
                compute_type=compute_type,
            )
        except Exception as error:  # noqa: BLE001
            raise MediaError(
                f"無法載入 faster-whisper 模型 {model_name}：{error}"
            ) from error

    def transcribe(self, audio: Path) -> list[Cue]:
        try:
            segments, info = self.model.transcribe(
                str(audio),
                language=self.language,
                beam_size=self.beam_size,
                vad_filter=self.vad_filter,
                word_timestamps=True,
                condition_on_previous_text=False,
            )
            normalized: list[dict[str, Any]] = []
            for segment in segments:
                words = [
                    {
                        "start": float(word.start),
                        "end": float(word.end),
                        "word": str(word.word),
                    }
                    for word in (getattr(segment, "words", None) or [])
                ]
                normalized.append(
                    {
                        "start": float(segment.start),
                        "end": float(segment.end),
                        "text": str(segment.text),
                        "words": words,
                    }
                )
        except Exception as error:  # noqa: BLE001
            raise MediaError(f"faster-whisper 轉錄失敗：{error}") from error

        probability = getattr(info, "language_probability", 0) or 0.0
        self.log(
            f"  language={getattr(info, 'language', '?')} "
            f"probability={probability:.2f}"
        )
        cues = segments_to_cues(normalized, self.max_cue_chars)
        if not cues:
            raise MediaError("faster-whisper 沒有產生任何字幕。")
        return cues


class OpenAIWhisperTranscriber:
    def __init__(
        self,
        model_name: str,
        device: str,
        language: str,
        beam_size: int,
        max_cue_chars: int,
        log: Log,
    ) -> None:
        try:
            import whisper  # type: ignore
        except ImportError as error:
            raise MediaDependencyError(
                "openai-whisper 未安裝：pip install openai-whisper"
            ) from error

        self.language = language
        self.beam_size = beam_size
        self.max_cue_chars = max_cue_chars
        self.log = log

        log(f"[asr] loading openai-whisper model {model_name} …")
        try:
            load_kwargs: dict[str, Any] = {}
            if device != "auto":
                load_kwargs["device"] = device
            self.model = whisper.load_model(model_name, **load_kwargs)
        except Exception as error:  # noqa: BLE001
            raise MediaError(
                f"無法載入 openai-whisper 模型 {model_name}：{error}"
            ) from error

    def transcribe(self, audio: Path) -> list[Cue]:
        try:
            result = self.model.transcribe(
                str(audio),
                language=self.language,
                beam_size=self.beam_size,
                word_timestamps=True,
                verbose=False,
            )
            normalized: list[dict[str, Any]] = []
            for segment in result.get("segments", []):
                words = [
                    {
                        "start": float(word.get("start", 0.0)),
                        "end": float(word.get("end", 0.0)),
                        "word": str(word.get("word", "")),
                    }
                    for word in (segment.get("words") or [])
                ]
                normalized.append(
                    {
                        "start": float(segment.get("start", 0.0)),
                        "end": float(segment.get("end", 0.0)),
                        "text": str(segment.get("text", "")),
                        "words": words,
                    }
                )
        except Exception as error:  # noqa: BLE001
            raise MediaError(f"openai-whisper 轉錄失敗：{error}") from error

        cues = segments_to_cues(normalized, self.max_cue_chars)
        if not cues:
            raise MediaError("openai-whisper 沒有產生任何字幕。")
        return cues


class WhisperCppTranscriber:
    def __init__(
        self,
        binary: str,
        model_path: str,
        language: str,
        max_cue_chars: int,
        log: Log,
        runner: Runner | None = None,
    ) -> None:
        self.binary = binary
        self.model_path = Path(model_path)
        self.language = language
        self.max_cue_chars = max_cue_chars
        self.log = log
        self.runner = runner
        if not self.model_path.is_file():
            raise MediaDependencyError(
                f"whisper.cpp 需要 .bin 模型檔，目前不是檔案：{model_path}"
            )

    def transcribe(self, audio: Path) -> list[Cue]:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "out"
            command = [
                self.binary,
                "-m",
                str(self.model_path),
                "-f",
                str(audio),
                "-l",
                self.language,
                "-osrt",
                "-of",
                str(base),
            ]
            self.log(f"[asr] whisper.cpp {audio.name} …")
            completed = run_command(command, runner=self.runner)
            if getattr(completed, "returncode", 0) != 0:
                raise MediaError(
                    f"whisper.cpp 轉錄失敗：{failure_detail(completed)}"
                )
            srt_path = base.with_suffix(".srt")
            if not srt_path.exists():
                matches = sorted(Path(directory).glob("*.srt"))
                if matches:
                    srt_path = matches[0]
            if not srt_path.exists():
                raise MediaError("whisper.cpp 沒有產生 SRT。")
            cues = parse_srt(srt_path.read_text(encoding="utf-8-sig"))
            if not cues:
                raise MediaError("whisper.cpp 沒有產生任何字幕。")
            return normalize_cues(
                _expand_long_cues(cues, self.max_cue_chars)
            )


def _build_transcriber(
    engine: str,
    model: str,
    device: str,
    compute_type: str,
    language: str,
    beam_size: int,
    vad_filter: bool,
    max_cue_chars: int,
    whisper_cpp_binary: str | None,
    log: Log,
) -> Any:
    if engine == "faster-whisper":
        return FasterWhisperTranscriber(
            model,
            device,
            compute_type,
            language,
            beam_size,
            vad_filter,
            max_cue_chars,
            log,
        )
    if engine == "openai-whisper":
        return OpenAIWhisperTranscriber(
            model,
            device,
            language,
            beam_size,
            max_cue_chars,
            log,
        )
    if engine == "whisper-cpp":
        binary = find_whisper_cpp_binary(whisper_cpp_binary)
        if not binary:
            raise MediaDependencyError(
                "找不到 whisper.cpp CLI（whisper-cli / whisper / main）。"
            )
        return WhisperCppTranscriber(
            binary,
            model,
            language,
            max_cue_chars,
            log,
        )
    raise MediaDependencyError(f"未知的 ASR engine：{engine}")


def create_transcriber(
    engine: str,
    model: str,
    device: str,
    compute_type: str,
    language: str,
    beam_size: int,
    vad_filter: bool,
    max_cue_chars: int,
    whisper_cpp_binary: str | None = None,
    log: Log = default_log,
) -> Any:
    if engine != "auto":
        selected = select_engine(engine, whisper_cpp_binary)
        log(f"[asr] engine={selected} model={model}")
        return _build_transcriber(
            selected,
            model,
            device,
            compute_type,
            language,
            beam_size,
            vad_filter,
            max_cue_chars,
            whisper_cpp_binary,
            log,
        )

    engines = available_engines(whisper_cpp_binary)
    errors: list[str] = []
    for name in ("faster-whisper", "openai-whisper", "whisper-cpp"):
        if not engines[name]:
            continue
        try:
            log(f"[asr] engine={name} model={model}")
            return _build_transcriber(
                name,
                model,
                device,
                compute_type,
                language,
                beam_size,
                vad_filter,
                max_cue_chars,
                whisper_cpp_binary,
                log,
            )
        except MediaError as error:
            errors.append(f"{name}: {error}")
    if errors:
        raise MediaDependencyError("；".join(errors))
    raise MediaDependencyError(
        "找不到本地 Whisper。請安裝 faster-whisper（推薦）、"
        "openai-whisper，或 whisper.cpp。"
    )


# ---------------------------------------------------------------------------
# Transcription
# ---------------------------------------------------------------------------


def transcribe_all(
    audio_dir: Path,
    srt_dir: Path,
    keys: Sequence[str],
    *,
    engine: str = "auto",
    model: str = "small.en",
    device: str = "auto",
    compute_type: str = "auto",
    language: str = "en",
    beam_size: int = 5,
    vad_filter: bool = True,
    max_cue_chars: int = 500,
    force: bool = False,
    whisper_cpp_binary: str | None = None,
    transcriber: Any | None = None,
    log: Log = default_log,
) -> list[TranscribeResult]:
    keys = list(dict.fromkeys(keys))
    if not keys:
        raise MediaError("沒有可轉錄的 passage key。")

    audio_dir = Path(audio_dir)
    srt_dir = Path(srt_dir)
    srt_dir.mkdir(parents=True, exist_ok=True)

    own_transcriber = transcriber is None
    pending: list[tuple[str, Path, Path]] = []
    results_by_key: dict[str, TranscribeResult] = {}

    for key in keys:
        audio = audio_dir / f"{key}.mp3"
        if not audio.exists():
            raise MediaError(
                f"找不到音頻片段：{audio}；請先執行 --split-audio，"
                "或把每段 MP3 放到這個位置。"
            )
        srt_path = srt_dir / f"{key}.srt"
        existing_cues = (
            count_cues(srt_path)
            if srt_path.exists() and srt_path.stat().st_size > 0
            else 0
        )
        if existing_cues > 0 and not force:
            log(f"[asr] {key} SRT already exists; skipping")
            results_by_key[key] = TranscribeResult(
                key=key,
                path=srt_path,
                cues=existing_cues,
                skipped=True,
            )
            continue
        pending.append((key, audio, srt_path))

    try:
        if pending:
            if transcriber is None:
                transcriber = create_transcriber(
                    engine,
                    model,
                    device,
                    compute_type,
                    language,
                    beam_size,
                    vad_filter,
                    max_cue_chars,
                    whisper_cpp_binary,
                    log,
                )
            assert transcriber is not None
            for key, audio, srt_path in pending:
                log(f"[asr] {key} transcribing {audio.name} …")
                cues = transcriber.transcribe(audio)
                count = write_srt(cues, srt_path)
                log(f"[asr] {key} wrote {count} cues → {srt_path}")
                results_by_key[key] = TranscribeResult(
                    key=key,
                    path=srt_path,
                    cues=count,
                    skipped=False,
                )
    finally:
        if own_transcriber and transcriber is not None:
            close = getattr(transcriber, "close", None)
            if callable(close):
                close()

    return [results_by_key[key] for key in keys if key in results_by_key]


# ---------------------------------------------------------------------------
# Dependency report
# ---------------------------------------------------------------------------


def dependency_report(
    engine: str = "auto",
    model: str = "small.en",
    whisper_cpp_binary: str | None = None,
) -> dict[str, Any]:
    ffmpeg = which("ffmpeg")
    ffprobe = which("ffprobe")
    engines = available_engines(whisper_cpp_binary)

    if engine == "auto":
        selected = next(
            (
                name
                for name in ("faster-whisper", "openai-whisper", "whisper-cpp")
                if engines[name]
            ),
            None,
        )
    else:
        selected = engine if engines.get(engine) else None

    model_ok = True
    if selected == "whisper-cpp":
        model_ok = Path(model).is_file()

    return {
        "ffmpeg": ffmpeg,
        "ffprobe": ffprobe,
        "engines": engines,
        "selected": selected,
        "model": model,
        "model_ok": model_ok,
        "ok": bool(ffmpeg and ffprobe and selected and model_ok),
    }


def print_dependency_report(report: dict[str, Any]) -> None:
    print("Phase B dependency check")
    print(f"  ffmpeg:  {report['ffmpeg'] or 'MISSING'}")
    print(f"  ffprobe: {report['ffprobe'] or 'MISSING'}")
    print("  Whisper engines:")
    for name, available in report["engines"].items():
        print(f"    {name}: {'yes' if available else 'no'}")
    print(f"  selected: {report['selected'] or 'NONE'}")
    if report["selected"] is None:
        print("  model: not selected")
    elif report["selected"] == "whisper-cpp":
        print(
            f"  model: {report['model']} "
            f"({'ok' if report['model_ok'] else 'missing .bin'})"
        )
    else:
        print(f"  model: {report['model']} (name; downloads on first run)")
    print(f"  ready: {'yes' if report['ok'] else 'no'}")


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def prepare_media(
    *,
    source: Path | None,
    audio_dir: Path,
    srt_dir: Path | None,
    keys: Sequence[str],
    spans: dict[str, tuple[float, float]],
    split: bool,
    transcribe: bool,
    source_checksum: str | None = None,
    source_duration: float | None = None,
    force_audio: bool = False,
    force_srt: bool = False,
    quality: str = "2",
    engine: str = "auto",
    model: str = "small.en",
    device: str = "auto",
    compute_type: str = "auto",
    language: str = "en",
    beam_size: int = 5,
    vad_filter: bool = True,
    max_cue_chars: int = 500,
    whisper_cpp_binary: str | None = None,
    ffmpeg: str | None = None,
    runner: Runner | None = None,
    transcriber: Any | None = None,
    log: Log = default_log,
) -> PrepareResult:
    audio_dir = Path(audio_dir)
    srt_path = Path(srt_dir) if srt_dir is not None else None
    split_results: list[SplitResult] = []
    transcribe_results: list[TranscribeResult] = []

    active_keys = list(dict.fromkeys(keys))
    if not active_keys:
        raise MediaError("沒有可處理的 passage。")

    if split:
        if source is None:
            raise MediaError("--split-audio 需要 --audio（完整 MP3）。")
        missing = [key for key in active_keys if key not in spans]
        if missing:
            raise MediaError(
                "缺少 passage span：" + ", ".join(missing)
                + "；請用 --spans 指定。"
            )
        split_spans = {key: spans[key] for key in active_keys}
        split_results = split_audio(
            source,
            audio_dir,
            split_spans,
            force=force_audio,
            quality=quality,
            source_checksum=source_checksum,
            source_duration=source_duration,
            ffmpeg=ffmpeg,
            runner=runner,
            log=log,
        )

    if transcribe:
        if srt_path is None:
            raise MediaError("--transcribe 需要 SRT 輸出目錄。")
        transcribe_results = transcribe_all(
            audio_dir,
            srt_path,
            active_keys,
            engine=engine,
            model=model,
            device=device,
            compute_type=compute_type,
            language=language,
            beam_size=beam_size,
            vad_filter=vad_filter,
            max_cue_chars=max_cue_chars,
            force=force_srt,
            whisper_cpp_binary=whisper_cpp_binary,
            transcriber=transcriber,
            log=log,
        )

    return PrepareResult(
        audio_dir=audio_dir,
        srt_dir=srt_path,
        split=split_results,
        transcriptions=transcribe_results,
    )
