from __future__ import annotations

from dataclasses import dataclass, field
from threading import Event
from time import time
from typing import Any, Literal
from uuid import uuid4


@dataclass(slots=True)
class ToolCall:
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: f"tool-{uuid4().hex[:12]}")

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "arguments": self.arguments}


@dataclass(slots=True)
class ToolResult:
    name: str
    ok: bool
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "ok": self.ok, "content": self.content, "metadata": dict(self.metadata)}


@dataclass(slots=True)
class TurnControl:
    turn_id: str = field(default_factory=lambda: f"turn-{uuid4().hex[:12]}")
    cancel_event: Event = field(default_factory=Event)
    cancel_reason: str = ""

    def cancel(self, reason: str = "") -> None:
        self.cancel_reason = reason.strip()
        self.cancel_event.set()


@dataclass(slots=True)
class SessionRecord:
    session_id: str
    working_dir: str
    idea: str = ""
    user_requirement: str = ""
    style: str = ""
    stage: str = "created"
    summary: str = ""
    stale: dict[str, bool] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""


StreamEventType = Literal["turn", "status", "token", "tool_start", "tool_progress", "tool_result", "terminal", "done", "session", "error", "prompt_trace"]


def now_ts() -> float:
    return time()
