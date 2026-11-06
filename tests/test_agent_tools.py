import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

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

    async def test_read_json_supports_virtual_session_json_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(session_id="20260630-125442-vimax", idea="surfing")
            registry = build_builtin_registry(tmp, index)
            executor = ToolExecutor(registry, index)
            result = await executor.execute(
                ToolCall(name="read_json", arguments={"path": f"{record['working_dir']}/session.json"}),
                TurnControl(),
            )
            self.assertTrue(result.result.ok)
            payload = json.loads(result.result.content)
            self.assertEqual(payload["session"]["session_id"], "20260630-125442-vimax")
            self.assertEqual(payload["source"], ".vimax/sessions.json")
            self.assertTrue(result.result.metadata["virtual_path"])

    async def test_read_file_supports_virtual_session_log_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(session_id="20260630-125442-vimax", idea="surfing")
            index.append_turn_record(record["session_id"], {"turn_id": "turn-1", "status": "completed", "final_assistant_text": "done"})
            registry = build_builtin_registry(tmp, index)
            executor = ToolExecutor(registry, index)
            result = await executor.execute(
                ToolCall(name="read_file", arguments={"path": ".vimax/logs/20260630-125442-vimax.log"}),
                TurnControl(),
            )
            self.assertTrue(result.result.ok)
            payload = json.loads(result.result.content)
            self.assertEqual(payload["session_id"], "20260630-125442-vimax")
            self.assertEqual(payload["source"], ".vimax/logs/*.jsonl")
            self.assertEqual(payload["records"][0]["turn_id"], "turn-1")
            self.assertTrue(result.result.metadata["virtual_path"])

    async def test_view_image_returns_transient_multimodal_content_without_logging_pixels(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(session_id="visual-session")
            image_path = index.working_dir(record["session_id"]) / "idea2video" / "reference.png"
            exif = Image.Exif()
            exif[271] = "Camera Corp"
            exif[272] = "Model One"
            exif[37386] = 50.0
            Image.new("RGB", (2400, 1200), (20, 40, 60)).save(image_path, exif=exif)
            registry = build_builtin_registry(tmp, index)
            executor = ToolExecutor(registry, index)
            result = await executor.execute(
                ToolCall(name="view_image", arguments={"path": "idea2video/reference.png"}),
                TurnControl(),
            )

            self.assertTrue(result.result.ok)
            self.assertEqual(result.result.metadata["original_width"], 2400)
            self.assertLessEqual(result.result.metadata["display_width"], 1568)
            self.assertEqual(result.result.metadata["camera_metadata"]["focal_length_mm"], 50.0)
            data_url = result.result.model_content[0]["image_url"]["url"]
            self.assertTrue(data_url.startswith("data:image/jpeg;base64,"))
            self.assertNotIn("model_content", result.result.as_dict())
            self.assertNotIn("data:image", (index.logs_dir / "tool_calls.jsonl").read_text(encoding="utf-8"))

    async def test_view_image_accepts_active_workspace_prefixed_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            record = index.create(session_id="visual-session")
            image_path = index.working_dir(record["session_id"]) / "script2video" / "frame.jpg"
            Image.new("RGB", (800, 450), "blue").save(image_path)
            registry = build_builtin_registry(tmp, index)
            result = await registry.execute("view_image", {"path": f"{record['working_dir']}/script2video/frame.jpg"})
            self.assertTrue(result.ok)
            self.assertEqual(result.metadata["path"], "script2video/frame.jpg")

    async def test_view_image_rejects_paths_outside_active_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = SessionIndex(tmp)
            active = index.create(session_id="active-session")
            other = index.create(session_id="other-session")
            other_image = index.working_dir(other["session_id"]) / "idea2video" / "other.png"
            Image.new("RGB", (16, 9), "red").save(other_image)
            index.set_active(active["session_id"])
            registry = build_builtin_registry(tmp, index)
            escaped = await registry.execute("view_image", {"path": "../../outside.png"})
            cross_session = await registry.execute("view_image", {"path": f"{other['working_dir']}/idea2video/other.png"})
            self.assertFalse(escaped.ok)
            self.assertFalse(cross_session.ok)
            self.assertEqual(escaped.metadata["error_type"], "invalid_input")
            self.assertEqual(cross_session.metadata["error_type"], "invalid_input")

    def test_concurrency_partition_groups_read_tools(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = build_builtin_registry(tmp, SessionIndex(tmp))
            batches = registry.partition_calls([ToolCall("read_file", {"path": "x"}), ToolCall("glob_files", {"pattern": "*"}), ToolCall("write_json", {"path": "x", "data": {}})])
            self.assertEqual(len(batches), 2)
            self.assertEqual(len(batches[0]), 2)
