#!/usr/bin/env python3
"""Bulk import reading content into CET-Lab Markdown files.

Primary input: one CSV row per question (or one Excel sheet with the same
columns). The script normalizes IDs, validates the same rules as the app,
renders the existing exam.md format, and optionally runs the Node validator.

Python 3.10+; standard library only. .xlsx support requires openpyxl.

Examples:
  python -I scripts/import_reading.py --template content/import-templates/reading-import-template.csv
  python -I scripts/import_reading.py --input content/imports/reading-example.csv --dry-run --stats
  python -I scripts/import_reading.py --input content/imports/reading-example.csv --output content/exams
  python -I scripts/import_reading.py --input content/imports/reading-example.csv --validate
"""

from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TEMPLATE = (
    REPO_ROOT / "content" / "import-templates" / "reading-import-template.csv"
)
CONFIG_PATH = REPO_ROOT / "config" / "exam_rules.json"

EXAM_ID_RE = re.compile(r"^exam_[a-z0-9_-]+$")
PASSAGE_ID_RE = re.compile(r"^psg_[a-z0-9_-]+$")
QUESTION_ID_RE = re.compile(r"^q_[a-z0-9_-]+$")

SOURCE_VALUES = {"user-entered", "original", "licensed", "public-domain"}
SUBTYPES = {"careful_reading", "banked_cloze"}
READING_TYPES = {
    "detail",
    "inference",
    "attitude",
    "main_idea",
    "vocabulary_in_context",
    "text_structure",
    "signposting",
    "paraphrase",
    "banked_cloze",
}
OPTION_KEYS = list("ABCDEFGHIJKLMNO")


@dataclass
class Diagnostic:
    level: str
    code: str
    message: str
    row: int | None = None
    column: str | None = None
    fix: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "level": self.level,
            "code": self.code,
            "row": self.row,
            "column": self.column,
            "message": self.message,
            "fix": self.fix,
        }


@dataclass
class ImportRow:
    data: dict[str, str]
    line: int


@dataclass
class QuestionDraft:
    id: str
    passage_id: str
    section: str
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
    blank_index: int | None = None


@dataclass
class PassageDraft:
    id: str
    exam_id: str
    section: str
    subtype: str
    order: int
    title: str
    body_md: str
    hot_topic_tags: list[str]
    word_count: int
    word_bank: list[dict[str, str]] = field(default_factory=list)
    questions: list[QuestionDraft] = field(default_factory=list)


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
    passages: list[PassageDraft] = field(default_factory=list)


def load_rules() -> dict[str, Any]:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


RULES = load_rules()

HOT_TOPIC_IDS = {
    item["id"] for item in RULES.get("reading", {}).get("hot_topics", [])
}
HOT_TOPIC_LABELS = {
    item["label"]: item["id"]
    for item in RULES.get("reading", {}).get("hot_topics", [])
}
KNOWLEDGE_IDS = set(RULES.get("taxonomy", {}).get("knowledge_tags", []))
ERROR_CAUSE_IDS = {
    item["id"] for item in RULES.get("taxonomy", {}).get("error_causes", [])
}
ERROR_CAUSE_LABELS = {
    item["label"]: item["id"]
    for item in RULES.get("taxonomy", {}).get("error_causes", [])
}


def normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def split_list(value: str) -> list[str]:
    if not value:
        return []
    return [
        item.strip()
        for item in re.split(r"[|,;]", value)
        if item.strip()
    ]


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return slug or "item"


def count_words(text: str) -> int:
    clean = re.sub(r"\[\[\d+\]\]", " ", text)
    return len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'’-]*", clean))


def normalize_for_search(text: str) -> str:
    value = text.lower().replace("’", "'").replace("‘", "'")
    value = value.replace("–", "-").replace("—", "-")
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def to_int(value: str, default: int | None = None) -> int | None:
    if value is None or str(value).strip() == "":
        return default
    try:
        return int(float(str(value).strip()))
    except ValueError:
        return default


def add_error(
    diagnostics: list[Diagnostic],
    code: str,
    message: str,
    row: int | None = None,
    column: str | None = None,
    fix: str | None = None,
) -> None:
    diagnostics.append(
        Diagnostic("error", code, message, row=row, column=column, fix=fix)
    )


def add_warning(
    diagnostics: list[Diagnostic],
    code: str,
    message: str,
    row: int | None = None,
    column: str | None = None,
    fix: str | None = None,
) -> None:
    diagnostics.append(
        Diagnostic("warning", code, message, row=row, column=column, fix=fix)
    )


def expand_inputs(patterns: Iterable[str]) -> list[Path]:
    paths: list[Path] = []
    for pattern in patterns:
        matches = glob.glob(pattern, recursive=True)
        if matches:
            paths.extend(Path(match) for match in matches)
        else:
            paths.append(Path(pattern))
    return sorted({path.resolve() for path in paths})


def read_csv(path: Path, diagnostics: list[Diagnostic]) -> list[ImportRow]:
    rows: list[ImportRow] = []
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames:
                add_error(
                    diagnostics,
                    "E_CSV_HEADER",
                    "CSV 沒有表頭",
                    column=str(path),
                )
                return rows
            for line, raw in enumerate(reader, start=2):
                data = {
                    normalize_header(key): (value or "").strip()
                    for key, value in raw.items()
                    if key is not None
                }
                rows.append(ImportRow(data, line))
    except OSError as error:
        add_error(
            diagnostics,
            "E_FILE",
            f"無法讀取 CSV：{error}",
            column=str(path),
        )
    return rows


