"""Regression tests for unbounded retry/polling loops and LLM-trusted graphs.

The bugs under test previously looped forever. Each test's fakes succeed after
N calls, so the buggy code produces a fast assertion failure (extra calls or a
missing exception) rather than hanging the suite; the fixed code must give up
before the fake ever succeeds.
"""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import requests

from agents.camera_image_generator import _validate_camera_tree
from agents.event_extractor import EventExtractor
from interfaces.camera import Camera
from interfaces.event import Event
from pipelines.novel2movie_pipeline import _ensure_extraction_cap
from tools.video_generator_doubao_seedance_yunwu_api import VideoGeneratorDoubaoSeedanceYunwuAPI
from tools.video_generator_omni_yunwu_api import VideoGeneratorOmniYunwuAPI
from utils.image import download_image
from utils.video import download_video


def _no_sleep(fn):
    retrying = getattr(fn, "retry", None)
    if retrying is not None:
        retrying.sleep = lambda seconds: None


class TestDownloadRetries(unittest.TestCase):
    def setUp(self):
        _no_sleep(download_image)
        _no_sleep(download_video)

    def test_download_image_gives_up_on_persistent_network_error(self):
        calls = {"n": 0}

        def flaky_get(url, **kwargs):
            calls["n"] += 1
            if calls["n"] < 10:
                raise requests.ConnectionError("connection refused")
            return MagicMock()

        with patch("utils.image.requests.get", side_effect=flaky_get):
            with self.assertRaises(requests.ConnectionError):
                download_image("http://example.com/a.png", "/tmp/a.png")
        self.assertLessEqual(calls["n"], 5, "retry must be bounded, not retry-until-success")

    def test_download_image_does_not_retry_client_errors(self):
        calls = {"n": 0}
        gone = MagicMock()
        gone.raise_for_status.side_effect = requests.HTTPError(
            "404", response=MagicMock(status_code=404)
        )

        def expired_then_ok(url, **kwargs):
            calls["n"] += 1
            if calls["n"] < 3:
                return gone
            return MagicMock()

        with patch("utils.image.requests.get", side_effect=expired_then_ok):
            with self.assertRaises(requests.HTTPError):
                download_image("http://example.com/expired.png", "/tmp/a.png")
        self.assertEqual(calls["n"], 1, "4xx responses must fail fast, not be retried")

    def test_download_image_sets_a_timeout(self):
        captured = {}

        def record_get(url, **kwargs):
            captured.update(kwargs)
            return MagicMock()

        with patch("utils.image.requests.get", side_effect=record_get):
            download_image("http://example.com/a.png", "/tmp/a.png")
        self.assertIsNotNone(captured.get("timeout"), "requests.get must not wait forever")

    def test_download_video_gives_up_on_persistent_network_error(self):
        calls = {"n": 0}

        def flaky_get(url, **kwargs):
            calls["n"] += 1
            if calls["n"] < 10:
                raise requests.ConnectionError("connection refused")
            return MagicMock()

        with patch("utils.video.requests.get", side_effect=flaky_get):
            with self.assertRaises(requests.ConnectionError):
                download_video("http://example.com/a.mp4", "/tmp/a.mp4")
        self.assertLessEqual(calls["n"], 5, "retry must be bounded, not retry-until-success")


class _FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def json(self):
        return self.payload


class _FakeSession:
    """Returns each scripted (payload, status) in turn, repeating the last one."""

    def __init__(self, scripted):
        self.scripted = list(scripted)
        self.calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def _next(self):
        response = self.scripted[min(self.calls, len(self.scripted) - 1)]
        self.calls += 1
        return _FakeResponse(*response)

    def post(self, url, **kwargs):
        return self._next()

    def get(self, url, **kwargs):
        return self._next()


