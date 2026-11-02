from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import listening_media as media  # noqa: E402


def fake_runner(command: list[str]) -> SimpleNamespace:
    Path(command[-1]).write_bytes(b"fake mp3 bytes")
    return SimpleNamespace(returncode=0, stdout="", stderr="")


class FakeTranscriber:
    def __init__(self) -> None:
        self.calls = 0

    def transcribe(self, audio: Path) -> list[media.Cue]:
        self.calls += 1
        return [media.Cue(0.0, 1.0, "Hello world.")]


class ListeningMediaTests(unittest.TestCase):
    def test_format_srt_time(self) -> None:
        self.assertEqual(media.format_srt_time(0), "00:00:00,000")
        self.assertEqual(media.format_srt_time(59.5), "00:00:59,500")
        self.assertEqual(media.format_srt_time(3661.5), "01:01:01,500")

    def test_write_and_parse_srt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.srt"
            count = media.write_srt(
                [
                    media.Cue(0.0, 1.0, "Hello."),
                    media.Cue(1.0, 2.0, "World."),
                ],
                path,
            )
            self.assertEqual(count, 2)
            cues = media.parse_srt(path.read_text(encoding="utf-8"))
            self.assertEqual([cue.text for cue in cues], ["Hello.", "World."])
            self.assertAlmostEqual(cues[0].start, 0.0)
            self.assertAlmostEqual(cues[1].end, 2.0)

    def test_words_to_cues_splits_sentences(self) -> None:
        words = [
            {"start": 0.0, "end": 0.5, "word": "Hello"},
            {"start": 0.5, "end": 1.0, "word": "world."},
            {"start": 1.2, "end": 1.4, "word": "How"},
            {"start": 1.4, "end": 1.6, "word": "are"},
            {"start": 1.6, "end": 2.0, "word": "you?"},
        ]
        cues = media.words_to_cues(words)
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0].text, "Hello world.")
        self.assertEqual(cues[1].text, "How are you?")
        self.assertAlmostEqual(cues[0].start, 0.0)
        self.assertAlmostEqual(cues[1].start, 1.2)

    def test_abbreviation_does_not_split(self) -> None:
        words = [
            {"start": 0.0, "end": 0.2, "word": "Mr."},
            {"start": 0.2, "end": 0.5, "word": "Smith"},
            {"start": 0.5, "end": 1.0, "word": "left."},
        ]
        cues = media.words_to_cues(words)
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].text, "Mr. Smith left.")

    def test_segment_without_words_splits_sentences(self) -> None:
        cues = media.segments_to_cues(
            [
                {
                    "start": 0.0,
                    "end": 10.0,
                    "text": "One. Two.",
                    "words": [],
                }
            ]
        )
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0].text, "One.")
        self.assertEqual(cues[1].text, "Two.")
        self.assertAlmostEqual(cues[0].start, 0.0)
        self.assertAlmostEqual(cues[0].end, 5.0)

    def test_long_cue_is_split(self) -> None:
        cues = media.words_to_cues(
            [
                {
                    "start": 0.0,
                    "end": 4.0,
                    "word": "one two three four five six seven eight nine ten.",
                }
            ],
            max_chars=12,
        )
        self.assertGreater(len(cues), 1)
        self.assertTrue(all(len(cue.text) <= 12 for cue in cues))
        self.assertAlmostEqual(cues[0].start, 0.0)
        self.assertAlmostEqual(cues[-1].end, 4.0)

    def test_normalize_clamps_overlap(self) -> None:
        cues = media.normalize_cues(
            [
                media.Cue(0.0, 5.0, "first"),
                media.Cue(1.0, 2.0, "second"),
            ]
        )
        self.assertEqual(len(cues), 2)
        self.assertAlmostEqual(cues[1].start, 5.0)
        self.assertGreater(cues[1].end, cues[1].start)

    def test_split_audio_with_fake_runner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "full.mp3"
            source.write_bytes(b"source bytes")
            audio_dir = root / "audio"
            spans = {"l1": (0.0, 10.0), "l2": (10.0, 20.0)}

            results = media.split_audio(
                source,
                audio_dir,
                spans,
                ffmpeg="/fake/ffmpeg",
                runner=fake_runner,
                source_checksum="abc",
                source_duration=20.0,
                log=lambda _: None,
            )
            self.assertEqual(len(results), 2)
            self.assertTrue((audio_dir / "l1.mp3").exists())
            self.assertTrue((audio_dir / "l2.mp3").exists())
            self.assertTrue((audio_dir / "manifest.json").exists())

            calls: list[list[str]] = []

            def counting_runner(command: list[str]) -> SimpleNamespace:
                calls.append(command)
                return fake_runner(command)

            skipped = media.split_audio(
                source,
                audio_dir,
                spans,
                ffmpeg="/fake/ffmpeg",
                runner=counting_runner,
                source_checksum="abc",
                source_duration=20.0,
                log=lambda _: None,
            )
            self.assertTrue(all(item.skipped for item in skipped))
            self.assertEqual(calls, [])

            with self.assertRaises(media.MediaError):
                media.split_audio(
                    source,
                    audio_dir,
                    spans,
                    ffmpeg="/fake/ffmpeg",
                    runner=counting_runner,
                    source_checksum="different",
                    source_duration=20.0,
                    log=lambda _: None,
                )

    def test_split_audio_incremental_spans(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "full.mp3"
            source.write_bytes(b"source bytes")
            audio_dir = root / "audio"

            first = media.split_audio(
                source,
                audio_dir,
                {"l1": (0.0, 10.0)},
                ffmpeg="/fake/ffmpeg",
                runner=fake_runner,
                source_checksum="abc",
                source_duration=20.0,
                log=lambda _: None,
            )
            self.assertFalse(first[0].skipped)

            second = media.split_audio(
                source,
                audio_dir,
                {"l1": (0.0, 10.0), "l2": (10.0, 20.0)},
                ffmpeg="/fake/ffmpeg",
                runner=fake_runner,
                source_checksum="abc",
                source_duration=20.0,
                log=lambda _: None,
            )
            by_key = {item.key: item for item in second}
            self.assertTrue(by_key["l1"].skipped)
            self.assertFalse(by_key["l2"].skipped)
            self.assertTrue((audio_dir / "l2.mp3").exists())

            with self.assertRaises(media.MediaError):
                media.split_audio(
                    source,
                    audio_dir,
                    {"l1": (0.0, 9.0), "l2": (10.0, 20.0)},
                    ffmpeg="/fake/ffmpeg",
                    runner=fake_runner,
                    source_checksum="abc",
                    source_duration=20.0,
                    log=lambda _: None,
                )

    def test_transcribe_all_with_fake_transcriber(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio_dir = root / "audio"
            srt_dir = root / "srt"
            audio_dir.mkdir()
            (audio_dir / "l1.mp3").write_bytes(b"a")
            (audio_dir / "l2.mp3").write_bytes(b"b")
            transcriber = FakeTranscriber()

            results = media.transcribe_all(
                audio_dir,
                srt_dir,
                ["l1", "l2"],
                transcriber=transcriber,
                log=lambda _: None,
            )
            self.assertEqual(len(results), 2)
            self.assertEqual(transcriber.calls, 2)
            self.assertTrue((srt_dir / "l1.srt").exists())
            self.assertTrue((srt_dir / "l2.srt").exists())

            skipped = media.transcribe_all(
                audio_dir,
                srt_dir,
                ["l1", "l2"],
                transcriber=transcriber,
                log=lambda _: None,
            )
            self.assertTrue(all(item.skipped for item in skipped))
            self.assertEqual(transcriber.calls, 2)

            media.transcribe_all(
                audio_dir,
                srt_dir,
                ["l1"],
                transcriber=transcriber,
                force=True,
                log=lambda _: None,
            )
            self.assertEqual(transcriber.calls, 3)

    def test_prepare_media_orchestrates_split_and_transcribe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "full.mp3"
            source.write_bytes(b"source")
            audio_dir = root / "audio"
            srt_dir = root / "srt"
            transcriber = FakeTranscriber()

            result = media.prepare_media(
                source=source,
                audio_dir=audio_dir,
                srt_dir=srt_dir,
                keys=["l1", "l2"],
                spans={"l1": (0.0, 10.0), "l2": (10.0, 20.0)},
                split=True,
                transcribe=True,
                source_checksum="abc",
                source_duration=20.0,
                ffmpeg="/fake/ffmpeg",
                runner=fake_runner,
                transcriber=transcriber,
                log=lambda _: None,
            )
            self.assertEqual(len(result.split), 2)
            self.assertEqual(len(result.transcriptions), 2)
            self.assertEqual(transcriber.calls, 2)
            self.assertTrue((audio_dir / "l1.mp3").exists())
            self.assertTrue((srt_dir / "l1.srt").exists())

    def test_dependency_report(self) -> None:
        def fake_which(name: str) -> str | None:
            if name in {"ffmpeg", "ffprobe"}:
                return f"/usr/bin/{name}"
            return None

        def fake_has_module(name: str) -> bool:
            return name == "faster_whisper"

        with patch.object(media, "which", side_effect=fake_which):
            with patch.object(media, "has_module", side_effect=fake_has_module):
                report = media.dependency_report("auto", "small.en")
        self.assertTrue(report["ok"])
        self.assertEqual(report["selected"], "faster-whisper")
        self.assertTrue(report["engines"]["faster-whisper"])


if __name__ == "__main__":
    unittest.main()