def read_xlsx(
    path: Path,
    args: argparse.Namespace,
    diagnostics: list[Diagnostic],
) -> tuple[list[ImportRow], int | None]:
    try:
        from openpyxl import load_workbook  # type: ignore
    except ImportError:
        add_error(
            diagnostics,
            "E_OPENPYXL",
            "讀取 .xlsx 需要 openpyxl；請安裝 openpyxl 或將檔案另存為 CSV。",
            column=str(path),
            fix="pip install openpyxl",
        )
        return [], 4

    try:
        workbook = load_workbook(path, read_only=True, data_only=True)
    except Exception as error:  # noqa: BLE001
        add_error(
            diagnostics,
            "E_XLSX",
            f"無法讀取 xlsx：{error}",
            column=str(path),
        )
        return [], 1

    def read_sheet(sheet_name: str | None) -> list[ImportRow]:
        try:
            sheet = workbook[sheet_name] if sheet_name else workbook.active
        except KeyError:
            add_error(
                diagnostics,
                "E_XLSX_SHEET",
                f"找不到工作表：{sheet_name}",
                column=str(path),
            )
            return []
        if sheet is None:
            add_error(
                diagnostics,
                "E_XLSX_SHEET",
                "工作簿沒有可讀取的工作表。",
                column=str(path),
            )
            return []
        rows: list[ImportRow] = []
        header: list[str] | None = None
        for index, values in enumerate(sheet.iter_rows(values_only=True), start=1):
            if header is None:
                header = [
                    normalize_header(str(value or ""))
                    for value in values
                ]
                continue
            if all(value is None or str(value).strip() == "" for value in values):
                continue
            data = {
                header[column_index]: str(value).strip()
                for column_index, value in enumerate(values)
                if column_index < len(header) and value is not None
            }
            rows.append(ImportRow(data, index))
        return rows

    if args.passages_sheet and args.questions_sheet:
        passages = read_sheet(args.passages_sheet)
        questions = read_sheet(args.questions_sheet)
        by_key = {
            row.data.get("passage_key", ""): row.data
            for row in passages
            if row.data.get("passage_key")
        }
        merged: list[ImportRow] = []
        for question in questions:
            key = question.data.get("passage_key", "")
            if key not in by_key:
                add_error(
                    diagnostics,
                    "E_XLSX_JOIN",
                    f"questions 找不到 passage_key={key}",
                    row=question.line,
                    column=str(path),
                )
                continue
            data = {**by_key[key], **question.data}
            merged.append(ImportRow(data, question.line))
        return merged, None

    return read_sheet(args.sheet), None


def read_inputs(
    args: argparse.Namespace,
    diagnostics: list[Diagnostic],
) -> tuple[list[ImportRow], int | None]:
    rows: list[ImportRow] = []
    for path in expand_inputs(args.input or []):
        if not path.exists():
            add_error(
                diagnostics,
                "E_FILE_MISSING",
                f"找不到輸入檔：{path}",
                column=str(path),
            )
            continue
        suffix = path.suffix.lower()
        file_format = args.format
        if file_format == "auto":
            if suffix == ".csv":
                file_format = "csv"
            elif suffix in {".xlsx", ".xlsm"}:
                file_format = "xlsx"
            else:
                add_error(
                    diagnostics,
                    "E_FORMAT",
                    f"無法判斷格式：{path}",
                    column=str(path),
                    fix="使用 --format csv 或 --format xlsx",
                )
                continue

        if file_format == "csv":
            rows.extend(read_csv(path, diagnostics))
        elif file_format == "xlsx":
            xlsx_rows, exit_code = read_xlsx(path, args, diagnostics)
            rows.extend(xlsx_rows)
            if exit_code:
                return rows, exit_code
        else:
            add_error(
                diagnostics,
                "E_FORMAT",
                f"不支援的格式：{file_format}",
                column=str(path),
            )
    return rows, None


def parse_word_bank(
    value: str,
    diagnostics: list[Diagnostic],
    row: int | None,
) -> list[dict[str, str]]:
    items = split_list(value)
    if not items:
        return []

    bank: list[dict[str, str]] = []
    seen_keys: set[str] = set()

    for index, item in enumerate(items):
        if "=" in item:
            key, text = item.split("=", 1)
            key = key.strip().upper()
            text = text.strip()
        else:
            key = OPTION_KEYS[index] if index < len(OPTION_KEYS) else ""
            text = item.strip()

        if key not in OPTION_KEYS:
            add_error(
                diagnostics,
                "E_WORD_BANK_KEY",
                f"word_bank key 必須是 A–O：{key or item}",
                row=row,
                column="word_bank",
            )
            continue
        if key in seen_keys:
            add_error(
                diagnostics,
                "E_WORD_BANK_DUP",
                f"word_bank key 重複：{key}",
                row=row,
                column="word_bank",
            )
            continue
        if not text:
            add_error(
                diagnostics,
                "E_WORD_BANK_EMPTY",
                f"word_bank {key} 沒有文字",
                row=row,
                column="word_bank",
            )
            continue
        seen_keys.add(key)
        bank.append({"key": key, "text": text})

    return bank


def parse_evidence_field(value: str) -> list[dict[str, Any]] | None:
    if not value:
        return None
    stripped = value.strip()
    if stripped.startswith("["):
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            return None

    evidence: list[dict[str, Any]] = []
    for token in split_list(stripped):
        match = re.match(r"^p(\d+)s(\d+)$", token.strip(), re.IGNORECASE)
        if not match:
            return None
        evidence.append(
            {"paragraph": int(match.group(1)), "sentence": int(match.group(2))}
        )
    return evidence or None


