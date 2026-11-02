#!/usr/bin/env python3
"""Import local CET-4 PDF exams into CET-Lab JSON.

Usage (from the project root):
  python scripts/import_exam_pdfs.py --input-dir content/imports/pdfs
  python scripts/import_exam_pdfs.py --input-dir content/imports/pdfs --dry-run

The script only reads PDFs you provide locally. It does not fetch pages from
the internet. PDFs must contain a text layer; scanned image-only PDFs cannot be
parsed without OCR.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

try:
    import pymupdf  # PyMuPDF
except ImportError:  # pragma: no cover
    print(
        "缺少 PyMuPDF。请先运行：\n"
        '  "C:\\Users\\COLORFUL\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" -m pip install pymupdf',
        file=sys.stderr,
    )
    raise SystemExit(2)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)
DEFAULT_INPUT = ROOT / "content" / "imports" / "pdfs"
DEFAULT_DATA = ROOT / "public" / "data"
DEFAULT_EXAMS = ROOT / "content" / "exams"
DEFAULT_TEXT = ROOT / "content" / "imports" / "pdf-text"

STOPWORDS = {
    "a", "an", "the", "of", "to", "in", "on", "and", "or", "is", "are",
    "was", "were", "be", "been", "being", "it", "this", "that", "these",
    "those", "with", "for", "as", "at", "by", "from", "we", "you", "they",
    "he", "she", "i", "its", "their", "his", "her", "our", "your", "has",
    "have", "had", "will", "would", "can", "could", "may", "might", "should",
    "not", "no", "so", "than", "then", "there", "here", "which", "who",
    "whom", "what", "when", "where", "why", "how", "more", "most", "some",
    "any", "all", "also", "into", "over", "under", "about", "across",
}

CHINESE_NUMERALS = {
    "一": "set1", "二": "set2", "三": "set3", "四": "set4",
    "五": "set5", "六": "set6", "1": "set1", "2": "set2",
    "3": "set3", "4": "set4", "5": "set5", "6": "set6",
}


@dataclass
class Question:
    number: int
    stem: str
    options: list[dict[str, str]]
    answer: str | None
    explanation: str
    evidence: list[dict[str, Any]]
    qtype: str
    section: str
    passage_id: str
    blank_index: int | None = None


@dataclass
class Passage:
    id: str
    section: str
    subtype: str
    order: int
    title: str
    body: str
    questions: list[Question] = field(default_factory=list)
    hot_topic_tags: list[str] = field(default_factory=lambda: ["unclassified"])
    word_bank: list[dict[str, str]] | None = None
    transcript: str | None = None
    audio_asset_id: str | None = None
    accent: str | None = None
    wpm: float | None = None


@dataclass
class Report:
    source: str
    included: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    generated_explanations: int = 0
    question_count: int = 0

    def skip(self, section: str, reason: str) -> None:
        self.skipped.append(f"{section}: {reason}")

    def warn(self, message: str) -> None:
        self.warnings.append(message)


def words(text: str) -> list[str]:
    return (re.findall(r"[A-Za-z][A-Za-z'’-]*", text) or [""])


def word_count(text: str) -> int:
    text = re.sub(r"\[\[\d+\]\]", " ", text)
    return len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'’\-]*", text))


def content_words(text: str) -> set[str]:
    return {
        word.lower()
        for word in re.findall(r"[A-Za-z][A-Za-z'’-]*", text)
        if len(word) >= 3 and word.lower() not in STOPWORDS
    }


def split_sentences(text: str) -> list[str]:
    return [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+", text.replace("\n", " "))
        if sentence.strip()
    ]


def normalize_paragraphs(text: str) -> str:
    paragraphs = []
    for paragraph in re.split(r"\n\s*\n", text):
        joined = re.sub(r"\s*\n\s*", " ", paragraph).strip()
        if joined:
            paragraphs.append(re.sub(r"[ \t]+", " ", joined))
    return "\n\n".join(paragraphs)


def clean_text(raw: str) -> str:
    raw = raw.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    lines: list[str] = []
    previous_nonempty = ""
    for line in raw.split("\n"):
        line = line.replace("\u00a0", " ").strip()
        if not line:
            lines.append("")
            continue
        if re.match(r"^[•・\-]?\s*20\d{2}\s*年.*真题.*$", line):
            previous_nonempty = line
            continue
        if re.search(r"第\s*\d+\s*页\s*共\s*\d+\s*页", line):
            previous_nonempty = line
            continue
        if re.match(r"^20\d{2}\.\d{1,2}\s+四级", line):
            previous_nonempty = line
            continue
        # Page numbers usually follow a footer. Keep standalone numbers
        # elsewhere: 26–35 are cloze blank markers, not page numbers.
        if re.match(r"^\d{1,3}$", line) and re.search(
            r"真题|四级|第\s*\d+\s*页", previous_nonempty
        ):
            continue
        lines.append(re.sub(r"[ \t]+", " ", line))
        previous_nonempty = line
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def extract_pdf_text(path: Path) -> tuple[str, int]:
    doc = pymupdf.open(path)
    pages = []
    for page in doc:
        pages.append(page.get_text())
    return clean_text("\n".join(pages)), doc.page_count


def detect_metadata(path: Path, text: str, args: argparse.Namespace) -> tuple[int, int, str]:
    filename = path.stem
    combined = f"{filename}\n{text[:1500]}"
    year = None
    month = None
    set_name = None

    m = re.search(r"(20\d{2})\s*年\s*(\d{1,2})\s*月", combined)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
    if not year:
        m = re.search(r"(20\d{2})[-_.](\d{1,2})", combined)
        if m:
            year, month = int(m.group(1)), int(m.group(2))

    m = re.search(r"第\s*([一二三四五六123456])\s*套", combined)
    if m:
        set_name = CHINESE_NUMERALS.get(m.group(1))
    if not set_name:
        m = re.search(r"(?:set|套)\s*([1-6])", combined, re.I)
        if m:
            set_name = f"set{m.group(1)}"

    year = args.year or year
    month = args.month or month
    set_name = args.set_name or set_name or "set1"

    if not year or not month:
        raise ValueError("无法识别年份/月份，请用 --year 和 --month 指定")
    return year, month, set_name


PART_RE = re.compile(
    r"(?im)^\s*Part\s+(?:I|II|III|IV|V|1|2|3|4|n|H[I1])\b[^\n]*$"
)
PART_NAMES = ["writing", "listening", "reading", "translation", "speaking"]


def split_parts(text: str) -> dict[str, str]:
    matches = list(PART_RE.finditer(text))
    parts: dict[str, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[match.end():end].strip()
        head = f"{match.group(0)} {body[:160]}".lower()
        name = None
        if "writing" in head:
            name = "writing"
        elif "listening" in head:
            name = "listening"
        elif "reading" in head:
            name = "reading"
        elif "translation" in head:
            name = "translation"
        if name is None and index < len(PART_NAMES):
            name = PART_NAMES[index]
        if name and name not in parts:
            parts[name] = body
    return parts


QUESTION_START_RE = re.compile(r"(?m)^\s*(\d{1,2})[.、．]\s*")


def extract_question_blocks(
    block: str, start: int, end: int
) -> list[tuple[int, str]]:
    matches = list(QUESTION_START_RE.finditer(block))
    blocks: list[tuple[int, str]] = []
    for index, match in enumerate(matches):
        number = int(match.group(1))
        if not (start <= number <= end):
            continue
        block_end = (
            matches[index + 1].start() if index + 1 < len(matches) else len(block)
        )
        body = block[match.end():block_end].strip()
        blocks.append((number, body))
    return blocks


OPTION_RE = re.compile(r"(?m)(?:^|\s)([A-D])[).]\s*")


def parse_options(body: str) -> tuple[str, list[dict[str, str]], str | None]:
    matches = list(OPTION_RE.finditer(body))
    if not matches:
        return body.strip(), [], None
    stem = body[: matches[0].start()].strip()
    options: dict[str, str] = {}
    duplicate = None
    for index, match in enumerate(matches):
        key = match.group(1)
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        text = re.sub(r"\s+", " ", body[start:end]).strip()
        if key in options:
            duplicate = key
        else:
            options[key] = text
    return stem, [
        {"key": key, "text": options[key]}
        for key in sorted(options)
    ], duplicate


def parse_answers(text: str) -> dict[int, str]:
    answers: dict[int, str] = {}
    markers = list(
        re.finditer(
            r"(?im)^\s*(?:参考答案|答案速查|答案与解析|答案详解|答案|Answer Key)\b.*$",
            text,
        )
    )
    # Do not scan the whole paper for "38. I..." style false positives.
    # Without an explicit answer-key heading, only inline "Answer: B" is used.
    if not markers:
        return {}
    tail = text[markers[-1].start():]

    for match in re.finditer(
        r"(\d{1,2})\s*[-–—~]\s*(\d{1,2})\s*[:：]?\s*([A-O](?:\s*[,，;；]?\s*[A-O])*)",
        tail,
    ):
        start, end = int(match.group(1)), int(match.group(2))
        letters = re.findall(r"[A-O]", match.group(3))
        for offset, letter in enumerate(letters):
            number = start + offset
            if number <= end:
                answers[number] = letter

    for match in re.finditer(
        r"(?m)^\s*(\d{1,2})[.、．]?\s*([A-O])\b", tail
    ):
        number = int(match.group(1))
        if 1 <= number <= 55:
            answers.setdefault(number, match.group(2))

    return answers


def parse_explanations(text: str) -> dict[int, str]:
    markers = list(
        re.finditer(r"(?im)^\s*(?:答案解析|答案详解|解析)\b.*$", text)
    )
    if not markers:
        return {}
    tail = text[markers[-1].start():]
    matches = list(QUESTION_START_RE.finditer(tail))
    result: dict[int, str] = {}
    for index, match in enumerate(matches):
        number = int(match.group(1))
        end = matches[index + 1].start() if index + 1 < len(matches) else len(tail)
        body = tail[match.end():end].strip()
        if body:
            result[number] = body[:5000]
    return result


def find_evidence(body: str, option_text: str) -> dict[str, Any]:
    paragraphs = [p for p in re.split(r"\n\s*\n", body) if p.strip()]
    targets = content_words(option_text)
    best: tuple[int, int, int, str] | None = None
    for p_index, paragraph in enumerate(paragraphs):
        for s_index, sentence in enumerate(split_sentences(paragraph)):
            score = len(targets & content_words(sentence))
            if score and (best is None or score > best[0]):
                best = (score, p_index + 1, s_index + 1, sentence)
    if best:
        return {"paragraph": best[1], "sentence": best[2], "quote": best[3][:500]}
    return {"paragraph": 1, "sentence": 1}


def find_segment_evidence(
    segments: list[str], option_text: str
) -> dict[str, Any]:
    targets = content_words(option_text)
    best: tuple[int, int] | None = None
    for index, segment in enumerate(segments):
        score = len(targets & content_words(segment))
        if score and (best is None or score > best[0]):
            best = (score, index)
    index = best[1] if best else 0
    return {"segment": index, "quote": segments[index][:500] if segments else ""}


def fallback_explanation(
    question: Question, word_text: str | None = None
) -> str:
    if question.options:
        option = next(
            (item["text"] for item in question.options if item["key"] == question.answer),
            "",
        )
        quote = question.evidence[0].get("quote") if question.evidence else None
        if quote:
            return (
                f"根据原文/关键句：“{quote}”，正确答案为 "
                f"{question.answer}（{option}）。"
            )
        return f"正确答案为 {question.answer}（{option}）。"
    if word_text:
        return f"正确答案为 {question.answer}（{word_text}）。"
    return f"正确答案为 {question.answer}。"


def question_type(stem: str, section: str) -> str:
    lower = stem.lower()
    if section == "listening":
        if "attitude" in lower or "think of" in lower:
            return "listening_attitude"
        if "infer" in lower or "why" in lower or "suggest" in lower:
            return "listening_inference"
        return "listening_detail"
    if "author" in lower and ("attitude" in lower or "think" in lower):
        return "attitude"
    if "main idea" in lower or "mainly" in lower or "purpose" in lower:
        return "main_idea"
    if "infer" in lower or "why" in lower or "suggest" in lower:
        return "inference"
    if "meaning" in lower or "word" in lower:
        return "vocabulary_in_context"
    return "detail"


def make_question(
    *,
    number: int,
    body: str,
    answer: str | None,
    explanation: str | None,
    section: str,
    passage_id: str,
    qtype: str | None = None,
    blank_index: int | None = None,
    passage_body: str | None = None,
    report: Report,
) -> Question | None:
    stem, options, duplicate = parse_options(body)
    stem = re.sub(r"\s+", " ", stem).strip()
    if duplicate:
        report.warn(f"题 {number} 选项 {duplicate} 重复，已保留第一次出现")
    if not stem:
        stem = f"Question {number}"

    if answer is None and options:
        inline = re.search(
            r"(?i)(?:Answer|答案)\s*[:：]\s*([A-O])", body
        )
        if inline:
            answer = inline.group(1)
    if answer is None:
        report.skip(f"题 {number}", "未找到答案")
        return None
    if options and answer not in {item["key"] for item in options}:
        report.skip(f"题 {number}", f"答案 {answer} 不在选项中")
        return None

    if qtype is None:
        qtype = question_type(stem, section)

    evidence: list[dict[str, Any]]
    if section == "reading" and passage_body:
        option_text = next(
            (item["text"] for item in options if item["key"] == answer),
            stem,
        )
        evidence = [find_evidence(passage_body, option_text)]
    else:
        evidence = [{"paragraph": 1, "sentence": 1}]

    final_explanation = explanation or fallback_explanation(
        Question(
            number=number,
            stem=stem,
            options=options,
            answer=answer,
            explanation="",
            evidence=evidence,
            qtype=qtype,
            section=section,
            passage_id=passage_id,
            blank_index=blank_index,
        )
    )
    if not explanation:
        report.generated_explanations += 1

    return Question(
        number=number,
        stem=stem,
        options=options,
        answer=answer,
        explanation=final_explanation,
        evidence=evidence,
        qtype=qtype,
        section=section,
        passage_id=passage_id,
        blank_index=blank_index,
    )


def parse_reading_c(
    part: str,
    answers: dict[int, str],
    explanations: dict[int, str],
    exam_id: str,
    report: Report,
) -> list[Passage]:
    headings = list(
        re.finditer(
            r"(?im)^\s*Passage\s+(One|Two|Three|[1-3])\s*$", part
        )
    )
    passages: list[Passage] = []
    for index, heading in enumerate(headings):
        start = heading.end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(part)
        chunk = part[start:end]
        q_range = re.search(
            r"(?im)Questions?\s+(\d{1,2})\s+(?:to|and|[-–—])\s+(\d{1,2})\s+are based",
            chunk,
        )
        if not q_range:
            report.skip(f"阅读 Passage {index + 1}", "未找到 Questions X to Y")
            continue
        start_num, end_num = int(q_range.group(1)), int(q_range.group(2))
        before = normalize_paragraphs(chunk[:q_range.start()])
        after_questions = chunk[q_range.end():]
        first_question = re.search(
            rf"(?m)^\s*{start_num}[.、．]\s*", after_questions
        )
        after = (
            normalize_paragraphs(after_questions[: first_question.start()])
            if first_question
            else ""
        )
        body = after or before
        if not body:
            report.skip(f"阅读 Passage {index + 1}", "未找到文章正文")
            continue
        qtext = (
            after_questions[first_question.start():]
            if first_question
            else ""
        )
        passage_id = f"psg_{exam_id}_r{index + 1}"
        passage = Passage(
            id=passage_id,
            section="reading",
            subtype="careful_reading",
            order=index + 1,
            title=f"Passage {index + 1}",
            body=body,
        )
        for number, qbody in extract_question_blocks(
            qtext, start_num, end_num
        ):
            q = make_question(
                number=number,
                body=qbody,
                answer=answers.get(number),
                explanation=explanations.get(number),
                section="reading",
                passage_id=passage_id,
                passage_body=body,
                report=report,
            )
            if q:
                if not q.options:
                    report.skip(f"题 {number}", "没有选项，已跳过")
                    continue
                passage.questions.append(q)
        if passage.questions:
            passages.append(passage)
        else:
            report.skip(f"阅读 Passage {index + 1}", "没有可用题目")
    return passages


def parse_reading_a(
    part: str,
    answers: dict[int, str],
    exam_id: str,
    report: Report,
) -> Passage | None:
    section = re.search(r"(?im)^\s*Section\s*A\b.*$", part)
    if not section:
        return None
    end_match = re.search(
        r"(?im)^\s*Section\s*B\b.*$", part[section.end():]
    )
    chunk = part[
        section.end(): section.end() + end_match.start()
        if end_match
        else len(part)
    ]
    bank: dict[str, str] = {}
    for match in re.finditer(
        r"(?m)^\s*([A-O])[).]\s*([A-Za-z][A-Za-z' -]{1,40})\s*$", chunk
    ):
        bank[match.group(1)] = match.group(2).strip()
    if len(bank) < 13:
        report.skip("阅读 Section A", f"词库不足（找到 {len(bank)} 个）")
        return None

    first_bank = re.search(
        r"(?m)^\s*[A-O][).]\s*[A-Za-z][A-Za-z' -]{1,40}\s*$", chunk
    )
    passage_text = chunk[: first_bank.start()] if first_bank else chunk
    passage_text = re.sub(
        r"(?is)^.*?Directions?:.*?\.\s*", "", passage_text, count=1
    )
    passage_text = passage_text.strip()

    by_number = {}
    for number in range(26, 36):
        pattern = re.compile(rf"(?m)^\s*{number}\s*$")
        match = pattern.search(passage_text)
        if match:
            by_number[number] = match
    if not by_number:
        report.skip("阅读 Section A", "未找到空格编号 26–35")
        return None

    for number, match in by_number.items():
        passage_text = passage_text.replace(match.group(0), f"[[{number - 25}]]", 1)

    body = normalize_paragraphs(passage_text)
    passage_id = f"psg_{exam_id}_cloze"
    passage = Passage(
        id=passage_id,
        section="reading",
        subtype="banked_cloze",
        order=1,
        title="Banked Cloze",
        body=body,
        word_bank=[{"key": k, "text": v} for k, v in sorted(bank.items())],
    )
    paragraphs = [p for p in body.split("\n\n") if p.strip()]
    for offset, number in enumerate(range(26, 36), start=1):
        answer = answers.get(number)
        if not answer or answer not in bank:
            report.skip(f"题 {number}", "未找到词库答案")
            continue
        evidence = {"paragraph": 1, "sentence": 1}
        for p_index, paragraph in enumerate(paragraphs):
            marker = f"[[{offset}]]"
            if marker in paragraph:
                before = paragraph[: paragraph.index(marker)]
                sentence = max(1, len(re.findall(r"[.!?]\s", before)) + 1)
                evidence = {"paragraph": p_index + 1, "sentence": sentence}
                break
        passage.questions.append(
            Question(
                number=number,
                stem=f"Blank {offset}",
                options=[],
                answer=answer,
                explanation=(
                    f"正确答案为 {answer}（{bank[answer]}）。"
                ),
                evidence=[evidence],
                qtype="banked_cloze",
                section="reading",
                passage_id=passage_id,
                blank_index=offset,
            )
        )
    return passage if passage.questions else None


def parse_reading_b(
    part: str,
    answers: dict[int, str],
    exam_id: str,
    report: Report,
) -> Passage | None:
    section = re.search(r"(?im)^\s*Section\s*B\b.*$", part)
    if not section:
        return None
    end_match = re.search(
        r"(?im)^\s*Section\s*C\b.*$", part[section.end():]
    )
    chunk = part[
        section.end(): section.end() + end_match.start()
        if end_match
        else len(part)
    ]
    paragraph_matches = list(
        re.finditer(r"(?m)^\s*([A-O])[).]\s+", chunk)
    )
    if len(paragraph_matches) < 5:
        report.skip("阅读 Section B", "未找到 A–O 段落")
        return None
    body_parts = []
    paragraph_texts: dict[str, str] = {}
    for index, match in enumerate(paragraph_matches):
        end = (
            paragraph_matches[index + 1].start()
            if index + 1 < len(paragraph_matches)
            else len(chunk)
        )
        text = chunk[match.end():end].strip()
        if text:
            body_parts.append(text)
            paragraph_texts[match.group(1)] = text
    body = normalize_paragraphs("\n\n".join(body_parts))
    if not body:
        return None
    passage_id = f"psg_{exam_id}_match"
    passage = Passage(
        id=passage_id,
        section="reading",
        subtype="careful_reading",
        order=2,
        title="Paragraph Matching",
        body=body,
    )
    first_statement = re.search(r"(?m)^\s*36[.、．]\s*", chunk)
    statement_text = chunk[first_statement.start():] if first_statement else chunk
    for number, qbody in extract_question_blocks(statement_text, 36, 45):
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
        first_sentence = split_sentences(paragraph_texts[answer])[:1]
        passage.questions.append(
            Question(
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


LISTENING_GROUPS = [
    ("News Report One", 1, 2),
    ("News Report Two", 3, 4),
    ("News Report Three", 5, 7),
    ("Conversation One", 8, 11),
    ("Conversation Two", 12, 15),
    ("Passage One", 16, 18),
    ("Passage Two", 19, 21),
    ("Passage Three", 22, 25),
]


def parse_listening_transcripts(text: str) -> dict[str, str]:
    markers = list(
        re.finditer(
            r"(?im)^\s*(?:听力原文|Listening Transcript|Transcript)\b.*$",
            text,
        )
    )
    if not markers:
        return {}
    tail = text[markers[0].start():]
    headings = list(
        re.finditer(
            r"(?im)^\s*(News Report (?:One|Two|Three)|Conversation (?:One|Two)|Passage (?:One|Two|Three))\s*$",
            tail,
        )
    )
    result: dict[str, str] = {}
    for index, heading in enumerate(headings):
        end = headings[index + 1].start() if index + 1 < len(headings) else len(tail)
        body = tail[heading.end():end].strip()
        body = re.split(
            r"(?im)^\s*(?:答案解析|答案详解|答案|解析)\b.*$", body
        )[0].strip()
        if body:
            result[heading.group(1).lower()] = re.sub(r"\[\d+\]\s*", "", body)
    return result


def parse_listening(
    part: str,
    answers: dict[int, str],
    explanations: dict[int, str],
    transcripts: dict[str, str],
    exam_id: str,
    report: Report,
) -> tuple[list[Passage], list[dict[str, Any]]]:
    passages: list[Passage] = []
    assets: list[dict[str, Any]] = []
    blocks = dict(extract_question_blocks(part, 1, 25))
    for index, (title, start, end) in enumerate(LISTENING_GROUPS, start=1):
        transcript = transcripts.get(title.lower())
        if not transcript:
            report.skip(title, "未找到听力逐字稿")
            continue
        transcript = normalize_paragraphs(transcript)
        segments = split_sentences(transcript)
        passage_id = f"psg_{exam_id}_l{index}"
        audio_id = f"aud_{exam_id}_l{index}"
        passage = Passage(
            id=passage_id,
            section="listening",
            subtype="careful_reading",
            order=index,
            title=title,
            body="",
            transcript=transcript,
            audio_asset_id=audio_id,
            accent="us",
            wpm=145,
        )
        for number in range(start, end + 1):
            body = blocks.get(number)
            if not body:
                report.skip(f"题 {number}", "未找到题目")
                continue
            q = make_question(
                number=number,
                body=body,
                answer=answers.get(number),
                explanation=explanations.get(number),
                section="listening",
                passage_id=passage_id,
                report=report,
            )
            if not q:
                continue
            option_text = next(
                (item["text"] for item in q.options if item["key"] == q.answer),
                q.stem,
            )
            q.evidence = [find_segment_evidence(segments, option_text)]
            if not explanations.get(number):
                q.explanation = fallback_explanation(q)
            passage.questions.append(q)
        if passage.questions:
            passages.append(passage)
            assets.append(
                {
                    "id": audio_id,
                    "kind": "audio",
                    "backend": "tts",
                    "src": "browser-speech",
                    "accent": "us",
                    "wpm": 145,
                    "synthetic": True,
                    "license": "TTS-generated",
                }
            )
        else:
            report.skip(title, "没有可用题目")
    return passages, assets


def parse_writing(
    part: str,
    full_text: str,
    exam_id: str,
    report: Report,
) -> Passage | None:
    directions = re.search(r"(?is)Directions:\s*", part)
    if not directions:
        report.skip("Writing", "未找到 Directions")
        return None
    prompt = part[directions.start():].strip()
    prompt = re.split(
        r"(?im)^\s*Part\s+(?:II|2|n)\b", prompt
    )[0].strip()
    if not prompt:
        return None
    sample = ""
    sample_match = re.search(r"(?is)参考范文[:：]\s*", full_text)
    if sample_match:
        sample = full_text[sample_match.end():]
        sample = re.split(
            r"(?im)^\s*(?:Part\s+IV|Translation|参考译文|答案解析|答案|听力原文)\b",
            sample,
        )[0].strip()
    explanation = (
        f"参考范文：\n\n{sample[:4500]}"
        if sample
        else "未在 PDF 中提取到参考范文，请人工补充参考范文与写作要点。"
    )
    passage_id = f"psg_{exam_id}_writing"
    passage = Passage(
        id=passage_id,
        section="writing",
        subtype="careful_reading",
        order=1,
        title="Writing Task",
        body=normalize_paragraphs(prompt),
    )
    passage.questions.append(
        Question(
            number=1,
            stem="Write an essay based on the directions.",
            options=[],
            answer="-",
            explanation=explanation,
            evidence=[
                {
                    "paragraph": 1,
                    "sentence": 1,
                    "quote": prompt[:500],
                }
            ],
            qtype="writing_task",
            section="writing",
            passage_id=passage_id,
        )
    )
    return passage


def parse_translation(
    part: str,
    full_text: str,
    exam_id: str,
    report: Report,
) -> Passage | None:
    lines = []
    for line in part.split("\n"):
        if re.match(
            r"(?im)^\s*(?:\u53c2\u8003\u8bd1\u6587|\u53c2\u8003\u8303\u6587|\u7b54\u6848|\u542c\u529b\u539f\u6587|Part\b)",
            line,
        ):
            break
        if re.search(r"[\u4e00-\u9fff]", line):
            lines.append(line.strip())
        elif lines and not line.strip():
            lines.append("")
    source = normalize_paragraphs("\n".join(lines))
    if not source:
        report.skip("Translation", "未找到中文原文")
        return None
    reference = ""
    ref_match = re.search(r"(?is)参考译文[:：]\s*", full_text)
    if ref_match:
        reference = full_text[ref_match.end():]
        reference = re.split(
            r"(?im)^\s*(?:Part\s+[IVX]+|答案解析|参考范文|答案|听力原文)\b",
            reference,
        )[0].strip()
    explanation = (
        f"参考译文：\n\n{reference[:4500]}"
        if reference
        else "未在 PDF 中提取到参考译文，请人工补充参考译文与译点提示。"
    )
    passage_id = f"psg_{exam_id}_translation"
    body = f"Translate the following passage into English.\n\n{source}"
    passage = Passage(
        id=passage_id,
        section="translation",
        subtype="careful_reading",
        order=1,
        title="Translation Task",
        body=body,
    )
    passage.questions.append(
        Question(
            number=1,
            stem="Translate the following passage into English.",
            options=[],
            answer="-",
            explanation=explanation,
            evidence=[
                {
                    "paragraph": 1,
                    "sentence": 1,
                    "quote": "Translate the following passage into English.",
                }
            ],
            qtype="translation",
            section="translation",
            passage_id=passage_id,
        )
    )
    return passage


def unique_exam_id(base: str, data_dir: Path, exams_dir: Path) -> str:
    candidate = base
    index = 2
    while (data_dir / f"{candidate}.json").exists() or (
        exams_dir / candidate
    ).exists():
        candidate = f"{base}-{index}"
        index += 1
    return candidate


def build_bundle(
    year: int,
    month: int,
    set_name: str,
    exam_id: str,
    passages: list[Passage],
    assets: list[dict[str, Any]],
) -> dict[str, Any]:
    sections = []
    for passage in passages:
        if passage.section not in sections:
            sections.append(passage.section)
    order = ["reading", "listening", "writing", "translation"]
    sections.sort(key=lambda item: order.index(item) if item in order else 99)

    bundle_passages = []
    bundle_questions = []
    for passage in passages:
        word_count_value = word_count(passage.transcript or passage.body)
        bundle_passages.append(
            {
                "id": passage.id,
                "exam_id": exam_id,
                "section": passage.section,
                "subtype": passage.subtype,
                "order": passage.order,
                "title": passage.title,
                "body_md": passage.body or (passage.transcript or ""),
                "word_count": word_count_value,
                "hot_topic_tags": passage.hot_topic_tags,
                **(
                    {"word_bank": passage.word_bank}
                    if passage.word_bank
                    else {}
                ),
                **(
                    {
                        "audio_asset_id": passage.audio_asset_id,
                        "accent": passage.accent,
                        "wpm": passage.wpm,
                        "transcript": passage.transcript,
                    }
                    if passage.section == "listening"
                    else {}
                ),
            }
        )
        for question in passage.questions:
            bundle_questions.append(
                {
                    "id": f"q_{exam_id}_{passage.id.removeprefix(f'psg_{exam_id}_')}_{question.number:02d}",
                    "exam_id": exam_id,
                    "passage_id": passage.id,
                    "section": passage.section,
                    "type": question.qtype,
                    "stem": question.stem,
                    **(
                        {"options": question.options}
                        if question.options
                        else {}
                    ),
                    "answer": question.answer,
                    "explanation": question.explanation,
                    "evidence": question.evidence,
                    "knowledge_tags": (
                        ["vocabulary_in_context"]
                        if question.qtype == "banked_cloze"
                        else ["main_idea"]
                        if question.qtype == "writing_task"
                        else ["paraphrase"]
                        if question.qtype == "translation"
                        else [question.qtype]
                    ),
                    "error_cause_tags": (
                        ["grammar", "lexical"]
                        if question.qtype in {"writing_task", "translation"}
                        else ["inference"]
                        if question.qtype
                        in {
                            "inference",
                            "listening_inference",
                            "attitude",
                            "listening_attitude",
                        }
                        else ["locating"]
                    ),
                    "hot_topic_tags": passage.hot_topic_tags,
                    "difficulty": 2,
                    **(
                        {"blank_index": question.blank_index}
                        if question.blank_index is not None
                        else {}
                    ),
                }
            )

    return {
        "schema_version": "1.0",
        "exam": {
            "id": exam_id,
            "title": f"{year} 年 {month} 月大学英语四级真题（{set_name}）",
            "year": year,
            "month": month,
            "set": set_name,
            "source": "user-entered",
            "license": "private",
            "content_version": "1.0.0",
            "sections": sections,
        },
        "passages": bundle_passages,
        "questions": bundle_questions,
        "assets": assets,
    }


def yaml_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(str(value), ensure_ascii=False)


def render_markdown(bundle: dict[str, Any]) -> str:
    exam = bundle["exam"]
    lines = ["---", "schema_version: \"1.0\"", "exam:"]
    for key in [
        "id", "title", "year", "month", "set", "source", "license",
        "content_version",
    ]:
        lines.append(f"  {key}: {yaml_scalar(exam[key])}")
    lines.append("  sections:")
    for section in exam["sections"]:
        lines.append(f"    - {section}")
    if bundle["assets"]:
        lines.append("assets:")
        for asset in bundle["assets"]:
            lines.append(f"  - id: {yaml_scalar(asset['id'])}")
            for key in ["kind", "backend", "src", "accent", "wpm", "synthetic", "license"]:
                if key in asset:
                    lines.append(f"    {key}: {yaml_scalar(asset[key])}")
    else:
        lines.append("assets: []")
    lines.append("---")
    lines.append("")

    for index, passage in enumerate(bundle["passages"], start=1):
        lines.append(f"## Passage {index}")
        lines.append("")
        lines.append("```yaml passage")
        lines.append(f"id: {yaml_scalar(passage['id'])}")
        lines.append(f"section: {passage['section']}")
        lines.append(f"subtype: {passage['subtype']}")
        lines.append(f"order: {passage['order']}")
        lines.append(f"title: {yaml_scalar(passage['title'])}")
        lines.append("hot_topic_tags:")
        for tag in passage["hot_topic_tags"]:
            lines.append(f"  - {tag}")
        lines.append(f"word_count: {passage['word_count']}")
        if passage.get("word_bank"):
            lines.append("word_bank:")
            for option in passage["word_bank"]:
                lines.append(f"  - key: {option['key']}")
                lines.append(f"    text: {yaml_scalar(option['text'])}")
        if passage["section"] == "listening":
            for key in ["audio_asset_id", "accent", "wpm"]:
                if passage.get(key) is not None:
                    lines.append(f"{key}: {yaml_scalar(passage[key])}")
            lines.append(f"transcript: {yaml_scalar(passage.get('transcript') or '')}")
        lines.append("```")
        lines.append("")
        if passage["body_md"]:
            lines.append(passage["body_md"])
            lines.append("")
        questions = [
            question
            for question in bundle["questions"]
            if question["passage_id"] == passage["id"]
        ]
        lines.append("```json questions")
        lines.append(json.dumps(questions, ensure_ascii=False, indent=2))
        lines.append("```")
        lines.append("")
    return "\n".join(lines)


def validate_bundle(bundle: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    ids = set()
    for collection in ["passages", "questions"]:
        for item in bundle[collection]:
            if item["id"] in ids:
                errors.append(f"ID 重复：{item['id']}")
            ids.add(item["id"])
    passage_by_id = {p["id"]: p for p in bundle["passages"]}
    for question in bundle["questions"]:
        passage = passage_by_id.get(question["passage_id"])
        if not passage:
            errors.append(f"{question['id']} 引用了不存在的 passage")
            continue
        if question.get("options"):
            keys = {option["key"] for option in question["options"]}
            if question["answer"] not in keys:
                errors.append(
                    f"{question['id']} 答案 {question['answer']} 不在选项中"
                )
    return errors


def write_report(
    report: Report,
    output: Path,
    bundle: dict[str, Any] | None,
) -> None:
    lines = [f"# PDF 导入报告：{report.source}", ""]
    lines.append(f"- 题目数：{report.question_count}")
    lines.append(f"- 自动生成解析数：{report.generated_explanations}")
    if bundle:
        lines.append(f"- 试卷 ID：{bundle['exam']['id']}")
        lines.append(f"- 板块：{', '.join(bundle['exam']['sections']) or '无'}")
    lines.append("")
    lines.append("## 已导入板块")
    if report.included:
        lines.extend(f"- {item}" for item in report.included)
    else:
        lines.append("- 无")
    lines.append("")
    lines.append("## 跳过 / 缺失")
    if report.skipped:
        lines.extend(f"- {item}" for item in report.skipped)
    else:
        lines.append("- 无")
    lines.append("")
    lines.append("## 警告")
    if report.warnings:
        lines.extend(f"- {item}" for item in report.warnings)
    else:
        lines.append("- 无")
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def import_pdf(
    path: Path,
    args: argparse.Namespace,
    data_dir: Path,
    exams_dir: Path,
    text_dir: Path,
) -> None:
    report = Report(source=str(path))
    text, page_count = extract_pdf_text(path)
    text_dir.mkdir(parents=True, exist_ok=True)
    (text_dir / f"{path.stem}.txt").write_text(text, encoding="utf-8")
    if not text.strip():
        print(f"[跳过] {path.name}: 没有文本层（可能是扫描版）")
        return

    year, month, set_name = detect_metadata(path, text, args)
    base_id = f"exam_{year:04d}-{month:02d}_{set_name}"
    if args.force:
        exam_id = base_id
        if (data_dir / f"{year:04d}-{month:02d}-{set_name}.json").exists():
            report.warn("--force：将覆盖同名 JSON / exam.md")
    else:
        exam_id = unique_exam_id(base_id, data_dir, exams_dir)
        if exam_id != base_id:
            report.warn(f"ID 已存在，改用 {exam_id}")

    parts = split_parts(text)
    answers = parse_answers(text)
    explanations = parse_explanations(text)
    transcripts = parse_listening_transcripts(text)

    passages: list[Passage] = []
    assets: list[dict[str, Any]] = []

    if "reading" in parts:
        reading = parts["reading"]
        cloze = parse_reading_a(reading, answers, exam_id, report)
        matching = parse_reading_b(reading, answers, exam_id, report)
        careful = parse_reading_c(reading, answers, explanations, exam_id, report)
        if cloze:
            passages.append(cloze)
        if matching:
            passages.append(matching)
        passages.extend(careful)
        if cloze or matching or careful:
            report.included.append("reading")
        else:
            report.skip("Reading", "没有解析出可用阅读题")
    else:
        report.skip("Reading", "未找到 Part III Reading")

    if "listening" in parts:
        listening_passages, listening_assets = parse_listening(
            parts["listening"], answers, explanations, transcripts, exam_id, report
        )
        passages.extend(listening_passages)
        assets.extend(listening_assets)
        if listening_passages:
            report.included.append("listening")
        else:
            report.skip("Listening", "没有逐字稿，未生成听力题")
    else:
        report.skip("Listening", "未找到 Part II Listening")

    if "writing" in parts:
        writing = parse_writing(parts["writing"], text, exam_id, report)
        if writing:
            passages.append(writing)
            report.included.append("writing")
        else:
            report.skip("Writing", "未解析出写作题")
    else:
        report.skip("Writing", "未找到 Part I Writing")

    if "translation" in parts:
        translation = parse_translation(parts["translation"], text, exam_id, report)
        if translation:
            passages.append(translation)
            report.included.append("translation")
        else:
            report.skip("Translation", "未解析出翻译题")
    else:
        report.skip("Translation", "未找到 Part IV Translation")

    # Ensure passage orders are sequential within each section.
    order_by_section: dict[str, int] = {}
    for passage in passages:
        order_by_section[passage.section] = order_by_section.get(passage.section, 0) + 1
        passage.order = order_by_section[passage.section]

    bundle = build_bundle(year, month, set_name, exam_id, passages, assets)
    report.question_count = len(bundle["questions"])
    errors = validate_bundle(bundle)
    if errors:
        for error in errors:
            report.warn(error)
    if not bundle["passages"] or not bundle["questions"]:
        print(f"[跳过] {path.name}: 没有可写入的有效题目")
        report_output = data_dir / f"{year:04d}-{month:02d}-{set_name}.report.md"
        write_report(report, report_output, None)
        return

    stem = f"{year:04d}-{month:02d}-{set_name}"
    if exam_id != base_id:
        stem = exam_id.removeprefix("exam_")
    json_path = data_dir / f"{stem}.json"
    report_path = data_dir / f"{stem}.report.md"
    md_path = exams_dir / exam_id / "exam.md"

    print(f"[解析] {path.name}")
    print(f"  试卷：{exam_id}（{page_count} 页）")
    print(f"  题目：{len(bundle['questions'])}，板块：{', '.join(bundle['exam']['sections'])}")
    if report.skipped:
        print(f"  跳过：{len(report.skipped)} 项（详见报告）")
    if args.dry_run:
        print("  --dry-run：未写入文件")
        return

    data_dir.mkdir(parents=True, exist_ok=True)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    md_path.write_text(render_markdown(bundle), encoding="utf-8")
    write_report(report, report_path, bundle)
    print(f"  写入：{display_path(json_path)}")
    print(f"  写入：{display_path(md_path)}")
    print(f"  报告：{display_path(report_path)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import local CET-4 PDF exams")
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--exam-md-dir", type=Path, default=DEFAULT_EXAMS)
    parser.add_argument("--text-dir", type=Path, default=DEFAULT_TEXT)
    parser.add_argument("--year", type=int)
    parser.add_argument("--month", type=int)
    parser.add_argument("--set", dest="set_name")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--force",
        action="store_true",
        help="覆盖同名的 JSON / exam.md（默认自动加 -2、-3 后缀）",
    )
    args = parser.parse_args()

    input_dir = args.input_dir
    if not input_dir.exists():
        input_dir.mkdir(parents=True, exist_ok=True)
        print(f"已创建输入目录：{input_dir}")
        print("把 PDF 放进该目录后重新运行。")
        return

    pdfs = [
        path
        for path in sorted(input_dir.rglob("*.pdf"))
        if not path.name.startswith("~$")
    ]
    if not pdfs:
        print(f"没有找到 PDF：{input_dir}")
        return

    print(f"找到 {len(pdfs)} 个 PDF")
    for path in pdfs:
        try:
            import_pdf(path, args, args.output_dir, args.exam_md_dir, args.text_dir)
        except Exception as error:  # noqa: BLE001
            print(f"[失败] {path.name}: {error}", file=sys.stderr)


if __name__ == "__main__":
    main()
