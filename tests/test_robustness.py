"""Regression tests for error-boundary and durability fixes.

Covers: LLM client retry/empty-choices handling, agent-loop turn error
boundary, session index corruption/atomicity/concurrency, and bounded
retry policies with backoff across agents and API clients.
"""

import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from tenacity.stop import stop_never
from tenacity.wait import wait_none

from agent_runtime.llm import OpenAICompatibleLLM
from agent_runtime.loop import AgentLoop
from agent_runtime.prompts import PromptBuilder
from agent_runtime.session_index import SessionIndex
from agent_runtime.tool_executor import ToolExecutor
from agent_runtime.tools import ToolRegistry
from agents.screenwriter import Screenwriter
from agents.script_planner import ScriptPlanner
from tools.image_generator_doubao_seedream_yunwu_api import ImageGeneratorDoubaoSeedreamYunwuAPI
from tools.image_generator_nanobanana_google_api import ImageGeneratorNanobananaGoogleAPI
from tools.image_generator_nanobanana_yunwu_api import ImageGeneratorNanobananaYunwuAPI
from tools.reranker_bge_silicon_api import RerankerBgeSiliconapi


class FakeStatusError(Exception):
    def __init__(self, status_code):
        self.status_code = status_code
        super().__init__(f"http status {status_code}")


def _fake_completion(text="ok"):
    message = MagicMock()
    message.content = text
    message.tool_calls = None
    message.model_dump.return_value = {}
    return MagicMock(choices=[MagicMock(message=message)])


class TestLLMClient(unittest.IsolatedAsyncioTestCase):
    def _llm(self, create):
        llm = OpenAICompatibleLLM(model="m", base_url="http://localhost:1", api_key="k")
        llm.client = MagicMock(chat=MagicMock(completions=MagicMock(create=create)))
        return llm

    async def test_retries_rate_limit_then_succeeds(self):
        create = AsyncMock(side_effect=[FakeStatusError(429), _fake_completion("recovered")])
        llm = self._llm(create)
        result = await llm.complete([{"role": "user", "content": "x"}], tools=[])
        self.assertEqual(result.text, "recovered")
        self.assertEqual(create.await_count, 2)

    async def test_does_not_retry_auth_errors(self):
        create = AsyncMock(side_effect=FakeStatusError(401))
        llm = self._llm(create)
        with self.assertRaises(FakeStatusError):
            await llm.complete([{"role": "user", "content": "x"}], tools=[])
        self.assertEqual(create.await_count, 1)

    async def test_gives_up_after_bounded_attempts(self):
        create = AsyncMock(side_effect=FakeStatusError(500))
        llm = self._llm(create)
        with self.assertRaises(FakeStatusError):
            await llm.complete([{"role": "user", "content": "x"}], tools=[])
        self.assertLessEqual(create.await_count, 4)
        self.assertGreater(create.await_count, 1)

    async def test_empty_choices_raises_clear_error(self):
        create = AsyncMock(return_value=MagicMock(choices=[]))
        llm = self._llm(create)
        with self.assertRaisesRegex(RuntimeError, "choice"):
            await llm.complete([{"role": "user", "content": "x"}], tools=[])


class BoomLLM:
    async def complete(self, messages, tools):
        raise RuntimeError("boom-llm")


