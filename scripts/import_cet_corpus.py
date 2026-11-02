#!/usr/bin/env python3
"""Build CET-Lab exam.md files from local question text + OCR text.

This script is a corpus-specific companion to ``import_exam_pdfs.py``. It
reuses that script's parsing helpers but adds:

- separate question text / OCR answer text / OCR transcript text inputs;
- CET-4 vs CET-6 exam ids and listening groups;
- answer extraction from ``答案详解`` prose (e.g. "故选项 A 为正确答案");
- transcript extraction from OCR pages (``听力原文`` sections);
- a manifest-driven batch mode.

It never fetches content from the network. OCR must already have been run
with ``scripts/ocr_pdf_pages.py``.

Example:
  python -I scripts/import_cet_corpus.py \
    --manifest content/imports/cet-corpus/manifest.json --dry-run
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any

import pymupdf

try:
    import wordninja
except ImportError:  # pragma: no cover - optional but recommended
    wordninja = None

ROOT = Path(__file__).resolve().parent.parent
CORE_PATH = Path(__file__).with_name("import_exam_pdfs.py")

_spec = importlib.util.spec_from_file_location("cetlab_import_core", CORE_PATH)
if _spec is None or _spec.loader is None:  # pragma: no cover
    raise SystemExit(f"无法加载 {CORE_PATH}")
core = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = core
_spec.loader.exec_module(core)

CET4_GROUPS = [
    ("News Report One", 1, 2),
    ("News Report Two", 3, 4),
    ("News Report Three", 5, 7),
    ("Conversation One", 8, 11),
    ("Conversation Two", 12, 15),
    ("Passage One", 16, 18),
    ("Passage Two", 19, 21),
    ("Passage Three", 22, 25),
]

CET6_GROUPS = [
    ("Conversation One", 1, 4),
    ("Conversation Two", 5, 8),
    ("Passage One", 9, 11),
    ("Passage Two", 12, 15),
    ("Recording One", 16, 18),
    ("Recording Two", 19, 21),
    ("Recording Three", 22, 25),
]

ANSWER_PATTERNS = [
    r"故选项\s*([A-O])\s*为正确答案",
    r"选项\s*([A-O])\s*为正确答案",
    r"([A-O])\s*为正确答案",
    r"故答案为\s*([A-O])",
    r"答案为\s*([A-O])",
    r"答案解析\s*([A-O])",
    r"选项\s*([A-O])\s*(?:与原文意思一致|与文章内容一致|与原文一致|符合原文|正确)",
    r"([A-O])\s*选项\s*(?:与原文意思一致|与文章内容一致|与原文一致|符合原文|正确)",
    r"([A-O])\s*项\s*(?:与原文意思一致|与文章内容一致|与原文一致|符合原文|正确)",
    r"选项\s*([A-O])\s*的?内容[^。]{0,20}(?:同义转述|为答案)",
    r"([A-O])\s*选项[^。]{0,30}(?:同义转述|为答案)",
    r"([A-O])\s*项[^。]{0,30}(?:同义转述|准确概括|为答案)",
    r"选项\s*([A-O])[^。]{0,60}为正确答案",
    r"([A-O])\s*项[^。]{0,60}为正确答案",
    r"选项\s*([A-O])[^。]{0,40}为正确选项",
    r"([A-O])\s*项[^。]{0,40}为正确选项",
    r"([A-O])\s*项是对原文内容的概括",
    r"([A-O])\s*项与原文(?:表述)?相符",
    r"([A-O])\s*项表述与原文相符",
    r"([A-O])\s*项\s*为正确答案",
    r"选\s*([A-O])\s*项",
    r"故选\s*([A-O])",
    r"应选\s*([A-O])",
    r"正确选项(?:是|为)\s*([A-O])",
    r"正确答案(?:是|为)\s*([A-O])",
    r"答案(?:是|为)\s*([A-O])",
    r"【答案】\s*([A-O])",
]


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    # Common OCR substitutions for Part headings.
    text = text.replace("Ⅲ", "III").replace("Ⅱ", "II").replace("Ⅰ", "I")
    text = re.sub(r"(?im)^\s*Part\s*IIII\b", "Part III", text)
    text = re.sub(r"(?im)^\s*Part\s*(I{1,3}|IV|V|[1-4])\b", r"Part \1", text)
    text = re.sub(r"(?im)^\s*Part\s+(in|ID|HI|H1|Hl|IIl)\s*$", "Part III", text)
    text = re.sub(r"(?im)^\s*Part\s+n\s*$", "Part II", text)
    text = re.sub(
        r"(?im)^\s*Part\s*(?:I|II|1|2)\s+(Reading\s+Comprehension)",
        r"Part III \1",
        text,
    )
    text = re.sub(r"(?im)^\s*Section\s*([A-C])\b", r"Section \1", text)
    text = re.sub(r"(?m)^\s*\[\s*1[lI]\s*", "[J]", text)
    text = re.sub(r"(?m)^\s*\[\s*1\s*\]\s*(?=[A-Z])", "[I] ", text)
    text = re.sub(r"(?i)Passage\s*(One|Two|Three)", r"Passage \1", text)
    text = re.sub(
        r"(?i)Questions\s*(\d+)\s*to\s*(\d+)\s*are\s*based",
        r"Questions \1 to \2 are based",
        text,
    )
    # Word banks occasionally print option O as a zero: "0) speculate".
    text = re.sub(r"(?m)^(\s*)0([).])\s*(?=[A-Za-z])", r"\1O\2 ", text)
    return text


def _parse_ranges(text: str, answers: dict[int, str]) -> None:
    for match in re.finditer(
        r"(\d{1,2})\s*[-–—~]\s*(\d{1,2})\s*[:：]?\s*"
        r"([A-O](?:\s*[;；,，]?\s*[A-O])*)",
        text,
    ):
        start, end = int(match.group(1)), int(match.group(2))
        letters = re.findall(r"[A-O]", match.group(3))
        for offset, letter in enumerate(letters):
            number = start + offset
            if number <= end:
                answers.setdefault(number, letter)


def clean_answer_ocr(text: str) -> str:
    """Remove OCR sidebar labels that get inserted mid-sentence.

    The explanation pages put a vertical "解析" label beside each answer. OCR
    flattens it into the sentence, producing text such as
    "选项C与文章析内容一致". Remove those standalone labels first.
    """
    text = re.sub(r"(?m)^\s*=+\s*PAGE\s*\d+\s*=+\s*$", "", text)
    text = re.sub(r"(?m)^\s*解\s*析\s*[→}】]?\s*", "", text)
    text = re.sub(r"(?m)^\s*解\s*[→}】]?\s*", "", text)
    text = re.sub(r"(?m)^\s*析\s*$", "", text)
    text = re.sub(
        r"(?m)^\s*(?:定位|概览|全文翻译|难词译注|答案详解)\s*$", "", text
    )
    return text


def parse_answer_key(text: str) -> dict[int, str]:
    """Extract answer letters from a text-layer or OCR answer section.

    Explicit answer keys/ranges win. Prose explanations fill in the gaps.
    """
    text = clean_answer_ocr(text)
    answers: dict[int, str] = dict(core.parse_answers(text))
    _parse_ranges(text, answers)

    # Banked-cloze explanations often look like "32.I readily" or "33.N) specific".
    for match in re.finditer(
        r"(?m)^\s*(2[6-9]|3[0-5])\s*[.、．]\s*([A-O])\s*[)）]?\s*[A-Za-z]",
        text,
    ):
        answers.setdefault(int(match.group(1)), match.group(2))

    marker = re.compile(r"(?m)^\s*(\d{1,2})\s*[.、．]\s*")
    chinese_marker = re.compile(r"(?m)^\s*(\d{1,2})\s*(?=[一-鿿])")
    matches: list[re.Match[str]] = list(marker.finditer(text))
    for match in chinese_marker.finditer(text):
        number = int(match.group(1))
        if not (1 <= number <= 55):
            continue
        line = text[match.start(): text.find("\n", match.start())]
        if re.search(r"(?:四级|六级|第\s*\d+\s*套|页)", line):
            continue
        matches.append(match)
    matches.sort(key=lambda item: item.start())
    deduped: list[re.Match[str]] = []
    seen_starts: set[int] = set()
    for match in matches:
        if match.start() in seen_starts:
            continue
        seen_starts.add(match.start())
        deduped.append(match)

    for index, match in enumerate(deduped):
        number = int(match.group(1))
        if not (1 <= number <= 55):
            continue
        end = deduped[index + 1].start() if index + 1 < len(deduped) else len(text)
        block = text[match.end():end]
        if not re.search(r"[一-鿿]", block):
            continue
        flat = re.sub(r"\s+", "", block)
        best: str | None = None
        best_position = len(flat) + 1
        for pattern in ANSWER_PATTERNS:
            hit = re.search(pattern, flat)
            if hit and hit.start() < best_position:
                best_position = hit.start()
                best = hit.group(1)
        if best:
            answers.setdefault(number, best)
    return answers


def _heading_pattern(title: str) -> re.Pattern[str]:
    words = [re.escape(word) for word in title.split()]
    return re.compile(r"(?im)^\s*" + r"\s*".join(words) + r"\s*$")


_VOCAB: set[str] | None = None


def _dictionary_vocab() -> set[str]:
    global _VOCAB
    if _VOCAB is not None:
        return _VOCAB
    words: set[str] = set()
    dictionary = ROOT / "public" / "dictionary" / "cet4.json"
    if dictionary.exists():
        try:
            payload = json.loads(dictionary.read_text(encoding="utf-8"))
            entries = payload.get("entries", {})
            if isinstance(entries, dict):
                for key in entries:
                    key = str(key).strip().lower()
                    if re.fullmatch(r"[a-z]+", key):
                        words.add(key)
        except (OSError, json.JSONDecodeError):
            pass
    _VOCAB = words
    return words


def _looks_inflected(token: str, vocab: set[str]) -> bool:
    """Avoid splitting a legitimate inflected word (optimistically, questionnaires)."""
    lower = token.lower()
    for suffix in (
        "ally",
        "tion",
        "ment",
        "ness",
        "ingly",
        "edly",
        "ly",
        "ies",
        "ing",
        "ed",
        "es",
        "s",
        "er",
        "est",
    ):
        if not lower.endswith(suffix) or len(lower) <= len(suffix) + 2:
            continue
        base = lower[: -len(suffix)]
        if base in vocab or base + "e" in vocab or base + "y" in vocab:
            return True
        if suffix == "ies" and base + "y" in vocab:
            return True
    return False


def _segment_token(token: str, vocab: set[str]) -> str:
    """Split an OCR-joined token using known words, or leave it alone."""
    if len(token) <= 2 or token.lower() in vocab:
        return token
    lower = token.lower()
    if not re.fullmatch(r"[a-z]+", lower):
        return token
    if _looks_inflected(token, vocab):
        return token
    if wordninja is not None:
        pieces = wordninja.split(token)
        if len(pieces) >= 2:
            return " ".join(pieces)
    length = len(lower)
    best: list[int] | None = None
    best_score = 10**9

    def walk(index: int, parts: list[int], unknown: int) -> None:
        nonlocal best, best_score
        if unknown * 2 >= best_score:
            return
        if index == length:
            score = len(parts) + unknown * 2
            if score < best_score:
                best_score = score
                best = parts.copy()
            return
        for end in range(min(length, index + 20), index, -1):
            piece = lower[index:end]
            if piece in vocab:
                parts.append(end)
                walk(end, parts, unknown)
                parts.pop()

    walk(0, [], 0)
    if not best or best_score > 20:
        return token
    pieces = []
    start = 0
    for end in best:
        pieces.append(token[start:end])
        start = end
    if len(pieces) < 3:
        return token
    return " ".join(pieces)


def _split_joined_words(text: str) -> str:
    vocab = set(_dictionary_vocab())
    protected: list[str] = []

    def protect(match: re.Match[str]) -> str:
        protected.append(match.group(0))
        return f"\x00{len(protected) - 1}\x00"

    text = re.sub(r"[（(][^）)]*[）)]", protect, text)
    text = re.sub(
        r"[A-Za-z]{3,}",
        lambda match: _segment_token(match.group(0), vocab),
        text,
    )
    for index, segment in enumerate(protected):
        text = text.replace(f"\x00{index}\x00", segment)
    return text


def _clean_transcript(body: str) -> str:
    marker = re.search(r"听\s*力\s*原\s*文", body)
    if marker:
        body = body[marker.end():]
    cut = re.search(r"(?:答案详解|答案解析|答案与解析|解析)", body)
    if cut:
        body = body[:cut.start()]

    lines: list[str] = []
    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        if not re.search(r"[A-Za-z]", line):
            continue
        if re.match(r"^\d{1,3}$", line):
            continue
        if re.search(r"(?:四级|六级).*20\d{2}", line):
            continue
        if re.search(r"第\s*\d+\s*页", line):
            continue
        line = re.sub(r"\[\d+\]\s*", "", line)
        line = re.sub(r"^[MW]\s*[:：]\s*", "", line)
        line = re.sub(r"\b[MW]\s*[:：]\s*", "", line)
        line = re.sub(
            r"[（(][^）)]*[一-鿿][^）)]*[）)]", "", line
        )
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            lines.append(line)
    text = " ".join(lines).strip()
    text = re.sub(r"^n\s+(?=[A-Z])", "", text)
    return _split_joined_words(text)


def parse_transcripts(text: str, level: str) -> dict[str, str]:
    groups = CET4_GROUPS if level == "cet4" else CET6_GROUPS
    text = normalize_text(text)
    listening_start = 0
    listening_marker = re.search(
        r"(?im)^\s*Part\s+II\b.*$|^\s*听\s*力\s*部\s*分\s*$", text
    )
    if listening_marker:
        listening_start = listening_marker.start()

    found: list[tuple[int, int, str]] = []
    for title, _start, _end in groups:
        pattern = _heading_pattern(title)
        candidates = [match for match in pattern.finditer(text)]
        candidates = [match for match in candidates if match.start() >= listening_start]
        if candidates:
            match = candidates[0]
            found.append((match.start(), match.end(), title))
    found.sort(key=lambda item: item[0])

    transcripts: dict[str, str] = {}
    for index, (_start, end, title) in enumerate(found):
        next_start = found[index + 1][0] if index + 1 < len(found) else len(text)
        body = _clean_transcript(text[end:next_start])
        if len(body) >= 40:
            transcripts[title.lower()] = body
    return transcripts


def repair_cloze_markers(passage) -> None:
    """Fill blank markers that OCR left inline (e.g. "26 of" or "34 _")."""
    if passage.subtype != "banked_cloze":
        return
    body = passage.body
    existing = {int(value) for value in re.findall(r"\[\[(\d+)\]\]", body)}
    for offset in range(1, 11):
        if offset in existing:
            continue
        number = offset + 25
        match = re.search(rf"(?<!\d){number}(?!\d)\s*_?", body)
        if match:
            body = body[: match.start()] + f"[[{offset}]]" + body[match.end():]
    passage.body = body


def parse_reading_c_all(
    question_text: str,
    answers: dict[int, str],
    exam_id: str,
    report,
):
    """Parse Passage One/Two even when the PDF text order is jumbled."""
    passages = []
    for index, label in enumerate(["One", "Two"], start=1):
        heading = re.search(rf"(?im)^\s*Passage\s+{label}\s*$", question_text)
        if not heading:
            continue
        tail = question_text[heading.end():]
        q_range = re.search(
            r"(?im)Questions?\s+(\d{1,2})\s+(?:to|and|[-–—])\s+"
            r"(\d{1,2})\s+are based",
            tail,
        )
        if not q_range:
            report.skip(f"阅读 Passage {label}", "未找到 Questions X to Y")
            continue
        start_num, end_num = int(q_range.group(1)), int(q_range.group(2))
        after_range = tail[q_range.end():]
        first_question = re.search(
            rf"(?m)^\s*{start_num}[.、．]\s*", after_range
        )
        body = (
            after_range[: first_question.start()] if first_question else after_range
        )
        body = re.sub(
            r"^\s*(?:on\s+the\s+following\s+passage|to\s+the\s+following\s+passage)\.?\s*",
            "",
            body,
            count=1,
            flags=re.I,
        )
        body = core.normalize_paragraphs(body)
        if not body:
            report.skip(f"阅读 Passage {label}", "未找到文章正文")
            continue
        passage_id = f"psg_{exam_id}_r{index}"
        passage = core.Passage(
            id=passage_id,
            section="reading",
            subtype="careful_reading",
            order=index,
            title=f"Passage {label}",
            body=body,
        )
        blocks = dict(
            core.extract_question_blocks(question_text, start_num, end_num)
        )
        for number, qbody in sorted(blocks.items()):
            question = core.make_question(
                number=number,
                body=qbody,
                answer=answers.get(number),
                explanation=None,
                section="reading",
                passage_id=passage_id,
                passage_body=body,
                report=report,
            )
            if question:
                if not question.options:
                    report.skip(f"题 {number}", "没有选项，已跳过")
                    continue
                passage.questions.append(question)
        if passage.questions:
            passages.append(passage)
        else:
            report.skip(f"阅读 Passage {label}", "没有可用题目")
    return passages


def clean_field(text: str, kind: str = "text") -> str:
    """Remove OCR page/heading leakage and restore missing word spaces."""
    text = str(text)
    text = re.sub(
        r"={3,}\s*(?:PAGE|SOURCE|OCR)[^\n]*?={3,}", " ", text
    )
    text = re.sub(r"(?m)^\s*=+\s*(?:PAGE|SOURCE|OCR)[^\n]*$", "", text)
    text = re.sub(r"(?m)^\s*\d{1,3}\s*(?:四级|六级)[^\n]*$", "", text)
    text = re.sub(r"(?m)^\s*第\s*\d+\s*页[^\n]*$", "", text)
    text = re.sub(r"(?m)^\s*(?:解|析|定位|解析|答案详解)\s*$", "", text)
    if kind in {"option", "stem"}:
        text = re.split(
            r"\s+(?:Part\s+(?:I{1,4}|IV|V|\d+)|Section\s+[A-C]|"
            r"Passage\s+(?:One|Two|Three)|Questions?\s+\d+|Directions\s*:)",
            text,
            maxsplit=1,
            flags=re.I,
        )[0]
        text = re.split(r"\s+[A-D]\)\s+", text, maxsplit=1)[0]
    if kind in {"body", "transcript"}:
        lines = [
            re.sub(r"[ \t]+", " ", line).strip()
            for line in text.splitlines()
        ]
        text = "\n".join(lines)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        return _split_joined_words(text)
    text = re.sub(r"\s+", " ", text).strip()
    if kind in {"option", "stem"}:
        text = _split_joined_words(text)
    return text


def clean_translation_body(body: str) -> str:
    """Keep the instruction + Chinese source; drop OCR leakage from other pages."""
    paragraphs = re.split(r"\n\s*\n", body)
    kept: list[str] = []
    for paragraph in paragraphs:
        text = paragraph.strip()
        if not text:
            continue
        if re.search(
            r"(答案速查|答案解析|考试真题答案|参考答案|第\s*\d+\s*套|解析)",
            text,
        ):
            continue
        chinese = len(re.findall(r"[一-鿿]", text))
        latin = len(re.findall(r"[A-Za-z]", text))
        if text.lower().startswith("translate the following passage") or (
            chinese > 0 and chinese >= max(4, latin * 0.5)
        ):
            kept.append(text)
    return "\n\n".join(kept)


def parse_reading_a_ocr(part: str, answers: dict[int, str], exam_id: str, report):
    """Banked cloze parser tuned for OCR text with inline blank numbers."""
    section = re.search(r"(?im)^\s*Section\s*A\b.*$", part)
    if not section:
        return None
    end_match = re.search(r"(?im)^\s*Section\s*B\b", part[section.end():])
    chunk = (
        part[section.end(): section.end() + end_match.start()]
        if end_match
        else part[section.end():]
    )
    lines = chunk.splitlines()
    bank: dict[str, str] = {}
    bank_start: int | None = None
    for index, line in enumerate(lines):
        match = re.match(
            r"^\s*\(?([A-O])[).\]]?\s*([A-Za-z][A-Za-z' -]{1,40})\s*$", line
        )
        if not match:
            # OCR often reads "I)" as "1".
            match = re.match(
                r"^\s*1\s*[)）]?\s*([A-Za-z][A-Za-z' -]{1,40})\s*$", line
            )
            if not match:
                continue
            key, text = "I", match.group(1)
        else:
            key, text = match.group(1), match.group(2)
        bank.setdefault(key, text.strip())
        if bank_start is None:
            bank_start = index
    if len(bank) < 13:
        report.skip("阅读 Section A", f"OCR 词库不足（找到 {len(bank)} 个）")
        return None

    passage_text = "\n".join(lines[:bank_start] if bank_start is not None else lines)
    for marker in (
        "People tend to want",
        "No beast on Earth",
        "Scientists have known",
    ):
        if marker in passage_text:
            passage_text = passage_text[passage_text.index(marker):]
            break
    for number in range(26, 36):
        offset = number - 25
        if f"[[{offset}]]" in passage_text:
            continue
        match = re.search(rf"(?<!\d){number}(?!\d)\s*_?", passage_text)
        if match:
            passage_text = (
                passage_text[: match.start()]
                + f"[[{offset}]]"
                + passage_text[match.end():]
            )

    body = core.normalize_paragraphs(passage_text)
    passage_id = f"psg_{exam_id}_cloze"
    passage = core.Passage(
        id=passage_id,
        section="reading",
        subtype="banked_cloze",
        order=1,
        title="Banked Cloze",
        body=body,
        word_bank=[{"key": key, "text": text} for key, text in sorted(bank.items())],
    )
    paragraphs = [item for item in body.split("\n\n") if item.strip()]
    for offset, number in enumerate(range(26, 36), start=1):
        answer = answers.get(number)
        if not answer or answer not in bank:
            report.skip(f"题 {number}", "未找到词库答案")
            continue
        evidence = {"paragraph": 1, "sentence": 1}
        for p_index, paragraph in enumerate(paragraphs):
            if f"[[{offset}]]" in paragraph:
                before = paragraph[: paragraph.index(f"[[{offset}]]")]
                sentence = max(1, len(re.findall(r"[.!?]\s", before)) + 1)
                evidence = {"paragraph": p_index + 1, "sentence": sentence}
                break
        passage.questions.append(
            core.Question(
                number=number,
                stem=f"Blank {offset}",
                options=[],
                answer=answer,
                explanation=f"正确答案为 {answer}（{bank[answer]}）。",
                evidence=[evidence],
                qtype="banked_cloze",
                section="reading",
                passage_id=passage_id,
                blank_index=offset,
            )
        )
    return passage if passage.questions else None


def parse_reading_b_ocr(part: str, answers: dict[int, str], exam_id: str, report):
    """Paragraph matching parser for OCR text using [A] / (B] markers."""
    section = re.search(r"(?im)^\s*Section\s*B\b.*$", part)
    if not section:
        return None
    end_match = re.search(r"(?im)^\s*Section\s*C\b", part[section.end():])
    chunk = (
        part[section.end(): section.end() + end_match.start()]
        if end_match
        else part[section.end():]
    )
    paragraph_matches = list(
        re.finditer(r"(?m)^\s*[\[(]?\s*([A-O])\s*[\]）)]\s*", chunk)
    )
    if len(paragraph_matches) < 5:
        report.skip("阅读 Section B", "OCR 未找到 A–O 段落")
        return None

    paragraph_texts: dict[str, str] = {}
    body_parts: list[str] = []
    for index, match in enumerate(paragraph_matches):
        end = (
            paragraph_matches[index + 1].start()
            if index + 1 < len(paragraph_matches)
            else len(chunk)
        )
        text = chunk[match.end():end].strip()
        if text:
            paragraph_texts.setdefault(match.group(1), text)
            body_parts.append(text)

    # OCR sometimes loses the [E] marker and merges its tail into [D].
    if "E" not in paragraph_texts:
        for key, text in list(paragraph_texts.items()):
            marker = "update their urban"
            if marker in text:
                head, tail = text.split(marker, 1)
                paragraph_texts[key] = head.strip()
                paragraph_texts["E"] = marker + tail
                break

    body_parts = [
        paragraph_texts[key] for key in sorted(paragraph_texts) if paragraph_texts[key]
    ]
    body = core.normalize_paragraphs("\n\n".join(body_parts))
    if not body:
        return None

    passage_id = f"psg_{exam_id}_match"
    passage = core.Passage(
        id=passage_id,
        section="reading",
        subtype="careful_reading",
        order=2,
        title="Paragraph Matching",
        body=body,
    )
    statement_start = re.search(r"(?m)^\s*36[.、．]\s*", chunk)
    statement_text = chunk[statement_start.start():] if statement_start else chunk
    for number, qbody in core.extract_question_blocks(statement_text, 36, 45):
        answer = answers.get(number)
        if not answer or answer not in paragraph_texts:
            report.skip(f"题 {number}", "未找到段落匹配答案")
            continue
        stem = re.sub(r"\s+", " ", qbody).strip()
        if not stem:
            continue
        options = [
            {"key": key, "text": f"第 {key} 段"}
            for key in sorted(paragraph_texts)
        ]
        paragraph_index = sorted(paragraph_texts).index(answer) + 1
        first_sentence = core.split_sentences(paragraph_texts[answer])[:1]
        passage.questions.append(
            core.Question(
                number=number,
                stem=stem,
                options=options,
                answer=answer,
                explanation=f"该信息来自第 {answer} 段。",
                evidence=[
                    {
                        "paragraph": paragraph_index,
                        "sentence": 1,
                        "quote": first_sentence[0][:500] if first_sentence else "",
                    }
                ],
                qtype="text_structure",
                section="reading",
                passage_id=passage_id,
            )
        )
    return passage if passage.questions else None


def apply_options_override(
    passages,
    listening_part: str,
    answers: dict[int, str],
    override_path: str | None,
    report,
) -> None:
    """Repair questions whose options are split across PDF columns.

    The manifest can provide a JSON map ``question number -> {A: text, ...}``.
    It is used to replace incomplete options and to re-add questions that the
    text-order parser had to skip.
    """
    if not override_path or not Path(override_path).exists():
        return
    try:
        override = json.loads(Path(override_path).read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        report.warn(f"选项修正表解析失败：{error}")
        return

    blocks = dict(core.extract_question_blocks(listening_part, 1, 25))
    for number_text, option_map in override.items():
        try:
            number = int(number_text)
        except (TypeError, ValueError):
            continue
        if not (1 <= number <= 25):
            continue
        if not isinstance(option_map, dict):
            continue
        passage = None
        for candidate in passages:
            if candidate.section != "listening":
                continue
            for title, start, end in core.LISTENING_GROUPS:
                if candidate.title == title and start <= number <= end:
                    passage = candidate
                    break
            if passage:
                break
        if passage is None:
            report.warn(f"题 {number} 找不到所属听力段落，选项修正跳过")
            continue

        options = [
            {"key": str(key), "text": str(value)}
            for key, value in sorted(option_map.items())
            if re.fullmatch(r"[A-O]", str(key))
        ]
        answer = answers.get(number)
        keys = {option["key"] for option in options}
        if not answer or answer not in keys:
            report.warn(f"题 {number} 选项修正后答案 {answer} 不在选项中")
            continue

        existing = next(
            (question for question in passage.questions if question.number == number),
            None,
        )
        if existing:
            existing.options = options
            continue

        block = blocks.get(number, "")
        stem, _text_options, _duplicate = core.parse_options(block)
        stem = re.sub(r"\s+", " ", stem).strip() or f"Question {number}"
        option_text = next(
            option["text"] for option in options if option["key"] == answer
        )
        segments = core.split_sentences(passage.transcript or "")
        evidence = [core.find_segment_evidence(segments, option_text)]
        question = core.Question(
            number=number,
            stem=stem,
            options=options,
            answer=answer,
            explanation="",
            evidence=evidence,
            qtype=core.question_type(stem, "listening"),
            section="listening",
            passage_id=passage.id,
        )
        question.explanation = core.fallback_explanation(question)
        passage.questions.append(question)
        report.warn(f"题 {number} 选项不完整，已用修正表补回")

    for passage in passages:
        passage.questions.sort(key=lambda question: question.number)


def apply_reading_options_override(
    passages,
    answers: dict[int, str],
    override_path: str | None,
    report,
    question_text: str = "",
) -> None:
    """Replace or re-add reading questions whose options were split by OCR."""
    if not override_path or not Path(override_path).exists():
        return
    try:
        override = json.loads(Path(override_path).read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        report.warn(f"选项修正表解析失败：{error}")
        return

    by_number = {}
    for passage in passages:
        for question in passage.questions:
            by_number.setdefault(question.number, question)

    for number_text, option_map in override.items():
        try:
            number = int(number_text)
        except (TypeError, ValueError):
            continue
        if number <= 25 or not isinstance(option_map, dict):
            continue
        question = by_number.get(number)
        options = [
            {"key": str(key), "text": str(value)}
            for key, value in sorted(option_map.items())
            if re.fullmatch(r"[A-O]", str(key))
        ]
        answer = answers.get(number)
        keys = {option["key"] for option in options}
        if not answer or answer not in keys:
            report.warn(f"题 {number} 选项修正后答案 {answer} 不在选项中")
            continue
        if question is not None:
            question.options = options
            continue

        # Re-add a reading question that was dropped because OCR only captured
        # part of its options.
        target = None
        for passage in passages:
            if passage.section != "reading" or not passage.id.endswith(
                ("_r1", "_r2")
            ):
                continue
            if passage.id.endswith("_r1") and 46 <= number <= 50:
                target = passage
            elif passage.id.endswith("_r2") and 51 <= number <= 55:
                target = passage
            if target:
                break
        if target is None or not question_text:
            report.warn(f"题 {number} 已跳过，选项修正表未使用")
            continue
        blocks = dict(core.extract_question_blocks(question_text, number, number))
        stem, _text_options, _duplicate = core.parse_options(blocks.get(number, ""))
        stem = re.sub(r"\s+", " ", stem).strip() or f"Question {number}"
        option_text = next(
            option["text"] for option in options if option["key"] == answer
        )
        evidence = (
            [core.find_evidence(target.body, option_text)]
            if target.body
            else [{"paragraph": 1, "sentence": 1}]
        )
        question = core.Question(
            number=number,
            stem=stem,
            options=options,
            answer=answer,
            explanation="",
            evidence=evidence,
            qtype=core.question_type(stem, "reading"),
            section="reading",
            passage_id=target.id,
        )
        question.explanation = core.fallback_explanation(question)
        target.questions.append(question)
        target.questions.sort(key=lambda item: item.number)
        report.warn(f"题 {number} 选项不完整，已用修正表补回")


def load_answers_file(path: Path) -> dict[int, str]:
    text = path.read_text(encoding="utf-8")
    answers: dict[int, str] = {}
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        range_match = re.match(
            r"^(\d{1,2})\s*[-–—~]\s*(\d{1,2})\s*[:：]?\s*([A-O\s;；,，]+)$",
            line,
        )
        if range_match:
            start, end = int(range_match.group(1)), int(range_match.group(2))
            letters = re.findall(r"[A-O]", range_match.group(3))
            for offset, letter in enumerate(letters):
                if start + offset <= end:
                    answers[start + offset] = letter
            continue
        match = re.match(r"^(\d{1,2})\s*[.、．:]?\s*([A-O])\b", line)
        if match:
            answers[int(match.group(1))] = match.group(2)
    return answers


def load_transcripts_dir(path: Path) -> dict[str, str]:
    """Load l1.txt..lN.txt and map them by question ranges in the filename."""
    transcripts: dict[str, str] = {}
    for file in sorted(path.glob("*.txt")):
        stem = file.stem.lower()
        match = re.match(r"l(\d+)$", stem)
        if not match:
            # Allow 1-2.txt / q1-2.txt as well.
            match = re.match(r"q?(\d+)(?:[-_](\d+))?$", stem)
        if not match:
            continue
        number = int(match.group(1))
        text = file.read_text(encoding="utf-8").strip()
        if text:
            transcripts[str(number)] = text
    return transcripts


def parse_page_spec(spec: str) -> list[int]:
    pages: list[int] = []
    for chunk in str(spec).split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            start, end = chunk.split("-", 1)
            pages.extend(range(int(start), int(end) + 1))
        else:
            pages.append(int(chunk))
    return pages


def build_question_text(paper: dict[str, Any]) -> str:
    """Return the text used for question/passage structure parsing.

    ``paper["question_sources"]`` can mix PDF text layers, OCR page text and
    plain text files. This lets a recall PDF use its text pages for questions
    and OCR pages for scanned reading passages without mixing answer pages in.
    """
    sources = paper.get("question_sources")
    if not sources:
        path = Path(paper["question_text"])
        if not path.exists():
            raise FileNotFoundError(f"找不到题干文本：{path}")
        return path.read_text(encoding="utf-8")

    chunks: list[str] = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        kind = str(source.get("type", ""))
        spec = str(source.get("pages", ""))
        if kind == "pdf":
            pdf_path = Path(source["path"])
            doc = pymupdf.open(pdf_path)
            try:
                for page_number in parse_page_spec(spec):
                    if 1 <= page_number <= doc.page_count:
                        text = doc[page_number - 1].get_text()
                        chunks.append(
                            f"\n===== SOURCE {pdf_path.name} PAGE {page_number} =====\n{text}"
                        )
            finally:
                doc.close()
        elif kind == "ocr":
            ocr_dir = Path(source["path"])
            for page_number in parse_page_spec(spec):
                page_path = ocr_dir / f"page-{page_number:04d}.txt"
                if page_path.exists():
                    chunks.append(
                        f"\n===== OCR PAGE {page_number} =====\n"
                        + page_path.read_text(encoding="utf-8")
                    )
        elif kind == "file":
            file_path = Path(source["path"])
            if file_path.exists():
                chunks.append(file_path.read_text(encoding="utf-8"))
    return "\n".join(chunks)


def build_paper(paper: dict[str, Any], dry_run: bool) -> dict[str, Any]:
    exam_id = str(paper["exam_id"])
    level = str(paper.get("level", "cet4")).lower()
    year = int(paper["year"])
    month = int(paper["month"])
    set_name = str(paper.get("set", "set1"))
    title = str(paper.get("title") or f"{year} 年 {month} 月大学英语真题（{set_name}）")
    report = core.Report(source=str(paper.get("source") or exam_id))

    question_text = normalize_text(build_question_text(paper))

    answer_text = ""
    for key in ("answer_text", "transcript_text"):
        value = paper.get(key)
        if value and Path(value).exists():
            answer_text += "\n" + Path(value).read_text(encoding="utf-8")
    answer_text = normalize_text(answer_text)

    answers = parse_answer_key(answer_text)
    answers_file = paper.get("answers_file")
    if answers_file and Path(answers_file).exists():
        answers.update(load_answers_file(Path(answers_file)))

    if paper.get("skip_listening"):
        transcripts: dict[str, str] = {}
    else:
        transcripts = {
            key: clean_field(value, "transcript")
            for key, value in parse_transcripts(answer_text, level).items()
        }
    transcripts_dir = paper.get("transcripts_dir")
    if transcripts_dir and Path(transcripts_dir).exists():
        groups = CET4_GROUPS if level == "cet4" else CET6_GROUPS
        external = load_transcripts_dir(Path(transcripts_dir))
        for number, text in external.items():
            for group_title, start, end in groups:
                if str(start) == number:
                    transcripts[group_title.lower()] = text
                    break

    if level == "cet6":
        core.LISTENING_GROUPS = CET6_GROUPS
    else:
        core.LISTENING_GROUPS = CET4_GROUPS

    parts = core.split_parts(question_text)
    passages = []
    assets: list[dict[str, Any]] = []

    if "reading" in parts:
        reading = parts["reading"]
        cloze = core.parse_reading_a(reading, answers, exam_id, report)
        if cloze is None:
            cloze = parse_reading_a_ocr(reading, answers, exam_id, report)
        matching = core.parse_reading_b(reading, answers, exam_id, report)
        if matching is None:
            matching = parse_reading_b_ocr(reading, answers, exam_id, report)
        careful = parse_reading_c_all(question_text, answers, exam_id, report)
        if cloze:
            passages.append(cloze)
        if matching:
            passages.append(matching)
        passages.extend(careful)
        if not (cloze or matching or careful):
            report.skip("Reading", "没有解析出可用阅读题")
    else:
        report.skip("Reading", "未找到 Part III Reading")

    if "listening" in parts:
        if paper.get("skip_listening"):
            report.skip("Listening", "按配置跳过听力（源文件无原文/音频）")
        elif transcripts:
            listening_passages, listening_assets = core.parse_listening(
                parts["listening"],
                answers,
                {},
                transcripts,
                exam_id,
                report,
            )
            passages.extend(listening_passages)
            assets.extend(listening_assets)
            apply_options_override(
                passages,
                parts["listening"],
                answers,
                paper.get("options_override"),
                report,
            )
        else:
            report.skip(
                "Listening",
                "没有听力原文；为避免编造内容，跳过听力",
            )
    else:
        report.skip("Listening", "未找到 Part II Listening")

    full_text = question_text + "\n" + answer_text
    if "writing" in parts:
        writing = core.parse_writing(parts["writing"], full_text, exam_id, report)
        if writing:
            passages.append(writing)
    else:
        report.skip("Writing", "未找到 Part I Writing")

    if "translation" in parts:
        translation = core.parse_translation(
            parts["translation"], full_text, exam_id, report
        )
        if translation:
            passages.append(translation)
    else:
        report.skip("Translation", "未找到 Part IV Translation")

    apply_reading_options_override(
        passages, answers, paper.get("options_override"), report, question_text
    )

    body_fixes = paper.get("body_fixes")
    if isinstance(body_fixes, dict):
        for passage in passages:
            for suffix, fix in body_fixes.items():
                if not passage.id.endswith(str(suffix)) or not isinstance(fix, dict):
                    continue
                body = passage.body
                strip_before = fix.get("strip_before")
                if isinstance(strip_before, str) and strip_before in body:
                    body = body[body.index(strip_before):]
                for replacement in fix.get("replace", []):
                    if (
                        isinstance(replacement, list)
                        and len(replacement) == 2
                    ):
                        body = body.replace(str(replacement[0]), str(replacement[1]))
                passage.body = body

    for passage in passages:
        repair_cloze_markers(passage)
        passage.body = clean_field(passage.body, "body")
        if passage.section == "translation":
            passage.body = clean_translation_body(passage.body)
        if passage.transcript:
            passage.transcript = clean_field(passage.transcript, "transcript")
        for question in passage.questions:
            question.stem = clean_field(question.stem, "stem")
            for option in question.options:
                option["text"] = clean_field(option["text"], "option")
            question.explanation = clean_field(question.explanation, "text")

    order_by_section: dict[str, int] = {}
    for passage in passages:
        order_by_section[passage.section] = order_by_section.get(passage.section, 0) + 1
        passage.order = order_by_section[passage.section]
        for question in passage.questions:
            for option in question.options:
                text = option["text"]
                text = re.split(
                    r"\s+(?:Passage|Part|Section)\s+(?:One|Two|Three|Four|[IVX]+|\d+)\b",
                    text,
                    maxsplit=1,
                )[0]
                text = re.split(r"\s+Questions?\s+\d+", text, maxsplit=1)[0]
                option["text"] = re.sub(r"\s+", " ", text).strip()

    bundle = core.build_bundle(year, month, set_name, exam_id, passages, assets)
    bundle["exam"]["title"] = title
    report.question_count = len(bundle["questions"])

    errors = core.validate_bundle(bundle)
    for error in errors:
        report.warn(error)

    answer_numbers = sorted(
        {
            int(question.get("id", "").rsplit("_", 1)[-1])
            for question in bundle["questions"]
            if re.fullmatch(r"[A-O]", str(question.get("answer", "")).strip())
            and str(question.get("id", "")).rsplit("_", 1)[-1].isdigit()
        }
    )
    missing_answers: list[int] = []
    for passage in passages:
        if passage.section not in {"reading", "listening"}:
            continue
        for question in passage.questions:
            if not re.fullmatch(r"[A-O]", str(question.answer).strip()):
                missing_answers.append(question.number)
    summary = {
        "exam_id": exam_id,
        "title": title,
        "level": level,
        "sections": bundle["exam"]["sections"],
        "passages": len(bundle["passages"]),
        "questions": len(bundle["questions"]),
        "answer_count": len(answer_numbers),
        "answer_numbers": answer_numbers,
        "missing_answers": sorted(set(missing_answers)),
        "skipped": report.skipped,
        "warnings": report.warnings,
        "generated_explanations": report.generated_explanations,
        "bundle": bundle,
    }

    if not dry_run:
        # Real exam papers are private content: keep them out of git/deploy.
        md_path = ROOT / "content" / "exams" / "private" / exam_id / "exam.md"
        md_path.parent.mkdir(parents=True, exist_ok=True)
        md_path.write_text(core.render_markdown(bundle), encoding="utf-8")
        summary["output"] = str(md_path)

        json_path = md_path.parent / "exam.json"
        json_path.write_text(
            json.dumps(bundle, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        summary["json"] = str(json_path)

        report_path = (
            ROOT
            / "content"
            / "imports"
            / "cet-corpus"
            / "reports"
            / f"{exam_id}.md"
        )
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(render_report(summary), encoding="utf-8")
        summary["report"] = str(report_path)

    return summary


def render_report(summary: dict[str, Any]) -> str:
    lines = [
        f"# 导入报告：{summary['exam_id']}",
        "",
        f"- 标题：{summary['title']}",
        f"- 板块：{', '.join(summary['sections']) or '无'}",
        f"- passage：{summary['passages']}",
        f"- 题目：{summary['questions']}",
        f"- 可自动判分答案：{summary['answer_count']}",
        "",
        "## 已解析答案题号",
        "",
        ", ".join(str(number) for number in summary["answer_numbers"]) or "无",
        "",
        "## 跳过 / 缺失",
        "",
    ]
    if summary["skipped"]:
        lines.extend(f"- {item}" for item in summary["skipped"])
    else:
        lines.append("- 无")
    lines.extend(["", "## 警告", ""])
    if summary["warnings"]:
        lines.extend(f"- {item}" for item in summary["warnings"])
    else:
        lines.append("- 无")
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build CET exam.md from local text + OCR")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--paper", action="append", default=None, help="exam_id to run")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--json", action="store_true", help="print machine-readable summary")
    args = parser.parse_args(argv)

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    papers = manifest["papers"] if isinstance(manifest, dict) else manifest
    wanted = set(args.paper or [])
    if wanted:
        papers = [paper for paper in papers if paper["exam_id"] in wanted]

    summaries = []
    failures = 0
    for paper in papers:
        try:
            summary = build_paper(paper, args.dry_run)
            summaries.append(summary)
            if not args.json:
                print(f"=== {summary['exam_id']}")
                print(f"  板块：{', '.join(summary['sections'])}")
                print(f"  passage：{summary['passages']} 题：{summary['questions']}")
                print(f"  答案：{summary['answer_count']} 个")
                if summary["skipped"]:
                    print(f"  跳过：{len(summary['skipped'])} 项")
                if summary.get("output"):
                    print(f"  写入：{summary['output']}")
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(f"[失败] {paper.get('exam_id')}: {error}", file=sys.stderr)

    if args.json:
        print(
            json.dumps(
                [{key: value for key, value in item.items() if key != "bundle"} for item in summaries],
                ensure_ascii=False,
                indent=2,
            )
        )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
