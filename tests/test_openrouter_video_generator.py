import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from tools.video_generator_openrouter_api import VideoGeneratorOpenRouterAPI
from interfaces.video_output import VideoOutput


class OpenRouterVideoGeneratorTests(unittest.IsolatedAsyncioTestCase):
    async def test_default_duration_is_eight_seconds(self):
        captured = {}

        async def fake_post_json(url, *, headers, payload, timeout, hard_timeout_seconds):
            captured["payload"] = payload
            return 200, {"id": "job-1", "polling_url": "/videos/job-1", "status": "queued"}

        async def fake_get_json(url, *, headers, timeout, hard_timeout_seconds):
            return 200, {"status": "completed", "unsigned_urls": ["https://cdn.example/out.mp4"]}

        async def fake_get_bytes(url, *, headers, timeout, hard_timeout_seconds):
            return 200, b"video"

        async def fake_sleep(seconds):
            return None

        generator = VideoGeneratorOpenRouterAPI(api_key="test-key", model="google/veo-3.1-lite")
        with patch.dict(os.environ, {}, clear=True), \
             patch("tools.video_generator_openrouter_api._post_json", fake_post_json), \
             patch("tools.video_generator_openrouter_api._get_json", fake_get_json), \
             patch("tools.video_generator_openrouter_api._get_bytes", fake_get_bytes), \
             patch("tools.video_generator_openrouter_api.asyncio.sleep", fake_sleep):
            output = await generator.generate_single_video(prompt="hello")

        self.assertIsInstance(output, VideoOutput)
        self.assertEqual(captured["payload"]["duration"], 8)
        self.assertEqual(captured["payload"]["model"], "google/veo-3.1-lite")

    async def test_seedance_fast_uses_supported_openrouter_payload(self):
        captured = {}

        async def fake_post_json(url, *, headers, payload, timeout, hard_timeout_seconds):
            captured["payload"] = payload
            return 200, {"id": "job-2", "polling_url": "/videos/job-2", "status": "queued"}

        async def fake_get_json(url, *, headers, timeout, hard_timeout_seconds):
            return 200, {"status": "completed", "unsigned_urls": ["https://cdn.example/seedance.mp4"]}

        async def fake_get_bytes(url, *, headers, timeout, hard_timeout_seconds):
            return 200, b"seedance-video"

        async def fake_sleep(seconds):
            return None

        with tempfile.TemporaryDirectory() as tmp:
            first_frame = Path(tmp) / "first.png"
            last_frame = Path(tmp) / "last.png"
            Image.new("RGB", (16, 9), "blue").save(first_frame)
            Image.new("RGB", (16, 9), "red").save(last_frame)
            generator = VideoGeneratorOpenRouterAPI(api_key="test-key", model="bytedance/seedance-2.0-fast")
            with patch.dict(os.environ, {}, clear=True), \
                 patch("tools.video_generator_openrouter_api._post_json", fake_post_json), \
                 patch("tools.video_generator_openrouter_api._get_json", fake_get_json), \
                 patch("tools.video_generator_openrouter_api._get_bytes", fake_get_bytes), \
                 patch("tools.video_generator_openrouter_api.asyncio.sleep", fake_sleep):
                output = await generator.generate_single_video(
                    prompt="a cinematic walk",
                    reference_image_paths=[str(first_frame), str(last_frame)],
                )

        payload = captured["payload"]
        self.assertIsInstance(output, VideoOutput)
        self.assertEqual(payload["model"], "bytedance/seedance-2.0-fast")
        self.assertEqual(payload["duration"], 8)
        self.assertEqual(payload["resolution"], "720p")
        self.assertEqual(payload["aspect_ratio"], "16:9")
        self.assertTrue(payload["generate_audio"])
        self.assertEqual(
            [frame["frame_type"] for frame in payload["frame_images"]],
            ["first_frame", "last_frame"],
        )


if __name__ == "__main__":
    unittest.main()
