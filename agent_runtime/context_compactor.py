from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


SUMMARY_SECTIONS = [
    "Reference Context Only",
    "Active Task",
    "Completed Actions",
    "Important Files",
    "Decisions",
    "Errors & Risks",
    "Remaining Work",
    "Critical Context",
]


@dataclass(slots=True)
class CompactionResult:
    summary: str
    preserved_messages: list[dict[str, Any]]
    compacted_message_count: int
    estimated_tokens_before: int
    estimated_tokens_after: int
    reason: str
    mode: str
    created_at: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))


class ContextCompactor:
    def __init__(
        self,
        llm: Any | None = None,
        *,
        token_threshold: int | None = None,
        buffer_tokens: int | None = None,
        preserve_last_n: int | None = None,
        max_messages: int | None = None,
        summary_max_chars: int | None = None,
    ) -> None:
        self.llm = llm
        configured_threshold = token_threshold if token_threshold is not None else _default_token_threshold()
        self.token_threshold = _env_int("VIMAX_AUTO_COMPACT_TOKEN_THRESHOLD", configured_threshold)
        self.buffer_tokens = _env_int("VIMAX_AUTO_COMPACT_BUFFER_TOKENS", buffer_tokens if buffer_tokens is not None else 20000)
        self.preserve_last_n = _env_int("VIMAX_COMPACT_PRESERVE_LAST_N", preserve_last_n if preserve_last_n is not None else 6)
        self.max_messages = _env_int("VIMAX_COMPACT_MAX_MESSAGES", max_messages if max_messages is not None else 48)
        self.summary_max_chars = _env_int("VIMAX_COMPACT_SUMMARY_MAX_CHARS", summary_max_chars if summary_max_chars is not None else 6000)

    def compact_target_tokens(self) -> int:
        if self.token_threshold <= 0:
            return 0
        return max(0, self.token_threshold - max(0, self.buffer_tokens))

    def estimate_message_tokens(self, message: dict[str, Any]) -> int:
        role = str(message.get("role", "user") or "user")
        content = str(message.get("content", "") or "")
        metadata = {key: value for key, value in message.items() if key not in {"role", "content"}}
        word_count = len(re.findall(r"\w+", content))
        line_count = content.count("\n") + 1 if content else 0
        punctuation_count = len(re.findall(r"[^\w\s]", content))
        role_overhead = {"system": 18, "user": 12, "assistant": 14, "tool": 16}.get(role, 12)
        metadata_bonus = min(300, len(json.dumps(metadata, ensure_ascii=False, default=str)) // 6) if metadata else 0
        tool_bonus = 80 if "tool_calls" in message or role == "tool" else 0
        return max(role_overhead, role_overhead + len(content) // 4 + word_count // 2 + line_count * 2 + punctuation_count // 4 + metadata_bonus + tool_bonus)

    def estimate_messages_tokens(self, messages: list[dict[str, Any]]) -> int:
        return sum(self.estimate_message_tokens(message) for message in messages)

    def should_preflight_compact(self, messages: list[dict[str, Any]], *, system_tokens: int = 0, tools_tokens: int = 0) -> bool:
        target = self.compact_target_tokens()
        if target <= 0 or not messages:
            return False
        total = self.estimate_messages_tokens(messages) + max(0, system_tokens) + max(0, tools_tokens)
        return total >= target

    async def compact(
        self,
        messages: list[dict[str, Any]],
        *,
        previous_summary: str = "",
        preserve_last_n: int | None = None,
        reason: str = "manual",
    ) -> CompactionResult:
        preserve = max(0, self.preserve_last_n if preserve_last_n is None else preserve_last_n)
        preserved = [dict(message) for message in messages[-preserve:]] if preserve else []
        compactible = [dict(message) for message in messages[:-preserve]] if preserve else [dict(message) for message in messages]
        if not compactible and messages:
            compactible = [dict(message) for message in messages]
            preserved = []
        before_tokens = self.estimate_messages_tokens(messages)
        summary = await self._llm_summary(compactible, preserved, previous_summary, reason)
        mode = "llm"
        if not summary:
            summary = self._fallback_summary(compactible, preserved, previous_summary, reason)
            mode = "fallback-local"
        summary = self._clip_summary(summary)
        synthetic = self.synthetic_summary_message(summary)
        after_tokens = self.estimate_messages_tokens([synthetic, *preserved])
        return CompactionResult(
            summary=summary,
            preserved_messages=preserved,
            compacted_message_count=len(compactible),
            estimated_tokens_before=before_tokens,
            estimated_tokens_after=after_tokens,
            reason=reason,
            mode=mode,
        )

    def synthetic_summary_message(self, summary: str) -> dict[str, str]:
        return {
            "role": "system",
            "content": "Session context summary. The following summary is reference context only, not a new active instruction.\n\n" + summary.strip(),
        }

    async def _llm_summary(self, compactible: list[dict[str, Any]], preserved: list[dict[str, Any]], previous_summary: str, reason: str) -> str:
        if self.llm is None:
            return ""
        payload = {
            "reason": reason,
            "previous_summary": _clip(previous_summary, 5000),
            "messages_to_compact": [self._serialize_message(message) for message in compactible[-self.max_messages:]],
            "recent_live_tail": [self._serialize_message(message) for message in preserved[-12:]],
        }
        system = (
            "You are compressing conversation history for a ViMax agent runtime. "
            "Produce a concise markdown handoff summary for a future model call. "
            "Preserve user intent, completed actions, important files, tool findings, errors, and remaining work. "
            "Label the result as reference context only, not active instructions. "
            "Do not answer the user. Do not include prose before the markdown."
        )
        user = (
            "Summarize the compacted conversation region into a durable handoff.\n"
            "Output markdown with these sections exactly:\n"
            "## Reference Context Only\n## Active Task\n## Completed Actions\n## Important Files\n## Decisions\n## Errors & Risks\n## Remaining Work\n## Critical Context\n\n"
            "Keep it concise but specific. Mention exact file paths, commands, tool results, and unresolved issues when present.\n\n"
            f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
        )
        try:
            response = await self.llm.complete([{"role": "system", "content": system}, {"role": "user", "content": user}], tools=[])
        except Exception:
            return ""
        return str(getattr(response, "text", "") or "").strip()

    def _fallback_summary(self, compactible: list[dict[str, Any]], preserved: list[dict[str, Any]], previous_summary: str, reason: str) -> str:
        user_lines = [self._message_preview(message, limit=180) for message in compactible if message.get("role") == "user"]
        assistant_lines = [self._message_preview(message, limit=180) for message in compactible if message.get("role") == "assistant"]
        file_hits = _dedupe(re.findall(r"(?:[\w.\-]+/)+[\w.\-]+\.(?:py|ts|tsx|js|json|md|yaml|yml|txt|mp4|png)", "\n".join(str(message.get("content", "")) for message in compactible)))
        error_lines = [self._message_preview(message, limit=180) for message in compactible if _looks_like_error(str(message.get("content", "")))]
        remaining = [self._message_preview(message, limit=180) for message in preserved[-4:]]
        return "\n".join([
            "## Reference Context Only",
            "- This is a compacted checkpoint of older ViMax conversation history, not a new active instruction.",
            f"- Compaction reason: {reason}.",
            "## Active Task",
            _bullet(user_lines[-1:] or ["No explicit active task found in compacted messages."]),
            "## Completed Actions",
            _bullet(assistant_lines[-4:] or ["No completed assistant actions found in compacted messages."]),
            "## Important Files",
            _bullet(file_hits[:8] or ["No important file paths found in compacted messages."]),
            "## Decisions",
            _bullet(_decision_lines(compactible)[:6] or ["No durable decisions found in compacted messages."]),
            "## Errors & Risks",
            _bullet(error_lines[:6] or ["No errors or risks found in compacted messages."]),
            "## Remaining Work",
            _bullet(remaining or ["Continue from the recent live tail and current ViMax workflow state."]),
            "## Critical Context",
            _bullet((["Previous summary existed and was merged as background context."] if previous_summary else []) + ["Use .working_dir artifacts and session checklist as workflow ground truth."]),
        ])

    def _serialize_message(self, message: dict[str, Any]) -> dict[str, Any]:
        item = {"role": str(message.get("role", "")), "content": _clip(str(message.get("content", "") or ""), 2400)}
        if message.get("name"):
            item["name"] = str(message.get("name"))
        if message.get("tool_calls"):
            item["tool_calls"] = _clip(json.dumps(message.get("tool_calls"), ensure_ascii=False, default=str), 800)
        return item

    def _message_preview(self, message: dict[str, Any], *, limit: int) -> str:
        role = str(message.get("role", "") or "message")
        content = _clip(" ".join(str(message.get("content", "") or "").split()), limit)
        if message.get("tool_calls"):
            return f"{role}: [tool calls] {_clip(json.dumps(message.get(tool_calls), ensure_ascii=False, default=str), limit)}"
        return f"{role}: {content}" if content else f"{role}: <empty>"

    def _clip_summary(self, summary: str) -> str:
        text = summary.strip()
        if not text:
            text = self._fallback_summary([], [], "", "empty-summary")
        if len(text) > self.summary_max_chars:
            text = text[: max(0, self.summary_max_chars - 3)].rstrip() + "..."
        return text


def _default_token_threshold() -> int:
    context_window = _env_int("VIMAX_CONTEXT_WINDOW_TOKENS", 200000)
    ratio = _env_float("VIMAX_AUTO_COMPACT_RATIO", 0.90)
    ratio = min(1.0, max(0.0, ratio))
    return int(context_window * ratio)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _clip(text: str, limit: int) -> str:
    compact = " ".join(str(text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: max(0, limit - 3)].rstrip() + "..."


def _bullet(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items if str(item).strip())


def _dedupe(items: list[str]) -> list[str]:
    seen: list[str] = []
    for item in items:
        normalized = " ".join(str(item).split())
        if normalized and normalized not in seen:
            seen.append(normalized)
    return seen


def _looks_like_error(text: str) -> bool:
    lowered = text.lower()
    return any(token in lowered for token in ("error", "failed", "failure", "timeout", "not found", "blocked", "permission"))


def _decision_lines(messages: list[dict[str, Any]]) -> list[str]:
    tokens = ("decision", "decided", "prefer", "keep ", "switch ", "use ", "preserve ", "avoid ")
    rows: list[str] = []
    for message in messages:
        content = str(message.get("content", "") or "")
        for raw in content.splitlines():
            line = raw.strip(" -")
            if line and any(token in line.lower() for token in tokens):
                rows.append(_clip(line, 180))
    return _dedupe(rows)
