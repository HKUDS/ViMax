from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from time import time
from typing import Any, Callable

from .models import ToolCall, ToolResult, TurnControl
from .tools import ToolRegistry, ToolRuntimeContext


@dataclass(slots=True)
class ToolExecutionRecord:
    requested_name: str
    canonical_name: str
    arguments_before: dict[str, Any]
    arguments_after: dict[str, Any]
    result: ToolResult
    started_at: float
    finished_at: float
    telemetry: dict[str, Any]


class ToolExecutor:
    def __init__(self, registry: ToolRegistry, session_index: Any) -> None:
        self.registry = registry
        self.session_index = session_index

    async def execute(self, call: ToolCall, control: TurnControl, progress_callback: Callable[[dict[str, Any]], None] | None = None) -> ToolExecutionRecord:
        requested_name = call.name
        canonical_name = self.registry.resolve_name(call.name)
        before = deepcopy(call.arguments)
        started_at = time()
        validated, validation_error = self.registry.validate_arguments(canonical_name, call.arguments)
        arguments = validated if validated is not None else call.arguments
        runtime = ToolRuntimeContext(requested_name=requested_name, canonical_name=canonical_name, turn_id=control.turn_id, cancel_event=control.cancel_event, progress_callback=progress_callback, metadata={"cancel_reason": control.cancel_reason})
        if validation_error:
            result = ToolResult(canonical_name, False, validation_error, {"validation_error": True})
        elif control.cancel_event.is_set():
            result = ToolResult(canonical_name, False, control.cancel_reason or "Tool execution cancelled", {"cancelled": True})
        else:
            result = await self.registry.execute(canonical_name, arguments, runtime=runtime)
        finished_at = time()
        telemetry = {"duration_ms": int((finished_at - started_at) * 1000), "requested_name": requested_name, "canonical_name": canonical_name, "result_ok": result.ok}
        self.session_index.append_log("tool_calls", {"turn_id": control.turn_id, "tool": canonical_name, "arguments_preview": str(before)[:500], "ok": result.ok, "content_preview": result.content[:500], **telemetry})
        return ToolExecutionRecord(requested_name, canonical_name, before, deepcopy(arguments), result, started_at, finished_at, telemetry)