def locate_quote(
    body: str,
    quote: str,
) -> dict[str, Any] | None:
    if not quote.strip():
        return None

    target = normalize_for_search(quote)
    if not target:
        return None

    paragraphs = [part for part in re.split(r"\n\s*\n", body) if part.strip()]
    for paragraph_index, paragraph in enumerate(paragraphs, start=1):
        sentences = [
            sentence
            for sentence in re.split(r"(?<=[.!?])\s+", paragraph.strip())
            if sentence.strip()
        ]
        for sentence_index, sentence in enumerate(sentences, start=1):
            if target in normalize_for_search(sentence):
                return {
                    "paragraph": paragraph_index,
                    "sentence": sentence_index,
                    "quote": quote.strip(),
                }
    return None


def parse_evidence(
    row: ImportRow,
    body: str,
    diagnostics: list[Diagnostic],
) -> list[dict[str, Any]] | None:
    explicit = parse_evidence_field(row.data.get("evidence", ""))
    quote = row.data.get("evidence_quote", "").strip()

    if explicit:
        if quote:
            for item in explicit:
                item.setdefault("quote", quote)
        return explicit

    if quote:
        located = locate_quote(body, quote)
        if located:
            return [located]
        add_error(
            diagnostics,
            "E_EVIDENCE_QUOTE",
            f"evidence_quote 在 body_md 中找不到：{quote[:60]}",
            row=row.line,
            column="evidence_quote",
            fix="確認 quote 與 body_md 一致，或改用 p<paragraph>s<sentence>",
        )
        return None

    add_error(
        diagnostics,
        "E_EVIDENCE_MISSING",
        "題目缺少 evidence；請填 evidence（例如 p1s1）或 evidence_quote。",
        row=row.line,
        column="evidence",
    )
    return None


def normalize_tags(
    value: str,
    allowed: set[str],
    labels: dict[str, str],
    name: str,
    row: ImportRow,
    diagnostics: list[Diagnostic],
    required: bool,
) -> list[str]:
    tags = split_list(value)
    if not tags:
        if required:
            add_error(
                diagnostics,
                "E_TAG_MISSING",
                f"缺少 {name}；至少需要一個。",
                row=row.line,
                column=name,
            )
        return []

    result: list[str] = []
    for tag in tags:
        normalized = labels.get(tag, tag)
        if normalized not in allowed:
            add_error(
                diagnostics,
                "E_TAG",
                f"{name} 不允許：{tag}",
                row=row.line,
                column=name,
                fix=f"可用值：{', '.join(sorted(allowed))}",
            )
            continue
        if normalized not in result:
            result.append(normalized)
    return result


def map_answer(
    raw_answer: str,
    options: list[dict[str, str]],
    word_bank: list[dict[str, str]],
    row: ImportRow,
    diagnostics: list[Diagnostic],
) -> str:
    answer = raw_answer.strip()
    candidates = options or word_bank
    keys = {item["key"] for item in candidates}

    if len(answer) == 1 and answer.upper() in keys:
        return answer.upper()

    normalized = normalize_for_search(answer)
    for item in candidates:
        if normalize_for_search(item["text"]) == normalized:
            return item["key"]

    add_error(
        diagnostics,
        "E_BAD_ANSWER",
        f"answer「{raw_answer}」不在選項/詞庫中。",
        row=row.line,
        column="answer",
        fix=f"可用 key：{', '.join(sorted(keys))}",
    )
    return answer.upper() if answer else ""


