import json
import unittest
from unittest import mock

from vimax_image_worker.pipeline_handler import (
    PIPELINE_JOB_HANDLERS,
    handle_pipeline_job,
)


class _FakeReporter:
    """Records JobReporter-style events without Redis."""

    def __init__(self):
        self.events = []
        self.requeued = []

    async def started(self):
        self.events.append(("started", None))

    async def progress(self, percent, message):
        self.events.append(("progress", percent))

    async def completed(self, output):
        self.events.append(("completed", output))

    async def failed(self, *, error_code, error_message, retryable):
        self.events.append(("failed", error_code))

    def requeue(self, queue_key, payload):
        self.requeued.append((queue_key, payload))


class PipelineDispatchTest(unittest.TestCase):
    def test_transient_agent_error_is_requeued_with_bounded_attempt(self):
        import asyncio

        payload = {
            "job_type": "pipeline.script2storyboard",
            "job_id": "00000000-0000-0000-0000-000000000001",
            "attempt": 0,
        }
        reporter = _FakeReporter()
        with (
            mock.patch.dict(
                PIPELINE_JOB_HANDLERS,
                {"pipeline.script2storyboard": mock.AsyncMock(side_effect=TimeoutError("provider timeout"))},
            ),
            mock.patch("vimax_image_worker.pipeline_handler.asyncio.sleep", new=mock.AsyncMock()),
        ):
            asyncio.run(handle_pipeline_job(payload, reporter))

        self.assertEqual(reporter.requeued[0][0], "vimax:queue:q.pipeline.full")
        self.assertEqual(reporter.requeued[0][1]["attempt"], 1)
        self.assertEqual([event[0] for event in reporter.events], ["started"])

    def test_validation_error_fails_fast_without_requeue(self):
        import asyncio

        payload = {
            "job_type": "pipeline.idea2script",
            "job_id": "00000000-0000-0000-0000-000000000002",
            "attempt": 0,
        }
        reporter = _FakeReporter()
        with mock.patch.dict(
            PIPELINE_JOB_HANDLERS,
            {"pipeline.idea2script": mock.AsyncMock(side_effect=ValueError("Script content is empty"))},
        ):
            asyncio.run(handle_pipeline_job(payload, reporter))

        self.assertEqual(reporter.requeued, [])
        self.assertEqual(
            [event[0] for event in reporter.events], ["started", "failed"]
        )

    def test_all_vimax_agents_have_job_types(self):
        expected = {
            "pipeline.script2storyboard",   # StoryboardArtist
            "pipeline.story_push",          # ScriptPlanner + StoryboardArtist
            "pipeline.idea2script",         # Screenwriter
            "pipeline.script2characters",   # CharacterExtractor
            "pipeline.plan_script",         # ScriptPlanner
            "pipeline.enhance_script",      # ScriptEnhancer
            "pipeline.novel2scenes",        # NovelCompressor + Event/Scene + GlobalPlanner
            "pipeline.select_reference",    # ReferenceImageSelector
            "pipeline.select_best_image",   # BestImageSelector
            "pipeline.camera_tree",         # CameraImageGenerator
            "pipeline.character_portraits", # CharacterPortraitsGenerator
        }
        self.assertEqual(expected, set(PIPELINE_JOB_HANDLERS))

    async def _handle(self, payload):
        reporter = _FakeReporter()
        await handle_pipeline_job(payload, reporter)
        return reporter.events

    def test_unknown_job_type_fails(self):
        import asyncio

        events = asyncio.run(self._handle({"job_type": "pipeline.nope"}))

        self.assertEqual([kind for kind, _ in events], ["started", "failed"])
        self.assertEqual(events[1][1], "worker.unknown_job_type")

    def test_script2storyboard_reports_cells(self):
        import asyncio

        cells = [{"shotBrief": "b", "cameraIdx": 0, "shotIdx": 0}]
        with mock.patch.object(
            PIPELINE_JOB_HANDLERS["pipeline.script2storyboard"].__globals__["vimax_bridge"],
            "design_storyboard_cells",
            mock.AsyncMock(return_value=cells),
        ):
            events = asyncio.run(
                self._handle(
                    {
                        "job_type": "pipeline.script2storyboard",
                        "input": {"content": "script"},
                        "credential": {"api_key": "sk", "model": "m"},
                    }
                )
            )

        kinds = [kind for kind, _ in events]
        self.assertEqual(kinds, ["started", "completed"])
        output = events[1][1]
        self.assertEqual(output["cells"], cells)
        # JSON envelope keeps the asset fields the TS event schema requires.
        self.assertEqual(output["mime_type"], "application/json")
        self.assertIn("storage_key", output)


if __name__ == "__main__":
    unittest.main()
