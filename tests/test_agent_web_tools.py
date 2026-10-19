"""Exercise the real registry, agent loop and MCP SDK with scripted model replies.

Only HTTP is replaced: the fixture observes all requests made by the official
Streamable HTTP transport, including discovery, search and fetch.
"""
import asyncio
import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

import httpx

from agent_runtime.config import load_agent_config
from agent_runtime.llm import AssistantMessage
from agent_runtime.loop import build_runtime
from agent_runtime.models import ToolCall, ToolResult, TurnControl
from agent_runtime.tools import ToolSpec
from agent_runtime.web_tools import SEARCH_MCP_URL, USER_AGENT

REAL_HTTP_CLIENT = httpx.AsyncClient
SEARCH = {"objective": "Research the historic tram in Lisbon", "search_queries": ["Lisbon historic tram route"]}
FETCH = {"urls": ["https://example.org/tram"], "objective": "Verify the tram route"}


class ScriptedLLM:
    def __init__(self, *calls):
        self.replies = [AssistantMessage(tool_calls=[ToolCall(name=name, arguments=deepcopy(args))]) for name, args in calls]
        self.replies.append(AssistantMessage(text="Sources are ready for the video brief."))
        self.messages = []
        self.schemas = []

    async def complete(self, messages, tools):
        self.messages.append(deepcopy(messages))
        self.schemas.append(deepcopy(tools))
        return self.replies.pop(0)


class MCPFixture:
    def __init__(self):
        self.requests = []
        self.calls = []
        self.delay = 0
        self.failure = None
        self.error = False
        self.missing = False
        self.empty = False
        self.structured = False
        self.text = 'Source: https://example.org/tram\nThe historic tram crosses Lisbon.'
        self.started = asyncio.Event()
        self.stopped = asyncio.Event()

    async def respond(self, request):
        self.requests.append(request)
        payload = json.loads(request.content) if request.content else {}
        method = payload.get("method")
        if method == "initialize":
            result = {"protocolVersion": "2025-11-25", "capabilities": {"tools": {}}, "serverInfo": {"name": "fixture", "version": "1"}}
        elif method == "tools/list":
            result = {"tools": [] if self.missing else [{"name": name, "inputSchema": {"type": "object"}} for name in ("web_search", "web_fetch")]}
        elif method == "tools/call":
            self.calls.append(payload["params"])
            self.started.set()
            try:
                if self.delay:
                    await asyncio.sleep(self.delay)
                if self.failure:
                    raise self.failure
                result = {"content": [] if self.empty or self.structured else [{"type": "text", "text": self.text}], "isError": self.error}
                if self.structured:
                    result["structuredContent"] = {"url": "https://example.org/tram", "excerpt": "Lisbon tram"}
            finally:
                self.stopped.set()
        else:
            return httpx.Response(202)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": payload["id"], "result": result})

    def client(self, *args, **kwargs):
        return REAL_HTTP_CLIENT(*args, **kwargs, transport=httpx.MockTransport(self.respond))


class AgentWebToolsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        load_agent_config.cache_clear()
        self.fixture = MCPFixture()
        self.http = patch("agent_runtime.web_tools.httpx.AsyncClient", self.fixture.client)
        self.http.start()

    def tearDown(self):
        self.http.stop()
        self.environment.stop()
        self.tmp.cleanup()
        load_agent_config.cache_clear()

    def configure(self, text):
        (self.root / "configs").mkdir(exist_ok=True)
        (self.root / "configs" / "agent.local.yaml").write_text(text, encoding="utf-8")
        load_agent_config.cache_clear()

    def runtime(self, llm=None, adapters=None):
        return build_runtime(self.root, llm=llm or ScriptedLLM(), adapter_specs=adapters or [])

    async def collect(self, runtime, prompt="Research the setting before making a video brief"):
        return [event async for event in runtime.stream_events(prompt)]

    async def dispatch(self, runtime, name="web_search", args=None, control=None):
        return (await runtime.tool_executor.execute(ToolCall(name=name, arguments=deepcopy(SEARCH if args is None else args)), control or TurnControl())).result

    async def test_anonymous_agent_search_fetch_and_followup_reach_model(self):
        llm = ScriptedLLM(("web_search", SEARCH), ("web_fetch", FETCH))
        runtime = self.runtime(llm)
        events = await self.collect(runtime)
        results = [e["tool_result"] for e in events if e["type"] == "tool_result"]
        self.assertEqual(len(results), 2)
        self.assertTrue(all(r["ok"] for r in results), results)
        self.assertIn("https://example.org/tram", llm.messages[1][-1]["content"])
        self.assertIn("historic tram", llm.messages[2][-1]["content"])
        self.assertEqual(events[-2]["assistant"], "Sources are ready for the video brief.")
        runtime.llm = ScriptedLLM(("web_search", SEARCH))
        await self.collect(runtime, "Find a second source")
        ids = [call["arguments"]["session_id"] for call in self.fixture.calls]
        self.assertEqual(len(set(ids)), 1)
        UUID(ids[0])
        self.assertNotEqual(ids[0], runtime.session_index.active()["session_id"])
        methods = [json.loads(r.content).get("method") for r in self.fixture.requests if r.content]
        self.assertEqual(methods.count("initialize"), 3)
        self.assertEqual(methods.count("tools/list"), 3)
        self.assertEqual([c["name"] for c in self.fixture.calls], ["web_search", "web_fetch", "web_search"])
        for request in self.fixture.requests:
            self.assertEqual(str(request.url), SEARCH_MCP_URL)
            self.assertEqual(request.headers["User-Agent"], USER_AGENT)
            self.assertNotIn("Authorization", request.headers)
            self.assertNotIn("Cookie", request.headers)
        for name in ("web_search", "web_fetch"):
            self.assertEqual(runtime.tool_registry.get_spec(name).permission_mode, "read-only")
        self.assertFalse((await self.dispatch(runtime, "run_shell", {"command": "pwd"})).ok)

    async def test_resume_and_new_project_identity_with_shared_handler(self):
        first = self.runtime(ScriptedLLM(("web_search", SEARCH)))
        await self.collect(first)
        original_id = self.fixture.calls[-1]["arguments"]["session_id"]
        original_project = first.session_index.active()["session_id"]
        resumed = self.runtime(ScriptedLLM(("web_fetch", FETCH)))
        await self.collect(resumed)
        self.assertEqual(self.fixture.calls[-1]["arguments"]["session_id"], original_id)
        resumed.session_index.create(project_name="Independent project")
        other = self.runtime(ScriptedLLM(("web_search", SEARCH)))
        # Two conversations share the exact same registered handler/transport.
        other.tool_registry = first.tool_registry
        other.tool_executor = first.tool_executor
        await self.collect(other)
        other_id = self.fixture.calls[-1]["arguments"]["session_id"]
        self.assertNotEqual(original_id, other_id)
        first.session_index.set_active(original_project)
        first.llm = ScriptedLLM(("web_search", SEARCH))
        await self.collect(first)
        self.assertEqual(self.fixture.calls[-1]["arguments"]["session_id"], original_id)

    async def test_interleaved_conversations_capture_context_before_project_switch(self):
        first = self.runtime(ScriptedLLM(("web_search", SEARCH), ("web_fetch", FETCH)))
        first_stream = first.stream_events("First conversation")
        await anext(first_stream)  # Captures first project's ID before yielding.
        first_id = first.session_index.active()["search_conversation_id"]
        second_project = first.session_index.create(project_name="Second conversation")
        second = self.runtime(ScriptedLLM(("web_search", SEARCH), ("web_fetch", FETCH)))
        second.tool_registry = first.tool_registry
        second.tool_executor = first.tool_executor
        second_stream = second.stream_events("Second conversation")
        await anext(second_stream)
        second_id = second.session_index.get(second_project["session_id"])["search_conversation_id"]
        async def drain(stream):
            return [event async for event in stream]
        await asyncio.gather(drain(first_stream), drain(second_stream))
        ids = [c["arguments"]["session_id"] for c in self.fixture.calls]
        self.assertNotEqual(first_id, second_id)
        self.assertEqual(ids.count(first_id), 2)
        self.assertEqual(ids.count(second_id), 2)

    async def test_saved_disable_environment_override_and_explicit_tool_override(self):
        self.configure("search:\n  provider: none\nllm:\n  api_key: configured-model-key\n")
        runtime = self.runtime()
        self.assertNotIn("web_search", [t["function"]["name"] for t in runtime.tool_registry.list_function_tools()])
        result = await self.dispatch(runtime)
        self.assertFalse(result.ok)
        self.assertEqual(self.fixture.requests, [])
        with patch.dict(os.environ, {"VIMAX_SEARCH_PROVIDER": "parallel", "PARALLEL_API_KEY": "ambient-key-must-not-be-sent"}):
            enabled = self.runtime()
            self.assertTrue((await self.dispatch(enabled)).ok)
            self.assertTrue(all("Authorization" not in r.headers for r in self.fixture.requests))
        self.configure("search:\n  provider: parallel\n")
        with patch.dict(os.environ, {"VIMAX_SEARCH_PROVIDER": "none"}):
            self.assertIsNone(self.runtime().tool_registry.get_spec("web_fetch"))
        async def explicit(args):
            return ToolResult("web_search", True, "Explicit search choice")
        custom = self.runtime(adapters=[ToolSpec("web_search", "Configured override", explicit)])
        self.assertEqual((await self.dispatch(custom)).content, "Explicit search choice")

    async def test_invalid_configuration_does_not_silently_fallback(self):
        for text in ("search: []", "search:\n  provider: []", "search:\n  provider: unknown", "search:\n  timeout_seconds: .nan", "search:\n  timeout_seconds: true", "search:\n  timeout_seconds: 0"):
            with self.subTest(text=text):
                self.configure(text)
                with self.assertRaises(ValueError):
                    self.runtime()
        self.assertEqual(self.fixture.requests, [])

    async def test_invalid_arguments_and_urls_never_make_requests(self):
        runtime = self.runtime()
        cases = [("web_search", {"objective": "x", "search_queries": []}), ("web_search", {"objective": "x", "search_queries": [2]}), ("web_search", {**SEARCH, "session_id": "model-chosen"}), ("web_fetch", {"urls": ["file:///etc/passwd"]}), ("web_fetch", {"urls": ["https://user:secret@example.org"]}), ("web_fetch", {"urls": ["https://example.org:bad"]}), ("web_fetch", {"urls": ["https://example.org/a b"]}), ("web_fetch", {"urls": []}), ("web_fetch", {**FETCH, "objective": "x" * 201}), ("web_fetch", {**FETCH, "full_content": 2})]
        for name, args in cases:
            with self.subTest(name=name, args=args):
                self.assertFalse((await self.dispatch(runtime, name, args)).ok)
        self.assertEqual(self.fixture.requests, [])

    async def test_mcp_quota_error_and_retry_keep_conversation_identity(self):
        runtime = self.runtime(ScriptedLLM(("web_search", SEARCH)))
        self.fixture.error = True
        self.fixture.text = "Free anonymous search quota exceeded. Try again later."
        events = await self.collect(runtime)
        result = next(e["tool_result"] for e in events if e["type"] == "tool_result")
        self.assertFalse(result["ok"])
        self.assertEqual(result["metadata"]["error_type"], "service_error")
        original_id = self.fixture.calls[-1]["arguments"]["session_id"]
        self.fixture.error = False
        runtime.llm = ScriptedLLM(("web_search", SEARCH))
        await self.collect(runtime)
        self.assertEqual(self.fixture.calls[-1]["arguments"]["session_id"], original_id)
        self.assertEqual(len(self.fixture.calls), 2)  # No automatic provider fallback/retry.

    async def test_transport_and_discovery_errors_reach_model(self):
        self.fixture.failure = httpx.ConnectError("fixture connection failed")
        llm = ScriptedLLM(("web_search", SEARCH))
        runtime = self.runtime(llm)
        events = await self.collect(runtime)
        result = next(e["tool_result"] for e in events if e["type"] == "tool_result")
        self.assertFalse(result["ok"])
        self.assertIn("fixture connection failed", llm.messages[1][-1]["content"])
        self.fixture.failure = None
        self.fixture.missing = True
        result = await self.dispatch(runtime)
        self.assertFalse(result.ok)
        self.assertIn("does not advertise", result.content)

    async def test_timeout_cancels_transport(self):
        self.configure("search:\n  timeout_seconds: 1\n")
        self.fixture.delay = 10
        result = await asyncio.wait_for(self.dispatch(self.runtime()), timeout=3)
        self.assertFalse(result.ok)
        self.assertEqual(result.metadata["error_type"], "timeout")
        self.assertTrue(self.fixture.stopped.is_set())

    async def test_cancel_before_and_during_request_closes_transport(self):
        runtime = self.runtime()
        control = TurnControl()
        control.cancel()
        result = await self.dispatch(runtime, control=control)
        self.assertFalse(result.ok)
        self.assertEqual(self.fixture.requests, [])
        control = TurnControl()
        self.fixture.delay = 10
        task = asyncio.create_task(self.dispatch(runtime, control=control))
        await asyncio.wait_for(self.fixture.started.wait(), timeout=2)
        control.cancel("Stop researching")
        result = await asyncio.wait_for(task, timeout=2)
        self.assertTrue(result.metadata["cancelled"])
        self.assertTrue(self.fixture.stopped.is_set())

    async def test_cancelling_agent_turn_closes_inflight_mcp_request(self):
        runtime = self.runtime(ScriptedLLM(("web_search", SEARCH)))
        self.fixture.delay = 10
        task = asyncio.create_task(self.collect(runtime))
        await asyncio.wait_for(self.fixture.started.wait(), timeout=2)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(self.fixture.stopped.is_set())

    async def test_structured_empty_and_bounded_output(self):
        runtime = self.runtime()
        self.fixture.structured = True
        result = await self.dispatch(runtime)
        self.assertTrue(result.ok)
        self.assertEqual(json.loads(result.content)["url"], "https://example.org/tram")
        self.fixture.structured = False
        self.fixture.empty = True
        self.assertFalse((await self.dispatch(runtime)).ok)
        self.fixture.empty = False
        self.fixture.text = "x" * 60000
        result = await self.dispatch(runtime)
        self.assertTrue(result.metadata["truncated"])
        self.assertLess(len(result.content), 50100)
