#!/usr/bin/env python3
"""Phase A: draft-first CET-4 listening import from PDF + answer key.

This tool does NOT write to the browser database directly. It produces:

  1. a reviewable draft JSON (questions, groups, spans, transcript segments,
     readiness diagnostics), and optionally
  2. a CET-Lab `exam.md` listening bundle.

The app ingests `exam.md` into IndexedDB on the next load. Audio is expected
under `public/audio/...` (one MP3 per passage), so the player does not need a
passage-level audio span.

Phase A scope:
  - extract text from PDF (pdfplumber) or .txt/.md
  - parse listening questions and options
  - merge a separate answer key
  - group questions into CET-4 listening passages
  - optional SRT/transcript input for segments
  - optional per-passage spans for splitting a full recording
  - render `exam.md` with local audio assets
  - never commit content while blocking issues remain

Phase B is integrated through `listening_media.py`:

  - `--split-audio`: ffmpeg splits the full MP3 by `--spans`
  - `--transcribe`: local Whisper writes one SRT per passage
  - `--prepare-media`: both of the above

Without those flags, use `--srt` / `--srt-dir` or provide per-passage MP3s
yourself; `--allow-missing-audio` is only for previewing the Markdown.

Examples:
  # 1. Parse a paper and answer key; write a draft for review.
  python -I scripts/import_listening.py \
    --pdf content/private/paper.pdf \
    --answers-file content/private/answers.txt \
    --exam-id exam_2024-12_set1 --year 2024 --month 12 --set set1 \
    --draft content/imports/private/exam_2024-12_set1.draft.json

  # 2. Add a full-exam SRT and passage spans, then preview Markdown.
  python -I scripts/import_listening.py \
    --pdf content/private/paper.pdf \
    --answers-file content/private/answers.txt \
    --audio content/private/listening.mp3 \
    --srt content/private/listening.srt \
    --spans "l1=0-128,l2=128-245,l3=245-402" \
    --exam-id exam_2024-12_set1 --year 2024 --month 12 --set set1 \
    --dry-run

  # 3. Commit after review and after the per-passage MP3 files exist.
  python -I scripts/import_listening.py \
    --pdf content/private/paper.pdf \
    --answers-file content/private/answers.txt \
    --srt content/private/listening.srt \
    --spans "l1=0-128,l2=128-245,l3=245-402" \
    --exam-id exam_2024-12_set1 --year 2024 --month 12 --set set1 \
    --commit --validate

  # 4. Phase B: ffmpeg split + local Whisper SRT + commit.
  python -I scripts/import_listening.py \
    --pdf content/private/paper.pdf \
    --answers-file content/private/answers.txt \
    --audio content/private/listening.mp3 \
    --spans "l1=0-128,l2=128-245,l3=245-402" \
    --prepare-media --asr-engine faster-whisper --whisper-model small.en \
    --whisper-device cpu --whisper-compute-type int8 \
    --exam-id exam_2024-12_set1 --year 2024 --month 12 --set set1 \
    --commit --validate
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

import import_pdf_reading as pdf_tools  # noqa: E402
import import_reading as core  # noqa: E402
import listening_media as media  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "config" / "exam_rules.json"
DEFAULT_OUT = REPO_ROOT / "content" / "exams" / "private"
DEFAULT_AUDIO_OUT = REPO_ROOT / "public" / "audio" / "private"
DEFAULT_DRAFT_DIR = REPO_ROOT / "content" / "imports" / "private"
DEFAULT_SRT_DIR = REPO_ROOT / "content" / "imports" / "private" / "srt"

EXAM_ID_RE = re.compile(r"^exam_[a-z0-9_-]+$")
PASSAGE_ID_RE = re.compile(r"^psg_[a-z0-9_-]+$")
AUDIO_ID_RE = re.compile(r"^aud_[a-z0-9_-]+$")
QUESTION_ID_RE = re.compile(r"^q_[a-z0-9_-]+$")
CONTENT_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")

ACCENTS = {"us", "british", "australian", "canadian", "other"}
SOURCES = {"user-entered", "original", "licensed", "public-domain"}
OPTION_KEYS = list("ABCDEFGHIJKLMNO")
LISTENING_TYPES = {
    "listening_detail",
    "listening_inference",
    "listening_attitude",
    "main_idea",
}
STOPWORDS = {
    "about",
    "after",
    "again",
    "also",
    "and",
    "are",
    "because",
    "been",
    "before",
    "but",
    "can",
    "could",
    "did",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "how",
    "into",
    "its",
    "may",
    "more",
    "most",
    "not",
    "now",
    "one",
    "only",
    "other",
    "our",
    "out",
    "over",
    "said",
    "says",
    "she",
    "should",
    "some",
    "such",
    "than",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "was",
    "were",
    "what",
    "when",
    "where",
    "which",
    "while",
    "who",
    "will",
    "with",
    "would",
    "you",
    "your",
}

SRT_TIME_RE = re.compile(
    r"^\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*"
    r"(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})"
)


# CET-4 listening layout: 25 questions, 8 passages.
# Override with --groups-file when the paper uses a different structure.
DEFAULT_GROUPS: tuple[tuple[str, str, str, int, int], ...] = (
    ("l1", "News Report 1", "A", 1, 2),
    ("l2", "News Report 2", "A", 3, 4),
    ("l3", "News Report 3", "A", 5, 7),
    ("l4", "Conversation 1", "B", 8, 11),
    ("l5", "Conversation 2", "B", 12, 15),
    ("l6", "Passage 1", "C", 16, 18),
    ("l7", "Passage 2", "C", 19, 21),
    ("l8", "Passage 3", "C", 22, 25),
)


class DependencyError(RuntimeError):
    """A required optional dependency is missing."""


@dataclass(frozen=True)
class Group:
    key: str
    label: str
    section: str
    first: int
    last: int


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


@dataclass
class SegmentDraft:
    index: int
    start: float
    end: float
    text: str
    text_zh: str | None = None


@dataclass
class QuestionDraft:
    id: str
    number: int
    passage_id: str
    type: str
    stem: str
    options: list[dict[str, str]]
    answer: str
    explanation: str
    evidence: list[dict[str, Any]]
    knowledge_tags: list[str]
    error_cause_tags: list[str]
    hot_topic_tags: list[str]
    difficulty: int
    generated: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "passage_id": self.passage_id,
            "section": "listening",
            "type": self.type,
            "stem": self.stem,
            "options": self.options,
            "answer": self.answer,
            "explanation": self.explanation,
            "evidence": self.evidence,
            "knowledge_tags": self.knowledge_tags,
            "error_cause_tags": self.error_cause_tags,
            "hot_topic_tags": self.hot_topic_tags,
            "difficulty": self.difficulty,
            "generated": self.generated,
        }


@dataclass
class AssetDraft:
    id: str
    src: str
    expected_path: Path
    accent: str | None
    wpm: int | None
    license: str
    duration_sec: float | None
    segments: list[SegmentDraft]


@dataclass
class PassageDraft:
    key: str
    id: str
    order: int
    label: str
    section: str
    span_start: float | None
    span_end: float | None
    transcript: str
    transcript_zh: str | None
    word_count: int
    wpm: int | None
    hot_topic_tags: list[str]
    asset: AssetDraft
    questions: list[QuestionDraft]
    warnings: list[str] = field(default_factory=list)


@dataclass
class ExamDraft:
    id: str
    title: str
    year: int
    month: int
    set_name: str
    source: str
    license: str
    content_version: str
    passages: list[PassageDraft]


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def add_error(
    diagnostics: list[core.Diagnostic],
    code: str,
    message: str,
    column: str | None = None,
    fix: str | None = None,
) -> None:
    diagnostics.append(
        core.Diagnostic("error", code, message, column=column, fix=fix)
    )


def add_warning(
    diagnostics: list[core.Diagnostic],
    code: str,
    message: str,
    column: str | None = None,
    fix: str | None = None,
) -> None:
    diagnostics.append(
        core.Diagnostic("warning", code, message, column=column, fix=fix)
    )


def yaml_str(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def fmt_num(value: float | int | None) -> str:
    if value is None:
        return "null"
    return json.dumps(round(float(value), 3), ensure_ascii=False)


def normalize_key(value: str) -> str:
    return core.slugify(value)


def parse_time_value(value: str) -> float:
    text = value.strip()
    if not text:
        raise ValueError("空的时间值")
    if ":" in text:
        parts = text.split(":")
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        raise ValueError(f"无法解析时间：{value}")
    return float(text)


def parse_spans(spec: str | None) -> dict[str, tuple[float, float]]:
    spans: dict[str, tuple[float, float]] = {}
    if not spec:
        return spans

    for chunk in re.split(r"[,;，；]", spec):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "=" not in chunk:
            raise ValueError(f"span 格式应为 key=start-end：{chunk}")
        key_text, range_text = chunk.split("=", 1)
        key = normalize_key(key_text)
        if key in spans:
            raise ValueError(f"span key 重复：{key}")
        if "-" not in range_text:
            raise ValueError(f"span 缺少範圍：{chunk}")
        start_text, end_text = range_text.split("-", 1)
        start = parse_time_value(start_text)
        end = parse_time_value(end_text)
        if end <= start:
            raise ValueError(f"span end 必須大於 start：{chunk}")
        spans[key] = (start, end)

    ordered = sorted(spans.items(), key=lambda item: item[1][0])
    for previous, current in zip(ordered, ordered[1:]):
        if current[1][0] < previous[1][1] - 0.001:
            raise ValueError(
                f"span 重疊：{previous[0]} 與 {current[0]}"
            )
    return spans


def load_hot_topic_ids() -> set[str]:
    try:
        rules = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return {
            str(item["id"])
            for item in rules.get("reading", {}).get("hot_topics", [])
        }
    except Exception:
        return {"unclassified"}


def parse_question_range(spec: str) -> tuple[int, int]:
    match = re.match(r"^\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$", spec)
    if not match:
        raise ValueError("--question-range 格式应为 1-25")
    first, last = int(match.group(1)), int(match.group(2))
    if first < 1 or last < first:
        raise ValueError("--question-range 範圍不正確")
    return first, last


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ffprobe_duration(path: Path) -> float | None:
    executable = shutil_which("ffprobe")
    if not executable:
        return None
    try:
        result = subprocess.run(
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
    if result.returncode != 0:
        return None
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def shutil_which(name: str) -> str | None:
    import shutil

    return shutil.which(name) or shutil.which(f"{name}.exe")


# ---------------------------------------------------------------------------
# PDF / text input
# ---------------------------------------------------------------------------


def extract_input(args: argparse.Namespace) -> tuple[str, list[int]]:
    path = Path(args.pdf)
    if not path.exists():
        raise FileNotFoundError(f"找不到輸入檔：{path}")
    pages_spec = args.page or args.pages
    try:
        return pdf_tools.extract_text(path, pages_spec, args.layout)
    except RuntimeError as error:
        message = str(error)
        if "pdfplumber" in message:
            raise DependencyError(message) from error
        raise


# ---------------------------------------------------------------------------
# Answers
# ---------------------------------------------------------------------------


def parse_answer_text(text: str) -> dict[int, str]:
    answers: dict[int, str] = {}
    for line in text.splitlines():
        range_match = re.match(
            r"^\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*[:：.=]?\s*"
            r"((?:[A-O]\s*){2,})\s*$",
            line,
            re.IGNORECASE,
        )
        if range_match:
            first = int(range_match.group(1))
            last = int(range_match.group(2))
            letters = re.sub(r"\s+", "", range_match.group(3)).upper()
            if last >= first and len(letters) == last - first + 1:
                for offset, letter in enumerate(letters):
                    answers[first + offset] = letter
                continue

        for match in re.finditer(
            r"(\d{1,3})\s*[:：.=)]?\s*([A-O])\b",
            line,
            re.IGNORECASE,
        ):
            number = int(match.group(1))
            if 1 <= number <= 200:
                answers.setdefault(number, match.group(2).upper())

    return answers


def load_answers(args: argparse.Namespace) -> dict[int, str]:
    answers = parse_answer_text(args.answers or "")
    if not args.answers_file:
        return answers

    path = Path(args.answers_file)
    if not path.exists():
        raise FileNotFoundError(f"找不到答案檔：{path}")

    if path.suffix.lower() == ".pdf":
        try:
            text, _ = pdf_tools.extract_text(path, None, False)
        except RuntimeError as error:
            if "pdfplumber" in str(error):
                raise DependencyError(str(error)) from error
            raise
        answers.update(parse_answer_text(text))
    else:
        answers.update(
            parse_answer_text(path.read_text(encoding="utf-8-sig"))
        )
    return answers


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------


def is_listening_header(line: str) -> bool:
    if pdf_tools.is_header(line):
        return True
    return bool(
        re.match(
            r"^(?:Section\s+[A-C]|Questions?\s+\d+|News\s+Report|"
            r"Conversation|Passage\s+(?:One|Two|Three|Four|Five|\d+))",
            line.strip(),
            re.IGNORECASE,
        )
    )


def parse_questions(
    lines: list[str],
    answers: dict[int, str],
    first_question: int,
    last_question: int,
    diagnostics: list[core.Diagnostic],
) -> list[pdf_tools.ParsedQuestion]:
    candidates = pdf_tools.find_question_candidates(lines)
    selected: list[pdf_tools.ParsedQuestion] = []
    seen: set[int] = set()

    for index, (line_index, number, first_text) in enumerate(candidates):
        if number < first_question or number > last_question:
            continue
        if number in seen:
            add_warning(
                diagnostics,
                "W_DUPLICATE_QUESTION",
                f"第 {number} 題重複出現，已保留第一份。",
                column="stem",
            )
            continue

        next_index = (
            candidates[index + 1][0]
            if index + 1 < len(candidates)
            else len(lines)
        )
        block = lines[line_index:next_index]

        # Section headers between two questions must not be appended to the
        # previous question's last option.
        for stop_at, block_line in enumerate(block[1:], start=1):
            if is_listening_header(block_line):
                block = block[:stop_at]
                break

        # Some PDFs put the question number on its own line; use the next
        # non-option line as the stem in that case.
        if not first_text.strip():
            for candidate_line in block[1:]:
                if pdf_tools.OPTION_LINE_RE.match(candidate_line):
                    continue
                if pdf_tools.is_header(candidate_line):
                    continue
                first_text = candidate_line.strip()
                break

        warnings: list[str] = []
        parsed = pdf_tools.build_question_from_block(
            number,
            first_text,
            block,
            answers,
            warnings,
        )
        for warning in warnings:
            add_warning(
                diagnostics,
                "W_PDF_QUESTION",
                warning,
                column=f"q{number}",
            )
        selected.append(parsed)
        seen.add(number)

    if not selected:
        add_error(
            diagnostics,
            "E_NO_QUESTIONS",
            f"找不到第 {first_question}–{last_question} 題；"
            "請確認 --pdf/--pages 是否包含題目頁，或調整 --question-range。",
        )
        return []

    selected.sort(key=lambda item: item.number)
    missing = [
        number
        for number in range(first_question, last_question + 1)
        if number not in seen
    ]
    if missing:
        add_warning(
            diagnostics,
            "W_QUESTION_GAP",
            f"題號不連續，缺少：{', '.join(str(n) for n in missing)}",
        )

    return selected


# ---------------------------------------------------------------------------
# Groups
# ---------------------------------------------------------------------------


def parse_group_range(value: Any) -> tuple[int, int]:
    if isinstance(value, str):
        match = re.match(r"^\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$", value)
        if not match:
            raise ValueError(f"group questions 格式錯誤：{value}")
        return int(match.group(1)), int(match.group(2))
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return int(value[0]), int(value[1])
    raise ValueError(f"group questions 必須是 [start, end] 或 \"start-end\"：{value}")


def load_groups(path: str | None) -> list[Group]:
    if not path:
        return [Group(*item) for item in DEFAULT_GROUPS]

    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"找不到 groups 檔：{file_path}")
    data = json.loads(file_path.read_text(encoding="utf-8-sig"))
    if isinstance(data, dict) and "groups" in data:
        data = data["groups"]
    if not isinstance(data, list) or not data:
        raise ValueError("groups 檔必須是非空陣列")

    groups: list[Group] = []
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"groups 第 {index} 項必須是物件")
        key = normalize_key(str(item.get("key", f"l{index}")))
        first, last = parse_group_range(item.get("questions"))
        if first > last:
            raise ValueError(f"group {key} 的 questions 範圍錯誤")
        groups.append(
            Group(
                key=key,
                label=str(item.get("label", f"Passage {index}")),
                section=str(item.get("section", "A")),
                first=first,
                last=last,
            )
        )

    keys = [group.key for group in groups]
    if len(set(keys)) != len(keys):
        raise ValueError("groups 的 key 重複")

    ordered = sorted(groups, key=lambda group: group.first)
    for previous, current in zip(ordered, ordered[1:]):
        if current.first <= previous.last:
            raise ValueError(
                f"groups 的題號範圍重疊：{previous.key} 與 {current.key}"
            )
    return groups


def group_questions(
    questions: list[pdf_tools.ParsedQuestion],
    groups: list[Group],
    diagnostics: list[core.Diagnostic],
) -> dict[str, list[pdf_tools.ParsedQuestion]]:
    grouped: dict[str, list[pdf_tools.ParsedQuestion]] = {
        group.key: [] for group in groups
    }
    for question in questions:
        matches = [
            group
            for group in groups
            if group.first <= question.number <= group.last
        ]
        if len(matches) != 1:
            add_error(
                diagnostics,
                "E_QUESTION_GROUP",
                f"第 {question.number} 題不屬於任何 group；"
                "請用 --groups-file 調整題號範圍。",
                column=f"q{question.number}",
            )
            continue
        grouped[matches[0].key].append(question)

    for group in groups:
        if not grouped[group.key]:
            add_warning(
                diagnostics,
                "W_EMPTY_GROUP",
                f"group {group.key}（{group.label}）沒有解析到題目。",
            )
    return grouped


# ---------------------------------------------------------------------------
# SRT / transcripts
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


def read_srt_file(path: Path) -> list[Cue]:
    return parse_srt(path.read_text(encoding="utf-8-sig"))


def oversized_split(
    text: str,
    start: float,
    end: float,
    max_chars: int = 1800,
) -> list[SegmentDraft]:
    if len(text) <= max_chars:
        return [SegmentDraft(0, start, end, text)]

    words = text.split()
    if not words:
        return []
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

    total_chars = sum(max(1, len(chunk)) for chunk in chunks)
    duration = end - start
    result: list[SegmentDraft] = []
    cursor = start
    for chunk in chunks:
        share = duration * (max(1, len(chunk)) / total_chars)
        chunk_end = min(end, cursor + share)
        if chunk_end > cursor:
            result.append(SegmentDraft(0, cursor, chunk_end, chunk))
        cursor = chunk_end
    return result


def cues_to_segments(
    cues: list[Cue],
    window_start: float,
    window_end: float,
) -> list[SegmentDraft]:
    raw_segments: list[SegmentDraft] = []
    for cue in cues:
        if cue.end <= window_start or cue.start >= window_end:
            continue
        overlap = min(cue.end, window_end) - max(cue.start, window_start)
        cue_duration = cue.end - cue.start
        if overlap <= 0:
            continue
        if cue_duration > 0 and overlap < cue_duration * 0.5:
            continue
        local_start = max(0.0, cue.start - window_start)
        local_end = min(window_end, cue.end) - window_start
        if local_end - local_start < 0.05:
            continue
        raw_segments.extend(
            oversized_split(cue.text, local_start, local_end)
        )

    raw_segments.sort(key=lambda segment: segment.start)
    result: list[SegmentDraft] = []
    previous_end = 0.0
    for segment in raw_segments:
        start = max(segment.start, previous_end)
        end = max(start, segment.end)
        if end - start < 0.05:
            continue
        result.append(
            SegmentDraft(
                index=len(result),
                start=start,
                end=end,
                text=segment.text.strip(),
            )
        )
        previous_end = end
    return result


def load_srt_for_group(
    key: str,
    srt_dir: str | None,
) -> list[Cue] | None:
    if not srt_dir:
        return None
    directory = Path(srt_dir)
    if not directory.is_dir():
        return None
    for suffix in (".srt", ".vtt"):
        path = directory / f"{key}{suffix}"
        if path.exists():
            try:
                return read_srt_file(path)
            except OSError:
                return None
    return None


def load_transcript_map(path: str | None) -> dict[str, str]:
    if not path:
        return {}
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"找不到逐字稿檔：{file_path}")

    if file_path.suffix.lower() == ".json":
        data = json.loads(file_path.read_text(encoding="utf-8-sig"))
        if not isinstance(data, dict):
            raise ValueError("逐字稿 JSON 必須是 key -> text 物件")
        return {
            normalize_key(str(key)): str(value).strip()
            for key, value in data.items()
        }

    raw = file_path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    headings = list(re.finditer(r"(?m)^#{1,3}\s+(.+?)\s*$", raw))
    if not headings:
        return {"": raw.strip()}

    result: dict[str, str] = {}
    for index, heading in enumerate(headings):
        start = heading.end()
        end = (
            headings[index + 1].start()
            if index + 1 < len(headings)
            else len(raw)
        )
        key = normalize_key(heading.group(1))
        result[key] = raw[start:end].strip()
    return result


def load_transcript_dir(key: str, directory: str | None) -> str | None:
    if not directory:
        return None
    base = Path(directory)
    if not base.is_dir():
        return None
    for suffix in (".txt", ".md"):
        path = base / f"{key}{suffix}"
        if path.exists():
            try:
                return path.read_text(encoding="utf-8-sig").strip()
            except OSError:
                return None
    return None


# ---------------------------------------------------------------------------
# Audio paths / metadata
# ---------------------------------------------------------------------------


def resolve_audio_dir(args: argparse.Namespace, exam_id: str) -> tuple[Path, str]:
    audio_out = Path(args.audio_out)
    if not audio_out.is_absolute():
        audio_out = REPO_ROOT / audio_out
    audio_dir = (audio_out / exam_id).resolve()

    public_root = (REPO_ROOT / "public").resolve()
    try:
        relative = audio_dir.relative_to(public_root).as_posix()
    except ValueError:
        relative = audio_dir.as_posix()
    return audio_dir, relative


def resolve_audio_meta(
    args: argparse.Namespace,
    diagnostics: list[core.Diagnostic],
) -> tuple[float | None, str | None]:
    if not args.audio:
        return args.duration, None

    path = Path(args.audio)
    if not path.exists():
        add_error(
            diagnostics,
            "E_AUDIO_MISSING",
            f"找不到音頻檔：{path}",
            column="audio",
        )
        return args.duration, None

    duration = args.duration
    if duration is None:
        duration = ffprobe_duration(path)
        if duration is None:
            add_warning(
                diagnostics,
                "W_FFPROBE",
                "找不到 ffprobe 或無法讀取音頻長度；請用 --duration 指定。",
                column="audio",
            )
    if duration is not None and duration <= 0:
        add_warning(
            diagnostics,
            "W_AUDIO_DURATION",
            "音頻長度讀取為 0；已忽略，請用 --duration 指定。",
            column="audio",
        )
        duration = None
    try:
        checksum = sha256_file(path)
    except OSError as error:
        add_warning(
            diagnostics,
            "W_AUDIO_CHECKSUM",
            f"無法計算音頻 checksum：{error}",
            column="audio",
        )
        checksum = None
    return duration, checksum


# ---------------------------------------------------------------------------
# Question metadata
# ---------------------------------------------------------------------------


def infer_listening_type(stem: str) -> str:
    lower = stem.lower()
    if re.search(
        r"\b(infer|implies?|inferred|suggest|suggests|likely|probably)\b",
        lower,
    ):
        return "listening_inference"
    if re.search(
        r"\b(attitude|tone|feel about|think of|opinion)\b",
        lower,
    ):
        return "listening_attitude"
    if re.search(
        r"\b(main idea|mainly|purpose|title|topic|talk about)\b",
        lower,
    ):
        return "main_idea"
    return "listening_detail"


def content_words(text: str) -> set[str]:
    return {
        word
        for word in re.findall(r"[a-z']+", text.lower())
        if len(word) >= 3 and word not in STOPWORDS
    }


def pick_evidence(
    stem: str,
    options: list[dict[str, str]],
    segments: list[SegmentDraft],
) -> tuple[int | None, float]:
    if not segments:
        return None, 0.0

    query = content_words(
        stem + " " + " ".join(option["text"] for option in options)
    )
    if not query:
        return segments[0].index, 0.0

    best_index = segments[0].index
    best_score = 0.0
    for segment in segments:
        segment_words = content_words(segment.text)
        if not segment_words:
            continue
        score = len(query & segment_words) / len(query)
        if score > best_score:
            best_score = score
            best_index = segment.index
    return best_index, best_score


def normalize_options(
    options: list[dict[str, str]],
    diagnostics: list[core.Diagnostic],
    number: int,
) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for option in options:
        key = str(option.get("key", "")).strip().upper()
        text = str(option.get("text", "")).strip()
        if key not in OPTION_KEYS:
            add_error(
                diagnostics,
                "E_OPTION_KEY",
                f"第 {number} 題選項 key 不合法：{key or '(空)'}",
                column=f"q{number}",
            )
            continue
        if not text:
            add_error(
                diagnostics,
                "E_OPTION_TEXT",
                f"第 {number} 題選項 {key} 沒有文字。",
                column=f"q{number}",
            )
            continue
        if key in seen:
            add_error(
                diagnostics,
                "E_OPTION_DUP",
                f"第 {number} 題選項 key 重複：{key}",
                column=f"q{number}",
            )
            continue
        seen.add(key)
        if len(text) > 1000:
            text = text[:1000]
            add_warning(
                diagnostics,
                "W_OPTION_LONG",
                f"第 {number} 題選項 {key} 超過 1000 字，已截斷。",
                column=f"q{number}",
            )
        result.append({"key": key, "text": text})
    return result


def build_questions(
    parsed_questions: list[pdf_tools.ParsedQuestion],
    passage_id: str,
    exam_id: str,
    group_key: str,
    segments: list[SegmentDraft],
    hot_topics: list[str],
    allow_missing_segments: bool,
    diagnostics: list[core.Diagnostic],
) -> list[QuestionDraft]:
    result: list[QuestionDraft] = []

    for index, parsed in enumerate(parsed_questions, start=1):
        options = normalize_options(parsed.options, diagnostics, parsed.number)
        if len(options) < 2:
            add_error(
                diagnostics,
                "E_OPTIONS",
                f"第 {parsed.number} 題只有 {len(options)} 個選項（至少需要 2 個）。",
                column=f"q{parsed.number}",
            )

        answer = (parsed.answer or "").strip().upper()
        option_keys = {option["key"] for option in options}
        if not answer:
            add_error(
                diagnostics,
                "E_ANSWER_MISSING",
                f"第 {parsed.number} 題缺少答案；請用 --answers 或 --answers-file 提供。",
                column=f"q{parsed.number}",
            )
        elif options and answer not in option_keys:
            add_error(
                diagnostics,
                "E_ANSWER_NOT_IN_OPTIONS",
                f"第 {parsed.number} 題答案 {answer} 不在選項 {', '.join(sorted(option_keys))} 中。",
                column=f"q{parsed.number}",
            )

        qtype = infer_listening_type(parsed.stem)
        if qtype not in LISTENING_TYPES:
            qtype = "listening_detail"

        evidence_index, confidence = pick_evidence(
            parsed.stem, options, segments
        )
        if evidence_index is None:
            if allow_missing_segments:
                evidence = [{"segment": 0}]
                add_warning(
                    diagnostics,
                    "W_EVIDENCE_PLACEHOLDER",
                    f"第 {parsed.number} 題沒有 segments，evidence 使用佔位 segment 0；"
                    "逐句功能與解析引用不可用。",
                    column=f"q{parsed.number}",
                )
            else:
                add_warning(
                    diagnostics,
                    "W_EVIDENCE_MISSING",
                    f"第 {parsed.number} 題沒有 segments，無法定位 evidence；"
                    "請提供 --srt/--srt-dir，或等待 Phase B 的 Whisper。",
                    column=f"q{parsed.number}",
                )
                evidence = []
        else:
            evidence = [{"segment": evidence_index}]
            if confidence < 0.05:
                add_warning(
                    diagnostics,
                    "W_EVIDENCE_LOW_CONFIDENCE",
                    f"第 {parsed.number} 題的 evidence 自動定位信心低；請人工校對 segment {evidence_index}。",
                    column=f"q{parsed.number}",
                )

        explanation = parsed.explanation.strip()
        generated = True
        if not explanation:
            explanation = "（待補解析）"
            add_warning(
                diagnostics,
                "W_EXPLANATION_MISSING",
                f"第 {parsed.number} 題沒有解析，已填入待補解析。",
                column=f"q{parsed.number}",
            )
        elif len(explanation) > 5000:
            explanation = explanation[:5000]
            add_warning(
                diagnostics,
                "W_EXPLANATION_LONG",
                f"第 {parsed.number} 題解析超過 5000 字，已截斷。",
                column=f"q{parsed.number}",
            )

        stem = parsed.stem.strip() or f"Question {parsed.number}"
        if len(stem) > 2000:
            stem = stem[:2000]
            add_warning(
                diagnostics,
                "W_STEM_LONG",
                f"第 {parsed.number} 題題幹超過 2000 字，已截斷。",
                column=f"q{parsed.number}",
            )

        question_id = f"q_{exam_id}_{group_key}_{index:02d}"
        if not QUESTION_ID_RE.match(question_id):
            add_error(
                diagnostics,
                "E_QUESTION_ID",
                f"question id 格式錯誤：{question_id}",
                column="question_id",
            )

        error_causes = (
            ["inference"]
            if qtype in {"listening_inference", "listening_attitude"}
            else ["locating"]
        )

        result.append(
            QuestionDraft(
                id=question_id,
                number=parsed.number,
                passage_id=passage_id,
                type=qtype,
                stem=stem,
                options=options,
                answer=answer,
                explanation=explanation,
                evidence=evidence,
                knowledge_tags=[qtype],
                error_cause_tags=error_causes,
                hot_topic_tags=list(hot_topics),
                difficulty=3,
                generated=generated,
            )
        )

    return result


# ---------------------------------------------------------------------------
# Build exam
# ---------------------------------------------------------------------------


def resolve_exam_id(args: argparse.Namespace) -> tuple[str, int, int, str]:
    year = args.year
    month = args.month
    set_name = args.set_name.strip() if args.set_name else ""

    if args.exam_id:
        exam_id = args.exam_id.strip()
        if not EXAM_ID_RE.match(exam_id):
            raise ValueError(
                f"exam_id 格式錯誤：{exam_id}（應為 exam_<year>-<month>_<set>）"
            )
        match = re.match(r"^exam_(\d{4})-(\d{2})_(.+)$", exam_id)
        if match:
            if year is None:
                year = int(match.group(1))
            if month is None:
                month = int(match.group(2))
            if not set_name:
                set_name = match.group(3)
    else:
        if year is None or month is None:
            raise ValueError("需要 --exam-id，或同時提供 --year 與 --month。")
        set_name = set_name or "listening"
        exam_id = f"exam_{year}-{month:02d}_{normalize_key(set_name)}"

    if year is None or month is None:
        raise ValueError("無法從 exam_id 推斷年份/月份，請提供 --year/--month。")
    if not (2000 <= year <= 2100) or not (1 <= month <= 12):
        raise ValueError("--year/--month 超出合理範圍。")

    set_name = normalize_key(set_name or "listening")
    if len(exam_id) > 80:
        raise ValueError(f"exam_id 超過 80 字元：{exam_id}")
    if len(set_name) > 40:
        raise ValueError(f"set 名稱超過 40 字元：{set_name}")
    return exam_id, int(year), int(month), set_name


def resolve_hot_topics(args: argparse.Namespace) -> list[str]:
    allowed = load_hot_topic_ids()
    raw = args.hot_topics or "unclassified"
    topics = [
        item.strip()
        for item in re.split(r"[|,;，；]", raw)
        if item.strip()
    ]
    result: list[str] = []
    for topic in topics:
        if topic not in allowed:
            raise ValueError(
                f"未知的 hot topic：{topic}；可用值：{', '.join(sorted(allowed))}"
            )
        if topic not in result:
            result.append(topic)
    return result or ["unclassified"]


def select_segments_for_group(
    group: Group,
    span: tuple[float, float] | None,
    full_cues: list[Cue],
    args: argparse.Namespace,
    diagnostics: list[core.Diagnostic],
) -> tuple[list[SegmentDraft], float | None, float | None]:
    """Return (segments, span_start, span_end)."""
    per_group = load_srt_for_group(group.key, args.srt_dir)
    if per_group is not None:
        if span:
            add_warning(
                diagnostics,
                "W_SRT_DIR_SPAN",
                f"group {group.key} 使用 --srt-dir 的本地時間，已忽略 --spans 的位移。",
                column=group.key,
            )
        max_end = max((cue.end for cue in per_group), default=0.0)
        if max_end <= 0:
            return [], None, None
        segments = cues_to_segments(per_group, 0.0, max_end)
        return segments, 0.0, max_end

    if full_cues:
        if span is None:
            add_error(
                diagnostics,
                "E_SPAN_REQUIRED",
                f"group {group.key} 使用完整 SRT，必須提供 --spans "
                f"（例如 {group.key}=0-128）。",
                column=group.key,
            )
            return [], None, None
        segments = cues_to_segments(full_cues, span[0], span[1])
        return segments, span[0], span[1]

    if span is not None:
        return [], span[0], span[1]

    return [], None, None


def build_exam(
    args: argparse.Namespace,
    exam_id: str,
    year: int,
    month: int,
    set_name: str,
    groups: list[Group],
    grouped: dict[str, list[pdf_tools.ParsedQuestion]],
    spans: dict[str, tuple[float, float]],
    full_cues: list[Cue],
    transcript_map: dict[str, str],
    hot_topics: list[str],
    audio_duration: float | None,
    diagnostics: list[core.Diagnostic],
) -> ExamDraft:
    audio_dir, src_prefix = resolve_audio_dir(args, exam_id)
    if Path(src_prefix).is_absolute():
        add_error(
            diagnostics,
            "E_AUDIO_OUTSIDE_PUBLIC",
            f"--audio-out 必須位於 public/ 之下（目前是 {src_prefix}）；"
            "app 的 FileAudioBackend 只會用 BASE_URL 解析相對路徑。",
            column="audio_out",
        )
    passages: list[PassageDraft] = []

    active_groups = [
        group for group in groups if grouped.get(group.key)
    ]
    unkeyed_transcript = (
        transcript_map.get("") if set(transcript_map) == {""} else None
    )
    warned_unkeyed_transcript = False

    for order, group in enumerate(groups, start=1):
        parsed_questions = grouped.get(group.key, [])
        if not parsed_questions:
            continue

        span = spans.get(group.key)
        if span and audio_duration is not None and span[1] > audio_duration + 1.0:
            add_error(
                diagnostics,
                "E_SPAN_OUT_OF_RANGE",
                f"group {group.key} 的 span 結束 {span[1]:.1f}s "
                f"超過音頻長度 {audio_duration:.1f}s。",
                column=group.key,
            )

        segments, span_start, span_end = select_segments_for_group(
            group, span, full_cues, args, diagnostics
        )
        duration = (
            span_end - span_start
            if span_start is not None and span_end is not None
            else None
        )

        transcript = load_transcript_dir(group.key, args.transcript_dir)
        if transcript is None:
            transcript = transcript_map.get(group.key)
        if transcript is None and unkeyed_transcript is not None:
            if len(active_groups) == 1:
                transcript = unkeyed_transcript
            elif not warned_unkeyed_transcript:
                add_warning(
                    diagnostics,
                    "W_TRANSCRIPT_UNKEYED",
                    "逐字稿沒有 group 標題，無法分配到多個 passage；"
                    "請用 --transcript JSON 或 --transcript-dir。",
                    column="transcript",
                )
                warned_unkeyed_transcript = True
        if transcript is None:
            transcript = " ".join(segment.text for segment in segments)
        transcript = re.sub(r"\s+", " ", transcript).strip()

        if not transcript:
            add_error(
                diagnostics,
                "E_TRANSCRIPT_MISSING",
                f"group {group.key} 缺少逐字稿；請提供 --srt/--srt-dir、"
                "--transcript/--transcript-dir，或等待 Phase B 的 Whisper。",
                column=group.key,
            )
        if "```" in transcript:
            add_error(
                diagnostics,
                "E_TRANSCRIPT_FENCE",
                f"group {group.key} 的逐字稿包含 ```，會破壞 Markdown 區塊。",
                column=group.key,
            )

        word_count = core.count_words(transcript)
        if transcript and word_count == 0:
            add_error(
                diagnostics,
                "E_TRANSCRIPT_WORDS",
                f"group {group.key} 的逐字稿沒有可計數的英文單詞。",
                column=group.key,
            )

        wpm: int | None = None
        if word_count > 0 and duration and duration > 0:
            computed = round(word_count / (duration / 60))
            if 80 <= computed <= 220:
                wpm = computed
            else:
                add_warning(
                    diagnostics,
                    "W_WPM_RANGE",
                    f"group {group.key} 計算出的語速 {computed} wpm 超出 80–220，"
                    "已留空；請確認 span 與逐字稿。",
                    column=group.key,
                )

        passage_id = f"psg_{exam_id}_{group.key}"
        asset_id = f"aud_{exam_id}_{group.key}"
        if not PASSAGE_ID_RE.match(passage_id) or len(passage_id) > 80:
            add_error(
                diagnostics,
                "E_PASSAGE_ID",
                f"passage id 格式錯誤或超過 80 字元：{passage_id}",
                column="passage_id",
            )
        if not AUDIO_ID_RE.match(asset_id) or len(asset_id) > 90:
            add_error(
                diagnostics,
                "E_AUDIO_ID",
                f"asset id 格式錯誤或超過 90 字元：{asset_id}",
                column="asset_id",
            )
        if len(group.label) > 200:
            group = Group(
                key=group.key,
                label=group.label[:200],
                section=group.section,
                first=group.first,
                last=group.last,
            )
            add_warning(
                diagnostics,
                "W_LABEL_LONG",
                f"group {group.key} 標題超過 200 字，已截斷。",
                column=group.key,
            )

        questions = build_questions(
            parsed_questions,
            passage_id,
            exam_id,
            group.key,
            segments,
            hot_topics,
            args.allow_missing_segments,
            diagnostics,
        )

        asset = AssetDraft(
            id=asset_id,
            src=f"{src_prefix}/{group.key}.mp3" if src_prefix else f"{group.key}.mp3",
            expected_path=audio_dir / f"{group.key}.mp3",
            accent=args.accent,
            wpm=wpm,
            license=args.license,
            duration_sec=round(duration, 3) if duration else None,
            segments=segments,
        )

        passages.append(
            PassageDraft(
                key=group.key,
                id=passage_id,
                order=order,
                label=group.label,
                section=group.section,
                span_start=span_start,
                span_end=span_end,
                transcript=transcript,
                transcript_zh=None,
                word_count=word_count,
                wpm=wpm,
                hot_topic_tags=list(hot_topics),
                asset=asset,
                questions=questions,
            )
        )

    if not passages:
        add_error(
            diagnostics,
            "E_NO_PASSAGES",
            "沒有任何 group 解析到題目，無法建立聽力題庫。",
        )

    title = (args.exam_title or f"CET-4 聽力 {year}-{month:02d} {set_name}").strip()
    if not title:
        raise ValueError("--exam-title 不能是空白。")
    if len(title) > 200:
        title = title[:200]
        add_warning(
            diagnostics,
            "W_TITLE_LONG",
            "exam title 超過 200 字，已截斷。",
            column="exam_title",
        )

    license_value = args.license.strip()
    if not license_value:
        raise ValueError("--license 不能是空白。")
    if len(license_value) > 100:
        license_value = license_value[:100]
        add_warning(
            diagnostics,
            "W_LICENSE_LONG",
            "license 超過 100 字，已截斷。",
            column="license",
        )

    content_version = args.content_version or "1.0.0"
    if not CONTENT_VERSION_RE.match(content_version):
        raise ValueError(f"content_version 必須是 x.y.z：{content_version}")

    return ExamDraft(
        id=exam_id,
        title=title,
        year=year,
        month=month,
        set_name=set_name,
        source=args.source,
        license=license_value,
        content_version=content_version,
        passages=passages,
    )


# ---------------------------------------------------------------------------
# Readiness
# ---------------------------------------------------------------------------


def evaluate_readiness(
    exam: ExamDraft,
    args: argparse.Namespace,
    diagnostics: list[core.Diagnostic],
) -> tuple[list[core.Diagnostic], list[core.Diagnostic]]:
    blocking = [item for item in diagnostics if item.level == "error"]
    warnings = [item for item in diagnostics if item.level == "warning"]

    for passage in exam.passages:
        for question in passage.questions:
            if not question.evidence:
                blocking.append(
                    core.Diagnostic(
                        "error",
                        "E_EVIDENCE_MISSING",
                        f"{question.id} 缺少 evidence；"
                        "請提供 SRT，或使用 --allow-missing-segments 產生佔位 evidence。",
                        column=question.id,
                    )
                )
        if not passage.asset.segments and not args.allow_missing_segments:
            blocking.append(
                core.Diagnostic(
                    "error",
                    "E_SEGMENTS_MISSING",
                    f"{passage.key} 缺少 segments（逐句時間）；"
                    "請提供 SRT，或使用 --allow-missing-segments 只做預覽。",
                    column=passage.key,
                )
            )
        if passage.span_start is None:
            blocking.append(
                core.Diagnostic(
                    "error",
                    "E_SPAN_MISSING",
                    f"{passage.key} 缺少 passage span；"
                    "請用 --spans 指定，或使用 --srt-dir 提供本地時間。",
                    column=passage.key,
                )
            )
        if not args.allow_missing_audio and not passage.asset.expected_path.exists():
            blocking.append(
                core.Diagnostic(
                    "error",
                    "E_AUDIO_FILE_MISSING",
                    f"{passage.key} 的 MP3 不存在：{passage.asset.expected_path}；"
                    "Phase B 會用 ffmpeg 切段，或使用 --allow-missing-audio 只做預覽。",
                    column=passage.key,
                )
            )

    if args.strict:
        blocking.extend(warnings)
        warnings = []

    return dedupe_diagnostics(blocking), dedupe_diagnostics(warnings)


def dedupe_diagnostics(
    diagnostics: list[core.Diagnostic],
) -> list[core.Diagnostic]:
    seen: set[tuple[str, str, str | None]] = set()
    result: list[core.Diagnostic] = []
    for item in diagnostics:
        key = (item.level, item.code, item.message)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


# ---------------------------------------------------------------------------
# Draft / report
# ---------------------------------------------------------------------------


def segment_to_dict(segment: SegmentDraft) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "index": segment.index,
        "start": round(segment.start, 3),
        "end": round(segment.end, 3),
        "text": segment.text,
    }
    if segment.text_zh:
        payload["textZh"] = segment.text_zh
    return payload


def passage_to_dict(passage: PassageDraft) -> dict[str, Any]:
    return {
        "key": passage.key,
        "id": passage.id,
        "order": passage.order,
        "label": passage.label,
        "section": passage.section,
        "span": (
            {
                "start": round(passage.span_start, 3),
                "end": round(passage.span_end, 3),
            }
            if passage.span_start is not None and passage.span_end is not None
            else None
        ),
        "transcript": passage.transcript,
        "word_count": passage.word_count,
        "wpm": passage.wpm,
        "hot_topic_tags": passage.hot_topic_tags,
        "audio": {
            "asset_id": passage.asset.id,
            "src": passage.asset.src,
            "expected_path": str(passage.asset.expected_path),
            "duration_sec": passage.asset.duration_sec,
            "segments": [
                segment_to_dict(segment)
                for segment in passage.asset.segments
            ],
        },
        "questions": [question.as_dict() for question in passage.questions],
        "warnings": passage.warnings,
    }


def build_draft(
    exam: ExamDraft,
    args: argparse.Namespace,
    pages: list[int],
    audio_duration: float | None,
    audio_checksum: str | None,
    blocking: list[core.Diagnostic],
    warnings: list[core.Diagnostic],
) -> dict[str, Any]:
    return {
        "phase": "A",
        "source": {
            "pdf": str(Path(args.pdf)),
            "pages": pages,
            "audio": str(Path(args.audio)) if args.audio else None,
            "srt": args.srt,
            "srt_dir": args.srt_dir,
            "transcript": args.transcript,
            "transcript_dir": args.transcript_dir,
            "answers": args.answers,
            "answers_file": args.answers_file,
        },
        "exam": {
            "id": exam.id,
            "title": exam.title,
            "year": exam.year,
            "month": exam.month,
            "set": exam.set_name,
            "source": exam.source,
            "license": exam.license,
            "content_version": exam.content_version,
            "sections": ["listening"],
        },
        "audio": {
            "duration_sec": round(audio_duration, 3)
            if audio_duration is not None
            else None,
            "sha256": audio_checksum,
            "expected_files": [
                str(passage.asset.expected_path)
                for passage in exam.passages
            ],
        },
        "passages": [passage_to_dict(passage) for passage in exam.passages],
        "readiness": {
            "can_commit": not blocking,
            "blocking_count": len(blocking),
            "warning_count": len(warnings),
            "blocking": [item.as_dict() for item in blocking],
            "warnings": [item.as_dict() for item in warnings],
        },
        "diagnostics": [item.as_dict() for item in (*blocking, *warnings)],
    }


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(
        prefix=path.name + ".",
        suffix=".tmp",
        dir=str(path.parent),
        text=True,
    )
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as temp:
            temp.write(json.dumps(payload, ensure_ascii=False, indent=2))
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def draft_path(args: argparse.Namespace, exam: ExamDraft) -> Path:
    if args.draft:
        path = Path(args.draft)
        if not path.is_absolute():
            path = REPO_ROOT / path
        return path
    return DEFAULT_DRAFT_DIR / f"{exam.id}.draft.json"


def print_passage_table(exam: ExamDraft) -> None:
    print("Passages:")
    for passage in exam.passages:
        span = (
            f"{format_clock(passage.span_start)}–{format_clock(passage.span_end)}"
            if passage.span_start is not None
            and passage.span_end is not None
            else "未指定"
        )
        print(
            f"  {passage.key:<4} {passage.label:<18} {span:<18} "
            f"{len(passage.questions):>2} 題  "
            f"{passage.word_count:>4} 詞  "
            f"{len(passage.asset.segments):>3} 句"
        )


def format_clock(seconds: float | None) -> str:
    if seconds is None:
        return "-"
    total = int(round(seconds))
    return f"{total // 60}:{total % 60:02d}"


def print_report(
    exam: ExamDraft,
    draft: dict[str, Any],
    draft_file: Path,
    output_file: Path | None,
    args: argparse.Namespace,
) -> None:
    readiness = draft["readiness"]
    print("Listening import draft")
    print(f"  Exam: {exam.id} — {exam.title}")
    print(f"  Questions: {sum(len(p.questions) for p in exam.passages)}")
    print(f"  Passages: {len(exam.passages)}")
    audio = draft["audio"]
    if audio.get("duration_sec") is not None:
        checksum = audio.get("sha256")
        suffix = f" (sha256 {checksum[:12]}…)" if checksum else ""
        print(f"  Audio: {audio['duration_sec']:.1f}s{suffix}")
    else:
        print("  Audio: 未提供或無法讀取長度")
    print_passage_table(exam)
    print(f"  Draft: {draft_file}")

    if readiness["blocking"]:
        print(f"Blocking ({len(readiness['blocking'])}):")
        for item in readiness["blocking"]:
            print(f"  - [{item['code']}] {item['message']}")
    if readiness["warnings"]:
        print(f"Warnings ({len(readiness['warnings'])}):")
        for item in readiness["warnings"]:
            print(f"  - [{item['code']}] {item['message']}")

    if output_file:
        print(f"  Markdown: {output_file}")
    else:
        print("No app content written. Review the draft, then re-run with --commit.")

    if readiness["can_commit"]:
        print("Readiness: ready to commit.")
    else:
        print("Readiness: NOT ready to commit; fix the blocking items first.")


def write_report(
    args: argparse.Namespace,
    draft: dict[str, Any],
) -> None:
    if not args.report:
        return
    payload = {
        "summary": {
            "exam_id": draft["exam"]["id"],
            "questions": sum(
                len(passage["questions"])
                for passage in draft["passages"]
            ),
            "passages": len(draft["passages"]),
            "can_commit": draft["readiness"]["can_commit"],
            "blocking": draft["readiness"]["blocking_count"],
            "warnings": draft["readiness"]["warning_count"],
        },
        "diagnostics": draft["diagnostics"],
    }
    if args.report == "-":
        if args.report_format == "json":
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print_human_report(payload)
        return

    path = Path(args.report)
    path.parent.mkdir(parents=True, exist_ok=True)
    if args.report_format == "json":
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
            newline="\n",
        )
    else:
        path.write_text(
            human_report_text(payload),
            encoding="utf-8",
            newline="\n",
        )


def human_report_text(payload: dict[str, Any]) -> str:
    summary = payload["summary"]
    lines = [
        f"exam: {summary['exam_id']}",
        f"questions: {summary['questions']}",
        f"passages: {summary['passages']}",
        f"can_commit: {summary['can_commit']}",
    ]
    for item in payload["diagnostics"]:
        lines.append(
            f"[{item['level']}] {item['code']}: {item['message']}"
        )
    return "\n".join(lines) + "\n"


def print_human_report(payload: dict[str, Any]) -> None:
    print(human_report_text(payload), end="")


# ---------------------------------------------------------------------------
# Render exam.md
# ---------------------------------------------------------------------------


def render_exam(exam: ExamDraft, schema_version: str) -> str:
    lines: list[str] = [
        "---",
        f"schema_version: {yaml_str(schema_version)}",
        "exam:",
        f"  id: {yaml_str(exam.id)}",
        f"  title: {yaml_str(exam.title)}",
        f"  year: {exam.year}",
        f"  month: {exam.month}",
        f"  set: {yaml_str(exam.set_name)}",
        f"  source: {yaml_str(exam.source)}",
        f"  license: {yaml_str(exam.license)}",
        f"  content_version: {yaml_str(exam.content_version)}",
        '  sections: ["listening"]',
        "assets:",
    ]

    for passage in exam.passages:
        asset = passage.asset
        lines.append(f"  - id: {yaml_str(asset.id)}")
        lines.append('    kind: "audio"')
        lines.append('    backend: "local"')
        lines.append(f"    src: {yaml_str(asset.src)}")
        lines.append(
            f"    accent: {yaml_str(asset.accent) if asset.accent else 'null'}"
        )
        lines.append(f"    wpm: {asset.wpm if asset.wpm is not None else 'null'}")
        lines.append("    synthetic: false")
        lines.append(f"    license: {yaml_str(asset.license)}")
        if asset.duration_sec is not None:
            lines.append(f"    duration_sec: {fmt_num(asset.duration_sec)}")
        if asset.segments:
            lines.append("    segments:")
            for segment in asset.segments:
                lines.append(f"      - index: {segment.index}")
                lines.append(f"        start: {fmt_num(segment.start)}")
                lines.append(f"        end: {fmt_num(segment.end)}")
                lines.append(f"        text: {yaml_str(segment.text)}")
                if segment.text_zh:
                    lines.append(
                        f"        textZh: {yaml_str(segment.text_zh)}"
                    )
        else:
            lines.append("    segments: []")

    lines.extend(["---", ""])

    for passage in exam.passages:
        lines.append(f"## {passage.label}")
        lines.append("")
        lines.append("```yaml passage")
        lines.append(f"id: {yaml_str(passage.id)}")
        lines.append('section: "listening"')
        lines.append(f"order: {passage.order}")
        lines.append(f"title: {yaml_str(passage.label)}")
        lines.append(
            "hot_topic_tags: ["
            + ", ".join(yaml_str(topic) for topic in passage.hot_topic_tags)
            + "]"
        )
        lines.append(f"word_count: {passage.word_count}")
        lines.append(f"audio_asset_id: {yaml_str(passage.asset.id)}")
        lines.append(
            f"accent: {yaml_str(passage.asset.accent) if passage.asset.accent else 'null'}"
        )
        lines.append(
            f"wpm: {passage.asset.wpm if passage.asset.wpm is not None else 'null'}"
        )
        lines.append("transcript: |")
        transcript_lines = passage.transcript.replace("\r\n", "\n").replace(
            "\r", "\n"
        ).split("\n")
        for line in transcript_lines:
            lines.append(("  " + line).rstrip() if line.strip() else "")
        lines.append("```")
        lines.append("")
        lines.append("```json questions")
        lines.append(
            json.dumps(
                [question.as_dict() for question in passage.questions],
                ensure_ascii=False,
                indent=2,
            )
        )
        lines.append("```")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def validate_renderable(exam: ExamDraft) -> list[core.Diagnostic]:
    diagnostics: list[core.Diagnostic] = []
    for passage in exam.passages:
        blob = json.dumps(
            [question.as_dict() for question in passage.questions],
            ensure_ascii=False,
        )
        if "```" in blob:
            add_error(
                diagnostics,
                "E_RENDER_FENCE",
                f"{passage.key} 的題目內容包含 ```，會破壞 JSON 區塊。",
            )
    return diagnostics


def write_exam(
    exam: ExamDraft,
    args: argparse.Namespace,
    diagnostics: list[core.Diagnostic],
) -> str | None:
    out_dir = Path(args.out)
    if not out_dir.is_absolute():
        out_dir = REPO_ROOT / out_dir
    target = out_dir / exam.id / "exam.md"

    if target.exists() and not args.force:
        add_error(
            diagnostics,
            "E_OUTPUT_EXISTS",
            f"輸出檔已存在：{target}（使用 --force 覆蓋）",
            column=str(target),
        )
        return None

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and args.force:
        backup = target.with_name(target.name + ".bak")
        backup.write_bytes(target.read_bytes())

    content = render_exam(exam, args.schema_version)
    handle, temp_name = tempfile.mkstemp(
        prefix=target.name + ".",
        suffix=".tmp",
        dir=str(target.parent),
        text=True,
    )
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as temp:
            temp.write(content)
        os.replace(temp_name, target)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise

    return str(target)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Phase A: import CET-4 listening questions from PDF/text into a "
            "reviewable draft and optionally exam.md."
        )
    )
    parser.add_argument("--pdf", "--input", dest="pdf", default=None,
                        help="題目 PDF 或 .txt/.md")
    parser.add_argument("--page", default=None, help="單頁，例如 3")
    parser.add_argument("--pages", default=None, help="頁碼範圍，例如 2-4,6")
    parser.add_argument("--layout", action="store_true", help="pdfplumber layout=True")
    parser.add_argument("--dump-text", default=None, help="把抽取文字寫到檔案")

    parser.add_argument("--audio", default=None, help="完整聽力 MP3（Phase A 只讀長度/checksum）")
    parser.add_argument("--duration", type=float, default=None, help="音頻長度（秒），沒有 ffprobe 時使用")
    parser.add_argument("--split-audio", action="store_true",
                        help="Phase B：用 ffmpeg 依 --spans 切成每段 MP3")
    parser.add_argument("--transcribe", action="store_true",
                        help="Phase B：用本地 Whisper 為每段 MP3 產生 SRT")
    parser.add_argument("--prepare-media", action="store_true",
                        help="等同 --split-audio --transcribe")
    parser.add_argument("--asr-engine",
                        choices=["auto", "faster-whisper", "openai-whisper", "whisper-cpp"],
                        default="auto", help="本地 Whisper 引擎（預設 auto）")
    parser.add_argument("--whisper-model", default="small.en",
                        help="Whisper 模型；whisper-cpp 時請給 .bin 路徑")
    parser.add_argument("--whisper-device", default="auto",
                        help="faster-whisper/openai-whisper device：auto/cpu/cuda")
    parser.add_argument("--whisper-compute-type", default="auto",
                        help="faster-whisper compute_type：auto/int8/float16/float32")
    parser.add_argument("--whisper-cpp-binary", default=None,
                        help="whisper.cpp 執行檔（預設自動找 whisper-cli/whisper/main）")
    parser.add_argument("--ffmpeg-path", default=None,
                        help="ffmpeg 執行檔路徑（預設從 PATH 找）")
    parser.add_argument("--language", default="en", help="ASR 語言（預設 en）")
    parser.add_argument("--beam-size", type=int, default=5, help="Whisper beam size（1–10）")
    parser.add_argument("--vad-filter", action=argparse.BooleanOptionalAction,
                        default=True, help="faster-whisper 是否使用 VAD")
    parser.add_argument("--max-cue-chars", type=int, default=500,
                        help="單句字幕最大字元數；過長會再切（預設 500）")
    parser.add_argument("--audio-quality", default="2",
                        help="ffmpeg libmp3lame -q:a（0–9，預設 2）")
    parser.add_argument("--srt-out", default=None,
                        help="Whisper SRT 輸出根目錄（預設 content/imports/private/srt/<exam_id>）")
    parser.add_argument("--force-audio", action="store_true",
                        help="覆寫已存在的切段 MP3")
    parser.add_argument("--force-srt", action="store_true",
                        help="覆寫已存在的 Whisper SRT")
    parser.add_argument("--check-deps", action="store_true",
                        help="檢查 ffmpeg/ffprobe/Whisper 後結束")
    parser.add_argument("--srt", default=None, help="完整聽力的 SRT；需搭配 --spans")
    parser.add_argument("--srt-dir", default=None, help="每段一個 <key>.srt；時間為該段本地時間")
    parser.add_argument("--transcript", default=None, help="逐字稿 JSON（key -> text）或含 ## key 的 .txt/.md")
    parser.add_argument("--transcript-dir", default=None, help="每段一個 <key>.txt")
    parser.add_argument("--spans", default=None, help='段落時間，例如 "l1=0-128,l2=128-245"')

    parser.add_argument("--answers", default=None, help='內聯答案，例如 "1:B,2:C" 或 "1-5 BCDAB"')
    parser.add_argument("--answers-file", default=None, help="獨立答案檔（txt/md/pdf）")
    parser.add_argument("--groups-file", default=None, help="自訂 listening groups JSON")
    parser.add_argument("--list-groups", action="store_true", help="列出預設 groups 後結束")
    parser.add_argument("--question-range", default="1-25", help="要匯入的題號範圍，預設 1-25")

    parser.add_argument("--exam-id", default=None)
    parser.add_argument("--exam-title", default=None)
    parser.add_argument("--year", type=int, default=None)
    parser.add_argument("--month", type=int, default=None)
    parser.add_argument("--set", dest="set_name", default=None)
    parser.add_argument("--source", choices=sorted(SOURCES), default="user-entered")
    parser.add_argument("--license", default="private")
    parser.add_argument("--content-version", default="1.0.0")
    parser.add_argument("--schema-version", choices=["1.0", "1.1"], default="1.1")
    parser.add_argument("--accent", choices=sorted(ACCENTS), default=None)
    parser.add_argument("--hot-topics", default="unclassified",
                        help="逗號分隔的 hot topic id；預設 unclassified")

    parser.add_argument("--out", default=str(DEFAULT_OUT),
                        help="exam.md 輸出根目錄（預設 content/exams/private）")
    parser.add_argument("--audio-out", default=str(DEFAULT_AUDIO_OUT),
                        help="每段 MP3 輸出根目錄（預設 public/audio/private）")
    parser.add_argument("--draft", default=None, help="draft JSON 路徑")
    parser.add_argument("--commit", action="store_true", help="寫入 exam.md")
    parser.add_argument("--dry-run", action="store_true", help="只寫 draft，不寫 exam.md")
    parser.add_argument("--force", action="store_true", help="覆蓋既有 exam.md（備份 .bak）")
    parser.add_argument("--allow-missing-audio", action="store_true",
                        help="允許 MP3 尚未切好時預覽 Markdown")
    parser.add_argument("--allow-missing-segments", action="store_true",
                        help="允許沒有 segments（逐句功能受限）")
    parser.add_argument(
        "--validate",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="commit 後執行 npm run content:validate",
    )
    parser.add_argument("--strict", action="store_true", help="warnings 也視為 blocking")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--report", default=None, help="報告輸出路徑，- 表示 stdout")
    parser.add_argument("--report-format", choices=["text", "json"], default="text")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    split_audio = bool(args.split_audio or args.prepare_media)
    transcribe = bool(args.transcribe or args.prepare_media)

    if args.list_groups:
        try:
            groups = load_groups(args.groups_file)
        except (FileNotFoundError, ValueError, json.JSONDecodeError) as error:
            print(f"Error: {error}", file=sys.stderr)
            return 2
        for group in groups:
            print(
                f"{group.key}\t{group.section}\t{group.first}-{group.last}\t{group.label}"
            )
        return 0

    if args.check_deps:
        report = media.dependency_report(
            args.asr_engine,
            args.whisper_model,
            args.whisper_cpp_binary,
        )
        media.print_dependency_report(report)
        return 0 if report["ok"] else 1

    try:
        quality = int(args.audio_quality)
    except ValueError:
        print("Error: --audio-quality 必須是 0–9。", file=sys.stderr)
        return 2
    if not 0 <= quality <= 9:
        print("Error: --audio-quality 必須是 0–9。", file=sys.stderr)
        return 2
    if args.max_cue_chars < 50:
        print("Error: --max-cue-chars 至少 50。", file=sys.stderr)
        return 2
    if not 1 <= args.beam_size <= 10:
        print("Error: --beam-size 必須是 1–10。", file=sys.stderr)
        return 2
    if split_audio and not args.audio:
        print("Error: --split-audio 需要 --audio（完整 MP3）。", file=sys.stderr)
        return 2

    if not args.pdf:
        print("Error: 需要 --pdf（或 --input）。", file=sys.stderr)
        return 2

    try:
        first_question, last_question = parse_question_range(args.question_range)
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    diagnostics: list[core.Diagnostic] = []
    try:
        text, pages = extract_input(args)
    except DependencyError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 4
    except FileNotFoundError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2
    except Exception as error:  # noqa: BLE001
        print(f"Error: 無法讀取題目檔：{error}", file=sys.stderr)
        return 2

    if args.dump_text:
        dump = Path(args.dump_text)
        dump.parent.mkdir(parents=True, exist_ok=True)
        dump.write_text(text, encoding="utf-8", newline="\n")
        print(f"Extracted text written to {dump}")

    lines = pdf_tools.clean_lines(text)

    try:
        answers = load_answers(args)
    except DependencyError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 4
    except (FileNotFoundError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    questions = parse_questions(
        lines, answers, first_question, last_question, diagnostics
    )

    try:
        groups = load_groups(args.groups_file)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    grouped = group_questions(questions, groups, diagnostics)

    try:
        spans = parse_spans(args.spans)
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    group_keys = {group.key for group in groups}
    for unknown_key in sorted(set(spans) - group_keys):
        add_warning(
            diagnostics,
            "W_UNKNOWN_SPAN",
            f"--spans 的 key {unknown_key} 不屬於任何 group，已忽略。",
            column="spans",
        )

    full_cues: list[Cue] = []
    if args.srt and not transcribe:
        srt_path = Path(args.srt)
        if not srt_path.exists():
            print(f"Error: 找不到 SRT：{srt_path}", file=sys.stderr)
            return 2
        full_cues = read_srt_file(srt_path)

    try:
        transcript_map = load_transcript_map(args.transcript)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    audio_duration, audio_checksum = resolve_audio_meta(args, diagnostics)

    try:
        hot_topics = resolve_hot_topics(args)
        exam_id, year, month, set_name = resolve_exam_id(args)
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    if split_audio or transcribe:
        audio_dir, src_prefix = resolve_audio_dir(args, exam_id)
        if Path(src_prefix).is_absolute():
            print(
                "Error: --audio-out 必須位於 public/ 之下，"
                "app 才能用 BASE_URL 解析音頻路徑。",
                file=sys.stderr,
            )
            return 2
        if args.srt_out:
            srt_out = Path(args.srt_out)
            if not srt_out.is_absolute():
                srt_out = REPO_ROOT / srt_out
        else:
            srt_out = DEFAULT_SRT_DIR / exam_id
        active_keys = [
            group.key for group in groups if grouped.get(group.key)
        ]
        if not active_keys:
            add_warning(
                diagnostics,
                "W_NO_MEDIA_KEYS",
                "沒有解析到任何題目，已跳過 Phase B 切段／轉錄。",
                column="question_range",
            )
        else:
            try:
                media_result = media.prepare_media(
                    source=Path(args.audio) if args.audio else None,
                    audio_dir=audio_dir,
                    srt_dir=srt_out,
                    keys=active_keys,
                    spans=spans,
                    split=split_audio,
                    transcribe=transcribe,
                    source_checksum=audio_checksum,
                    source_duration=audio_duration,
                    force_audio=args.force_audio,
                    force_srt=args.force_srt,
                    quality=str(quality),
                    engine=args.asr_engine,
                    model=args.whisper_model,
                    device=args.whisper_device,
                    compute_type=args.whisper_compute_type,
                    language=args.language,
                    beam_size=args.beam_size,
                    vad_filter=args.vad_filter,
                    max_cue_chars=args.max_cue_chars,
                    whisper_cpp_binary=args.whisper_cpp_binary,
                    ffmpeg=args.ffmpeg_path,
                    log=(lambda _: None) if args.quiet else media.default_log,
                )
            except media.MediaDependencyError as error:
                print(f"Error: {error}", file=sys.stderr)
                return 4
            except media.MediaError as error:
                print(f"Error: {error}", file=sys.stderr)
                return 1

            if transcribe:
                if args.srt:
                    add_warning(
                        diagnostics,
                        "W_ASR_OVERRIDES_SRT",
                        "已指定 --transcribe，將使用 Whisper 產生的 SRT；--srt 已忽略。",
                        column="srt",
                    )
                if args.srt_dir:
                    add_warning(
                        diagnostics,
                        "W_ASR_OVERRIDES_SRT_DIR",
                        "已指定 --transcribe，將使用 --srt-out 的 SRT；--srt-dir 已忽略。",
                        column="srt_dir",
                    )
                args.srt_dir = str(srt_out)
                full_cues = []
            if not args.quiet:
                print(
                    f"Phase B: {len(media_result.split)} audio clips, "
                    f"{len(media_result.transcriptions)} transcripts"
                )

    try:
        exam = build_exam(
            args,
            exam_id,
            year,
            month,
            set_name,
            groups,
            grouped,
            spans,
            full_cues,
            transcript_map,
            hot_topics,
            audio_duration,
            diagnostics,
        )
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    diagnostics.extend(validate_renderable(exam))
    blocking, warnings = evaluate_readiness(exam, args, diagnostics)
    draft = build_draft(
        exam,
        args,
        pages,
        audio_duration,
        audio_checksum,
        blocking,
        warnings,
    )

    draft_file = draft_path(args, exam)
    try:
        write_json_atomic(draft_file, draft)
    except OSError as error:
        print(f"Error: 無法寫入 draft：{error}", file=sys.stderr)
        return 1

    output_file: Path | None = None
    if args.commit and not args.dry_run:
        if blocking:
            if not args.quiet:
                print_report(exam, draft, draft_file, None, args)
            print(
                f"Error: {len(blocking)} 個 blocking 問題，未寫入 exam.md。",
                file=sys.stderr,
            )
            return 1

        try:
            output = write_exam(exam, args, diagnostics)
        except OSError as error:
            print(f"Error: 無法寫入 exam.md：{error}", file=sys.stderr)
            return 1
        if output is None:
            for item in diagnostics:
                if item.level == "error":
                    print(f"Error: [{item.code}] {item.message}", file=sys.stderr)
            if not args.quiet:
                print_report(exam, draft, draft_file, None, args)
            return 3
        output_file = Path(output)

    if not args.quiet:
        print_report(exam, draft, draft_file, output_file, args)
    write_report(args, draft)

    if args.commit and not args.dry_run and output_file is not None:
        if args.validate:
            return core.run_node_validation()
        return 0

    if args.strict and blocking:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
