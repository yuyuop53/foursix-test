#!/usr/bin/env python3
"""Structured dry-run parser and preview generator for CET-Lab.

This script deliberately does NOT write exam.md, Dexie/IndexedDB, or the
production content directory. It only produces preview JSON under
``content/private/previews/``.

Design goals:
- preserve every question/paragraph it can find;
- when an answer/option/paragraph is uncertain, keep the raw block and mark
  the item as pending instead of dropping it;
- expose the result to the frontend preview page for human inspection.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import pymupdf

try:
    import wordninja
except ImportError:  # pragma: no cover
    wordninja = None

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = ROOT / "content" / "imports" / "cet-corpus" / "manifest.json"
PREVIEW_DIR = ROOT / "content" / "private" / "previews"

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
    r"选\s*([A-O])\s*项",
    r"故选\s*([A-O])",
    r"应选\s*([A-O])",
    r"所以答案是\s*([A-O])\s*项",
    r"所以答案是\s*([A-O])",
    r"答案是\s*([A-O])\s*项",
    r"答案是\s*([A-O])",
    r"【答案】\s*([A-O])",
]


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


def load_source_text(paper: dict[str, Any]) -> str:
    if paper.get("question_text"):
        path = Path(paper["question_text"])
        if path.exists():
            return path.read_text(encoding="utf-8")
    chunks: list[str] = []
    for source in paper.get("question_sources") or []:
        kind = str(source.get("type", ""))
        spec = str(source.get("pages", ""))
        if kind == "pdf":
            doc = pymupdf.open(Path(source["path"]))
            try:
                for page_number in parse_page_spec(spec):
                    if 1 <= page_number <= doc.page_count:
                        chunks.append(
                            f"\n===== PAGE {page_number} =====\n"
                            + doc[page_number - 1].get_text()
                        )
            finally:
                doc.close()
        elif kind == "ocr":
            directory = Path(source["path"])
            for page_number in parse_page_spec(spec):
                page = directory / f"page-{page_number:04d}.txt"
                if page.exists():
                    chunks.append(
                        f"\n===== OCR PAGE {page_number} =====\n"
                        + page.read_text(encoding="utf-8")
                    )
        elif kind == "file":
            path = Path(source["path"])
            if path.exists():
                chunks.append(path.read_text(encoding="utf-8"))
    return "\n".join(chunks)


def load_answer_text(paper: dict[str, Any]) -> str:
    chunks: list[str] = []
    value = paper.get("answer_text")
    if value and Path(value).exists():
        chunks.append(Path(value).read_text(encoding="utf-8"))
    value = paper.get("answers_file")
    if value and Path(value).exists():
        chunks.append(Path(value).read_text(encoding="utf-8"))
    return "\n".join(chunks)


def segment_words(text: str) -> str:
    """Restore missing spaces without touching parentheses/proper nouns."""
    if wordninja is None:
        return text
    protected: list[str] = []

    def protect(match: re.Match[str]) -> str:
        protected.append(match.group(0))
        return f"\x00{len(protected) - 1}\x00"

    text = re.sub(r"[（(][^）)]*[）)]", protect, text)
    text = re.sub(
        r"[A-Za-z]{3,}",
        lambda match: (
            " ".join(wordninja.split(match.group(0)))
            if len(wordninja.split(match.group(0))) > 1
            else match.group(0)
        ),
        text,
    )
    for index, value in enumerate(protected):
        text = text.replace(f"\x00{index}\x00", value)
    return text


def clean_block(text: str) -> str:
    text = re.sub(r"={3,}\s*(?:PAGE|SOURCE|OCR)[^\n]*?={3,}", " ", text)
    text = re.sub(r"(?m)^\s*\d{1,3}\s*(?:四级|六级)[^\n]*$", "", text)
    text = re.sub(r"(?m)^\s*第\s*\d+\s*页[^\n]*$", "", text)
    text = re.sub(r"(?m)^\s*(?:解|析|定位|解析)\s*$", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return segment_words(text)


def normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
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
    text = re.sub(r"(?m)^(\s*)0([).])\s*(?=[A-Za-z])", r"\1O\2 ", text)
    return text


def split_parts(text: str) -> dict[str, str]:
    matches = list(
        re.finditer(
            r"(?im)^\s*Part\s+(I{1,3}|IV|V|[1-4])\b[^\n]*$", text
        )
    )
    parts: dict[str, str] = {}
    names = ["writing", "listening", "reading", "translation", "speaking"]
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[match.end():end].strip()
        head = f"{match.group(0)} {body[:180]}".lower()
        name = None
        if "writing" in head:
            name = "writing"
        elif "listening" in head:
            name = "listening"
        elif "reading" in head:
            name = "reading"
        elif "translation" in head:
            name = "translation"
        if name is None and index < len(names):
            name = names[index]
        if name and name not in parts:
            parts[name] = body
    return parts


def answers_from_text(text: str) -> dict[int, str]:
    answers: dict[int, str] = {}
    for match in re.finditer(
        r"(\d{1,2})\s*[-–—~]\s*(\d{1,2})\s*[:：]?\s*([A-O](?:\s*[;；,，]?\s*[A-O])*)",
        text,
    ):
        start, end = int(match.group(1)), int(match.group(2))
        for offset, letter in enumerate(re.findall(r"[A-O]", match.group(3))):
            if start + offset <= end:
                answers.setdefault(start + offset, letter)
    # explicit answer files: "1 A"
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        range_match = re.match(
            r"^(\d{1,2})\s*[-–—~]\s*(\d{1,2})\s*[:：]?\s*([A-O\s;；,，]+)$",
            line,
        )
        if range_match:
            start, end = int(range_match.group(1)), int(range_match.group(2))
            for offset, letter in enumerate(re.findall(r"[A-O]", range_match.group(3))):
                if start + offset <= end:
                    answers.setdefault(start + offset, letter)
            continue
        match = re.match(r"^(\d{1,2})\s*[.、．:]?\s*([A-O])\b", line)
        if match:
            answers.setdefault(int(match.group(1)), match.group(2))
    # Banked-cloze explanation headings: "32.I readily" / "33.N) specific".
    for match in re.finditer(
        r"(?m)^\s*(2[6-9]|3[0-5])\s*[.、．]\s*([A-O])\s*[)）]?\s*[A-Za-z]",
        text,
    ):
        answers.setdefault(int(match.group(1)), match.group(2))

    # Clean OCR sidebar labels before block matching.
    text = re.sub(r"(?m)^\s*解\s*析\s*[→}】]?\s*", "", text)
    text = re.sub(r"(?m)^\s*解\s*[→}】]?\s*", "", text)
    text = re.sub(r"(?m)^\s*析\s*$", "", text)

    markers = list(re.finditer(r"(?m)^\s*(\d{1,2})\s*[.、．]\s*", text))
    for match in re.finditer(r"(?m)^\s*(\d{1,2})\s*(?=[一-鿿])", text):
        number = int(match.group(1))
        if not 1 <= number <= 55:
            continue
        line = text[match.start(): text.find("\n", match.start())]
        if re.search(r"(?:四级|六级|第\s*\d+\s*套|页)", line):
            continue
        markers.append(match)
    markers.sort(key=lambda item: item.start())
    deduped = []
    seen = set()
    for match in markers:
        if match.start() in seen:
            continue
        seen.add(match.start())
        deduped.append(match)

    for index, match in enumerate(deduped):
        number = int(match.group(1))
        if not 1 <= number <= 55:
            continue
        end = deduped[index + 1].start() if index + 1 < len(deduped) else len(text)
        block = re.sub(r"\s+", "", text[match.end():end])
        if not re.search(r"[一-鿿]", block):
            continue
        best = None
        best_pos = len(block) + 1
        for pattern in ANSWER_PATTERNS:
            hit = re.search(pattern, block)
            if hit and hit.start() < best_pos:
                best_pos = hit.start()
                best = hit.group(1)
        if best:
            answers.setdefault(number, best)
    return answers


def transcripts_from_text(text: str, level: str) -> dict[str, str]:
    groups = CET4_GROUPS if level == "cet4" else CET6_GROUPS
    text = normalize(text)
    listening = re.search(
        r"(?im)^\s*Part\s+II\b.*$|^\s*听\s*力\s*部\s*分\s*$", text
    )
    start_at = listening.start() if listening else 0
    found: list[tuple[int, int, str]] = []
    for title, _start, _end in groups:
        pattern = re.compile(
            r"(?im)^\s*" + r"\s*".join(re.escape(word) for word in title.split()) + r"\s*$"
        )
        matches = [
            match for match in pattern.finditer(text) if match.start() >= start_at
        ]
        if matches:
            found.append((matches[0].start(), matches[0].end(), title))
    found.sort(key=lambda item: item[0])
    result: dict[str, str] = {}
    for index, (_start, end, title) in enumerate(found):
        stop = found[index + 1][0] if index + 1 < len(found) else len(text)
        body = text[end:stop]
        marker = re.search(r"听\s*力\s*原\s*文", body)
        if marker:
            body = body[marker.end():]
        cut = re.search(r"(?:答案详解|答案解析|答案与解析|解析)", body)
        if cut:
            body = body[:cut.start()]
        lines = []
        for line in body.splitlines():
            line = line.strip()
            if not line or not re.search(r"[A-Za-z]", line):
                continue
            if re.match(r"^\d{1,3}$", line):
                continue
            if re.search(r"(?:四级|六级).*20\d{2}", line):
                continue
            line = re.sub(r"\[\d+\]\s*", "", line)
            line = re.sub(r"^[MW]\s*[:：]\s*", "", line)
            line = re.sub(r"\b[MW]\s*[:：]\s*", "", line)
            line = re.sub(r"[（(][^）)]*[一-鿿][^）)]*[）)]", "", line)
            line = re.sub(r"\s+", " ", line).strip()
            if line:
                lines.append(line)
        value = segment_words(" ".join(lines).strip())
        if len(value) >= 40:
            result[title.lower()] = value
    return result


def option_pairs(block: str) -> list[dict[str, str]]:
    """Extract A-D option pairs, including inline/multi-column text."""
    values: dict[str, str] = {}
    matches = list(
        re.finditer(r"(?m)(?:^|\s)([A-D])[).]\s*", block)
    )
    for index, match in enumerate(matches):
        key = match.group(1)
        end = matches[index + 1].start() if index + 1 < len(matches) else len(block)
        text = clean_block(block[match.end():end])
        text = re.split(
            r"\s+(?:Part\s+(?:I{1,4}|IV|V|\d+)|Section\s+[A-C]|"
            r"Passage\s+(?:One|Two|Three)|Questions?\s+\d+|Directions\s*:)",
            text,
            maxsplit=1,
            flags=re.I,
        )[0]
        text = re.split(r"\s+[A-D]\)\s+", text, maxsplit=1)[0].strip()
        if key not in values and text:
            values[key] = text
    return [{"key": key, "text": values[key]} for key in sorted(values)]


def question_blocks(text: str, start: int, end: int) -> dict[int, str]:
    markers = list(re.finditer(r"(?m)^\s*(\d{1,2})[.、．]\s*", text))
    result: dict[int, str] = {}
    for index, match in enumerate(markers):
        number = int(match.group(1))
        if not start <= number <= end:
            continue
        stop = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        result.setdefault(number, text[match.end():stop])
    return result


def parse_cloze(part: str, answers: dict[int, str], override: dict[str, Any]):
    section = re.search(r"(?im)^\s*Section\s*A\b.*$", part)
    if not section:
        return None, ["READING_A_MISSING"]
    end = re.search(r"(?im)^\s*Section\s*B\b", part[section.end():])
    chunk = part[section.end(): section.end() + end.start()] if end else part[section.end():]
    lines = chunk.splitlines()
    bank: dict[str, str] = {}
    bank_start = None
    for index, line in enumerate(lines):
        match = re.match(r"^\s*\(?([A-O])[).\]]?\s*([A-Za-z][A-Za-z' -]{1,40})\s*$", line)
        if not match:
            match = re.match(r"^\s*1\s*[)）]?\s*([A-Za-z][A-Za-z' -]{1,40})\s*$", line)
            if not match:
                continue
            key, text = "I", match.group(1)
        else:
            key, text = match.group(1), match.group(2)
        bank.setdefault(key, text.strip())
        if bank_start is None:
            bank_start = index
    if len(bank) < 13:
        return None, [f"READING_A_BANK_INCOMPLETE:{len(bank)}"]
    body = "\n".join(lines[:bank_start] if bank_start is not None else lines)
    for marker in ("People tend to want", "No beast on Earth", "Scientists have known"):
        if marker in body:
            body = body[body.index(marker):]
            break
    for number in range(26, 36):
        offset = number - 25
        if f"[[{offset}]]" in body:
            continue
        match = re.search(rf"(?<!\d){number}(?!\d)\s*_?", body)
        if match:
            body = body[:match.start()] + f"[[{offset}]]" + body[match.end():]
    body = "\n\n".join(
        item.strip() for item in re.split(r"\n\s*\n", body) if item.strip()
    )
    body = segment_words(body)
    questions = []
    for number in range(26, 36):
        answer = answers.get(number)
        raw = ""
        for line in lines:
            if re.match(rf"^\s*{number}[.、．]", line):
                raw = line
        questions.append(
            {
                "number": number,
                "stem": f"Blank {number - 25}",
                "options": [],
                "answer": answer,
                "pending": answer is None or answer not in bank,
                "reasons": [] if answer in bank else ["答案/词库待确认"],
                "raw": raw,
            }
        )
    return {
        "id": "cloze",
        "section": "reading",
        "title": "Banked Cloze",
        "body": body,
        "word_bank": [{"key": key, "text": value} for key, value in sorted(bank.items())],
        "questions": questions,
    }, []


def parse_matching(part: str, answers: dict[int, str]):
    section = re.search(r"(?im)^\s*Section\s*B\b.*$", part)
    if not section:
        return None, ["READING_B_MISSING"]
    end = re.search(r"(?im)^\s*Section\s*C\b", part[section.end():])
    chunk = part[section.end(): section.end() + end.start()] if end else part[section.end():]
    paragraphs = list(
        re.finditer(r"(?m)^\s*[\[(]?\s*([A-O])\s*[\]）)]\s*", chunk)
    )
    if len(paragraphs) < 5:
        return None, [f"READING_B_PARAGRAPHS_INCOMPLETE:{len(paragraphs)}"]
    texts: dict[str, str] = {}
    for index, match in enumerate(paragraphs):
        stop = paragraphs[index + 1].start() if index + 1 < len(paragraphs) else len(chunk)
        value = segment_words(chunk[match.end():stop].strip())
        if value:
            texts.setdefault(match.group(1), value)
    if "E" not in texts:
        for key, value in list(texts.items()):
            marker = "update their urban"
            if marker in value:
                head, tail = value.split(marker, 1)
                texts[key] = head.strip()
                texts["E"] = marker + tail
                break
    missing_letters = [key for key in "ABCDEFGHIJKLMNO" if key not in texts]
    body = "\n\n".join(texts[key] for key in sorted(texts))
    start = re.search(r"(?m)^\s*36[.、．]\s*", chunk)
    statement_text = chunk[start.start():] if start else chunk
    questions = []
    for number, raw in sorted(question_blocks(statement_text, 36, 45).items()):
        answer = answers.get(number)
        questions.append(
            {
                "number": number,
                "stem": clean_block(raw),
                "options": [{"key": key, "text": f"第 {key} 段"} for key in sorted(texts)],
                "answer": answer,
                "pending": answer is None or answer not in texts,
                "reasons": [] if answer in texts else ["段落或答案待确认"],
                "raw": raw,
            }
        )
    issues = [f"READING_B_PARAGRAPH_MISSING:{letter}" for letter in missing_letters]
    return {
        "id": "matching",
        "section": "reading",
        "title": "Paragraph Matching",
        "body": body,
        "questions": questions,
    }, issues


def parse_reading_c(text: str, answers: dict[int, str], override: dict[str, Any]):
    passages = []
    issues = []
    for index, label in enumerate(["One", "Two"], start=1):
        heading = re.search(rf"(?im)^\s*Passage\s+{label}\s*$", text)
        if not heading:
            issues.append(f"READING_C_PASSAGE_{label}_MISSING")
            continue
        tail = text[heading.end():]
        q_range = re.search(
            r"(?im)Questions?\s+(\d{1,2})\s+(?:to|and|[-–—])\s+(\d{1,2})\s+are based",
            tail,
        )
        if not q_range:
            issues.append(f"READING_C_PASSAGE_{label}_RANGE_MISSING")
            continue
        start, end = int(q_range.group(1)), int(q_range.group(2))
        after = tail[q_range.end():]
        first = re.search(rf"(?m)^\s*{start}[.、．]\s*", after)
        body = after[: first.start()] if first else after
        body = re.sub(
            r"^\s*on\s+the\s+following\s+passage\.?\s*",
            "",
            body,
            count=1,
            flags=re.I,
        )
        body = "\n\n".join(
            item.strip() for item in re.split(r"\n\s*\n", body) if item.strip()
        )
        body = segment_words(body)
        questions = []
        for number, raw in sorted(question_blocks(text, start, end).items()):
            options = option_pairs(raw)
            answer = answers.get(number)
            reasons = []
            if len(options) < 4:
                reasons.append(f"选项不完整:{''.join(item['key'] for item in options)}")
            if answer is None:
                reasons.append("答案待确认")
            elif answer not in {item["key"] for item in options}:
                reasons.append(f"答案 {answer} 不在选项中")
            questions.append(
                {
                    "number": number,
                    "stem": clean_block(re.split(r"\s+[A-D]\)\s+", raw, maxsplit=1)[0]),
                    "options": options,
                    "answer": answer,
                    "pending": bool(reasons),
                    "reasons": reasons,
                    "raw": raw,
                }
            )
        passages.append(
            {
                "id": f"r{index}",
                "section": "reading",
                "title": f"Passage {label}",
                "body": body,
                "questions": questions,
            }
        )
    return passages, issues


def parse_listening(
    part: str,
    answers: dict[int, str],
    level: str,
    transcripts: dict[str, str] | None = None,
):
    groups = CET4_GROUPS if level == "cet4" else CET6_GROUPS
    blocks = question_blocks(part, 1, 25)
    transcripts = transcripts or {}
    passages = []
    issues = []
    for index, (title, start, end) in enumerate(groups, start=1):
        questions = []
        for number in range(start, end + 1):
            raw = blocks.get(number, "")
            options = option_pairs(raw)
            answer = answers.get(number)
            reasons = []
            if not raw:
                reasons.append("题干缺失")
            if len(options) < 2:
                reasons.append("选项不足")
            if answer is None:
                reasons.append("答案待确认")
            questions.append(
                {
                    "number": number,
                    "stem": clean_block(re.split(r"\s+[A-D]\)\s+", raw, maxsplit=1)[0]),
                    "options": options,
                    "answer": answer,
                    "pending": bool(reasons),
                    "reasons": reasons,
                    "raw": raw,
                }
            )
        transcript = transcripts.get(title.lower())
        if not transcript:
            issues.append(f"LISTENING_TRANSCRIPT_MISSING:{title}")
        passages.append(
            {
                "id": f"l{index}",
                "section": "listening",
                "title": title,
                "body": "",
                "transcript": transcript,
                "transcript_pending": not bool(transcript),
                "questions": questions,
            }
        )
    return passages, issues


def parse_translation(part: str, full_text: str):
    lines = []
    for line in part.splitlines():
        if re.match(r"(?im)^\s*(?:参考答案|参考译文|答案|解析|听力原文|Part\b)", line):
            break
        if re.search(r"[一-鿿]", line):
            lines.append(line.strip())
        elif lines and not line.strip():
            lines.append("")
    source = "\n\n".join(
        item.strip() for item in re.split(r"\n\s*\n", "\n".join(lines)) if item.strip()
    )
    source = segment_words(source)
    reference = ""
    match = re.search(r"(?is)参考译文[:：]\s*", full_text)
    if match:
        reference = full_text[match.end():]
        reference = re.split(
            r"(?im)^\s*(?:Part\s+[IVX]+|答案解析|参考范文|答案|听力原文)\b",
            reference,
        )[0].strip()
    return {
        "id": "translation",
        "section": "translation",
        "title": "Translation Task",
        "body": source,
        "reference": clean_block(reference) if reference else "",
    }, [] if source else ["TRANSLATION_SOURCE_MISSING"]


def parse_writing(part: str):
    match = re.search(r"(?is)Directions:\s*", part)
    if not match:
        return None, ["WRITING_DIRECTIONS_MISSING"]
    prompt = part[match.end():].strip()
    return {
        "id": "writing",
        "section": "writing",
        "title": "Writing Task",
        "body": clean_block(prompt),
    }, []


def parse_paper(paper: dict[str, Any]) -> dict[str, Any]:
    exam_id = str(paper["exam_id"])
    level = str(paper.get("level", "cet4")).lower()
    question_text = normalize(load_source_text(paper))
    answer_text = normalize(load_answer_text(paper))
    answers = answers_from_text(answer_text)
    override = {}
    if paper.get("options_override") and Path(paper["options_override"]).exists():
        override = json.loads(Path(paper["options_override"]).read_text(encoding="utf-8"))
    parts = split_parts(question_text)
    passages: list[dict[str, Any]] = []
    issues: list[str] = []

    reading = parts.get("reading", "")
    if reading:
        cloze, cloze_issues = parse_cloze(reading, answers, override)
        if cloze:
            passages.append(cloze)
        issues.extend(cloze_issues)
        matching, matching_issues = parse_matching(reading, answers)
        if matching:
            passages.append(matching)
        issues.extend(matching_issues)
        care, care_issues = parse_reading_c(question_text, answers, override)
        passages.extend(care)
        issues.extend(care_issues)
    else:
        issues.append("READING_PART_MISSING")

    listening = parts.get("listening", "")
    if listening and not paper.get("skip_listening"):
        transcripts = transcripts_from_text(answer_text, level)
        listening_passages, listening_issues = parse_listening(
            listening, answers, level, transcripts
        )
        passages.extend(listening_passages)
        issues.extend(listening_issues)

    writing = None
    if "writing" in parts:
        writing, writing_issues = parse_writing(parts["writing"])
        issues.extend(writing_issues)
    translation = None
    if "translation" in parts:
        translation, translation_issues = parse_translation(
            parts["translation"], question_text + "\n" + answer_text
        )
        issues.extend(translation_issues)

    # Apply explicit option overrides to preview items as well.
    for passage in passages:
        for question in passage.get("questions", []):
            values = override.get(str(question["number"]))
            if isinstance(values, dict):
                merged = [
                    {"key": key, "text": str(value)}
                    for key, value in sorted(values.items())
                ]
                existing = {item["key"] for item in question["options"]}
                if len(merged) > len(existing):
                    question["options"] = merged
                    question["pending"] = False
                    question["reasons"] = []
                    question["option_source"] = "override"

    all_questions = [
        question
        for passage in passages
        for question in passage.get("questions", [])
    ]
    pending = [question for question in all_questions if question.get("pending")]
    return {
        "exam_id": exam_id,
        "title": paper.get("title") or exam_id,
        "level": level,
        "source": paper.get("source", ""),
        "sections": sorted(
            {passage["section"] for passage in passages}
            | ({"writing"} if writing else set())
            | ({"translation"} if translation else set())
        ),
        "passages": passages,
        "writing": writing,
        "translation": translation,
        "issues": sorted(set(issues)),
        "stats": {
            "passages": len(passages),
            "questions": len(all_questions),
            "pending_questions": len(pending),
            "answers": sum(1 for question in all_questions if question.get("answer")),
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Dry-run structured parser")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--paper", action="append", default=None)
    parser.add_argument("--out-dir", type=Path, default=PREVIEW_DIR)
    args = parser.parse_args(argv)

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    papers = manifest["papers"] if isinstance(manifest, dict) else manifest
    wanted = set(args.paper or [])
    if wanted:
        papers = [paper for paper in papers if paper["exam_id"] in wanted]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    failures = 0
    for paper in papers:
        try:
            preview = parse_paper(paper)
            path = args.out_dir / f"{preview['exam_id']}.json"
            path.write_text(
                json.dumps(preview, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(
                f"=== {preview['exam_id']} | {preview['stats']['questions']} Q | "
                f"{preview['stats']['pending_questions']} pending | "
                f"issues {len(preview['issues'])} | {path}"
            )
            for issue in preview["issues"][:8]:
                print("  -", issue)
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(f"[FAILED] {paper.get('exam_id')}: {error}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
