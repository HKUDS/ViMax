import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from agent_runtime.models import ToolCall, TurnControl
from agent_runtime.session_index import SessionIndex
from agent_runtime.tool_executor import ToolExecutor
from agent_runtime.tools import build_builtin_registry


class ToolRegistryTests(unittest.IsolatedAsyncioTestCase):
    async def test_validation_default_write_json_and_logging(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            index.create()
            registry = build_builtin_registry(tmp, index)
            executor = ToolExecutor(registry, index)
            record = await executor.execute(ToolCall(name="write_json", arguments={"path": "data/a.json", "data": {"x": 1}}), TurnControl())
            self.assertTrue(record.result.ok)
            self.assertEqual(json.loads((Path(tmp) / "data" / "a.json").read_text())["x"], 1)
            self.assertTrue((Path(tmp) / ".vimax" / "logs" / "tool_calls.jsonl").exists())

    async def test_unknown_and_missing_argument_return_tool_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            registry = build_builtin_registry(tmp, index)
            executor = ToolExecutor(registry, index)
            missing = await executor.execute(ToolCall(name="read_file", arguments={}), TurnControl())
            self.assertFalse(missing.result.ok)
            unknown = await executor.execute(ToolCall(name="does_not_exist", arguments={}), TurnControl())
            self.assertFalse(unknown.result.ok)


    async def test_run_shell_is_disabled_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            registry = build_builtin_registry(tmp, index)
            executor = ToolExecutor(registry, index)
            record = await executor.execute(ToolCall(name="run_shell", arguments={"command": "pwd"}), TurnControl())
            self.assertFalse(record.result.ok)
            self.assertEqual(record.result.metadata["error_type"], "disabled")


    async def test_todo_read_returns_empty_items_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            registry = build_builtin_registry(tmp, index)
            executor = ToolExecutor(registry, index)
            record = await executor.execute(ToolCall(name="todo_read", arguments={}), TurnControl())
            self.assertTrue(record.result.ok)
            self.assertEqual(json.loads(record.result.content)["items"], [])

    async def test_todo_write_then_read_persists_items_and_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            index.create()
            registry = build_builtin_registry(tmp, index)
            executor = ToolExecutor(registry, index)
            items = [{"content": "实现 TUI", "status": "in_progress"}, {"content": "补测试"}]
            written = await executor.execute(ToolCall(name="todo_write", arguments={"items": items}), TurnControl())
            self.assertTrue(written.result.ok)
            todo_path = Path(tmp) / ".vimax" / "todo.json"
            self.assertTrue(todo_path.exists())
            payload = json.loads(todo_path.read_text())
            self.assertEqual(payload["items"][0]["content"], "实现 TUI")
            self.assertEqual(payload["items"][1]["status"], "pending")

            read = await executor.execute(ToolCall(name="todo_read", arguments={}), TurnControl())
            self.assertTrue(read.result.ok)
            self.assertEqual(json.loads(read.result.content)["items"], payload["items"])
            logs = (Path(tmp) / ".vimax" / "logs" / "tool_calls.jsonl").read_text()
            self.assertIn('"tool": "todo_write"', logs)

    async def test_todo_write_rejects_invalid_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            registry = build_builtin_registry(tmp, index)
            executor = ToolExecutor(registry, index)
            not_list = await executor.execute(ToolCall(name="todo_write", arguments={"items": {"content": "x"}}), TurnControl())
            self.assertFalse(not_list.result.ok)
            missing_content = await executor.execute(ToolCall(name="todo_write", arguments={"items": [{"status": "pending"}]}), TurnControl())
            self.assertFalse(missing_content.result.ok)
            bad_status = await executor.execute(ToolCall(name="todo_write", arguments={"items": [{"content": "x", "status": "blocked"}]}), TurnControl())
            self.assertFalse(bad_status.result.ok)

    def test_concurrency_partition_groups_read_tools(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = build_builtin_registry(tmp, SessionIndex(tmp))
            batches = registry.partition_calls([ToolCall("read_file", {"path": "x"}), ToolCall("glob_files", {"pattern": "*"}), ToolCall("write_json", {"path": "x", "data": {}})])
            self.assertEqual(len(batches), 2)
            self.assertEqual(len(batches[0]), 2)
