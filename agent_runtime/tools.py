from __future__ import annotations

import asyncio
import glob
import inspect
import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event
from typing import Any, Awaitable, Callable

from .models import ToolCall, ToolResult

ToolHandler = Callable[..., Awaitable[ToolResult] | ToolResult]
ProgressCallback = Callable[[dict[str, Any]], None]


@dataclass(slots=True)
class ToolArgumentSchema:
    type: type | tuple[type, ...]
    required: bool = False
    default: Any = None


@dataclass(slots=True)
class ToolSpec:
    name: str
    description: str
    handler: ToolHandler
    aliases: tuple[str, ...] = ()
    permission_mode: str = "workspace-write"
    schema: dict[str, ToolArgumentSchema] | None = None
    json_schema: dict[str, Any] | None = None
    concurrency_safe: bool = False


@dataclass(slots=True)
class ToolRuntimeContext:
    requested_name: str
    canonical_name: str
    turn_id: str = ""
    cancel_event: Event | None = None
    progress_callback: ProgressCallback | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def emit_progress(self, message: str, *, stage: str = "running", metadata: dict[str, Any] | None = None) -> None:
        if self.progress_callback is None:
            return
        payload: dict[str, Any] = {
            "type": "tool_progress",
            "tool": {"requested_name": self.requested_name, "name": self.canonical_name},
            "progress": {"stage": stage, "message": message, "metadata": metadata or {}},
        }
        if self.turn_id:
            payload["turn_id"] = self.turn_id
        self.progress_callback(payload)

    def emit_terminal(self, line: str, *, stream: str = "stdout") -> None:
        if self.progress_callback is None:
            return
        if not line:
            return
        payload: dict[str, Any] = {"type": "terminal", "stream": stream, "line": line}
        if self.turn_id:
            payload["turn_id"] = self.turn_id
        self.progress_callback(payload)

    def is_cancelled(self) -> bool:
        return self.cancel_event.is_set() if self.cancel_event is not None else False

    def raise_if_cancelled(self, default_reason: str = "Tool execution cancelled") -> None:
        if self.is_cancelled():
            raise RuntimeError(str(self.metadata.get("cancel_reason") or default_reason))