class TestSeedanceClientBounds(unittest.IsolatedAsyncioTestCase):
    async def test_create_task_fails_fast_on_auth_error(self):
        session = _FakeSession([
            ({"error": "invalid api key"}, 401),
            ({"error": "invalid api key"}, 401),
            ({"id": "task-1"}, 200),
        ])
        generator = VideoGeneratorDoubaoSeedanceYunwuAPI(api_key="bad-key")
        with patch("tools.video_generator_doubao_seedance_yunwu_api.aiohttp.ClientSession", return_value=session), \
             patch("tools.video_generator_doubao_seedance_yunwu_api.asyncio.sleep", new=AsyncMock()):
            with self.assertRaises(RuntimeError):
                await generator.create_video_generation_task("a prompt", [])
        self.assertEqual(session.calls, 1, "4xx must not be retried")

    async def test_query_task_polling_is_bounded(self):
        session = _FakeSession([({"status": "queued"}, 200)])
        generator = VideoGeneratorDoubaoSeedanceYunwuAPI(api_key="key", max_poll_attempts=3)
        with patch("tools.video_generator_doubao_seedance_yunwu_api.aiohttp.ClientSession", return_value=session), \
             patch("tools.video_generator_doubao_seedance_yunwu_api.asyncio.sleep", new=AsyncMock()):
            with self.assertRaises(TimeoutError):
                await generator.query_video_generation_task("task-1")
        self.assertLessEqual(session.calls, 3)


class TestOmniClientBounds(unittest.IsolatedAsyncioTestCase):
    def test_polling_is_bounded_by_default(self):
        generator = VideoGeneratorOmniYunwuAPI(api_key="key")
        self.assertIsNotNone(generator.max_poll_attempts, "default polling must have a deadline")

    async def test_create_task_fails_fast_on_auth_error(self):
        session = _FakeSession([
            ({"error": "invalid api key"}, 401),
            ({"error": "invalid api key"}, 401),
            ({"id": "task-1"}, 200),
        ])
        generator = VideoGeneratorOmniYunwuAPI(api_key="bad-key")
        with patch("tools.video_generator_omni_yunwu_api.aiohttp.ClientSession", return_value=session), \
             patch("tools.video_generator_omni_yunwu_api.asyncio.sleep", new=AsyncMock()):
            with self.assertRaises(RuntimeError):
                await generator.create_video_generation_task("a prompt", [])
        self.assertEqual(session.calls, 1, "4xx must not be retried")


class TestEventExtractionCap(unittest.TestCase):
    def test_extraction_aborts_when_model_never_emits_is_last(self):
        extractor = object.__new__(EventExtractor)
        calls = {"n": 0}

        def never_last(novel_text, extracted_events):
            calls["n"] += 1
            if calls["n"] > 200:
                raise AssertionError("loop was not capped")
            return Event(
                index=len(extracted_events),
                is_last=False,
                description="an event",
                process_chain=["something happens"],
            )

        extractor.extract_next_event = never_last
        with self.assertRaisesRegex(RuntimeError, "[Mm]ax|[Cc]ap|exceed"):
            extractor("some novel text")

    def test_pipeline_extraction_cap_helper(self):
        _ensure_extraction_cap(0, 50, "events")
        _ensure_extraction_cap(49, 50, "events")
        with self.assertRaisesRegex(RuntimeError, "events"):
            _ensure_extraction_cap(50, 50, "events")


class TestCameraTreeValidation(unittest.TestCase):
    def _camera(self, idx, parent=None):
        return Camera(idx=idx, active_shot_idxs=[idx], parent_cam_idx=parent, parent_shot_idx=idx if parent is not None else None)

    def test_valid_tree_passes(self):
        cameras = [self._camera(0), self._camera(1, parent=0), self._camera(2, parent=1)]
        _validate_camera_tree(cameras)

    def test_cycle_is_rejected(self):
        cameras = [self._camera(0, parent=1), self._camera(1, parent=0)]
        with self.assertRaisesRegex(ValueError, "[Cc]ycle"):
            _validate_camera_tree(cameras)

    def test_self_parent_is_rejected(self):
        cameras = [self._camera(0, parent=0)]
        with self.assertRaises(ValueError):
            _validate_camera_tree(cameras)

    def test_unknown_parent_index_is_rejected(self):
        cameras = [self._camera(0), self._camera(1, parent=7)]
        with self.assertRaises(ValueError):
            _validate_camera_tree(cameras)


if __name__ == "__main__":
    unittest.main()