def build_question(
    row: ImportRow,
    exam_id: str,
    passage: PassageDraft,
    question_number: int,
    diagnostics: list[Diagnostic],
) -> QuestionDraft | None:
    options: list[dict[str, str]] = []
    for key in OPTION_KEYS[:6]:
        text = row.data.get(f"option_{key.lower()}", "").strip()
        if text:
            options.append({"key": key, "text": text})

    is_cloze = passage.subtype == "banked_cloze"
    raw_type = row.data.get("type", "").strip()
    question_type = raw_type or ("banked_cloze" if is_cloze else "detail")

    if question_type not in READING_TYPES:
        add_error(
            diagnostics,
            "E_QUESTION_TYPE",
            f"不支援的題型：{question_type}",
            row=row.line,
            column="type",
        )
        return None

    if is_cloze:
        if options:
            add_error(
                diagnostics,
                "E_CLOZE_OPTIONS",
                "選詞填空不應填 option_a..f；請使用 word_bank 與 blank_index。",
                row=row.line,
                column="option_a",
            )
            return None
        if question_type != "banked_cloze":
            add_error(
                diagnostics,
                "E_CLOZE_TYPE",
                "選詞填空的題型必須是 banked_cloze。",
                row=row.line,
                column="type",
            )
            return None
    elif question_type == "banked_cloze":
        add_error(
            diagnostics,
            "E_CLOZE_TYPE",
            "banked_cloze 題型只能用在 subtype=banked_cloze 的 passage。",
            row=row.line,
            column="type",
        )
        return None

    answer = map_answer(
        row.data.get("answer", ""),
        options,
        passage.word_bank,
        row,
        diagnostics,
    )
    if not answer:
        return None

    evidence = parse_evidence(row, passage.body_md, diagnostics)
    if not evidence:
        return None

    difficulty = to_int(row.data.get("difficulty", ""), 3) or 3
    if difficulty < 1 or difficulty > 5:
        add_error(
            diagnostics,
            "E_DIFFICULTY",
            f"difficulty 必須是 1–5：{difficulty}",
            row=row.line,
            column="difficulty",
        )
        return None

    knowledge_tags = normalize_tags(
        row.data.get("knowledge_tags", ""),
        KNOWLEDGE_IDS,
        {},
        "knowledge_tags",
        row,
        diagnostics,
        required=True,
    )
    error_cause_tags = normalize_tags(
        row.data.get("error_cause_tags", ""),
        ERROR_CAUSE_IDS,
        ERROR_CAUSE_LABELS,
        "error_cause_tags",
        row,
        diagnostics,
        required=True,
    )
    hot_topic_tags = normalize_tags(
        row.data.get("hot_topic_tags", "") or "|".join(passage.hot_topic_tags),
        HOT_TOPIC_IDS,
        HOT_TOPIC_LABELS,
        "hot_topic_tags",
        row,
        diagnostics,
        required=False,
    )

    blank_index = to_int(row.data.get("blank_index", ""))
    if is_cloze and blank_index is None:
        add_error(
            diagnostics,
            "E_BLANK_INDEX",
            "選詞填空每題必須填 blank_index。",
            row=row.line,
            column="blank_index",
        )
        return None
    if not is_cloze and blank_index is not None:
        add_error(
            diagnostics,
            "E_BLANK_INDEX",
            "非選詞填空題不應填 blank_index。",
            row=row.line,
            column="blank_index",
        )
        return None

    question_id = row.data.get("question_id", "").strip() or (
        f"q_{exam_id}_r{passage.order}_{question_number:02d}"
    )
    if not QUESTION_ID_RE.match(question_id):
        add_error(
            diagnostics,
            "E_QUESTION_ID",
            f"question_id 格式錯誤：{question_id}",
            row=row.line,
            column="question_id",
            fix="使用 q_<exam-id>_r<order>_<NN>",
        )
        return None

    stem = row.data.get("stem", "").strip()
    if not stem:
        add_error(
            diagnostics,
            "E_STEM",
            "題目缺少 stem。",
            row=row.line,
            column="stem",
        )
        return None

    explanation = row.data.get("explanation", "").strip()
    if not explanation:
        add_error(
            diagnostics,
            "E_EXPLANATION",
            "題目缺少 explanation。",
            row=row.line,
            column="explanation",
        )
        return None

    if not is_cloze:
        if len(options) < 2:
            add_error(
                diagnostics,
                "E_OPTIONS",
                "仔細閱讀題至少需要 2 個選項（A–F）。",
                row=row.line,
                column="option_a",
            )
            return None
        if any(
            option["key"] == answer and option["text"] == ""
            for option in options
        ):
            add_error(
                diagnostics,
                "E_OPTIONS",
                "answer 對應的選項沒有文字。",
                row=row.line,
                column="answer",
            )
            return None

    return QuestionDraft(
        id=question_id,
        passage_id=passage.id,
        section=passage.section,
        type=question_type,
        stem=stem,
        options=options,
        answer=answer,
        explanation=explanation,
        evidence=evidence,
        knowledge_tags=knowledge_tags,
        error_cause_tags=error_cause_tags,
        hot_topic_tags=hot_topic_tags,
        difficulty=difficulty,
        blank_index=blank_index,
    )


