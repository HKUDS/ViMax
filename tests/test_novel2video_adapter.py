import contextlib
import io
import json
import logging
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from interfaces import CharacterInEvent, CharacterInNovel, CharacterInScene, Event, Scene
from interfaces.environment import EnvironmentInScene
from agent_runtime.session_index import SessionIndex
from agent_runtime.tools import ToolRuntimeContext
from agent_runtime.vimax_adapters import ViMaxAdapters, _run_planning_step
from agents.global_information_planner import GlobalInformationPlanner, MergeCharactersAcrossScenesInEventResponse
from pipelines.novel2movie_pipeline import Novel2MoviePipeline


class FakeCompressor:
    def split(self, novel_text):
        return [novel_text]

    async def compress_single_novel_chunk(self, semaphore, index, novel_chunk):
        return index, f"compressed {novel_chunk}"

    def aggregate(self, chunks):
        return "\n".join(chunks)


class FakeEventExtractor:
    def extract_next_event(self, novel_text, extracted_events):
        return Event(index=len(extracted_events), is_last=True, description="Hero leaves home", process_chain=["Hero opens the door"])


class FakeKnowledgeBase:
    def similarity_search(self, process, k=10):
        return [SimpleNamespace(page_content="Hero opens the old wooden door.")]


class FakeReranker:
    async def __call__(self, documents, query, top_n):
        return [(documents[0], 0.95)]


class FakeSceneExtractor:
    async def get_next_scene(self, relevant_chunks, event, previous_scenes):
        return Scene(
            idx=len(previous_scenes),
            is_last=True,
            environment=EnvironmentInScene(slugline="INT. HOUSE - DAY", description="A quiet room."),
            characters=[CharacterInScene(idx=0, identifier_in_scene="Hero", is_visible=True, static_features="adult", dynamic_features="coat")],
            script="<Hero> opens the door.",
        )


class FakeGlobalPlanner:
    async def merge_characters_across_scenes_in_event(self, event_idx, scenes):
        return [CharacterInEvent(index=0, identifier_in_event="Hero", active_scenes={0: "Hero"}, static_features="adult")]

    def merge_characters_to_existing_characters_in_novel(self, event_idx, existing_characters_in_novel, characters_in_event):
        return [CharacterInNovel(index=0, identifier_in_novel="Hero", active_events={event_idx: "Hero"}, static_features="adult")]


class FakeNovelPipeline:
    def __init__(self, working_dir: Path):
        self.working_dir = working_dir

    async def plan_text_artifacts(self, novel_text, user_requirement="", style="", progress=None, quiet=False):
        if progress:
            for stage in ["save_novel", "compress_novel", "extract_events", "retrieve_chunks", "extract_scenes", "merge_characters", "completed"]:
                progress(stage, stage, {})
        novel = self.working_dir / "novel"
        novel.mkdir(parents=True, exist_ok=True)
        (novel / "novel.txt").write_text(novel_text, encoding="utf-8")
        (novel / "novel_compressed.txt").write_text("compressed", encoding="utf-8")
        events = self.working_dir / "events"
        events.mkdir(parents=True, exist_ok=True)
        (events / "event_0.json").write_text(json.dumps(Event(index=0, is_last=True, description="d", process_chain=["p"]).model_dump()), encoding="utf-8")
        chunks = self.working_dir / "relevant_chunks" / "event_0"
        chunks.mkdir(parents=True, exist_ok=True)
        (chunks / "chunk_0-score_0.95.txt").write_text("chunk", encoding="utf-8")
        scenes = self.working_dir / "scenes" / "event_0"
        scenes.mkdir(parents=True, exist_ok=True)
        scene = Scene(idx=0, is_last=True, environment=EnvironmentInScene(slugline="INT. ROOM - DAY", description="room"), characters=[CharacterInScene(idx=0, identifier_in_scene="Hero", is_visible=True, static_features="adult", dynamic_features="coat")], script="<Hero> walks.")
        (scenes / "scene_0.json").write_text(json.dumps(scene.model_dump()), encoding="utf-8")
        event_level = self.working_dir / "global_information" / "characters" / "event_level"
        event_level.mkdir(parents=True, exist_ok=True)
        event_char = CharacterInEvent(index=0, identifier_in_event="Hero", active_scenes={0: "Hero"}, static_features="adult")
        (event_level / "event_0_characters.json").write_text(json.dumps([event_char.model_dump()]), encoding="utf-8")
        novel_level = self.working_dir / "global_information" / "characters" / "novel_level"
        novel_level.mkdir(parents=True, exist_ok=True)
        novel_char = CharacterInNovel(index=0, identifier_in_novel="Hero", active_events={0: "Hero"}, static_features="adult")
        (novel_level / "novel_characters_after_event_0.json").write_text(json.dumps([novel_char.model_dump()]), encoding="utf-8")
        return {}


class FakeMergeChain:
    async def ainvoke(self, messages):
        return MergeCharactersAcrossScenesInEventResponse(
            characters=[CharacterInEvent(index=0, identifier_in_event="Hero", active_scenes={0: "Hero"}, static_features="adult")]
        )


