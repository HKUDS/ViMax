import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from PIL import Image
from langchain_core.messages import AIMessage
from tenacity import stop_after_attempt, wait_none

from agents.best_image_selector import BestImageResponse, BestImageSelector
from agent_runtime.session_index import SessionIndex
from agent_runtime.tools import ToolRuntimeContext
from agent_runtime.vimax_adapters import ViMaxAdapters
from interfaces import Camera, ImageOutput, ShotDescription
from pipelines.idea2video_pipeline import Idea2VideoPipeline
from pipelines.script2video_pipeline import Script2VideoPipeline
from utils.image_selection import image_candidate_count_from_config, validate_image_candidate_count


class CandidateGenerator:
    def __init__(self, failures=(), portrait_indices=(), blocked=False):
        self.calls = []
        self.failures = set(failures)
        self.portrait_indices = set(portrait_indices)
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        if not blocked:
            self.release.set()
        self.running = 0
        self.peak = 0

    async def generate_single_image(self, **kwargs):
        index = len(self.calls)
        self.calls.append(kwargs)
        self.running += 1
        self.peak = max(self.peak, self.running)
        if self.running == 2:
            self.started.set()
        try:
            await self.release.wait()
            if index in self.failures:
                raise RuntimeError(f"candidate {index} unavailable")
            size = (9, 16) if index in self.portrait_indices else (16, 9)
            return ImageOutput(fmt="pil", ext="png", data=Image.new("RGB", size, (index, 0, 0)))
        finally:
            self.running -= 1


def build_pipeline(root, generator, count=2, chosen=1):
    pipeline = Script2VideoPipeline(
        chat_model=object(), image_generator=generator, video_generator=object(),
        working_dir=str(root), num_image_candidates=count,
    )
    pipeline.best_image_selector = SimpleNamespace(select=AsyncMock(
        return_value=BestImageResponse(best_image_index=chosen, reason="Matches the target composition."),
    ))
    return pipeline


async def generate(pipeline, directory, progress=None, prompt="two references", **kwargs):
    return await pipeline.generate_and_select_best_image(
        prompt=prompt, reference_image_paths=[], reference_image_path_and_text_pairs=[],
        target_description="The target composition.", candidates_save_dir=str(directory),
        progress=progress, **kwargs,
    )


