"""Regression tests for rate-limiter lock behavior, media resource cleanup,
packaging metadata, config templates, and test-suite isolation."""

import asyncio
import subprocess
import sys
import tomllib
import unittest
from contextlib import suppress
from pathlib import Path
from unittest.mock import MagicMock, patch

import yaml

from utils.rate_limiter import RateLimiter
from utils.video import concatenate_video_files

REPO_ROOT = Path(__file__).resolve().parent.parent


class TestRateLimiterLocking(unittest.IsolatedAsyncioTestCase):
    async def test_waiting_acquirer_does_not_hold_the_lock(self):
        limiter = RateLimiter(max_requests_per_minute=1)
        await limiter.acquire()  # consume the only slot in the window
        waiter = asyncio.create_task(limiter.acquire())
        await asyncio.sleep(0.05)  # waiter is now waiting for the window to free
        try:
            try:
                await asyncio.wait_for(limiter.lock.acquire(), timeout=0.25)
                limiter.lock.release()
            except asyncio.TimeoutError:
                self.fail("rate limiter sleeps while holding its lock, blocking every other caller")
        finally:
            waiter.cancel()
            with suppress(asyncio.CancelledError):
                await waiter

    async def test_min_delay_smoothing_still_applies(self):
        limiter = RateLimiter(max_requests_per_minute=600)  # min delay 0.1s
        loop = asyncio.get_running_loop()
        start = loop.time()
        await limiter.acquire()
        await limiter.acquire()
        self.assertGreaterEqual(loop.time() - start, 0.08)


class TestVideoConcatenationCleanup(unittest.TestCase):
    def test_concatenate_closes_all_clips_even_on_failure(self):
        clips = [MagicMock(), MagicMock()]
        final = MagicMock()
        with patch("utils.video.VideoFileClip", side_effect=clips), \
             patch("utils.video.concatenate_videoclips", return_value=final):
            concatenate_video_files(["a.mp4", "b.mp4"], "out.mp4")
        final.write_videofile.assert_called_once()
        final.close.assert_called_once()
        for clip in clips:
            clip.close.assert_called_once()

        # And when writing fails, the ffmpeg readers must still be released.
        clips = [MagicMock(), MagicMock()]
        final = MagicMock()
        final.write_videofile.side_effect = OSError("disk full")
        with patch("utils.video.VideoFileClip", side_effect=clips), \
             patch("utils.video.concatenate_videoclips", return_value=final):
            with self.assertRaises(OSError):
                concatenate_video_files(["a.mp4", "b.mp4"], "out.mp4")
        final.close.assert_called_once()
        for clip in clips:
            clip.close.assert_called_once()


class TestPackagingMetadata(unittest.TestCase):
    def test_pyproject_is_consistent(self):
        with open(REPO_ROOT / "pyproject.toml", "rb") as f:
            data = tomllib.load(f)
        readme = data["project"]["readme"]
        self.assertTrue((REPO_ROOT / readme).exists(), f"readme points at missing file: {readme}")
        self.assertNotIn("index", data, "top-level [[index]] is not valid pyproject TOML and is silently ignored")
        dev_group = data.get("dependency-groups", {}).get("dev", [])
        self.assertTrue(any("pytest" in str(item) for item in dev_group), "pytest must be a declared dev dependency so the suite runs from the venv")


class TestProviderConfigTemplates(unittest.TestCase):
    def test_minimax_templates_do_not_ship_truthy_placeholders(self):
        for name in ("idea2video_minimax.yaml", "script2video_minimax.yaml"):
            with open(REPO_ROOT / "configs" / name, encoding="utf-8") as f:
                config = yaml.safe_load(f)
            chat_key = config["chat_model"]["init_args"].get("api_key")
            self.assertFalse(chat_key, f"{name}: a truthy api_key placeholder defeats the MINIMAX_API_KEY env fallback")
            for section in ("image_generator", "video_generator"):
                key = config[section]["init_args"].get("api_key")
                self.assertNotIn("<", str(key or ""), f"{name}: {section} ships an angle-bracket placeholder that would be sent as a bearer token")


class TestSuiteIsolation(unittest.TestCase):
    def test_importing_minimax_tests_does_not_stub_global_modules(self):
        code = (
            "import sys; import tests.test_minimax_integration; "
            "mod = sys.modules.get('cv2'); "
            "from unittest.mock import MagicMock; "
            "exit(1 if isinstance(mod, MagicMock) else 0)"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode, 0,
            "importing tests.test_minimax_integration replaces sys.modules entries at import time, "
            "making every later-collected test module see MagicMock stubs instead of real libraries",
        )


if __name__ == "__main__":
    unittest.main()
