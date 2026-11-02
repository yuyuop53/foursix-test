from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import import_listening as importer  # noqa: E402
import listening_media as media  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
IMPORTS = REPO_ROOT / "content" / "imports"


class ImportListeningTests(unittest.TestCase):
    def test_parse_srt_rebases_nothing(self) -> None:
        cues = importer.parse_srt(
            (IMPORTS / "listening-example.srt").read_text(encoding="utf-8")
        )
        self.assertEqual(len(cues), 4)
        self.assertAlmostEqual(cues[0].start, 1.0)
        self.assertAlmostEqual(cues[0].end, 4.0)
        self.assertIn("Volunteers", cues[0].text)

    def test_parse_spans(self) -> None:
        spans = importer.parse_spans("l1=0-10,l2=10-20")
        self.assertEqual(spans["l1"], (0.0, 10.0))
        self.assertEqual(spans["l2"], (10.0, 20.0))

    def test_parse_answer_range(self) -> None:
        answers = importer.parse_answer_text("1-4: BBCA")
        self.assertEqual(
            answers,
            {1: "B", 2: "B", 3: "C", 4: "A"},
        )

    def test_parse_question_range(self) -> None:
        self.assertEqual(importer.parse_question_range("1-25"), (1, 25))
        with self.assertRaises(ValueError):
            importer.parse_question_range("25-1")

    def test_dry_run_and_commit(self) -> None:
        (REPO_ROOT / "public" / "audio").mkdir(parents=True, exist_ok=True)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            out_dir = root / "out"
            draft_path = root / "draft.json"

            with tempfile.TemporaryDirectory(
                dir=REPO_ROOT / "public" / "audio"
            ) as audio_dir:
                common = [
                    "--pdf",
                    str(IMPORTS / "listening-example-paper.txt"),
                    "--answers-file",
                    str(IMPORTS / "listening-example-answers.txt"),
                    "--srt",
                    str(IMPORTS / "listening-example.srt"),
                    "--spans",
                    "l1=0-10,l2=10-20",
                    "--transcript-dir",
                    str(IMPORTS / "listening-example-transcripts"),
                    "--groups-file",
                    str(IMPORTS / "listening-example-groups.json"),
                    "--question-range",
                    "1-4",
                    "--exam-id",
                    "exam_test_listening_2026_11",
                    "--year",
                    "2026",
                    "--month",
                    "11",
                    "--set",
                    "test-listening",
                    "--out",
                    str(out_dir),
                    "--audio-out",
                    str(audio_dir),
                    "--draft",
                    str(draft_path),
                    "--allow-missing-audio",
                    "--no-validate",
                ]

                self.assertEqual(
                    importer.main([*common, "--dry-run"]),
                    0,
                )

                draft = json.loads(draft_path.read_text(encoding="utf-8"))
                self.assertTrue(draft["readiness"]["can_commit"])
                self.assertEqual(len(draft["passages"]), 2)
                self.assertEqual(
                    sum(len(item["questions"]) for item in draft["passages"]),
                    4,
                )
                self.assertEqual(len(draft["passages"][0]["audio"]["segments"]), 2)
                self.assertTrue(
                    draft["passages"][0]["audio"]["src"].startswith("audio/")
                )
                self.assertTrue(
                    draft["passages"][0]["questions"][0]["evidence"]
                )

                self.assertEqual(importer.main([*common, "--commit"]), 0)
                target = (
                    out_dir
                    / "exam_test_listening_2026_11"
                    / "exam.md"
                )
                self.assertTrue(target.exists())
                rendered = target.read_text(encoding="utf-8")
                self.assertIn("## News Report 1", rendered)
                self.assertIn("audio_asset_id:", rendered)
                self.assertIn('"segment": 0', rendered)
                self.assertIn("transcript: |", rendered)

    def test_phase_b_flags_feed_generated_srt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            out_dir = root / "out"
            srt_out = root / "srt"
            source = root / "full.mp3"
            source.write_bytes(b"fake full audio")
            draft_path = root / "phase-b-draft.json"

            def fake_prepare_media(**kwargs: object) -> media.PrepareResult:
                audio_dir = Path(str(kwargs["audio_dir"]))
                srt_dir = Path(str(kwargs["srt_dir"]))
                keys = list(kwargs["keys"])  # type: ignore[arg-type]
                audio_dir.mkdir(parents=True, exist_ok=True)
                srt_dir.mkdir(parents=True, exist_ok=True)
                for key in keys:
                    (audio_dir / f"{key}.mp3").write_bytes(b"fake clip")
                    media.write_srt(
                        [media.Cue(0.0, 4.0, "Generated sentence.")],
                        srt_dir / f"{key}.srt",
                    )
                return media.PrepareResult(
                    audio_dir=audio_dir,
                    srt_dir=srt_dir,
                )

            with tempfile.TemporaryDirectory(
                dir=REPO_ROOT / "public" / "audio"
            ) as audio_dir:
                args = [
                    "--pdf",
                    str(IMPORTS / "listening-example-paper.txt"),
                    "--answers-file",
                    str(IMPORTS / "listening-example-answers.txt"),
                    "--groups-file",
                    str(IMPORTS / "listening-example-groups.json"),
                    "--question-range",
                    "1-4",
                    "--audio",
                    str(source),
                    "--spans",
                    "l1=0-10,l2=10-20",
                    "--split-audio",
                    "--transcribe",
                    "--srt-out",
                    str(srt_out),
                    "--exam-id",
                    "exam_test_phase_b_2026_11",
                    "--year",
                    "2026",
                    "--month",
                    "11",
                    "--set",
                    "test-phase-b",
                    "--out",
                    str(out_dir),
                    "--audio-out",
                    str(audio_dir),
                    "--draft",
                    str(draft_path),
                    "--commit",
                    "--no-validate",
                    "--quiet",
                ]
                with patch.object(
                    importer.media,
                    "prepare_media",
                    side_effect=fake_prepare_media,
                ):
                    self.assertEqual(importer.main(args), 0)

            target = (
                out_dir
                / "exam_test_phase_b_2026_11"
                / "exam.md"
            )
            self.assertTrue(target.exists())
            rendered = target.read_text(encoding="utf-8")
            self.assertIn("Generated sentence.", rendered)
            self.assertIn('"segment": 0', rendered)
            self.assertTrue((srt_out / "l1.srt").exists())
            self.assertTrue((srt_out / "l2.srt").exists())


if __name__ == "__main__":
    unittest.main()