class ImageCandidateTests(unittest.IsolatedAsyncioTestCase):
    async def test_candidates_are_concurrent_and_selected_result_is_persisted(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "shots" / "0" / "first_frame_candidates"
            generator = CandidateGenerator(blocked=True)
            pipeline = build_pipeline(tmp, generator)
            events = []
            task = asyncio.create_task(generate(pipeline, directory, lambda stage, message, metadata: events.append(stage)))
            try:
                await asyncio.wait_for(generator.started.wait(), 1)
                self.assertEqual(generator.peak, 2)
                self.assertEqual(generator.calls[0], generator.calls[1])
                generator.release.set()
                output = await asyncio.wait_for(task, 2)
            finally:
                generator.release.set()
                if not task.done():
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            self.assertEqual(output.data.getpixel((0, 0)), (1, 0, 0))
            self.assertTrue((directory / "candidate_0.png").is_file())
            self.assertTrue((directory / "candidate_1.png").is_file())
            record = json.loads((directory / "selection.json").read_text())
            self.assertEqual(record["status"], "selected")
            self.assertEqual(record["selected_candidate_index"], 1)
            self.assertEqual(record["selection_method"], "vlm")
            self.assertEqual(record["reason"], "Matches the target composition.")
            self.assertEqual(events.count("image_candidate_done"), 2)
            self.assertIn("image_selection_start", events)
            self.assertEqual(events[-1], "image_selection_done")

    async def test_single_candidate_disables_vlm(self):
        with tempfile.TemporaryDirectory() as tmp:
            generator = CandidateGenerator()
            pipeline = build_pipeline(tmp, generator, count=1)
            await generate(pipeline, Path(tmp) / "first_frame_candidates")
            self.assertEqual(len(generator.calls), 1)
            pipeline.best_image_selector.select.assert_not_awaited()

    async def test_failed_or_portrait_candidate_is_excluded(self):
        for kwargs in ({"failures": [0]}, {"portrait_indices": [0]}):
            with self.subTest(kwargs=kwargs), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp) / "candidates"
                generator = CandidateGenerator(**kwargs)
                pipeline = build_pipeline(tmp, generator)
                output = await generate(pipeline, directory)
                self.assertEqual(output.data.getpixel((0, 0)), (1, 0, 0))
                pipeline.best_image_selector.select.assert_not_awaited()
                record = json.loads((directory / "selection.json").read_text())
                self.assertEqual(record["selection_method"], "single_valid_candidate")
                self.assertEqual(record["selected_candidate_index"], 1)

    async def test_filtered_indices_map_back_to_original_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            generator = CandidateGenerator(failures=[0])
            pipeline = build_pipeline(tmp, generator, count=3, chosen=1)
            directory = Path(tmp) / "candidates"
            output = await generate(pipeline, directory)
            self.assertEqual(output.data.getpixel((0, 0)), (2, 0, 0))
            self.assertEqual(json.loads((directory / "selection.json").read_text())["selected_candidate_index"], 2)

    async def test_all_candidate_failures_remain_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "candidates"
            pipeline = build_pipeline(tmp, CandidateGenerator(failures=[0, 1]))
            with self.assertRaisesRegex(RuntimeError, "All 2 image candidates failed"):
                await generate(pipeline, directory)
            pipeline.best_image_selector.select.assert_not_awaited()
            self.assertEqual(json.loads((directory / "selection.json").read_text())["status"], "generation_failed")

    async def test_selection_failure_keeps_candidates_and_resume_reuses_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "candidates"
            generator = CandidateGenerator()
            pipeline = build_pipeline(tmp, generator)
            pipeline.best_image_selector.select.side_effect = [
                RuntimeError("VLM unavailable"),
                BestImageResponse(best_image_index=1, reason="Second candidate is better."),
            ]
            with self.assertRaisesRegex(RuntimeError, "VLM unavailable"):
                await generate(pipeline, directory)
            self.assertEqual(json.loads((directory / "selection.json").read_text())["status"], "selection_failed")
            self.assertTrue((directory / "candidate_0.png").exists())
            await generate(pipeline, directory)
            self.assertEqual(len(generator.calls), 2)
            record = json.loads((directory / "selection.json").read_text())
            self.assertTrue(all(item["reused"] for item in record["candidates"]))

    async def test_changed_prompt_does_not_reuse_old_candidates(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "candidates"
            generator = CandidateGenerator()
            pipeline = build_pipeline(tmp, generator)
            await generate(pipeline, directory)
            await generate(pipeline, directory, prompt="a revised composition")
            self.assertEqual(len(generator.calls), 4)

    async def test_cancellation_stops_candidate_tasks_and_persists_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "candidates"
            generator = CandidateGenerator(blocked=True)
            pipeline = build_pipeline(tmp, generator)
            task = asyncio.create_task(generate(pipeline, directory))
            await asyncio.wait_for(generator.started.wait(), 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertEqual(generator.running, 0)
            pipeline.best_image_selector.select.assert_not_awaited()
            self.assertEqual(json.loads((directory / "selection.json").read_text())["status"], "cancelled")

    async def test_first_and_last_frame_candidates_are_separate_and_cached(self):
        with tempfile.TemporaryDirectory() as tmp:
            generator = CandidateGenerator()
            pipeline = build_pipeline(tmp, generator)
            pipeline.reference_image_selector.select_reference_images_and_generate_prompt = AsyncMock(
                return_value={"reference_image_path_and_text_pairs": [], "text_prompt": "frame"},
            )
            pipeline.frame_events[0] = {"first_frame": asyncio.Event(), "last_frame": asyncio.Event()}
            (Path(tmp) / "shots" / "0").mkdir(parents=True)
            for frame in ("first_frame", "last_frame", "first_frame"):
                await pipeline.generate_frame_for_single_shot(0, frame, ("reference.png", "reference"), "a scene", [], {})
            self.assertEqual(len(generator.calls), 4)
            shot = Path(tmp) / "shots" / "0"
            self.assertTrue((shot / "first_frame_candidates" / "selection.json").is_file())
            self.assertTrue((shot / "last_frame_candidates" / "selection.json").is_file())
            self.assertTrue((shot / "first_frame.png").is_file())
            self.assertTrue((shot / "last_frame.png").is_file())

    async def test_camera_first_frame_uses_candidate_selection(self):
        with tempfile.TemporaryDirectory() as tmp:
            generator = CandidateGenerator()
            pipeline = build_pipeline(tmp, generator)
            pipeline.reference_image_selector.select_reference_images_and_generate_prompt = AsyncMock(
                return_value={"reference_image_path_and_text_pairs": [], "text_prompt": "frame"},
            )
            pipeline.frame_events[0] = {"first_frame": asyncio.Event(), "last_frame": asyncio.Event()}
            (Path(tmp) / "shots" / "0").mkdir(parents=True)
            shot = ShotDescription(idx=0, is_last=True, cam_idx=0, visual_desc="scene", variation_type="small", variation_reason="still", ff_desc="scene", ff_vis_char_idxs=[], lf_desc="scene", lf_vis_char_idxs=[], motion_desc="still", audio_desc="silent")
            await pipeline.generate_frames_for_single_camera(Camera(idx=0, active_shot_idxs=[0]), [shot], [], {}, [])
            self.assertEqual(len(generator.calls), 2)
            pipeline.best_image_selector.select.assert_awaited_once()
            self.assertTrue(pipeline.frame_events[0]["first_frame"].is_set())


class BestImageSelectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_reuses_configured_model_and_sends_reference_and_candidates(self):
        with tempfile.TemporaryDirectory() as tmp:
            files = []
            for name in ("reference", "candidate_0", "candidate_1"):
                path = Path(tmp) / f"{name}.png"
                Image.new("RGB", (16, 9)).save(path)
                files.append(str(path))
            model = SimpleNamespace(ainvoke=AsyncMock(return_value=AIMessage(content='{"best_image_index":1,"reason":"Better alignment"}')))
            selector = BestImageSelector(chat_model=model)
            self.assertIs(selector.chat_model, model)
            selected = await selector([(files[0], "The character")], "Target scene", files[1:])
            self.assertEqual(selected, files[2])
            messages = model.ainvoke.await_args.args[0]
            self.assertIn("exactly 2 candidate", messages[0].content)
            self.assertEqual(len([block for block in messages[1].content if block["type"] == "image_url"]), 3)

    async def test_schema_wrapped_response_parses_without_resampling(self):
        model = SimpleNamespace(ainvoke=AsyncMock(return_value=AIMessage(content='{"properties":{"best_image_index":1,"reason":"Aligned"}}')))
        selector = BestImageSelector(chat_model=model)
        with patch("agents.best_image_selector.image_path_to_b64", return_value="data:image/png;base64,AA=="):
            response = await selector.select([], "scene", ["0.png", "1.png"])
        self.assertEqual(response.best_image_index, 1)
        self.assertEqual(model.ainvoke.await_count, 1)

    async def test_invalid_index_fails_after_bounded_retries(self):
        model = SimpleNamespace(ainvoke=AsyncMock(return_value=AIMessage(content='{"best_image_index":9,"reason":"Invalid"}')))
        selector = BestImageSelector(chat_model=model)
        select = selector.select.retry_with(stop=stop_after_attempt(3), wait=wait_none())
        with patch("agents.best_image_selector.image_path_to_b64", return_value="data:image/png;base64,AA=="):
            with self.assertRaisesRegex(ValueError, "invalid candidate index"):
                await select(selector, [], "scene", ["0.png", "1.png"])
        self.assertEqual(model.ainvoke.await_count, 3)


class ImageSelectionIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_idea_scenes_receive_count_and_scoped_progress(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipeline = Idea2VideoPipeline(
                chat_model=object(), image_generator=object(), video_generator=object(),
                working_dir=tmp, num_image_candidates=3,
            )
            pipeline.develop_story = AsyncMock(return_value="story")
            pipeline.extract_characters = AsyncMock(return_value=[])
            pipeline.generate_character_portraits = AsyncMock(return_value={})
            pipeline.write_script_based_on_story = AsyncMock(return_value=["scene one", "scene two"])
            events = []

            async def render_scene(**kwargs):
                kwargs["progress"]("image_selection_done", "selected", {"shot_idx": 0})
                return "scene.mp4"

            renderer = AsyncMock(side_effect=render_scene)
            with patch("pipelines.idea2video_pipeline.Script2VideoPipeline", return_value=renderer) as factory, \
                 patch("pipelines.idea2video_pipeline.concatenate_video_files") as concatenate:
                await pipeline("idea", "short", "noir", quiet=True, progress=lambda stage, message, metadata: events.append(metadata))
            self.assertEqual(factory.call_count, 2)
            self.assertTrue(all(call.kwargs["num_image_candidates"] == 3 for call in factory.call_args_list))
            self.assertEqual([event["scene_idx"] for event in events], [0, 1])
            self.assertTrue(all(event["shot_idx"] == 0 for event in events))
            concatenate.assert_called_once()

    async def test_adapter_reads_workspace_count_and_rejects_invalid_count(self):
        for workflow in ("idea2video", "script2video"):
            for count in (3, 0):
                with self.subTest(workflow=workflow, count=count), tempfile.TemporaryDirectory() as tmp, \
                     patch.dict(os.environ, {}, clear=True):
                    workspace = Path(tmp)
                    config = workspace / "configs" / "agent.local.yaml"
                    config.parent.mkdir()
                    config.write_text(f"image_selection:\n  num_candidates: {count}\n", encoding="utf-8")
                    index = SessionIndex(tmp)
                    session = index.create(idea="short scene")
                    root = workspace / session["working_dir"] / workflow
                    scene = root / "scene_0" if workflow == "idea2video" else root
                    (scene / "shots" / "0").mkdir(parents=True)
                    (root / "characters.json").write_text("[]", encoding="utf-8")
                    (scene / "storyboard.json").write_text("[]", encoding="utf-8")
                    (scene / "camera_tree.json").write_text("[]", encoding="utf-8")
                    (scene / "shots" / "0" / "shot_description.json").write_text("{}", encoding="utf-8")
                    if workflow == "idea2video":
                        (root / "story.txt").write_text("story", encoding="utf-8")
                        (root / "script.json").write_text("[]", encoding="utf-8")
                    else:
                        (root / "script.txt").write_text("script", encoding="utf-8")
                    adapter = ViMaxAdapters(workspace, index)
                    events = []
                    runtime = ToolRuntimeContext("vimax_render_video", "vimax_render_video", progress_callback=events.append)

                    async def render(**kwargs):
                        kwargs["progress"]("image_selection_done", "selected", {"index": 1})
                        output = root / "final_video.mp4"
                        output.write_bytes(b"unit-test video")
                        return str(output)

                    factory_name = "Idea2VideoPipeline" if workflow == "idea2video" else "Script2VideoPipeline"
                    with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()), \
                         patch("agent_runtime.vimax_adapters._build_image_generator", return_value=object()), \
                         patch("agent_runtime.vimax_adapters._build_video_generator", return_value=object()), \
                         patch(f"agent_runtime.vimax_adapters.{factory_name}", return_value=AsyncMock(side_effect=render)) as factory:
                        result = await adapter.vimax_render_video({}, runtime)
                    if count == 0:
                        self.assertFalse(result.ok)
                        factory.assert_not_called()
                        self.assertEqual(index.get(session["session_id"])["stage"], "error")
                    else:
                        self.assertTrue(result.ok)
                        self.assertEqual(factory.call_args.kwargs["num_image_candidates"], 3)
                        stages = [event["progress"]["stage"] for event in events if event.get("type") == "tool_progress"]
                        self.assertIn("image_selection_done", stages)


class ImageSelectionConfigTests(unittest.TestCase):
    def test_count_validation(self):
        for value in (False, True, 0, -1, 1.5, None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_image_candidate_count(value)
        self.assertEqual(validate_image_candidate_count(3), 3)

    def test_pipeline_yaml_wires_count_to_both_workflows(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {}, clear=True):
            config = Path(tmp) / "config.yaml"
            config.write_text(f"chat_model:\n  init_args:\n    model: vision-model\nimage_selection:\n  num_candidates: 3\nworking_dir: {tmp}\n", encoding="utf-8")
            backend = SimpleNamespace(image_generator=object(), video_generator=object())
            for cls, module in ((Idea2VideoPipeline, "idea2video"), (Script2VideoPipeline, "script2video")):
                with self.subTest(workflow=module), patch(f"pipelines.{module}_pipeline.init_chat_model", return_value=object()), patch(f"pipelines.{module}_pipeline.RenderBackend.from_config", return_value=backend):
                    pipeline = cls.init_from_config(str(config))
                    self.assertEqual(pipeline.num_image_candidates, 3)

    def test_malformed_selection_section_is_rejected(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(ValueError, "YAML mapping"):
            image_candidate_count_from_config({"image_selection": False})


if __name__ == "__main__":
    unittest.main()
