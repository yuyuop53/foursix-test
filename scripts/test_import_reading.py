from __future__ import annotations

import argparse
import csv
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import import_reading as importer  # noqa: E402


def make_args(output: str, force: bool = False) -> argparse.Namespace:
    return argparse.Namespace(
        year=None,
        month=None,
        set=None,
        source="user-entered",
        license="private",
        output=output,
        force=force,
        schema_version="1.1",
        strict=False,
    )


class ImportReadingTests(unittest.TestCase):
    def test_template_has_required_headers_and_rows(self) -> None:
        path = Path(__file__).resolve().parent.parent / "content" / "imports" / "reading-example.csv"
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            headers = reader.fieldnames or []
            rows = list(reader)

        for required in [
            "exam_id",
            "exam_title",
            "passage_key",
            "body_md",
            "question_id",
            "type",
            "stem",
            "answer",
            "explanation",
            "evidence",
            "knowledge_tags",
            "error_cause_tags",
            "difficulty",
        ]:
            self.assertIn(required, headers)

        self.assertEqual(len(rows), 3)

    def test_example_csv_builds_valid_drafts(self) -> None:
        path = Path(__file__).resolve().parent.parent / "content" / "imports" / "reading-example.csv"
        diagnostics: list[importer.Diagnostic] = []
        rows = importer.read_csv(path, diagnostics)
        self.assertTrue(rows)

        with tempfile.TemporaryDirectory() as directory:
            args = make_args(directory)
            exams = importer.build_drafts(rows, args, diagnostics)
            importer.validate_drafts(exams, args, diagnostics)

            errors = [item for item in diagnostics if item.level == "error"]
            self.assertEqual(errors, [], [item.as_dict() for item in errors])

            self.assertEqual(len(exams), 1)
            exam = exams[0]
            self.assertEqual(exam.id, "exam_import_sample")
            self.assertEqual(len(exam.passages), 2)
            self.assertEqual(
                sum(len(passage.questions) for passage in exam.passages),
                3,
            )
            self.assertEqual(exam.passages[0].questions[0].answer, "A")

            rendered = importer.render_exam(exam, "1.1")
            self.assertIn("schema_version: \"1.1\"", rendered)
            self.assertIn("## Passage 1", rendered)
            self.assertIn("word_bank:", rendered)
            self.assertIn("blank_index", rendered)

    def test_write_exam_and_stats(self) -> None:
        path = Path(__file__).resolve().parent.parent / "content" / "imports" / "reading-example.csv"
        diagnostics: list[importer.Diagnostic] = []
        rows = importer.read_csv(path, diagnostics)

        with tempfile.TemporaryDirectory() as directory:
            args = make_args(directory)
            exams = importer.build_drafts(rows, args, diagnostics)
            importer.validate_drafts(exams, args, diagnostics)
            output = importer.write_exam(exams[0], args, diagnostics)
            self.assertIsNotNone(output)
            self.assertTrue(Path(output or "").exists())

            stats = importer.compute_stats(Path(directory))
            self.assertEqual(stats["passages"], 2)
            self.assertEqual(stats["questions"], 3)

            importer.validate_drafts(exams, args, diagnostics)
            self.assertTrue(
                any(item.code == "E_OUTPUT_EXISTS" for item in diagnostics)
            )

    def test_answer_text_mapping_and_invalid_answer(self) -> None:
        row = importer.ImportRow({}, 2)
        options = [
            {"key": "A", "text": "Remote work"},
            {"key": "B", "text": "Office costs"},
        ]
        diagnostics: list[importer.Diagnostic] = []

        self.assertEqual(
            importer.map_answer("office costs", options, [], row, diagnostics),
            "B",
        )
        self.assertEqual(diagnostics, [])

        importer.map_answer("not present", options, [], row, diagnostics)
        self.assertTrue(any(item.code == "E_BAD_ANSWER" for item in diagnostics))

    def test_evidence_quote_location(self) -> None:
        body = "First sentence. Second sentence."
        located = importer.locate_quote(body, "second sentence")
        self.assertEqual(
            located,
            {
                "paragraph": 1,
                "sentence": 2,
                "quote": "second sentence",
            },
        )

    def test_template_copy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "template.csv"
            exit_code = importer.handle_template(str(target))
            self.assertEqual(exit_code, 0)
            self.assertTrue(target.exists())
            self.assertIn(
                "exam_id",
                target.read_text(encoding="utf-8").splitlines()[0],
            )


if __name__ == "__main__":
    unittest.main()
