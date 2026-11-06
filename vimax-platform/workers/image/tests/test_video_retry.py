import asyncio
import unittest
from unittest import mock

from vimax_image_worker.video_handler import VideoJobPayload, _run_video


class _Reporter:
    def __init__(self):
        self.events = []

    async def started(self):
        self.events.append("started")

    async def progress(self, *_args):
        pass

    async def failed(self, **kwargs):
        self.events.append(("failed", kwargs))

    def requeue(self, queue_key, payload):
        self.events.append(("requeue", queue_key, payload))


class VideoRetryTest(unittest.TestCase):
    def test_timeout_requeues_once_without_publishing_failure(self):
        payload = VideoJobPayload.model_validate({
            "job_id": "video-job",
            "job_type": "shot.video",
            "model_id": "model",
            "credential": {"class_path": "tools.Video", "api_key": "key"},
            "input": {"prompt": "scene"},
            "callback": {"event_channel": "events", "upload_bucket": "bucket", "upload_prefix": "out"},
            "cache_key": "cache",
        })
        reporter = _Reporter()
        redis = mock.Mock()
        generator = mock.Mock()
        generator.generate_single_video = mock.AsyncMock(side_effect=TimeoutError("provider timeout"))

        with (
            mock.patch("vimax_image_worker.video_handler.JobReporter", return_value=reporter),
            mock.patch("vimax_image_worker.video_handler.download_objects", return_value=[]),
            mock.patch("vimax_image_worker.video_handler._build_video_generator", return_value=generator),
            mock.patch("vimax_image_worker.video_handler.asyncio.sleep", new=mock.AsyncMock()),
        ):
            asyncio.run(_run_video(payload, redis))

        requeued = [event for event in reporter.events if event[0] == "requeue"]
        self.assertEqual(len(requeued), 1)
        self.assertEqual(requeued[0][1], "vimax:queue:q.video.std")
        self.assertEqual(requeued[0][2]["attempt"], 1)
        self.assertNotIn("failed", reporter.events)


if __name__ == "__main__":
    unittest.main()