class TestLoopErrorBoundary(unittest.IsolatedAsyncioTestCase):
    async def test_llm_failure_emits_error_and_persists_failed_turn(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            registry = ToolRegistry([])
            loop = AgentLoop(index, PromptBuilder(f"{tmp}/prompts", index, registry), registry, ToolExecutor(registry, index), BoomLLM())
            events = [event async for event in loop.stream_events("hi")]
            kinds = [event["type"] for event in events]
            self.assertIn("error", kinds)
            error_event = next(event for event in events if event["type"] == "error")
            self.assertIn("boom-llm", error_event["message"])
            self.assertEqual(events[-2]["type"], "done")
            self.assertEqual(events[-1]["type"], "session")
            active = index.active()
            records = index.get(active["session_id"])["recent_turn_records"]
            self.assertEqual(records[-1]["status"], "failed")


class TestSessionIndexDurability(unittest.TestCase):
    def test_corrupt_sessions_file_is_backed_up_not_silently_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            index.create(idea="precious work", session_id="keep-me")
            index.sessions_path.write_text("{ definitely not json", encoding="utf-8")
            data = index.load()
            self.assertEqual(data["sessions"], {})
            backups = list(index.vimax_dir.glob("sessions.json.corrupt-*"))
            self.assertEqual(len(backups), 1, "corrupt state must be preserved for recovery, not discarded")
            self.assertIn("definitely not json", backups[0].read_text(encoding="utf-8"))

    def test_save_is_atomic_and_leaves_no_temp_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            index.create(session_id="roundtrip")
            self.assertEqual(list(index.vimax_dir.glob("*.tmp")), [])
            self.assertIn("roundtrip", index.load()["sessions"])

    def test_concurrent_creates_do_not_lose_sessions(self):
        with tempfile.TemporaryDirectory() as tmp:
            index_a = SessionIndex(tmp)
            index_b = SessionIndex(tmp)

            def worker(index, tag):
                for i in range(40):
                    index.create(session_id=f"s-{tag}-{i}")

            threads = [
                threading.Thread(target=worker, args=(index_a, "a")),
                threading.Thread(target=worker, args=(index_b, "b")),
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            sessions = index_a.load()["sessions"]
            self.assertEqual(len(sessions), 80, "concurrent read-modify-write must not lose sessions")


class TestBoundedRetryPolicies(unittest.TestCase):
    CASES = [
        ("Screenwriter.write_script_based_on_story", Screenwriter.write_script_based_on_story),
        ("ScriptPlanner.plan_script", ScriptPlanner.plan_script),
        ("RerankerBgeSiliconapi.__call__", RerankerBgeSiliconapi.__call__),
        ("ImageGeneratorDoubaoSeedreamYunwuAPI.generate_single_image", ImageGeneratorDoubaoSeedreamYunwuAPI.generate_single_image),
        ("ImageGeneratorNanobananaGoogleAPI.generate_single_image", ImageGeneratorNanobananaGoogleAPI.generate_single_image),
        ("ImageGeneratorNanobananaYunwuAPI.generate_single_image", ImageGeneratorNanobananaYunwuAPI.generate_single_image),
    ]

    def test_every_retry_is_bounded_with_backoff(self):
        for name, fn in self.CASES:
            with self.subTest(name=name):
                retrying = getattr(fn, "retry", None)
                self.assertIsNotNone(retrying, f"{name} must have a retry policy")
                self.assertIsNot(retrying.stop, stop_never, f"{name} must not retry forever")
                self.assertNotIsInstance(retrying.wait, wait_none, f"{name} must back off between attempts")


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


class TestClientHttpErrors(unittest.IsolatedAsyncioTestCase):
    async def test_reranker_surfaces_http_error_without_retry(self):
        session = _FakeSession([
            ({"message": "invalid api key"}, 401),
            ({"results": []}, 200),
        ])
        reranker = RerankerBgeSiliconapi(api_key="bad", base_url="http://x")
        with patch("tools.reranker_bge_silicon_api.aiohttp.ClientSession", return_value=session):
            with self.assertRaisesRegex(RuntimeError, "401"):
                await reranker(documents=["doc"], query="q", top_n=1)
        self.assertEqual(session.calls, 1, "4xx must fail fast with the real error, not retry into KeyError")

    async def test_seedream_surfaces_http_error_without_retry(self):
        session = _FakeSession([
            ({"error": {"message": "invalid api key"}}, 401),
            ({"data": [{"url": "http://img"}]}, 200),
        ])
        generator = ImageGeneratorDoubaoSeedreamYunwuAPI(api_key="bad")
        with patch("tools.image_generator_doubao_seedream_yunwu_api.aiohttp.ClientSession", return_value=session):
            with self.assertRaisesRegex(RuntimeError, "401"):
                await generator.generate_single_image(prompt="p")
        self.assertEqual(session.calls, 1)


if __name__ == "__main__":
    unittest.main()
