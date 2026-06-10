import asyncio
import tempfile
import unittest

from agent_runtime.context_compactor import ContextCompactor
from agent_runtime.llm import AssistantMessage
from agent_runtime.loop import AgentLoop
from agent_runtime.models import ToolCall, ToolResult
from agent_runtime.prompts import PromptBuilder
from agent_runtime.session_index import SessionIndex
from agent_runtime.tool_executor import ToolExecutor
from agent_runtime.tools import ToolArgumentSchema, ToolRegistry, ToolSpec


class FakeLLM:
    def __init__(self, replies):
        self.replies = list(replies)

    async def complete(self, messages, tools):
        return self.replies.pop(0)


class AgentLoopTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_tool_call_finishes(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            registry = ToolRegistry([])
            loop = AgentLoop(index, PromptBuilder(f"{tmp}/prompts", index, registry), registry, ToolExecutor(registry, index), FakeLLM([AssistantMessage(text="done")]))
            events = [event async for event in loop.stream_events("hi")]
            self.assertEqual(events[-2]["type"], "done")
            turn_id = events[0]["turn_id"]
            self.assertTrue(all(event.get("turn_id") == turn_id for event in events))
            log_text = (index.logs_dir / "loop_history.jsonl").read_text(encoding="utf-8")
            self.assertIn("assistant_finished_without_tools", log_text)


    async def test_turn_record_follows_session_created_by_tool(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            old = index.create(idea="old")

            def create_actual(args):
                record = index.create(idea="actual")
                return ToolResult("create_actual", True, record["session_id"])

            registry = ToolRegistry([ToolSpec("create_actual", "Create actual session", create_actual, schema={})])
            llm = FakeLLM([AssistantMessage(tool_calls=[ToolCall(name="create_actual", arguments={})]), AssistantMessage(text="finished")])
            loop = AgentLoop(index, PromptBuilder(f"{tmp}/prompts", index, registry), registry, ToolExecutor(registry, index), llm)
            events = [event async for event in loop.stream_events("start new project")]
            active = index.active()
            self.assertNotEqual(active["session_id"], old["session_id"])
            self.assertEqual(len(index.get(active["session_id"])["recent_turn_records"]), 1)
            self.assertEqual(index.get(old["session_id"])["recent_turn_records"], [])
            self.assertEqual(events[-1]["session"]["active_session_id"], active["session_id"])


    async def test_tool_progress_streams_before_tool_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            release = asyncio.Event()

            async def slow_tool(args, runtime):
                runtime.emit_progress("started", stage="running")
                await release.wait()
                return ToolResult("slow_tool", True, "done")

            registry = ToolRegistry([ToolSpec("slow_tool", "Slow tool", slow_tool, schema={})])
            llm = FakeLLM([AssistantMessage(tool_calls=[ToolCall(name="slow_tool", arguments={})]), AssistantMessage(text="finished")])
            loop = AgentLoop(index, PromptBuilder(f"{tmp}/prompts", index, registry), registry, ToolExecutor(registry, index), llm)
            agen = loop.stream_events("start")
            seen = []
            while True:
                event = await asyncio.wait_for(anext(agen), timeout=1)
                seen.append(event["type"])
                if event["type"] == "tool_progress":
                    self.assertFalse(release.is_set())
                    break
            release.set()
            async for event in agen:
                seen.append(event["type"])
            self.assertLess(seen.index("tool_progress"), seen.index("tool_result"))


    async def test_preflight_compact_summarizes_old_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            registry = ToolRegistry([])
            compactor = ContextCompactor(None, token_threshold=200, buffer_tokens=0, preserve_last_n=2, summary_max_chars=2000)
            loop = AgentLoop(index, PromptBuilder(f"{tmp}/prompts", index, registry), registry, ToolExecutor(registry, index), FakeLLM([AssistantMessage(text="after compact")]), compactor)
            loop.history = [
                {"role": "user", "content": "old request " + "x" * 1200},
                {"role": "assistant", "content": "old answer " + "y" * 1200},
                {"role": "user", "content": "recent request"},
                {"role": "assistant", "content": "recent answer"},
            ]
            events = [event async for event in loop.stream_events("continue")]
            self.assertIn("compact", [event.get("phase") for event in events if event["type"] == "status"])
            session = index.active()
            self.assertIn("Reference Context Only", session["compacted_summary"])
            self.assertGreaterEqual(session["compacted_turns"], 1)
            self.assertTrue(session["compaction_snapshots"])
            self.assertEqual(loop.history[0]["role"], "system")
            self.assertIn("after compact", loop.history[-1]["content"])
            self.assertNotIn("old request", index.memory_text())

    async def test_tool_call_continues_then_finishes(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)

            def hello(args):
                return ToolResult("hello", True, "hello result")

            registry = ToolRegistry([ToolSpec("hello", "Say hello", hello, schema={"name": ToolArgumentSchema(str, False, "x")})])
            llm = FakeLLM([AssistantMessage(tool_calls=[ToolCall(name="hello", arguments={})]), AssistantMessage(text="finished")])
            loop = AgentLoop(index, PromptBuilder(f"{tmp}/prompts", index, registry), registry, ToolExecutor(registry, index), llm)
            events = [event async for event in loop.stream_events("start")]
            self.assertTrue(any(event["type"] == "tool_result" for event in events))
            self.assertEqual(events[-2]["assistant"], "finished")