def build_drafts(
    rows: list[ImportRow],
    args: argparse.Namespace,
    diagnostics: list[Diagnostic],
) -> list[ExamDraft]:
    exams: dict[str, ExamDraft] = {}
    passages: dict[tuple[str, str], PassageDraft] = {}
    question_counts: dict[tuple[str, str], int] = defaultdict(int)
    seen_passages: dict[str, str] = {}

    for row in rows:
        data = row.data
        year = to_int(data.get("year", ""), args.year)
        month = to_int(data.get("month", ""), args.month)
        set_name = data.get("set", "") or args.set or "import"

        if not year or not month:
            add_error(
                diagnostics,
                "E_EXAM_DATE",
                "缺少 year/month，且沒有提供 --year/--month。",
                row=row.line,
                column="year",
            )
            continue

        exam_id = data.get("exam_id", "").strip() or (
            f"exam_{year}-{month:02d}_{slugify(set_name)}"
        )
        if not EXAM_ID_RE.match(exam_id):
            add_error(
                diagnostics,
                "E_EXAM_ID",
                f"exam_id 格式錯誤：{exam_id}",
                row=row.line,
                column="exam_id",
                fix="使用 exam_<year>-<month>_<set>",
            )
            continue

        exam_title = data.get("exam_title", "").strip() or f"Imported {exam_id}"
        source = data.get("source", "").strip() or args.source
        license_value = data.get("license", "").strip() or args.license
        content_version = (
            data.get("content_version", "").strip() or "1.0.0"
        )

        if source not in SOURCE_VALUES:
            add_error(
                diagnostics,
                "E_SOURCE",
                f"source 不允許：{source}",
                row=row.line,
                column="source",
            )
            continue
        if not license_value:
            add_error(
                diagnostics,
                "E_LICENSE",
                "缺少 license。",
                row=row.line,
                column="license",
            )
            continue

        exam = exams.get(exam_id)
        if exam is None:
            exam = ExamDraft(
                id=exam_id,
                title=exam_title,
                year=year,
                month=month,
                set_name=set_name,
                source=source,
                license=license_value,
                content_version=content_version,
            )
            exams[exam_id] = exam
        else:
            if exam.title != exam_title:
                add_warning(
                    diagnostics,
                    "W_EXAM_TITLE",
                    f"同一 exam_id 的 exam_title 不一致，使用第一個：{exam.title}",
                    row=row.line,
                    column="exam_title",
                )
            if (
                exam.year != year
                or exam.month != month
                or exam.set_name != set_name
            ):
                add_error(
                    diagnostics,
                    "E_EXAM_MISMATCH",
                    "同一 exam_id 的 year/month/set 不一致。",
                    row=row.line,
                    column="year",
                )
                continue

        section = data.get("section", "").strip() or "reading"
        if section != "reading":
            add_error(
                diagnostics,
                "E_SECTION",
                "此 importer 目前只支援 section=reading。",
                row=row.line,
                column="section",
            )
            continue

        passage_key = (
            data.get("passage_key", "").strip()
            or data.get("passage_id", "").strip()
            or f"p{to_int(data.get('order', ''), 1) or 1}"
        )
        key = (exam_id, passage_key)
        order = to_int(data.get("order", ""), 1) or 1
        subtype = data.get("subtype", "").strip() or "careful_reading"
        if subtype not in SUBTYPES:
            add_error(
                diagnostics,
                "E_SUBTYPE",
                f"subtype 不允許：{subtype}",
                row=row.line,
                column="subtype",
            )
            continue

        body_md = data.get("body_md", "").strip()
        if not body_md:
            add_error(
                diagnostics,
                "E_BODY",
                "缺少 body_md（文章正文）。",
                row=row.line,
                column="body_md",
            )
            continue
        if "```" in body_md:
            add_error(
                diagnostics,
                "E_BODY_FENCE",
                "body_md 不可包含 ```，否則會破壞 Markdown 區塊。",
                row=row.line,
                column="body_md",
            )
            continue

        passage_id = data.get("passage_id", "").strip() or (
            f"psg_{exam_id}_r{order}"
        )
        if not PASSAGE_ID_RE.match(passage_id):
            add_error(
                diagnostics,
                "E_PASSAGE_ID",
                f"passage_id 格式錯誤：{passage_id}",
                row=row.line,
                column="passage_id",
                fix="使用 psg_<exam-id>_r<order>",
            )
            continue

        passage_title = (
            data.get("passage_title", "").strip() or f"Passage {order}"
        )
        hot_topic_tags = normalize_tags(
            data.get("hot_topic_tags", ""),
            HOT_TOPIC_IDS,
            HOT_TOPIC_LABELS,
            "hot_topic_tags",
            row,
            diagnostics,
            required=True,
        )
        computed_words = count_words(body_md)
        provided_words = to_int(data.get("word_count", ""))
        if provided_words is not None and computed_words > 0:
            tolerance = max(5, round(computed_words * 0.05))
            if abs(provided_words - computed_words) > tolerance:
                add_warning(
                    diagnostics,
                    "W_WORD_COUNT",
                    f"word_count={provided_words} 與實際 {computed_words} 相差超過 5%，已使用實際值。",
                    row=row.line,
                    column="word_count",
                )

        word_bank = (
            parse_word_bank(data.get("word_bank", ""), diagnostics, row.line)
            if subtype == "banked_cloze"
            else []
        )
        if subtype != "banked_cloze" and data.get("word_bank", "").strip():
            add_warning(
                diagnostics,
                "W_WORD_BANK_IGNORED",
                "非選詞填空 passage 的 word_bank 會被忽略。",
                row=row.line,
                column="word_bank",
            )

        passage = passages.get(key)
        if passage is None:
            passage = PassageDraft(
                id=passage_id,
                exam_id=exam_id,
                section=section,
                subtype=subtype,
                order=order,
                title=passage_title,
                body_md=body_md,
                hot_topic_tags=hot_topic_tags,
                word_count=computed_words,
                word_bank=word_bank,
            )
            passages[key] = passage
            exam.passages.append(passage)
        else:
            if passage.id != passage_id:
                add_error(
                    diagnostics,
                    "E_PASSAGE_ID_MISMATCH",
                    f"同一 passage_key 出現了不同 passage_id：{passage.id} / {passage_id}",
                    row=row.line,
                    column="passage_id",
                )
            if (
                passage.body_md != body_md
                or passage.subtype != subtype
                or passage.title != passage_title
                or passage.order != order
            ):
                add_error(
                    diagnostics,
                    "E_PASSAGE_MISMATCH",
                    "同一 passage_key 的 body/subtype/title/order 不一致。",
                    row=row.line,
                    column="passage_key",
                )

        question_counts[key] += 1
        question = build_question(
            row,
            exam_id,
            passage,
            question_counts[key],
            diagnostics,
        )
        if question:
            passage.questions.append(question)

        digest = hashlib.sha256(
            f"{exam_id}|{section}|{subtype}|{normalize_for_search(body_md)}".encode(
                "utf-8"
            )
        ).hexdigest()
        previous = seen_passages.get(digest)
        if previous and previous != passage.id:
            add_warning(
                diagnostics,
                "W_DUPLICATE_PASSAGE",
                f"passage 內容與 {previous} 重複。",
                row=row.line,
                column="body_md",
            )
        else:
            seen_passages[digest] = passage.id

    return list(exams.values())