class ToolRegistry:
    def __init__(self, specs: list[ToolSpec] | None = None) -> None:
        self._specs: dict[str, ToolSpec] = {}
        self._aliases: dict[str, str] = {}
        for spec in specs or []:
            self.register(spec)

    def register(self, spec: ToolSpec) -> None:
        self._specs[spec.name] = spec
        for alias in spec.aliases:
            self._aliases[alias] = spec.name

    def list_tools(self) -> list[dict[str, str]]:
        return sorted([{"name": spec.name, "description": spec.description, "permission_mode": spec.permission_mode} for spec in self._specs.values()], key=lambda item: item["name"])

    def list_function_tools(self) -> list[dict[str, Any]]:
        tools = []
        for spec in sorted(self._specs.values(), key=lambda item: item.name):
            parameters = spec.json_schema or _argument_schema_to_json_schema(spec.schema or {})
            tools.append({"type": "function", "function": {"name": spec.name, "description": spec.description, "parameters": parameters}})
        return tools

    def get_spec(self, name: str) -> ToolSpec | None:
        return self._specs.get(self.resolve_name(name))

    def resolve_name(self, name: str) -> str:
        normalized = name.strip()
        return self._aliases.get(normalized, normalized)

    def validate_arguments(self, name: str, arguments: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
        spec = self.get_spec(name)
        if spec is None:
            return None, f"Unknown tool: {name}"
        schema = spec.schema or {}
        normalized = dict(arguments or {})
        for field_name, field_spec in schema.items():
            if field_name not in normalized:
                if field_spec.required and field_spec.default is None:
                    return None, f"Missing required argument '{field_name}' for {spec.name}"
                if field_spec.default is not None:
                    normalized[field_name] = field_spec.default
                continue
            value = normalized[field_name]
            expected = field_spec.type
            if expected is bool and isinstance(value, str) and value.lower() in {"true", "false"}:
                normalized[field_name] = value.lower() == "true"
                continue
            if expected is int and isinstance(value, str):
                try:
                    normalized[field_name] = int(value)
                    continue
                except ValueError:
                    return None, f"Argument '{field_name}' for {spec.name} must be an integer"
            if not isinstance(normalized[field_name], expected):
                expected_name = ", ".join(t.__name__ for t in expected) if isinstance(expected, tuple) else expected.__name__
                return None, f"Argument '{field_name}' for {spec.name} must be {expected_name}"
        return normalized, None

    def is_concurrency_safe(self, name: str) -> bool:
        spec = self.get_spec(name)
        return bool(spec and spec.concurrency_safe)

    def partition_calls(self, calls: list[ToolCall]) -> list[list[ToolCall]]:
        batches: list[list[ToolCall]] = []
        for call in calls:
            if self.is_concurrency_safe(call.name) and batches and all(self.is_concurrency_safe(item.name) for item in batches[-1]):
                batches[-1].append(call)
            else:
                batches.append([call])
        return batches

    async def execute(self, name: str, arguments: dict[str, Any], runtime: ToolRuntimeContext | None = None) -> ToolResult:
        canonical = self.resolve_name(name)
        spec = self._specs.get(canonical)
        if spec is None:
            return ToolResult(name=name, ok=False, content=f"Unknown tool: {name}", metadata={"error_type": "unknown_tool"})
        handler = spec.handler
        try:
            params = inspect.signature(handler).parameters
            result = handler(arguments, runtime) if runtime is not None and len(params) >= 2 else handler(arguments)
            if inspect.isawaitable(result):
                return await result
            return result
        except Exception as exc:
            return ToolResult(name=canonical, ok=False, content=str(exc), metadata={"error_type": "exception"})


def _argument_schema_to_json_schema(schema: dict[str, ToolArgumentSchema]) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    required: list[str] = []
    for field_name, field_spec in schema.items():
        field_schema = _type_to_json_schema(field_spec.type)
        if field_spec.default is not None:
            field_schema["default"] = field_spec.default
        properties[field_name] = field_schema
        if field_spec.required and field_spec.default is None:
            required.append(field_name)
    payload: dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        payload["required"] = required
    return payload


def _type_to_json_schema(tp: type | tuple[type, ...]) -> dict[str, Any]:
    if isinstance(tp, tuple):
        return {"anyOf": [_type_to_json_schema(item) for item in tp]}
    return {str: {"type": "string"}, int: {"type": "integer"}, bool: {"type": "boolean"}, dict: {"type": "object", "additionalProperties": True}, list: {"type": "array", "items": {}}}.get(tp, {"type": "string"})


def build_builtin_registry(workspace_root: str | Path, session_index: Any, adapter_specs: list[ToolSpec] | None = None) -> ToolRegistry:
    root = Path(workspace_root).resolve()

    def safe_path(raw: Any) -> Path:
        path = (root / str(raw)).resolve()
        if root not in path.parents and path != root:
            raise ValueError(f"Path escapes workspace: {raw}")
        return path

    def read_file(args: dict[str, Any]) -> ToolResult:
        path = safe_path(args["path"])
        if not path.exists():
            return ToolResult("read_file", False, f"File not found: {path}")
        return ToolResult("read_file", True, path.read_text(encoding="utf-8"))

    def read_json(args: dict[str, Any]) -> ToolResult:
        path = safe_path(args["path"])
        if not path.exists():
            return ToolResult("read_json", False, f"File not found: {path}")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            return ToolResult("read_json", False, f"Invalid JSON: {exc}", {"error_type": "invalid_json"})
        return ToolResult("read_json", True, json.dumps(payload, ensure_ascii=False, indent=2))

    def write_json(args: dict[str, Any]) -> ToolResult:
        path = safe_path(args["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(args["data"], ensure_ascii=False, indent=2), encoding="utf-8")
        return ToolResult("write_json", True, f"Wrote JSON {path.relative_to(root)}")

    def list_files(args: dict[str, Any]) -> ToolResult:
        path = safe_path(args.get("path", "."))
        if not path.exists():
            return ToolResult("list_files", False, f"Path not found: {path}")
        rows = [str(item.relative_to(root)) for item in sorted(path.iterdir())]
        return ToolResult("list_files", True, "\n".join(rows) or "No entries")

    def glob_files(args: dict[str, Any]) -> ToolResult:
        pattern = str(args["pattern"])
        matches = [str(Path(item).resolve().relative_to(root)) for item in glob.glob(str(root / pattern), recursive=True)]
        return ToolResult("glob_files", True, "\n".join(matches[:200]) or "No matches")

    def search_text(args: dict[str, Any]) -> ToolResult:
        needle = str(args["query"])
        base = safe_path(args.get("path", "."))
        rows: list[str] = []
        paths = base.rglob("*") if base.is_dir() else [base]
        for path in paths:
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for idx, line in enumerate(text.splitlines(), start=1):
                if needle in line:
                    rows.append(f"{path.relative_to(root)}:{idx}: {line}")
                    if len(rows) >= int(args.get("max_results", 100)):
                        return ToolResult("search_text", True, "\n".join(rows))
        return ToolResult("search_text", True, "\n".join(rows) or "No matches")

    def memory_read(args: dict[str, Any]) -> ToolResult:
        return ToolResult("memory_read", True, session_index.memory_text())

    def memory_write(args: dict[str, Any]) -> ToolResult:
        session_index.write_memory(str(args["content"]))
        return ToolResult("memory_write", True, "Updated .vimax/memory.md")

    def todo_path() -> Path:
        return root / ".vimax" / "todo.json"

    def todo_read(args: dict[str, Any]) -> ToolResult:
        path = todo_path()
        if not path.exists():
            return ToolResult("todo_read", True, json.dumps({"items": []}, ensure_ascii=False, indent=2), {"items": []})
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            return ToolResult("todo_read", False, f"Invalid todo JSON: {exc}", {"error_type": "invalid_json"})
        items = payload.get("items")
        if not isinstance(items, list):
            return ToolResult("todo_read", False, "Invalid todo JSON: expected an items array", {"error_type": "invalid_todo"})
        return ToolResult("todo_read", True, json.dumps({"items": items}, ensure_ascii=False, indent=2), {"items": items})

    def todo_write(args: dict[str, Any]) -> ToolResult:
        items = args.get("items")
        if not isinstance(items, list):
            return ToolResult("todo_write", False, "items must be an array", {"error_type": "invalid_arguments"})
        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                return ToolResult("todo_write", False, f"items[{index}] must be an object", {"error_type": "invalid_arguments", "index": index})
            content = str(item.get("content", "")).strip()
            if not content:
                return ToolResult("todo_write", False, f"items[{index}].content is required", {"error_type": "invalid_arguments", "index": index})
            status = str(item.get("status", "pending")).strip() or "pending"
            if status not in {"pending", "in_progress", "completed"}:
                return ToolResult("todo_write", False, f"items[{index}].status must be pending, in_progress, or completed", {"error_type": "invalid_arguments", "index": index})
            normalized.append({"content": content, "status": status})
        path = todo_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"items": normalized}, ensure_ascii=False, indent=2), encoding="utf-8")
        return ToolResult("todo_write", True, f"Updated .vimax/todo.json with {len(normalized)} item(s)", {"items": normalized, "item_count": len(normalized)})

    async def sleep_tool(args: dict[str, Any], runtime: ToolRuntimeContext | None = None) -> ToolResult:
        seconds = float(args.get("seconds", 0))
        if seconds < 0 or seconds > 300:
            return ToolResult("sleep", False, "seconds must be between 0 and 300")
        if runtime:
            runtime.emit_progress(f"Sleeping for {seconds:g}s", stage="running")
        await asyncio.sleep(seconds)
        return ToolResult("sleep", True, f"Slept for {seconds:g}s")

    async def run_shell(args: dict[str, Any], runtime: ToolRuntimeContext | None = None) -> ToolResult:
        if os.environ.get("VIMAX_ENABLE_RUN_SHELL") != "1":
            return ToolResult("run_shell", False, "run_shell is disabled by default. Set VIMAX_ENABLE_RUN_SHELL=1 to enable bounded shell commands.", {"error_type": "disabled"})
        command = str(args["command"]).strip()
        timeout_seconds = min(max(int(args.get("timeout_seconds", 30)), 1), 120)
        output_limit = min(max(int(args.get("output_limit", 20000)), 1000), 50000)
        denied_tokens = ["rm ", "rm -", "sudo", "chmod", "chown", "mkfs", "dd ", ":(){", "curl ", "wget ", "ssh ", "printenv", "env", "export"]
        lowered = command.lower()
        if any(token in lowered for token in denied_tokens):
            return ToolResult("run_shell", False, "Command rejected by run_shell policy.", {"error_type": "command_rejected"})
        if runtime:
            runtime.emit_progress("Starting shell command", stage="starting", metadata={"command": command, "timeout_seconds": timeout_seconds})
        proc = await asyncio.create_subprocess_shell(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return ToolResult("run_shell", False, f"Command timed out after {timeout_seconds}s", {"error_type": "timeout", "timeout_seconds": timeout_seconds})
        content = ""
        if stdout:
            content += stdout.decode(errors="replace")
        if stderr:
            content += stderr.decode(errors="replace")
        truncated = len(content) > output_limit
        if truncated:
            content = content[:output_limit] + "\n...[truncated]"
        return ToolResult("run_shell", proc.returncode == 0, content, {"returncode": proc.returncode, "truncated": truncated})

    specs = [
        ToolSpec("read_file", "Read a UTF-8 text file inside the workspace.", read_file, schema={"path": ToolArgumentSchema(str, True)}, concurrency_safe=True),
        ToolSpec("read_json", "Read and parse a JSON file inside the workspace.", read_json, schema={"path": ToolArgumentSchema(str, True)}, concurrency_safe=True),
        ToolSpec("write_json", "Write formatted JSON inside the workspace.", write_json, schema={"path": ToolArgumentSchema(str, True), "data": ToolArgumentSchema((dict, list), True)}),
        ToolSpec("list_files", "List direct children of a workspace path.", list_files, schema={"path": ToolArgumentSchema(str, False, ".")}, concurrency_safe=True),
        ToolSpec("glob_files", "Find workspace files with a glob pattern.", glob_files, schema={"pattern": ToolArgumentSchema(str, True)}, concurrency_safe=True),
        ToolSpec("search_text", "Search text in workspace files.", search_text, schema={"query": ToolArgumentSchema(str, True), "path": ToolArgumentSchema(str, False, "."), "max_results": ToolArgumentSchema(int, False, 100)}, concurrency_safe=True),
        ToolSpec("memory_read", "Read .vimax/memory.md user preferences.", memory_read, schema={}, concurrency_safe=True),
        ToolSpec("memory_write", "Replace .vimax/memory.md with user preference notes only.", memory_write, schema={"content": ToolArgumentSchema(str, True)}),
        ToolSpec("todo_read", "Read short-term todo items from .vimax/todo.json. This is not a task or team system.", todo_read, schema={}, concurrency_safe=True),
        ToolSpec("todo_write", "Replace short-term todo items in .vimax/todo.json. Items require content and may use pending, in_progress, or completed status.", todo_write, schema={"items": ToolArgumentSchema(list, True)}),
        ToolSpec("sleep", "Wait for a bounded number of seconds.", sleep_tool, schema={"seconds": ToolArgumentSchema(int, False, 0)}, concurrency_safe=True),
        ToolSpec("run_shell", "Run a bounded shell command in the workspace. Disabled unless VIMAX_ENABLE_RUN_SHELL=1; rejects dangerous commands, enforces timeout, and truncates output.", run_shell, schema={"command": ToolArgumentSchema(str, True), "timeout_seconds": ToolArgumentSchema(int, False, 30), "output_limit": ToolArgumentSchema(int, False, 20000)}),
    ]
    for spec in adapter_specs or []:
        specs.append(spec)
    return ToolRegistry(specs)
