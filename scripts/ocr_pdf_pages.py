#!/usr/bin/env python3
"""OCR selected pages of a local PDF into UTF-8 text.

This is a local-only helper for CET-Lab content import. It never fetches
anything from the network. Requires ``rapidocr_onnxruntime`` and PyMuPDF.

Examples:
  python -I scripts/ocr_pdf_pages.py \
    --pdf "C:/path/paper.pdf" --pages 10-28 \
    --out-dir content/imports/ocr/paper

  python -I scripts/ocr_pdf_pages.py \
    --pdf "C:/path/paper.pdf" --pages 1-11 --dpi 200 --json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

import pymupdf


def parse_pages(spec: str, total: int) -> list[int]:
    pages: list[int] = []
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            start, end = chunk.split("-", 1)
            first, last = int(start), int(end)
            if first > last:
                first, last = last, first
            pages.extend(range(first, last + 1))
        else:
            pages.append(int(chunk))
    result = []
    seen = set()
    for page in pages:
        if 1 <= page <= total and page not in seen:
            result.append(page)
            seen.add(page)
    return result


def sort_lines(items: list[list[object]]) -> list[str]:
    """Sort OCR boxes top-to-bottom, then left-to-right.

    RapidOCR already returns a reading order in most cases, but two-column
    exam pages need a deterministic sort. Lines whose vertical centres are
    within a small threshold are treated as the same row.
    """
    rows: list[tuple[float, float, str]] = []
    for item in items:
        if len(item) < 3:
            continue
        box, text, score = item[0], item[1], item[2]
        if not text or not str(text).strip():
            continue
        try:
            ys = [point[1] for point in box]
            xs = [point[0] for point in box]
        except (TypeError, IndexError):
            continue
        rows.append((min(ys), min(xs), str(text).strip()))

    rows.sort(key=lambda row: (round(row[0] / 12), row[1]))
    return [text for _, _, text in rows]


def ocr_page(engine, page, dpi: int, temp_dir: Path) -> list[str]:
    pix = page.get_pixmap(dpi=dpi)
    image_path = temp_dir / f"page-{page.number + 1:04d}.png"
    pix.save(image_path)
    result, _elapse = engine(str(image_path))
    if not result:
        return []
    return sort_lines(result)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="OCR local PDF pages")
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--pages", default="1-", help="e.g. 1-11, 10-28, 6")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--json", action="store_true", help="also write pages.json")
    args = parser.parse_args(argv)

    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        print(
            "缺少 rapidocr_onnxruntime。请先运行：\n"
            "  python -m pip install --user rapidocr_onnxruntime",
            file=sys.stderr,
        )
        return 2

    pdf_path = args.pdf
    if not pdf_path.exists():
        print(f"找不到 PDF：{pdf_path}", file=sys.stderr)
        return 2

    doc = pymupdf.open(pdf_path)
    total = doc.page_count
    spec = args.pages
    if spec.endswith("-"):
        spec = f"{spec}{total}"
    pages = parse_pages(spec, total)
    if not pages:
        print(f"没有有效页码：{args.pages}（共 {total} 页）", file=sys.stderr)
        return 2

    args.out_dir.mkdir(parents=True, exist_ok=True)
    engine = RapidOCR()
    payload: dict[str, object] = {
        "pdf": str(pdf_path),
        "page_count": total,
        "pages": {},
    }
    combined: list[str] = []

    with tempfile.TemporaryDirectory(prefix="cetlab-ocr-") as temp:
        temp_dir = Path(temp)
        for page_number in pages:
            page = doc[page_number - 1]
            lines = ocr_page(engine, page, args.dpi, temp_dir)
            text = "\n".join(lines)
            (args.out_dir / f"page-{page_number:04d}.txt").write_text(
                text + ("\n" if text else ""), encoding="utf-8"
            )
            if isinstance(payload["pages"], dict):
                payload["pages"][str(page_number)] = lines
            combined.append(f"\n===== PAGE {page_number} =====\n{text}\n")
            print(f"[OCR] page {page_number}/{total}: {len(lines)} lines")

    (args.out_dir / "combined.txt").write_text(
        "".join(combined).strip() + "\n", encoding="utf-8"
    )
    if args.json:
        (args.out_dir / "pages.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(f"写入：{args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