def validate_drafts(
    exams: list[ExamDraft],
    args: argparse.Namespace,
    diagnostics: list[Diagnostic],
) -> None:
    exam_ids: set[str] = set()
    passage_ids: set[str] = set()
    question_ids: set[str] = set()
    output_root = Path(args.output)

    for exam in exams:
        if exam.id in exam_ids:
            add_error(
                diagnostics,
                "E_DUPLICATE_EXAM_ID",
                f"exam id 重複：{exam.id}",
                column="exam_id",
            )
        exam_ids.add(exam.id)

        if exam.content_version and not re.match(
            r"^\d+\.\d+\.\d+$", exam.content_version
        ):
            add_error(
                diagnostics,
                "E_CONTENT_VERSION",
                f"content_version 必須是 x.y.z：{exam.content_version}",
                column="content_version",
            )

        output_file = output_root / exam.id / "exam.md"
        if output_file.exists() and not args.force:
            add_error(
                diagnostics,
                "E_OUTPUT_EXISTS",
                f"輸出檔已存在：{output_file}（使用 --force 覆蓋）",
                column=str(output_file),
            )

        for passage in sorted(exam.passages, key=lambda item: item.order):
            if passage.id in passage_ids:
                add_error(
                    diagnostics,
                    "E_DUPLICATE_PASSAGE_ID",
                    f"passage id 重複：{passage.id}",
                    column="passage_id",
                )
            passage_ids.add(passage.id)

            if not passage.questions:
                add_error(
                    diagnostics,
                    "E_NO_QUESTIONS",
                    f"passage {passage.id} 沒有任何題目。",
                    column="question_id",
                )

            if passage.subtype == "banked_cloze":
                markers = [
                    int(match)
                    for match in re.findall(r"\[\[(\d+)\]\]", passage.body_md)
                ]
                expected = list(range(1, len(markers) + 1))
                if markers != expected:
                    add_error(
                        diagnostics,
                        "E_CLOZE_MARKERS",
                        f"選詞填空 {passage.id} 的 [[n]] 必須依序且連續 1..N。",
                        column="body_md",
                    )
                if len(passage.word_bank) < len(markers) + 3:
                    add_error(
                        diagnostics,
                        "E_CLOZE_BANK",
                        f"選詞填空 {passage.id} 至少需要 {len(markers) + 3} 個詞庫選項（含 3 個干擾項）。",
                        column="word_bank",
                    )
                blank_indexes = {
                    question.blank_index
                    for question in passage.questions
                    if question.blank_index is not None
                }
                if blank_indexes != set(markers):
                    add_error(
                        diagnostics,
                        "E_CLOZE_BLANKS",
                        f"選詞填空 {passage.id} 的 blank_index 與文章空白不一致。",
                        column="blank_index",
                    )
                bank_keys = {item["key"] for item in passage.word_bank}
                used_answers: set[str] = set()
                for question in passage.questions:
                    if question.type != "banked_cloze":
                        add_error(
                            diagnostics,
                            "E_CLOZE_TYPE",
                            f"選詞填空 {passage.id} 只能有 banked_cloze 題。",
                            column="type",
                        )
                    if question.answer not in bank_keys:
                        add_error(
                            diagnostics,
                            "E_CLOZE_ANSWER",
                            f"{question.id} 的 answer={question.answer} 不在 word_bank 中。",
                            column="answer",
                        )
                    if question.answer in used_answers:
                        add_error(
                            diagnostics,
                            "E_CLOZE_REUSE",
                            f"{question.id} 的 answer={question.answer} 重複使用；每個詞限用一次。",
                            column="answer",
                        )
                    used_answers.add(question.answer)
            else:
                if passage.word_bank:
                    add_error(
                        diagnostics,
                        "E_CLOZE_BANK",
                        f"非選詞填空 {passage.id} 不應有 word_bank。",
                        column="word_bank",
                    )
                for question in passage.questions:
                    if question.options and not any(
                        option["key"] == question.answer
                        for option in question.options
                    ):
                        add_error(
                            diagnostics,
                            "E_ANSWER_NOT_IN_OPTIONS",
                            f"{question.id} 的 answer={question.answer} 不在選項中。",
                            column="answer",
                        )
                    if question.blank_index is not None:
                        add_error(
                            diagnostics,
                            "E_BLANK_INDEX",
                            f"{question.id} 不應有 blank_index。",
                            column="blank_index",
                        )

            for question in passage.questions:
                if question.id in question_ids:
                    add_error(
                        diagnostics,
                        "E_DUPLICATE_QUESTION_ID",
                        f"question id 重複：{question.id}",
                        column="question_id",
                    )
                question_ids.add(question.id)


