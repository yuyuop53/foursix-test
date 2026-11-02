#!/usr/bin/env python3
"""Extract CET-4 reading questions from PDF/text into a review JSON draft.

This is intentionally a *draft-first* tool: PDF layouts vary, so it writes a
JSON file for human review before anything is committed to the app content.

Supported:
  - careful reading (MCQ): question number, stem, A-D options, answer/explanation
  - banked cloze: word bank + passage blanks + answer key
  - paragraph matching: extracted as an unsupported draft only (the app does
    not have a matching practice UI yet)

Dependencies:
  - Python 3.10+
  - optional: pdfplumber for PDF input (`pip install pdfplumber`)
  - .txt / .md input works with the standard library only

Examples:
  # Review one careful-reading question; writes a draft JSON, no app content.
  python -I scripts/import_pdf_reading.py --input paper.pdf --page 3 \
    --section careful_reading --limit 1 --answers 46:B

  # Use copied text instead of a PDF (no pdfplumber needed).
  python -I scripts/import_pdf_reading.py --input page.txt --limit 1 --stdout

  # Commit to content/exams after reviewing the JSON.
  python -I scripts/import_pdf_reading.py --input paper.pdf --page 3 \
    --section careful_reading --limit 1 --answers 46:B \
    --output content/imports/pdf-draft.json --commit
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import import_reading as core  # noqa: E402


HEADER_PATTERNS = [
    r"^大学英语四级考试",
    r"^大學英語四級考試",
    r"^College English Test",
    r"^CET-?4",
    r"^Part\s+[IVX]+",
    r"^Section\s+[ABC]",
    r"^Questions?\s+\d+\s*(?:to|-|–)\s*\d+",
    r"^Passage\s+(?:One|Two|Three|Four|Five|\d+)",
    r"^Directions?\s*[:：]",
]

OPTION_LINE_RE = re.compile(r"^\s*([A-O])\s*[.)、]\s*(.*)$")
QUESTION_LINE_RE = re.compile(r"^\s*(\d{1,3})\s*[.、)]\s*(.*)$")
ANSWER_RE = re.compile(
    r"(?:答案|正确答案|正確答案|Answer|【答案】)\s*[:：]?\s*([A-O])",
    re.IGNORECASE,
)
EXPLANATION_RE = re.compile(
    r"(?:解析|Explanation|【解析】)\s*[:：]?\s*(.*)",
    re.IGNORECASE,
)


@dataclass
class ParsedQuestion:
    number: int
    stem: str
    options: list[dict[str, str]]
    answer: str | None
    explanation: str
    warnings: list[str] = field(default_factory=list)


@dataclass
class ParsedPassage:
    title: str
    text: str
    word_bank: list[dict[str, str]] = field(default_factory=list)


@dataclass
class ParseResult:
    section: str
    passage: ParsedPassage
    questions: list[ParsedQuestion]
    warnings: list[str] = field(default_factory=list)
    supported: bool = True


def is_header(line: str) -> bool:
    return any(re.match(pattern, line.strip(), re.IGNORECASE) for pattern in HEADER_PATTERNS)


def clean_lines(text: str) -> list[str]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines: list[str] = []
    for raw in normalized.split("\n"):
        line = raw.strip()
        if not line:
            continue
        if re.fullmatch(r"\d{1,3}", line):
            continue
        lines.append(line)
    return lines


def select_pages(total: int, spec: str | None) -> list[int]:
    if not spec:
        return list(range(1, total + 1))

    selected: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start, end = int(start_text), int(end_text)
            selected.update(range(start, end + 1))
        else:
            selected.add(int(part))

    return sorted(page for page in selected if 1 <= page <= total)


def extract_text(
    path: Path,
    pages_spec: str | None,
    layout: bool,
) -> tuple[str, list[int]]:
    if path.suffix.lower() in {".txt", ".md"}:
        return path.read_text(encoding="utf-8-sig"), [1]

    if path.suffix.lower() != ".pdf":
        raise RuntimeError("只支援 .pdf / .txt / .md 輸入。")

    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError(
            "解析 PDF 需要 pdfplumber；請先安裝：pip install pdfplumber"
        ) from error

    chunks: list[str] = []
    selected_pages: list[int] = []
    with pdfplumber.open(str(path)) as pdf:
        for page_number in select_pages(len(pdf.pages), pages_spec):
            page = pdf.pages[page_number - 1]
            text = page.extract_text(
                x_tolerance=2,
                y_tolerance=3,
                layout=layout,
            ) or ""
            selected_pages.append(page_number)
            chunks.append(text)

    combined = "\n\n".join(chunks)
    if not combined.strip():
        raise RuntimeError(
            "PDF 沒有可提取文字，可能是掃描檔；請先用 OCR 轉成可選取文字的 PDF。"
        )
    return combined, selected_pages


def detect_section(text: str, requested: str) -> str:
    if requested != "auto":
        return requested

    lower = text.lower()
    if "選詞填空" in text or "banked cloze" in lower or "word bank" in lower:
        return "banked_cloze"
    if "長篇閱讀" in text or "段落匹配" in text or "paragraph matching" in lower:
        return "paragraph_matching"
    return "careful_reading"


def parse_answer_map(inline: str | None, file_path: str | None) -> dict[int, str]:
    answers: dict[int, str] = {}

    if inline:
        for token in re.split(r"[,;，；]", inline):
            match = re.match(r"\s*(\d{1,3})\s*[:：.=]\s*([A-O])\s*$", token, re.I)
            if match:
                answers[int(match.group(1))] = match.group(2).upper()

    if file_path:
        raw = Path(file_path).read_text(encoding="utf-8-sig")
        stripped = raw.strip()
        if stripped.startswith("{"):
            payload = json.loads(stripped)
            for key, value in payload.items():
                answers[int(key)] = str(value).strip().upper()
        else:
            for line in raw.splitlines():
                match = re.match(r"\s*(\d{1,3})\s*[:：.=)]?\s*([A-O])\b", line, re.I)
                if match:
                    answers[int(match.group(1))] = match.group(2).upper()

    return answers


def parse_inline_options(text: str) -> tuple[str, list[dict[str, str]]]:
    matches = list(re.finditer(r"(?<![A-Za-z])([A-D])\s*[.)、]\s*", text))
    if len(matches) < 2:
        return text.strip(), []

    options: list[dict[str, str]] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        options.append(
            {
                "key": match.group(1).upper(),
                "text": text[start:end].strip(),
            }
        )
    return text[: matches[0].start()].strip(), options


def parse_options(lines: list[str]) -> list[dict[str, str]]:
    options: list[dict[str, str]] = []

    for line in lines:
        match = OPTION_LINE_RE.match(line)
        if match and match.group(1) in "ABCD":
            options.append(
                {
                    "key": match.group(1).upper(),
                    "text": match.group(2).strip(),
                }
            )
            continue

        inline_stem, inline_options = parse_inline_options(line)
        if len(inline_options) >= 2:
            options.extend(inline_options)
            continue

        if options and not ANSWER_RE.search(line) and not EXPLANATION_RE.search(line):
            # Wrapped option text in PDF extraction.
            if not re.match(r"^\d", line):
                options[-1]["text"] = (options[-1]["text"] + " " + line).strip()

    return options


def find_question_candidates(lines: list[str]) -> list[tuple[int, int, str]]:
    candidates: list[tuple[int, int, str]] = []

    for index, line in enumerate(lines):
        match = QUESTION_LINE_RE.match(line)
        if not match:
            continue
        number = int(match.group(1))
        if number < 1 or number > 100:
            continue

        window = lines[index + 1:index + 14]
        option_count = sum(
            1 for item in window if OPTION_LINE_RE.match(item)
        )
        inline_count = len(re.findall(r"(?<![A-Za-z])[A-D]\s*[.)、]", line))
        if option_count >= 2 or inline_count >= 2:
            candidates.append((index, number, match.group(2).strip()))

    return candidates


def build_question_from_block(
    number: int,
    first_text: str,
    block: list[str],
    answers: dict[int, str],
    warnings: list[str],
) -> ParsedQuestion:
    stem, inline_options = parse_inline_options(first_text)
    options = inline_options or parse_options(block[1:])

    answer = answers.get(number)
    if answer is None:
        for line in block:
            match = ANSWER_RE.search(line)
            if match:
                answer = match.group(1).upper()
                break

    explanation = ""
    for index, line in enumerate(block):
        match = EXPLANATION_RE.search(line)
        if match:
            explanation = match.group(1).strip()
            if not explanation and index + 1 < len(block):
                explanation = block[index + 1].strip()
            break

    question_warnings: list[str] = []
    if answer is None:
        question_warnings.append(
            f"第 {number} 題沒有找到答案；請用 --answers {number}:B 指定。"
        )
    elif options and answer not in {option["key"] for option in options}:
        question_warnings.append(
            f"第 {number} 題答案 {answer} 不在選項 {', '.join(option['key'] for option in options)} 中。"
        )
    if len(options) < 2:
        question_warnings.append(f"第 {number} 題只抽到 {len(options)} 個選項。")

    warnings.extend(question_warnings)
    return ParsedQuestion(
        number=number,
        stem=stem or f"Question {number}",
        options=options,
        answer=answer,
        explanation=explanation,
        warnings=question_warnings,
    )


def parse_careful_reading(
    lines: list[str],
    answers: dict[int, str],
    passage_text_file: str | None,
    title: str | None,
) -> ParseResult:
    candidates = find_question_candidates(lines)
    if not candidates:
        raise RuntimeError(
            "找不到題目區塊（需要像 46. ... 的題號與 A-D 選項）。"
            "可先用 --dump-text 檢查抽取出的文字，或確認 --page 是否包含題目。"
        )

    questions: list[ParsedQuestion] = []
    warnings: list[str] = []

    for index, (line_index, number, first_text) in enumerate(candidates):
        next_index = (
            candidates[index + 1][0]
            if index + 1 < len(candidates)
            else len(lines)
        )
        block = lines[line_index:next_index]
        questions.append(
            build_question_from_block(
                number,
                first_text,
                block,
                answers,
                warnings,
            )
        )

    if passage_text_file:
        passage_text = Path(passage_text_file).read_text(encoding="utf-8-sig").strip()
    else:
        first_question_index = candidates[0][0]
        passage_lines = [
            line
            for line in lines[:first_question_index]
            if not is_header(line)
        ]
        passage_text = "\n\n".join(passage_lines).strip()

    if not passage_text:
        raise RuntimeError(
            "找不到文章正文。請用 --pages 把文章所在頁一起納入，"
            "或用 --passage-text-file 指定文章文字檔。"
        )

    if "```" in passage_text:
        raise RuntimeError("文章文字包含 ```，會破壞 Markdown 區塊。")

    return ParseResult(
        section="careful_reading",
        passage=ParsedPassage(
            title=title or "PDF Passage",
            text=passage_text,
        ),
        questions=questions,
        warnings=warnings,
        supported=True,
    )


def parse_banked_cloze(
    lines: list[str],
    answers: dict[int, str],
    title: str | None,
) -> ParseResult:
    word_bank: list[dict[str, str]] = []
    passage_lines: list[str] = []
    warnings: list[str] = []
    in_word_bank = False

    for line in lines:
        if re.search(r"word\s*bank|詞庫|选词填空|選詞填空", line, re.I):
            in_word_bank = True
            continue

        match = OPTION_LINE_RE.match(line)
        if in_word_bank and match:
            word_bank.append(
                {
                    "key": match.group(1).upper(),
                    "text": match.group(2).strip(),
                }
            )
            continue
        if in_word_bank and not match:
            in_word_bank = False

        if is_header(line):
            continue

        passage_lines.append(line)

    passage_text = "\n\n".join(passage_lines).strip()
    if not passage_text:
        raise RuntimeError("選詞填空找不到 passage 文字。")

    blank_numbers: list[int] = []
    for match in re.finditer(r"\((\d{1,3})\)", passage_text):
        number = int(match.group(1))
        if number not in blank_numbers:
            blank_numbers.append(number)

    if not blank_numbers:
        raise RuntimeError(
            "選詞填空找不到 (26)、(27)… 形式的空白標記。"
        )

    questions: list[ParsedQuestion] = []
    for index, original_number in enumerate(blank_numbers, start=1):
        answer = answers.get(original_number)
        if answer is None:
            warnings.append(
                f"第 {original_number} 空沒有答案；請用 --answers {original_number}:B 指定。"
            )
        questions.append(
            ParsedQuestion(
                number=original_number,
                stem=f"Blank {original_number}",
                options=[],
                answer=answer,
                explanation="",
                warnings=[],
            )
        )

    # Replace (26) with [[1]], (27) with [[2]], ... in order.
    normalized = passage_text
    for index, original_number in enumerate(blank_numbers, start=1):
        normalized = normalized.replace(f"({original_number})", f"[[{index}]]", 1)

    if len(word_bank) < len(blank_numbers) + 3:
        warnings.append(
            f"詞庫只有 {len(word_bank)} 個，選詞填空需要至少 {len(blank_numbers) + 3} 個（含 3 個干擾項）。"
        )

    return ParseResult(
        section="banked_cloze",
        passage=ParsedPassage(
            title=title or "PDF Banked Cloze",
            text=normalized,
            word_bank=word_bank,
        ),
        questions=questions,
        warnings=warnings,
        supported=True,
    )


def parse_matching(
    lines: list[str],
    answers: dict[int, str],
    title: str | None,
) -> ParseResult:
    paragraphs: list[dict[str, str]] = []
    statements: list[ParsedQuestion] = []
    warnings: list[str] = []
    current_paragraph: dict[str, str] | None = None

    for line in lines:
        paragraph_match = re.match(r"^\s*([A-G])\s*[.)、]\s*(.+)$", line)
        if paragraph_match:
            current_paragraph = {
                "key": paragraph_match.group(1),
                "text": paragraph_match.group(2).strip(),
            }
            paragraphs.append(current_paragraph)
            continue

        statement_match = QUESTION_LINE_RE.match(line)
        if statement_match:
            number = int(statement_match.group(1))
            if 1 <= number <= 100:
                answer = answers.get(number)
                if answer is None:
                    inline_answer = ANSWER_RE.search(statement_match.group(2))
                    if inline_answer:
                        answer = inline_answer.group(1).upper()
                statements.append(
                    ParsedQuestion(
                        number=number,
                        stem=statement_match.group(2).strip(),
                        options=[],
                        answer=answer,
                        explanation="",
                    )
                )
                if answer is None:
                    warnings.append(
                        f"第 {number} 題沒有答案；請用 --answers {number}:A 指定。"
                    )
                continue

        if current_paragraph and not is_header(line):
            current_paragraph["text"] += " " + line.strip()

    if not paragraphs or not statements:
        raise RuntimeError(
            "長篇匹配需要 A-G 段落與 36-45 形式的敘述句；目前抽取結果不足。"
        )

    passage_text = "\n\n".join(
        f"{paragraph['key']}) {paragraph['text']}"
        for paragraph in paragraphs
    )

    return ParseResult(
        section="paragraph_matching",
        passage=ParsedPassage(
            title=title or "PDF Paragraph Matching",
            text=passage_text,
        ),
        questions=statements,
        warnings=warnings,
        supported=False,
    )


def infer_question_type(stem: str) -> tuple[str, list[str], list[str]]:
    lower = stem.lower()
    if any(word in lower for word in ("infer", "imply", "suggest", "likely")):
        return "inference", ["inference"], ["inference"]
    if any(word in lower for word in ("attitude", "tone", "feel about")):
        return "attitude", ["attitude"], ["inference"]
    if any(word in lower for word in ("main idea", "mainly", "purpose", "title")):
        return "main_idea", ["main_idea"], ["locating"]
    if any(word in lower for word in ("mean", "refer to", "closest in meaning")):
        return "vocabulary_in_context", ["vocabulary_in_context"], ["lexical"]
    return "detail", ["detail"], ["locating"]


def build_exam_draft(
    result: ParseResult,
    args: argparse.Namespace,
) -> core.ExamDraft:
    year = args.year or 2026
    month = args.month or 11
    set_name = args.set or "pdf"
    exam_id = args.exam_id or f"exam_pdf_{year}-{month:02d}_{core.slugify(set_name)}"
    passage_id = f"psg_{exam_id}_r1"
    exam = core.ExamDraft(
        id=exam_id,
        title=args.exam_title or f"PDF import {exam_id}",
        year=year,
        month=month,
        set_name=set_name,
        source=args.source,
        license=args.license,
        content_version="1.0.0",
    )

    questions: list[core.QuestionDraft] = []
    for index, question in enumerate(result.questions, start=1):
        if result.section == "careful_reading":
            question_type, knowledge_tags, error_causes = infer_question_type(
                question.stem
            )
            if not question.answer:
                raise RuntimeError(
                    f"第 {question.number} 題缺少答案，無法 commit。"
                )
            if len(question.options) < 2:
                raise RuntimeError(
                    f"第 {question.number} 題選項不足，無法 commit。"
                )
            options = question.options
            blank_index = None
        else:
            question_type = "banked_cloze"
            knowledge_tags = ["vocabulary_in_context"]
            error_causes = ["lexical"]
            options = []
            blank_index = index
            if not question.answer:
                raise RuntimeError(
                    f"第 {question.number} 空缺少答案，無法 commit。"
                )

        questions.append(
            core.QuestionDraft(
                id=f"q_{exam_id}_r1_{index:02d}",
                passage_id=passage_id,
                section="reading",
                type=question_type,
                stem=question.stem,
                options=options,
                answer=question.answer or "",
                explanation=question.explanation,
                evidence=[{"paragraph": 1, "sentence": 1}],
                knowledge_tags=knowledge_tags,
                error_cause_tags=error_causes,
                hot_topic_tags=[],
                difficulty=3,
                blank_index=blank_index,
            )
        )

    passage = core.PassageDraft(
        id=passage_id,
        exam_id=exam_id,
        section="reading",
        subtype=result.section,
        order=1,
        title=result.passage.title,
        body_md=result.passage.text,
        hot_topic_tags=[],
        word_count=core.count_words(result.passage.text),
        word_bank=result.passage.word_bank,
        questions=questions,
    )
    exam.passages.append(passage)
    return exam


def exam_to_bundle(exam: core.ExamDraft) -> dict[str, Any]:
    passages: list[dict[str, Any]] = []
    questions: list[dict[str, Any]] = []
    exam_id = exam.id

    for passage in exam.passages:
        passage_payload: dict[str, Any] = {
            "id": passage.id,
            "exam_id": passage.exam_id,
            "section": passage.section,
            "subtype": passage.subtype,
            "order": passage.order,
            "title": passage.title,
            "body_md": passage.body_md,
            "word_count": passage.word_count,
            "hot_topic_tags": passage.hot_topic_tags,
        }
        if passage.word_bank:
            passage_payload["word_bank"] = passage.word_bank
        passages.append(passage_payload)

        for question in passage.questions:
            payload: dict[str, Any] = {
                "id": question.id,
                "exam_id": exam_id,
                "passage_id": question.passage_id,
                "section": question.section,
                "type": question.type,
                "stem": question.stem,
                "options": question.options,
                "answer": question.answer,
                "explanation": question.explanation,
                "evidence": question.evidence,
                "knowledge_tags": question.knowledge_tags,
                "error_cause_tags": question.error_cause_tags,
                "hot_topic_tags": question.hot_topic_tags,
                "difficulty": question.difficulty,
            }
            if question.blank_index is not None:
                payload["blank_index"] = question.blank_index
            if not payload["options"]:
                payload.pop("options")
            questions.append(payload)

    return {
        "schema_version": "1.1",
        "exam": {
            "id": exam.id,
            "title": exam.title,
            "year": exam.year,
            "month": exam.month,
            "set": exam.set_name,
            "source": exam.source,
            "license": exam.license,
            "content_version": exam.content_version,
            "sections": ["reading"],
        },
        "passages": passages,
        "questions": questions,
        "assets": [],
    }


def draft_payload(
    result: ParseResult,
    args: argparse.Namespace,
    input_path: Path,
    pages: list[int],
    bundle: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "source": {
            "input": str(input_path),
            "pages": pages,
            "section": result.section,
        },
        "supported": result.supported,
        "needs_review": bool(
            result.warnings
            or any(question.warnings for question in result.questions)
        ),
        "warnings": result.warnings,
        "passage": {
            "title": result.passage.title,
            "text": result.passage.text,
            "word_count": core.count_words(result.passage.text),
            "word_bank": result.passage.word_bank,
        },
        "questions": [
            {
                "number": question.number,
                "stem": question.stem,
                "options": question.options,
                "answer": question.answer,
                "explanation": question.explanation,
                "warnings": question.warnings,
            }
            for question in result.questions
        ],
        "system_bundle": bundle,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract CET-4 reading questions from PDF/text into a review JSON draft."
    )
    parser.add_argument("--input", required=True)
    parser.add_argument("--page", default=None, help="單頁，例如 3")
    parser.add_argument("--pages", default=None, help="頁碼範圍，例如 2-4,6")
    parser.add_argument(
        "--section",
        choices=["auto", "careful_reading", "banked_cloze", "paragraph_matching"],
        default="auto",
    )
    parser.add_argument("--limit", type=int, default=1, help="只取前 N 題；0 = 全部")
    parser.add_argument("--question", type=int, default=None, help="只取指定題號")
    parser.add_argument("--answers", default=None, help='例如 "46:B,47:C"')
    parser.add_argument("--answers-file", default=None)
    parser.add_argument("--passage-text-file", default=None)
    parser.add_argument("--title", default=None)
    parser.add_argument("--exam-id", default=None)
    parser.add_argument("--exam-title", default=None)
    parser.add_argument("--year", type=int, default=None)
    parser.add_argument("--month", type=int, default=None)
    parser.add_argument("--set", default=None)
    parser.add_argument(
        "--source",
        choices=sorted(core.SOURCE_VALUES),
        default="user-entered",
    )
    parser.add_argument("--license", default="private")
    parser.add_argument("--layout", action="store_true", help="pdfplumber layout=True")
    parser.add_argument("--dump-text", default=None, help="把抽取文字寫到檔案")
    parser.add_argument(
        "--output",
        default="content/imports/pdf-draft.json",
        help="draft JSON 輸出路徑",
    )
    parser.add_argument("--stdout", action="store_true", help="把 draft JSON 印到 stdout")
    parser.add_argument("--commit", action="store_true", help="驗證並寫入 content/exams")
    parser.add_argument("--out-dir", default="content/exams")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--strict", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    input_path = Path(args.input)

    if not input_path.exists():
        print(f"Error: 找不到輸入檔 {input_path}", file=sys.stderr)
        return 2

    pages_spec = args.page or args.pages
    try:
        text, pages = extract_text(input_path, pages_spec, args.layout)
    except Exception as error:  # noqa: BLE001
        print(f"Error: {error}", file=sys.stderr)
        return 2

    if args.dump_text:
        dump = Path(args.dump_text)
        dump.parent.mkdir(parents=True, exist_ok=True)
        dump.write_text(text, encoding="utf-8", newline="\n")
        print(f"Extracted text written to {dump}")

    lines = clean_lines(text)
    section = detect_section(text, args.section)
    answers = parse_answer_map(args.answers, args.answers_file)

    try:
        if section == "banked_cloze":
            result = parse_banked_cloze(lines, answers, args.title)
        elif section == "paragraph_matching":
            result = parse_matching(lines, answers, args.title)
        else:
            result = parse_careful_reading(
                lines,
                answers,
                args.passage_text_file,
                args.title,
            )
    except Exception as error:  # noqa: BLE001
        print(f"Error: {error}", file=sys.stderr)
        return 1

    if args.question is not None:
        result.questions = [
            question
            for question in result.questions
            if question.number == args.question
        ]
        if not result.questions:
            print(f"Error: 找不到第 {args.question} 題。", file=sys.stderr)
            return 1
    elif args.limit > 0:
        result.questions = result.questions[: args.limit]

    if not result.questions:
        print("Error: 沒有解析到任何題目。", file=sys.stderr)
        return 1

    bundle: dict[str, Any] | None = None
    warnings = list(result.warnings)
    if result.supported:
        try:
            exam = build_exam_draft(result, args)
            bundle = exam_to_bundle(exam)
        except Exception as error:  # noqa: BLE001
            warnings.append(str(error))
            exam = None
    else:
        exam = None
        warnings.append(
            "長篇匹配目前沒有 app 練習 UI；只輸出 draft，--commit 會被拒絕。"
        )

    payload = draft_payload(result, args, input_path, pages, bundle)
    payload["warnings"] = warnings
    payload["needs_review"] = bool(
        warnings or any(question.warnings for question in result.questions)
    )

    if args.stdout:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
            newline="\n",
        )
        print(f"Draft written to {output}")

    print(
        f"Parsed {len(result.questions)} question(s); section={section}; "
        f"supported={result.supported}; needs_review={payload['needs_review']}"
    )
    for warning in warnings:
        print(f"Warning: {warning}")
    for question in result.questions:
        for warning in question.warnings:
            print(f"Warning (Q{question.number}): {warning}")

    if not args.commit:
        print("No app content written. Review the draft JSON, then use --commit.")
        return 0

    if not result.supported:
        print("Error: paragraph_matching 尚未支援 --commit。", file=sys.stderr)
        return 6

    if exam is None:
        print("Error: 無法建立可寫入的 exam draft。", file=sys.stderr)
        return 1

    commit_args = argparse.Namespace(
        output=args.out_dir,
        force=args.force,
        schema_version="1.1",
        strict=args.strict,
    )
    diagnostics: list[core.Diagnostic] = []
    core.validate_drafts([exam], commit_args, diagnostics)
    errors = [item for item in diagnostics if item.level == "error"]
    if errors:
        for item in diagnostics:
            print(f"{item.level.upper()} {item.code}: {item.message}")
        return 1

    output_path = core.write_exam(exam, commit_args, diagnostics)
    if output_path:
        print(f"Committed to {output_path}")
        print("Run: npm run content:validate")
        return 0

    print("Error: 寫入失敗。", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
