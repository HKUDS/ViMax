import unittest
from unittest import mock

from vimax_image_worker.audio_handler import _build_tts_generator, handle_audio_job
from vimax_image_worker.concat_handler import _build_srt, _format_srt_time


class _FakeReporter:
    def __init__(self):
        self.events = []

    async def started(self):
        self.events.append(("started", None))

    async def progress(self, percent, message):
        self.events.append(("progress", percent))

    async def completed(self, output):
        self.events.append(("completed", output))

    async def failed(self, *, error_code, error_message, retryable):
        self.events.append(("failed", error_code))


class SrtBuilderTest(unittest.TestCase):
    def test_formats_srt_timestamps(self):
        self.assertEqual(_format_srt_time(0), "00:00:00,000")
        self.assertEqual(_format_srt_time(63.5), "00:01:03,500")
        self.assertEqual(_format_srt_time(3661.25), "01:01:01,250")

    def test_builds_cues_from_clip_durations(self):
        srt = _build_srt(
            ["第一句口播", None, "第三句口播"],
            [3.0, 4.0, 5.0],
        )
        # Clip 1 gets a cue; the skipped clip advances the cursor, so clip 3's
        # cue starts at 7s. Only 2 cues total.
        self.assertIn("1\n00:00:00,000 --> 00:00:03,000\n第一句口播", srt)
        self.assertIn("2\n00:00:07,000 --> 00:00:12,000\n第三句口播", srt)
        self.assertNotIn("3\n", srt)


class _FakeTtsGenerator:
    def __init__(self, api_key, base_url="", model=""):
        self.api_key = api_key
        self.voice = "alloy"

    async def synthesize(self, text, output_path):
        with open(output_path, "wb") as f:
            f.write(b"ID3fake-mp3-data-for-test-payload")


class AudioDispatchTest(unittest.TestCase):
    def _payload(self, job_type):
        return {
            "job_id": "test-job",
            "job_type": job_type,
            "credential": {"class_path": "tests_fake.Gen", "api_key": "sk-test"},
            "input": {"prompt": "", "text": "大家好，今天给大家带来一款好物", "voice": "alloy"},
            "callback": {
                "event_channel": "ch",
                "upload_bucket": "bucket",
                "upload_prefix": "prefix",
            },
        }

    def test_tts_requires_api_key(self):
        import asyncio

        payload = self._payload("audio.tts")
        payload["credential"]["api_key"] = ""
        reporter = _FakeReporter()
        asyncio.run(handle_audio_job(payload, reporter))

        kinds = [kind for kind, _ in reporter.events]
        self.assertEqual(kinds, ["started", "failed"])

    def test_tts_builds_generator_from_class_path(self):
        from vimax_image_worker import audio_handler

        with mock.patch.object(
            audio_handler.importlib, "import_module", return_value=mock.Mock(**{"Gen": _FakeTtsGenerator})
        ):
            generator = _build_tts_generator({"class_path": "tests_fake.Gen", "api_key": "sk-test"})

        self.assertIsInstance(generator, _FakeTtsGenerator)
        self.assertEqual(generator.api_key, "sk-test")


if __name__ == "__main__":
    unittest.main()