def yaml_value(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def render_exam(exam: ExamDraft, schema_version: str) -> str:
    lines: list[str] = [
        "---",
        f"schema_version: {yaml_value(schema_version)}",
        "exam:",
        f"  id: {yaml_value(exam.id)}",
        f"  title: {yaml_value(exam.title)}",
        f"  year: {exam.year}",
        f"  month: {exam.month}",
        f"  set: {yaml_value(exam.set_name)}",
        f"  source: {yaml_value(exam.source)}",
        f"  license: {yaml_value(exam.license)}",
        f"  content_version: {yaml_value(exam.content_version)}",
        '  sections: ["reading"]',
        "assets: []",
        "---",
        "",
    ]

    for passage in sorted(exam.passages, key=lambda item: item.order):
        lines.append(f"## Passage {passage.order}")
        lines.append("")
        lines.append("```yaml passage")
        lines.append(f"id: {yaml_value(passage.id)}")
        lines.append(f"section: {yaml_value(passage.section)}")
        lines.append(f"subtype: {yaml_value(passage.subtype)}")
        lines.append(f"order: {passage.order}")
        lines.append(f"title: {yaml_value(passage.title)}")
        lines.append(
            "hot_topic_tags: "
            + yaml_value(passage.hot_topic_tags)
        )
        lines.append(f"word_count: {passage.word_count}")
        if passage.word_bank:
            lines.append("word_bank:")
            for item in passage.word_bank:
                lines.append(
                    "  - { key: "
                    + yaml_value(item["key"])
                    + ", text: "
                    + yaml_value(item["text"])
                    + " }"
                )
        lines.append("```")
        lines.append("")
        lines.append(passage.body_md.strip())
        lines.append("")
        lines.append("```json questions")
        questions: list[dict[str, Any]] = []
        for question in passage.questions:
            payload: dict[str, Any] = {
                "id": question.id,
                "passage_id": question.passage_id,
                "section": question.section,
                "type": question.type,
                "stem": question.stem,
            }
            if question.options:
                payload["options"] = question.options
            payload.update(
                {
                    "answer": question.answer,
                    "explanation": question.explanation,
                    "evidence": question.evidence,
                    "knowledge_tags": question.knowledge_tags,
                    "error_cause_tags": question.error_cause_tags,
                    "hot_topic_tags": question.hot_topic_tags,
                    "difficulty": question.difficulty,
                }
            )
            if question.blank_index is not None:
                payload["blank_index"] = question.blank_index
            questions.append(payload)
        lines.append(json.dumps(questions, ensure_ascii=False, indent=2))
        lines.append("```")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def write_exam(
    exam: ExamDraft,
    args: argparse.Namespace,
    diagnostics: list[Diagnostic],
) -> str | None:
    output_root = Path(args.output)
    target = output_root / exam.id / "exam.md"
    if target.exists() and not args.force:
        add_error(
            diagnostics,
            "E_OUTPUT_EXISTS",
            f"輸出檔已存在：{target}",
            column=str(target),
        )
        return None

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and args.force:
        backup = target.with_name(target.name + ".bak")
        shutil.copy2(target, backup)

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


def compute_stats(path: Path) -> dict[str, Any]:
    files = sorted(path.rglob("*.md")) if path.exists() else []
    types: Counter[str] = Counter()
    difficulties: Counter[int] = Counter()
    hot_topics: Counter[str] = Counter()
    warnings: list[str] = []
    passages = 0
    questions = 0

    for file in files:
        try:
            text = file.read_text(encoding="utf-8")
        except OSError:
            continue
        file_passages = len(re.findall(r"^##\s+", text, re.MULTILINE))
        file_questions = len(re.findall(r'"id"\s*:\s*"q_', text))
        passages += file_passages
        questions += file_questions
        for match in re.findall(r'"type"\s*:\s*"([^"]+)"', text):
            types[match] += 1
        for match in re.findall(r'"difficulty"\s*:\s*(\d)', text):
            difficulties[int(match)] += 1
        for match in re.findall(
            r"(?:hot_topic_tags:|hot_topic_tags\")\s*:?\s*\[([^\]]*)\]",
            text,
        ):
            for tag in re.findall(r'"([^"]+)"', match):
                hot_topics[tag] += 1
        if file_passages > 0 and file_questions < file_passages * 3:
            warnings.append(
                f"{file}: {file_passages} 篇但只有 {file_questions} 題（每篇少於 3 題）"
            )

    return {
        "files": len(files),
        "passages": passages,
        "questions": questions,
        "types": dict(types),
        "difficulties": dict(difficulties),
        "hot_topics": dict(hot_topics),
        "warnings": warnings,
    }


def print_stats(stats: dict[str, Any]) -> None:
    print(
        f"Content stats: {stats['files']} files, "
        f"{stats['passages']} passages, {stats['questions']} questions"
    )
    print(
        "Question types: "
        + (", ".join(f"{key} {value}" for key, value in stats["types"].items()) or "none")
    )
    print(
        "Difficulty: "
        + (
            ", ".join(
                f"{key}:{value}"
                for key, value in sorted(stats["difficulties"].items())
            )
            or "none"
        )
    )
    print(
        "Hot topics: "
        + (", ".join(f"{key} {value}" for key, value in stats["hot_topics"].items()) or "none")
    )
    if stats["warnings"]:
        print("Coverage warnings:")
        for warning in stats["warnings"]:
            print(f"  - {warning}")


def write_report(
    args: argparse.Namespace,
    diagnostics: list[Diagnostic],
    outputs: list[str],
    stats: dict[str, Any] | None,
) -> None:
    errors = [item for item in diagnostics if item.level == "error"]
    warnings = [item for item in diagnostics if item.level == "warning"]
    summary = {
        "errors": len(errors),
        "warnings": len(warnings),
        "outputs": outputs,
        "stats": stats,
    }
    report = {
        "summary": summary,
        "diagnostics": [item.as_dict() for item in diagnostics],
    }

    if args.report:
        if args.report == "-":
            if args.report_format == "json":
                print(json.dumps(report, ensure_ascii=False, indent=2))
            else:
                print_human_report(summary, diagnostics)
        else:
            report_path = Path(args.report)
            report_path.parent.mkdir(parents=True, exist_ok=True)
            if args.report_format == "json":
                report_path.write_text(
                    json.dumps(report, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            else:
                report_path.write_text(
                    human_report_text(summary, diagnostics),
                    encoding="utf-8",
                )


def human_report_text(
    summary: dict[str, Any],
    diagnostics: list[Diagnostic],
) -> str:
    lines = [
        f"Errors: {summary['errors']}  Warnings: {summary['warnings']}",
    ]
    for item in diagnostics:
        location = []
        if item.row is not None:
            location.append(f"row {item.row}")
        if item.column:
            location.append(str(item.column))
        prefix = f"[{item.level}] {item.code}"
        if location:
            prefix += " (" + ", ".join(location) + ")"
        lines.append(f"{prefix}: {item.message}")
        if item.fix:
            lines.append(f"  fix: {item.fix}")
    if summary["outputs"]:
        lines.append("Outputs:")
        lines.extend(f"  - {path}" for path in summary["outputs"])
    if summary.get("stats"):
        lines.append(json.dumps(summary["stats"], ensure_ascii=False, indent=2))
    return "\n".join(lines) + "\n"


def print_human_report(
    summary: dict[str, Any],
    diagnostics: list[Diagnostic],
) -> None:
    print(human_report_text(summary, diagnostics), end="")


def run_node_validation() -> int:
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        print("Warning: 找不到 npm，略過 Node 內容驗證。", file=sys.stderr)
        return 0

    command = [npm, "run", "content:validate"]
    if sys.platform.startswith("win"):
        command = ["cmd", "/c", "npm", "run", "content:validate"]

    result = subprocess.run(
        command,
        cwd=str(REPO_ROOT),
        text=True,
        capture_output=True,
    )
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    return 0 if result.returncode == 0 else 5


def handle_template(value: str) -> int:
    if not DEFAULT_TEMPLATE.exists():
        print(f"Error: 找不到模板 {DEFAULT_TEMPLATE}", file=sys.stderr)
        return 2

    text = DEFAULT_TEMPLATE.read_text(encoding="utf-8")
    if value == "-":
        print(text, end="")
        return 0

    target = Path(value)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote template to {target}")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Bulk import CET-Lab reading content from CSV/Excel."
    )
    parser.add_argument("--input", nargs="+", action="extend", default=None)
    parser.add_argument("--output", default="content/exams")
    parser.add_argument("--format", choices=["auto", "csv", "xlsx"], default="auto")
    parser.add_argument("--sheet", default=None)
    parser.add_argument("--passages-sheet", default=None)
    parser.add_argument("--questions-sheet", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--report", default=None)
    parser.add_argument("--report-format", choices=["text", "json"], default="text")
    parser.add_argument("--template", nargs="?", const="-", default=None)
    parser.add_argument("--stats", nargs="?", const="__OUTPUT__", default=None)
    parser.add_argument(
        "--validate",
        action=argparse.BooleanOptionalAction,
        default=False,
    )
    parser.add_argument("--source", choices=sorted(SOURCE_VALUES), default="user-entered")
    parser.add_argument("--license", default="private")
    parser.add_argument("--schema-version", choices=["1.0", "1.1"], default="1.1")
    parser.add_argument("--year", type=int, default=None)
    parser.add_argument("--month", type=int, default=None)
    parser.add_argument("--set", default=None)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if args.template is not None:
        return handle_template(args.template)

    if not args.input and args.stats is None:
        print(
            "Error: 需要 --input，或使用 --template / --stats。",
            file=sys.stderr,
        )
        return 2

    diagnostics: list[Diagnostic] = []
    rows: list[ImportRow] = []
    if args.input:
        rows, exit_code = read_inputs(args, diagnostics)
        if exit_code:
            write_report(args, diagnostics, [], None)
            return exit_code

    if args.input and not rows:
        if not any(item.level == "error" for item in diagnostics):
            add_error(
                diagnostics,
                "E_NO_ROWS",
                "輸入檔沒有任何資料列。",
            )
        write_report(args, diagnostics, [], None)
        if not args.quiet:
            print_human_report(
                {
                    "errors": len(
                        [item for item in diagnostics if item.level == "error"]
                    ),
                    "warnings": len(
                        [item for item in diagnostics if item.level == "warning"]
                    ),
                    "outputs": [],
                },
                diagnostics,
            )
        return 1

    exams: list[ExamDraft] = []
    outputs: list[str] = []
    if rows:
        exams = build_drafts(rows, args, diagnostics)
        validate_drafts(exams, args, diagnostics)

        errors = [item for item in diagnostics if item.level == "error"]
        if errors or (args.strict and any(item.level == "warning" for item in diagnostics)):
            write_report(args, diagnostics, [], None)
            if not args.quiet:
                print_human_report(
                    {
                        "errors": len(errors),
                        "warnings": len([item for item in diagnostics if item.level == "warning"]),
                        "outputs": [],
                    },
                    diagnostics,
                )
            return 3 if any(item.code == "E_OUTPUT_EXISTS" for item in errors) else 1

        if not args.dry_run:
            for exam in exams:
                try:
                    output = write_exam(exam, args, diagnostics)
                    if output:
                        outputs.append(output)
                except Exception as error:  # noqa: BLE001
                    add_error(
                        diagnostics,
                        "E_WRITE",
                        f"寫入 {exam.id} 失敗：{error}",
                        column="output",
                    )

            if any(item.level == "error" for item in diagnostics):
                write_report(args, diagnostics, outputs, None)
                if not args.quiet:
                    print_human_report(
                        {
                            "errors": len([item for item in diagnostics if item.level == "error"]),
                            "warnings": len([item for item in diagnostics if item.level == "warning"]),
                            "outputs": outputs,
                        },
                        diagnostics,
                    )
                return 1

    stats = None
    if args.stats is not None:
        stats_path = args.output if args.stats == "__OUTPUT__" else args.stats
        stats = compute_stats(Path(stats_path))
        if not args.quiet:
            print_stats(stats)

    if args.input:
        write_report(args, diagnostics, outputs, stats)
        if not args.quiet and not args.report:
            print_human_report(
                {
                    "errors": len([item for item in diagnostics if item.level == "error"]),
                    "warnings": len([item for item in diagnostics if item.level == "warning"]),
                    "outputs": outputs,
                    "stats": stats,
                },
                diagnostics,
            )

    if args.validate and not args.dry_run and outputs:
        return run_node_validation()

    return 0


if __name__ == "__main__":
    sys.exit(main())
