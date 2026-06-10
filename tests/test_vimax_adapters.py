import asyncio
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from interfaces import Camera, CharacterInScene, ShotBriefDescription, ShotDescription
from agent_runtime.session_index import SessionIndex
from agent_runtime.vimax_adapters import ViMaxAdapters
from agent_runtime.tools import ToolRuntimeContext
from pipelines.idea2video_pipeline import Idea2VideoPipeline
from pipelines.script2video_pipeline import Script2VideoPipeline


class FakeIdeaPipeline:
    def __init__(self, chat_model, image_generator, video_generator, working_dir):
        self.working_dir = Path(working_dir)
        self.working_dir.mkdir(parents=True, exist_ok=True)

    async def develop_story(self, idea, user_requirement, quiet=False):
        path = self.working_dir / "story.txt"
        path.write_text("story", encoding="utf-8")
        return "story"

    async def extract_characters(self, story, quiet=False):
        chars = [CharacterInScene(idx=0, identifier_in_scene="Cat", is_visible=True, static_features="black cat", dynamic_features="helmet")]
        (self.working_dir / "characters.json").write_text(json.dumps([c.model_dump() for c in chars]), encoding="utf-8")
        return chars

    async def write_script_based_on_story(self, story, user_requirement, quiet=False):
        script = [{"scene": "cat jumps"}]
        (self.working_dir / "script.json").write_text(json.dumps(script), encoding="utf-8")
        return script




class HangingIdeaPipeline(FakeIdeaPipeline):
    async def develop_story(self, idea, user_requirement, quiet=False):
        await asyncio.sleep(10)
        return "story"



class FakeRevisionModel:
    async def ainvoke(self, prompt):
        return SimpleNamespace(content='[{"idx": 0, "description": "more oppressive"}]')


class FailRenderIdeaPipeline(FakeIdeaPipeline):
    async def __call__(self, idea, user_requirement, style, quiet=False):
        raise RuntimeError("render failed")


class NoisyRenderIdeaPipeline(FakeIdeaPipeline):
    async def __call__(self, idea, user_requirement, style, quiet=False):
        print("NOISE_FROM_RENDER_PIPELINE")
        final = self.working_dir / "final_video.mp4"
        final.write_text("video", encoding="utf-8")
        return str(final)


class FakeScriptPipeline:
    def __init__(self, chat_model, image_generator, video_generator, working_dir):
        self.working_dir = Path(working_dir)
        self.working_dir.mkdir(parents=True, exist_ok=True)

    async def plan_text_artifacts(self, script, user_requirement, style, characters=None, progress=None, quiet=False):
        if progress:
            progress("design_storyboard", "Designing storyboard", {})
            progress("decompose_shots", "Decomposing shot visual descriptions", {"shot_count": 1})
            progress("construct_camera_tree", "Constructing camera tree", {"shot_count": 1})
        (self.working_dir / "storyboard.json").write_text("[]", encoding="utf-8")
        (self.working_dir / "camera_tree.json").write_text("[]", encoding="utf-8")
        shot_dir = self.working_dir / "shots" / "0"
        shot_dir.mkdir(parents=True, exist_ok=True)
        (shot_dir / "shot_description.json").write_text("{}", encoding="utf-8")
        if characters:
            (self.working_dir / "characters.json").write_text(json.dumps([c.model_dump() for c in characters]), encoding="utf-8")
        return {}




class FailingScriptPipeline(FakeScriptPipeline):
    async def plan_text_artifacts(self, script, user_requirement, style, characters=None, progress=None, quiet=False):
        if progress:
            progress("design_storyboard", "Designing storyboard", {})
        raise RuntimeError("storyboard failed")


class FakeInitChatModel:
    def __init__(self):
        self.calls = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return object()