class FakeMergeChatModel:
    def __or__(self, parser):
        return FakeMergeChain()


class GlobalInformationPlannerCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_merge_event_characters_uses_scene_character_idx(self):
        planner = GlobalInformationPlanner.__new__(GlobalInformationPlanner)
        planner.chat_model = FakeMergeChatModel()
        scene = Scene(
            idx=0,
            is_last=True,
            environment=EnvironmentInScene(slugline="INT. ROOM - DAY", description="room"),
            characters=[CharacterInScene(idx=0, identifier_in_scene="Hero", is_visible=True, static_features="adult", dynamic_features="coat")],
            script="<Hero> walks.",
        )
        characters = await planner.merge_characters_across_scenes_in_event(event_idx=0, scenes=[scene])
        self.assertEqual(characters[0].identifier_in_event, "Hero")


class PlanningStepOutputSuppressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_planning_step_suppresses_stdout_stderr_and_warnings(self):
        async def noisy_step():
            print("NOISE_STDOUT")
            logging.warning("NOISE_WARNING")
            return "ok"

        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            result = await _run_planning_step("message", "stage", noisy_step(), runtime=None)
        self.assertEqual(result, "ok")
        self.assertNotIn("NOISE_STDOUT", stdout.getvalue())
        self.assertNotIn("NOISE_WARNING", stderr.getvalue())


