import contextlib
import io
import json
import sys
import unittest
from unittest.mock import patch

import main_agent


class FakeSessionIndex:
    def __init__(self, fail_session=False):
        self.fail_session = fail_session
        self.activated = ""
        self.created = 0

    def set_active(self, session_id):
        if self.fail_session:
            raise KeyError(session_id)
        self.activated = session_id

    def create(self):
        self.created += 1
        self.activated = f"new-{self.created}"
        return {"session_id": self.activated}

    def snapshot(self):
        return {"active_session_id": self.activated, "session": {"session_id": self.activated, "stage": "created"}}


class FakeRuntime:
    def __init__(self, fail_session=False):
        self.session_index = FakeSessionIndex(fail_session=fail_session)
        self.inputs = []

    async def compact_history(self, reason="manual"):
        return "Compacted context 100 -> 50 (fallback-local)."

    async def stream_events(self, user_input):
        self.inputs.append(user_input)
        turn_id = "turn-test"
        yield {"type": "turn", "turn_id": turn_id, "turn": {"id": turn_id}}
        yield {"type": "status", "turn_id": turn_id, "phase": "sampling_assistant", "message": "Sampling assistant"}
        yield {"type": "tool_progress", "turn_id": turn_id, "tool": {"name": "fake_tool"}, "progress": {"stage": "running", "message": "working"}}
        yield {"type": "terminal", "turn_id": turn_id, "stream": "stdout", "line": "pipeline output"}
        yield {"type": "token", "turn_id": turn_id, "delta": "done"}
        yield {"type": "done", "turn_id": turn_id, "assistant": "done", "tool_results": []}
        yield {"type": "session", "turn_id": turn_id, "session": {"session": {"session_id": "s1", "stage": "narrative_planned"}}}


class MainAgentCliTests(unittest.IsolatedAsyncioTestCase):
    async def run_cli(self, argv, runtime=None, stdin_text="", session_index=None, load_runtime_side_effect=None):
        runtime = runtime or FakeRuntime()
        session_index = session_index or runtime.session_index
        stdout = io.StringIO()
        stderr = io.StringIO()
        stdin = io.StringIO(stdin_text)
        load_runtime_patch = patch.object(main_agent, "load_runtime", return_value=runtime)
        if load_runtime_side_effect is not None:
            load_runtime_patch = patch.object(main_agent, "load_runtime", side_effect=load_runtime_side_effect)
        with load_runtime_patch, \
             patch.object(main_agent, "load_session_index", return_value=session_index), \
             patch.object(sys, "stdin", stdin), \
             contextlib.redirect_stdout(stdout), \
             contextlib.redirect_stderr(stderr):
            code = await main_agent.amain(argv)
        return code, stdout.getvalue(), stderr.getvalue(), runtime

    def test_help_parser_contains_once(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout), self.assertRaises(SystemExit) as ctx:
            main_agent.parse_args(["--help"])
        self.assertEqual(ctx.exception.code, 0)
        self.assertIn("--once", stdout.getvalue())

    async def test_jsonl_once_outputs_valid_events_with_turn_id(self):
        code, stdout, stderr, runtime = await self.run_cli(["--jsonl", "--once", "hello"])
        self.assertEqual(code, 0)
        self.assertEqual(stderr, "")
        self.assertEqual(runtime.inputs, ["hello"])
        lines = [json.loads(line) for line in stdout.splitlines()]
        self.assertTrue(lines)
        self.assertEqual({event["turn_id"] for event in lines}, {"turn-test"})
        self.assertEqual(lines[0]["type"], "turn")
        self.assertIn("terminal", [event["type"] for event in lines])
        self.assertNotIn("›", stdout)

    async def test_stdin_non_tty_is_single_prompt(self):
        code, stdout, stderr, runtime = await self.run_cli(["--jsonl"], stdin_text="from stdin\n")
        self.assertEqual(code, 0)
        self.assertEqual(runtime.inputs, ["from stdin"])
        self.assertTrue(stdout.strip())


    async def test_stdin_repl_reads_each_line_as_a_turn(self):
        code, stdout, stderr, runtime = await self.run_cli(["--jsonl", "--stdin-repl"], stdin_text="first\nsecond\n")
        self.assertEqual(code, 0)
        self.assertEqual(stderr, "")
        self.assertEqual(runtime.inputs, ["first", "second"])
        events = [json.loads(line) for line in stdout.splitlines()]
        self.assertEqual([event["type"] for event in events if event["type"] == "done"], ["done", "done"])

    async def test_session_error_is_clear_before_runtime_load(self):
        runtime = FakeRuntime()
        failing_index = FakeSessionIndex(fail_session=True)
        code, stdout, stderr, runtime = await self.run_cli(
            ["--session", "missing", "--once", "hello"],
            runtime=runtime,
            session_index=failing_index,
            load_runtime_side_effect=AssertionError("runtime should not load"),
        )
        self.assertEqual(code, 2)
        self.assertEqual(stdout, "")
        self.assertIn("unknown session id", stderr)
        self.assertEqual(runtime.inputs, [])


    async def test_new_session_is_created_before_runtime_load(self):
        runtime = FakeRuntime()
        session_index = FakeSessionIndex()
        code, stdout, stderr, runtime = await self.run_cli(
            ["--new-session", "--jsonl", "--once", "hello"],
            runtime=runtime,
            session_index=session_index,
        )
        self.assertEqual(code, 0)
        self.assertEqual(stderr, "")
        self.assertEqual(session_index.created, 1)
        self.assertEqual(session_index.activated, "new-1")
        self.assertEqual(runtime.inputs, ["hello"])

    async def test_new_session_and_session_are_mutually_exclusive(self):
        runtime = FakeRuntime()
        code, stdout, stderr, runtime = await self.run_cli(
            ["--new-session", "--session", "s1", "--once", "hello"],
            runtime=runtime,
            load_runtime_side_effect=AssertionError("runtime should not load"),
        )
        self.assertEqual(code, 2)
        self.assertEqual(stdout, "")
        self.assertIn("cannot be used together", stderr)
        self.assertEqual(runtime.inputs, [])


    async def test_compact_command_outputs_jsonl_without_llm_turn(self):
        code, stdout, stderr, runtime = await self.run_cli(["--jsonl", "--once", "/compact"])
        self.assertEqual(code, 0)
        self.assertEqual(stderr, "")
        self.assertEqual(runtime.inputs, [])
        events = [json.loads(line) for line in stdout.splitlines()]
        self.assertEqual([event["type"] for event in events], ["turn", "status", "token", "done", "session"])
        turn_ids = {event["turn_id"] for event in events}
        self.assertEqual(len(turn_ids), 1)
        self.assertTrue(next(iter(turn_ids)).startswith("turn-"))
        self.assertIn("Compacted context", events[2]["delta"])

    async def test_plain_mode_prints_progress_terminal_and_session(self):
        code, stdout, stderr, _ = await self.run_cli(["--once", "hello"])
        self.assertEqual(code, 0)
        self.assertIn("tool: fake_tool running: working", stdout)
        self.assertIn("terminal[stdout]: pipeline output", stdout)
        self.assertIn("session: s1 narrative_planned", stdout)