class Script2VideoPlanningProgressTests(unittest.IsolatedAsyncioTestCase):
    async def test_plan_text_artifacts_emits_progress_in_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipeline = Script2VideoPipeline(chat_model=object(), image_generator=object(), video_generator=object(), working_dir=tmp)
            chars = [CharacterInScene(idx=0, identifier_in_scene="Cat", is_visible=True, static_features="black cat", dynamic_features="helmet")]
            storyboard = [ShotBriefDescription(idx=0, is_last=True, cam_idx=0, visual_desc="cat jumps", audio_desc="wind")]
            shot = ShotDescription(idx=0, is_last=True, cam_idx=0, visual_desc="cat jumps", variation_type="small", variation_reason="simple motion", ff_desc="cat starts", ff_vis_char_idxs=[0], lf_desc="cat lands", lf_vis_char_idxs=[0], motion_desc="cat jumps", audio_desc="wind")
            camera = [Camera(idx=0, active_shot_idxs=[0])]

            async def design_storyboard(script, characters, user_requirement, quiet=False):
                return storyboard

            async def decompose_visual_descriptions(shot_brief_descriptions, characters, quiet=False):
                return [shot]

            async def construct_camera_tree(shot_descriptions, quiet=False):
                return camera

            pipeline.design_storyboard = design_storyboard
            pipeline.decompose_visual_descriptions = decompose_visual_descriptions
            pipeline.construct_camera_tree = construct_camera_tree
            events = []
            await pipeline.plan_text_artifacts("script", "req", "style", characters=chars, progress=lambda stage, message, metadata=None: events.append(stage))
            self.assertEqual(events, ["extract_characters", "design_storyboard", "decompose_shots", "construct_camera_tree"])


    async def test_idea_pipeline_quiet_suppresses_text_planning_prints(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipeline = Idea2VideoPipeline(chat_model=object(), image_generator=object(), video_generator=object(), working_dir=tmp)

            async def develop_story(idea, user_requirement):
                return "story"

            pipeline.screenwriter = SimpleNamespace(develop_story=develop_story)
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                result = await pipeline.develop_story("idea", "req", quiet=True)
            self.assertEqual(result, "story")
            self.assertEqual(stdout.getvalue(), "")


class ViMaxAdapterTests(unittest.IsolatedAsyncioTestCase):
    def test_build_chat_model_uses_bounded_init_chat_model_kwargs(self):
        fake = FakeInitChatModel()
        with patch.dict("os.environ", {
            "VIMAX_LLM_API_KEY": "test-key",
            "VIMAX_LLM_MODEL": "test-model",
            "VIMAX_LLM_BASE_URL": "https://example.invalid/v1",
            "VIMAX_LLM_REQUEST_TIMEOUT_SECONDS": "12",
            "VIMAX_NARRATIVE_MAX_TOKENS": "1234",
        }), patch("agent_runtime.vimax_adapters.init_chat_model", fake):
            from agent_runtime.vimax_adapters import _build_chat_model

            _build_chat_model()

        self.assertEqual(fake.calls[0]["model"], "test-model")
        self.assertEqual(fake.calls[0]["base_url"], "https://example.invalid/v1")
        self.assertEqual(fake.calls[0]["timeout"], 12.0)
        self.assertEqual(fake.calls[0]["max_retries"], 0)
        self.assertEqual(fake.calls[0]["max_completion_tokens"], 1234)


    async def test_narrative_planning_uses_text_only_pipeline(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            adapter = ViMaxAdapters(Path(tmp), index)
            with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()), \
                 patch("agent_runtime.vimax_adapters.Idea2VideoPipeline", FakeIdeaPipeline), \
                 patch("agent_runtime.vimax_adapters.Script2VideoPipeline", FakeScriptPipeline):
                result = await adapter.vimax_narrative_planning({"idea": "moon cat", "user_requirement": "short", "style": "anime"})
            self.assertTrue(result.ok)
            payload = json.loads(result.content)
            self.assertTrue(payload["ready_for_render"])
            root = Path(tmp) / payload["working_dir"]
            self.assertTrue((root / "idea2video" / "scene_0" / "storyboard.json").exists())
            self.assertTrue((root / "idea2video" / "scene_0" / "camera_tree.json").exists())
            self.assertTrue((root / "idea2video" / "scene_0" / "shots" / "0" / "shot_description.json").exists())
            self.assertFalse((root / "script2video" / "storyboard.json").exists())
            self.assertFalse((root / "script2video" / "final_video.mp4").exists())


    async def test_narrative_planning_forwards_pipeline_progress(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            adapter = ViMaxAdapters(Path(tmp), index)
            events = []
            runtime = ToolRuntimeContext("vimax_narrative_planning", "vimax_narrative_planning", turn_id="turn-test", progress_callback=events.append)
            with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()), \
                 patch("agent_runtime.vimax_adapters.Idea2VideoPipeline", FakeIdeaPipeline), \
                 patch("agent_runtime.vimax_adapters.Script2VideoPipeline", FakeScriptPipeline):
                result = await adapter.vimax_narrative_planning({"idea": "moon cat"}, runtime)
            self.assertTrue(result.ok)
            stages = [event["progress"]["stage"] for event in events if event.get("type") == "tool_progress"]
            self.assertIn("initializing_llm", stages)
            self.assertIn("develop_story", stages)
            self.assertIn("design_storyboard", stages)
            self.assertIn("decompose_shots", stages)
            self.assertIn("construct_camera_tree", stages)


    async def test_plan_scene_failure_marks_session_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            adapter = ViMaxAdapters(Path(tmp), index)
            with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()), \
                 patch("agent_runtime.vimax_adapters.Idea2VideoPipeline", FakeIdeaPipeline), \
                 patch("agent_runtime.vimax_adapters.Script2VideoPipeline", FailingScriptPipeline):
                with self.assertRaises(RuntimeError):
                    await adapter.vimax_narrative_planning({"idea": "moon cat"})
            session = index.active()
            self.assertEqual(session["stage"], "error")
            self.assertIn("storyboard failed", session["summary"])


    async def test_narrative_planning_timeout_marks_session_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            adapter = ViMaxAdapters(Path(tmp), index)
            with patch.dict("os.environ", {"VIMAX_NARRATIVE_STEP_TIMEOUT_SECONDS": "0.01"}), \
                 patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()), \
                 patch("agent_runtime.vimax_adapters.Idea2VideoPipeline", HangingIdeaPipeline):
                with self.assertRaises(RuntimeError):
                    await adapter.vimax_narrative_planning({"idea": "moon cat"})
            session = index.active()
            self.assertIsNotNone(session)
            self.assertEqual(session["stage"], "error")
            self.assertIn("timed out", session["summary"])



    async def test_active_session_without_new_input_continues_existing_idea(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(idea="moon cat", user_requirement="short", style="anime")
            adapter = ViMaxAdapters(Path(tmp), index)
            with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()),                  patch("agent_runtime.vimax_adapters.Idea2VideoPipeline", FakeIdeaPipeline),                  patch("agent_runtime.vimax_adapters.Script2VideoPipeline", FakeScriptPipeline):
                result = await adapter.vimax_narrative_planning({})
            self.assertTrue(result.ok)
            payload = json.loads(result.content)
            self.assertEqual(payload["session_id"], record["session_id"])
            self.assertEqual(index.active()["session_id"], record["session_id"])


    async def test_active_session_continuation_preserves_existing_style(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(idea="moon cat", user_requirement="short", style="anime")
            adapter = ViMaxAdapters(Path(tmp), index)
            with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()),                  patch("agent_runtime.vimax_adapters.Idea2VideoPipeline", FakeIdeaPipeline),                  patch("agent_runtime.vimax_adapters.Script2VideoPipeline", FakeScriptPipeline):
                result = await adapter.vimax_narrative_planning({"session_id": record["session_id"]})
            self.assertTrue(result.ok)
            self.assertEqual(index.get(record["session_id"])["style"], "anime")

    async def test_new_idea_creates_new_session_instead_of_reusing_active(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            adapter = ViMaxAdapters(Path(tmp), index)
            with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()), \
                 patch("agent_runtime.vimax_adapters.Idea2VideoPipeline", FakeIdeaPipeline), \
                 patch("agent_runtime.vimax_adapters.Script2VideoPipeline", FakeScriptPipeline):
                first = await adapter.vimax_narrative_planning({"idea": "moon cat"})
                second = await adapter.vimax_narrative_planning({"idea": "ocean robot"})
            self.assertNotEqual(json.loads(first.content)["session_id"], json.loads(second.content)["session_id"])


    async def test_explicit_session_with_different_idea_creates_new_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            old = index.create(idea="old cat")
            adapter = ViMaxAdapters(Path(tmp), index)
            with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()), \
                 patch("agent_runtime.vimax_adapters.Idea2VideoPipeline", FakeIdeaPipeline), \
                 patch("agent_runtime.vimax_adapters.Script2VideoPipeline", FakeScriptPipeline):
                result = await adapter.vimax_narrative_planning({"session_id": old["session_id"], "idea": "new robot"})
            self.assertTrue(result.ok)
            payload = json.loads(result.content)
            self.assertNotEqual(payload["session_id"], old["session_id"])
            self.assertEqual(index.get(payload["session_id"])["idea"], "new robot")

    async def test_revision_mode_rewrites_existing_artifact_and_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(idea="x")
            target = Path(tmp) / record["working_dir"] / "idea2video" / "scene_0" / "storyboard.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('[{"idx": 0, "description": "calm"}]', encoding="utf-8")
            adapter = ViMaxAdapters(Path(tmp), index)
            with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=FakeRevisionModel()):
                result = await adapter.vimax_narrative_planning({"revision_target": "idea2video/scene_0/storyboard.json", "revision_instruction": "make it oppressive"})
            self.assertTrue(result.ok)
            self.assertIn("more oppressive", target.read_text(encoding="utf-8"))
            self.assertTrue((Path(tmp) / ".vimax" / "logs" / "revisions.jsonl").exists())
            self.assertTrue(index.get(record["session_id"])["stale"]["final_video"])


    async def test_revision_missing_instruction_marks_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(idea="x")
            target = Path(tmp) / record["working_dir"] / "idea2video" / "scene_0" / "storyboard.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('[]', encoding="utf-8")
            adapter = ViMaxAdapters(Path(tmp), index)
            result = await adapter.vimax_narrative_planning({"revision_target": "idea2video/scene_0/storyboard.json"})
            self.assertFalse(result.ok)
            self.assertEqual(result.metadata["error_type"], "missing_revision_instruction")
            self.assertEqual(index.get(record["session_id"])["stage"], "error")


    async def test_revision_missing_target_marks_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(idea="x")
            adapter = ViMaxAdapters(Path(tmp), index)
            result = await adapter.vimax_narrative_planning({"revision_target": "idea2video/scene_0/missing.json", "revision_instruction": "change it"})
            self.assertFalse(result.ok)
            self.assertEqual(result.metadata["error_type"], "dependency_missing")
            self.assertEqual(index.get(record["session_id"])["stage"], "error")

    async def test_render_setup_failure_marks_session_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(idea="x")
            root = Path(tmp) / record["working_dir"] / "idea2video"
            (root / "scene_0" / "shots" / "0").mkdir(parents=True, exist_ok=True)
            (root / "story.txt").write_text("story", encoding="utf-8")
            (root / "characters.json").write_text("[]", encoding="utf-8")
            (root / "script.json").write_text("[]", encoding="utf-8")
            (root / "scene_0" / "storyboard.json").write_text("[]", encoding="utf-8")
            (root / "scene_0" / "camera_tree.json").write_text("[]", encoding="utf-8")
            (root / "scene_0" / "shots" / "0" / "shot_description.json").write_text("{}", encoding="utf-8")
            adapter = ViMaxAdapters(Path(tmp), index)
            with patch("agent_runtime.vimax_adapters._build_chat_model", side_effect=RuntimeError("missing key")):
                with self.assertRaises(RuntimeError):
                    await adapter.vimax_render_video({})
            self.assertEqual(index.get(record["session_id"])["stage"], "error")

    async def test_render_failure_marks_session_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(idea="x")
            root = Path(tmp) / record["working_dir"] / "idea2video"
            (root / "scene_0" / "shots" / "0").mkdir(parents=True, exist_ok=True)
            (root / "story.txt").write_text("story", encoding="utf-8")
            (root / "characters.json").write_text("[]", encoding="utf-8")
            (root / "script.json").write_text("[]", encoding="utf-8")
            (root / "scene_0" / "storyboard.json").write_text("[]", encoding="utf-8")
            (root / "scene_0" / "camera_tree.json").write_text("[]", encoding="utf-8")
            (root / "scene_0" / "shots" / "0" / "shot_description.json").write_text("{}", encoding="utf-8")
            adapter = ViMaxAdapters(Path(tmp), index)
            with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()), \
                 patch("agent_runtime.vimax_adapters._build_image_generator", return_value=object()), \
                 patch("agent_runtime.vimax_adapters._build_video_generator", return_value=object()), \
                 patch("agent_runtime.vimax_adapters.Idea2VideoPipeline", FailRenderIdeaPipeline):
                with self.assertRaises(RuntimeError):
                    await adapter.vimax_render_video({})
            self.assertEqual(index.get(record["session_id"])["stage"], "error")


    async def test_render_pipeline_stdout_is_suppressed(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(idea="x", style="anime")
            root = Path(tmp) / record["working_dir"] / "idea2video"
            (root / "scene_0" / "shots" / "0").mkdir(parents=True, exist_ok=True)
            (root / "story.txt").write_text("story", encoding="utf-8")
            (root / "characters.json").write_text("[]", encoding="utf-8")
            (root / "script.json").write_text("[]", encoding="utf-8")
            (root / "scene_0" / "storyboard.json").write_text("[]", encoding="utf-8")
            (root / "scene_0" / "camera_tree.json").write_text("[]", encoding="utf-8")
            (root / "scene_0" / "shots" / "0" / "shot_description.json").write_text("{}", encoding="utf-8")
            adapter = ViMaxAdapters(Path(tmp), index)
            stdout = io.StringIO()
            with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()),                  patch("agent_runtime.vimax_adapters._build_image_generator", return_value=object()),                  patch("agent_runtime.vimax_adapters._build_video_generator", return_value=object()),                  patch("agent_runtime.vimax_adapters.Idea2VideoPipeline", NoisyRenderIdeaPipeline),                  contextlib.redirect_stdout(stdout):
                result = await adapter.vimax_render_video({})
            self.assertTrue(result.ok)
            self.assertNotIn("NOISE_FROM_RENDER_PIPELINE", stdout.getvalue())

    async def test_render_dependency_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            index.create(idea="x")
            adapter = ViMaxAdapters(Path(tmp), index)
            result = await adapter.vimax_render_video({})
            self.assertFalse(result.ok)
            self.assertEqual(result.metadata["error_type"], "dependency_missing")