class Novel2MoviePlanningTests(unittest.IsolatedAsyncioTestCase):
    async def test_plan_text_artifacts_writes_structured_text_and_progress(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipeline = Novel2MoviePipeline(
                novel_compressor=FakeCompressor(),
                event_extractor=FakeEventExtractor(),
                embeddings=SimpleNamespace(model="fake-embedding"),
                rerank_model=FakeReranker(),
                scene_extractor=FakeSceneExtractor(),
                global_information_planner=FakeGlobalPlanner(),
                image_generator=object(),
                rewriter=object(),
                script2video_pipeline=object(),
                working_dir=tmp,
            )
            events = []
            with patch("pipelines.novel2movie_pipeline.CacheBackedEmbeddings.from_bytes_store", return_value=object()), \
                 patch("pipelines.novel2movie_pipeline.FAISS.from_texts", return_value=FakeKnowledgeBase()):
                result = await pipeline.plan_text_artifacts("Hero opens a door.", progress=lambda stage, message, metadata=None: events.append(stage), quiet=True)
            self.assertEqual(events, ["save_novel", "compress_novel", "extract_events", "retrieve_chunks", "extract_scenes", "merge_characters", "completed"])
            root = Path(tmp)
            self.assertTrue((root / "novel" / "novel_compressed.txt").exists())
            self.assertTrue((root / "events" / "event_0.json").exists())
            self.assertTrue((root / "relevant_chunks" / "event_0" / "chunk_0-score_0.95.txt").exists())
            self.assertTrue((root / "scenes" / "event_0" / "scene_0.json").exists())
            self.assertTrue((root / "global_information" / "characters" / "novel_level" / "novel_characters_after_event_0.json").exists())
            self.assertFalse((root / "character_portraits").exists())
            self.assertFalse((root / "videos").exists())
            self.assertEqual(len(result["events"]), 1)


class FakeNovelRenderPipeline:
    def __init__(self, working_dir: Path):
        self.working_dir = Path(working_dir)

    async def render_video_artifacts(self, style, user_requirement="", progress=None, quiet=False):
        if progress:
            progress("novel_portraits_start", "portraits", {})
            progress("novel_scene_render_start", "scene", {"event_idx": 0, "scene_idx": 0})
            progress("novel_render_completed", "done", {"scene_count": 1})
        scene_dir = self.working_dir / "videos" / "event_0" / "scene_0"
        scene_dir.mkdir(parents=True, exist_ok=True)
        (scene_dir / "final_video.mp4").write_text("video", encoding="utf-8")
        return {
            "character_portraits_dir": str(self.working_dir / "character_portraits"),
            "scene_videos_dir": str(self.working_dir / "videos"),
            "scene_video_dirs": [str(scene_dir)],
            "scene_count": 1,
        }


def write_minimal_novel_artifacts(root: Path):
    novel = root / "novel2video"
    (novel / "novel").mkdir(parents=True, exist_ok=True)
    (novel / "novel" / "novel.txt").write_text("novel", encoding="utf-8")
    (novel / "novel" / "novel_compressed.txt").write_text("compressed", encoding="utf-8")
    events = novel / "events"
    events.mkdir(parents=True, exist_ok=True)
    (events / "event_0.json").write_text(json.dumps(Event(index=0, is_last=True, description="d", process_chain=["p"]).model_dump()), encoding="utf-8")
    chunks = novel / "relevant_chunks" / "event_0"
    chunks.mkdir(parents=True, exist_ok=True)
    (chunks / "chunk_0-score_0.95.txt").write_text("chunk", encoding="utf-8")
    scenes = novel / "scenes" / "event_0"
    scenes.mkdir(parents=True, exist_ok=True)
    scene = Scene(idx=0, is_last=True, environment=EnvironmentInScene(slugline="INT. ROOM - DAY", description="room"), characters=[CharacterInScene(idx=0, identifier_in_scene="Hero", is_visible=True, static_features="adult", dynamic_features="coat")], script="<Hero> walks.")
    (scenes / "scene_0.json").write_text(json.dumps(scene.model_dump()), encoding="utf-8")
    event_level = novel / "global_information" / "characters" / "event_level"
    event_level.mkdir(parents=True, exist_ok=True)
    event_char = CharacterInEvent(index=0, identifier_in_event="Hero", active_scenes={0: "Hero"}, static_features="adult")
    (event_level / "event_0_characters.json").write_text(json.dumps([event_char.model_dump()]), encoding="utf-8")
    novel_level = novel / "global_information" / "characters" / "novel_level"
    novel_level.mkdir(parents=True, exist_ok=True)
    novel_char = CharacterInNovel(index=0, identifier_in_novel="Hero", active_events={0: "Hero"}, static_features="adult")
    (novel_level / "novel_characters_after_event_0.json").write_text(json.dumps([novel_char.model_dump()]), encoding="utf-8")


class NovelAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_rag_config_returns_tool_error_and_marks_session_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            adapter = ViMaxAdapters(Path(tmp), index)
            with patch.dict("os.environ", {"VIMAX_LLM_API_KEY": "llm-key", "VIMAX_LLM_BASE_URL": "https://llm.test/v1"}, clear=True), \
                 patch("agent_runtime.vimax_adapters._build_embedding_model", side_effect=RuntimeError("embedding config missing")):
                result = await adapter.vimax_novel_planning({"novel_text": "Hero opens a door."})
            self.assertFalse(result.ok)
            self.assertIn("embedding", result.content.lower())
            self.assertEqual(index.active()["stage"], "error")

    async def test_success_writes_novel2video_artifacts_and_marks_novel_planned(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            adapter = ViMaxAdapters(Path(tmp), index)
            progress_events = []
            runtime = ToolRuntimeContext("vimax_novel_planning", "vimax_novel_planning", turn_id="turn-test", progress_callback=progress_events.append)
            with patch("agent_runtime.vimax_adapters._build_novel_pipeline", side_effect=lambda working_dir: FakeNovelPipeline(Path(working_dir))):
                result = await adapter.vimax_novel_planning({"novel_text": "Hero opens a door.", "style": "noir"}, runtime)
            self.assertTrue(result.ok)
            payload = json.loads(result.content)
            root = Path(tmp) / payload["working_dir"]
            self.assertTrue((root / "novel2video" / "novel" / "novel_compressed.txt").exists())
            self.assertTrue((root / "novel2video" / "events" / "event_0.json").exists())
            self.assertIn("novel2video/scenes/event_*/scene_*.json", payload["generated"])
            self.assertFalse(payload["ready_for_scene_render"])
            self.assertEqual(index.active()["stage"], "novel_planned")
            stages = [event["progress"]["stage"] for event in progress_events if event.get("type") == "tool_progress"]
            self.assertIn("novel_plan_text_artifacts", stages)
            self.assertIn("merge_characters", stages)

    async def test_render_video_routes_novel2video_with_mock_pipeline(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(idea="novel", user_requirement="scene render", style="noir")
            root = Path(tmp) / record["working_dir"]
            write_minimal_novel_artifacts(root)
            adapter = ViMaxAdapters(Path(tmp), index)
            progress_events = []
            runtime = ToolRuntimeContext("vimax_render_video", "vimax_render_video", turn_id="turn-test", progress_callback=progress_events.append)
            with patch("agent_runtime.vimax_adapters._build_chat_model", return_value=object()), \
                 patch("agent_runtime.vimax_adapters._build_image_generator", return_value=object()), \
                 patch("agent_runtime.vimax_adapters._build_video_generator", return_value=object()), \
                 patch("agent_runtime.vimax_adapters._build_novel_render_pipeline", side_effect=lambda working_dir, chat_model, image_generator, video_generator: FakeNovelRenderPipeline(Path(working_dir))):
                result = await adapter.vimax_render_video({}, runtime)
            self.assertTrue(result.ok)
            payload = json.loads(result.content)
            self.assertEqual(payload["render_mode"], "novel2video")
            self.assertTrue(payload["scene_render_completed"])
            self.assertIsNone(payload["final_video_path"])
            self.assertEqual(payload["scene_count"], 1)
            self.assertEqual(index.get(record["session_id"])["stage"], "novel_scene_rendered")
            self.assertTrue((root / "novel2video" / "videos" / "event_0" / "scene_0" / "final_video.mp4").exists())
            stages = [event["progress"]["stage"] for event in progress_events if event.get("type") == "tool_progress"]
            self.assertIn("novel_scene_render_start", stages)
            self.assertIn("novel_render_completed", stages)


if __name__ == "__main__":
    unittest.main()
