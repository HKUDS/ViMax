from __future__ import annotations

import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator

from .context_compactor import ContextCompactor, CompactionResult
from .llm import OpenAICompatibleLLM
from .models import ToolCall, ToolResult, TurnControl
from .prompts import PromptBuilder
from .session_index import SessionIndex
from .tool_executor import ToolExecutor
from .tools import ToolRegistry, build_builtin_registry

MAX_TOOL_PASSES = 50


class AgentLoop:
    def __init__(self, session_index: SessionIndex, prompt_builder: PromptBuilder, tool_registry: ToolRegistry, tool_executor: ToolExecutor, llm: Any, context_compactor: ContextCompactor | None = None) -> None:
        self.session_index = session_index
        self.prompt_builder = prompt_builder
        self.tool_registry = tool_registry
        self.tool_executor = tool_executor
        self.llm = llm
        self.context_compactor = context_compactor or ContextCompactor(llm)
        self.history: list[dict[str, Any]] = []

    async def compact_history(self, *, reason: str = "manual") -> str:
        if not self.history:
            return "No conversation history to compact."
        session = self.session_index.active() or self.session_index.create()
        result = await self.context_compactor.compact(
            self.history,
            previous_summary=str(session.get("compacted_summary", "") or ""),
            reason=reason,
        )
        self.history = [self.context_compactor.synthetic_summary_message(result.summary), *result.preserved_messages]
        self.session_index.update_compaction(session["session_id"], _compaction_record(result))
        return f"Compacted context {result.estimated_tokens_before} -> {result.estimated_tokens_after} ({result.mode})."

    async def stream_events(self, user_input: str) -> AsyncIterator[dict[str, Any]]:
        control = TurnControl()
        yield {"type": "turn", "turn_id": control.turn_id, "turn": {"id": control.turn_id}}
        tool_schemas = self.tool_registry.list_function_tools()
        parts = self.prompt_builder.build_parts(user_input)
        system = "\n\n".join(f"## {part.title}\n{part.body}" for part in parts if part.id != "request.user")
        if self.context_compactor.should_preflight_compact(
            [*self.history, {"role": "user", "content": user_input}],
            system_tokens=_prompt_tokens(parts),
            tools_tokens=_tool_schema_tokens(tool_schemas),
        ):
            yield {"type": "status", "turn_id": control.turn_id, "phase": "compact", "message": "Compacting context before sampling"}
            await self.compact_history(reason="token-pressure")
            parts = self.prompt_builder.build_parts(user_input)
            system = "\n\n".join(f"## {part.title}\n{part.body}" for part in parts if part.id != "request.user")
        yield {"type": "prompt_trace", "turn_id": control.turn_id, "prompt_trace": self.prompt_builder.trace(parts)}
        runtime_messages: list[dict[str, Any]] = [{"role": "system", "content": system}, *self.history, {"role": "user", "content": user_input}]
        assistant_turns: list[dict[str, Any]] = []
        tool_rounds: list[dict[str, Any]] = []
        transitions: list[dict[str, str]] = []
        all_tool_results: list[ToolResult] = []
        final_text = ""
        status = "completed"
        tool_round = 0

        while True:
            yield {"type": "status", "turn_id": control.turn_id, "phase": "sampling_assistant", "message": "Sampling assistant"}
            assistant = await self.llm.complete(runtime_messages, tools=tool_schemas)
            assistant_turns.append({"phase": "initial" if tool_round == 0 else f"followup_{tool_round}", "text": assistant.text, "tool_calls": [call.as_dict() for call in assistant.tool_calls]})
            if not assistant.tool_calls:
                transitions.append(_transition("sampling_assistant", "finalizing_answer", "assistant_finished_without_tools"))
                final_text = assistant.text
                if final_text:
                    yield {"type": "token", "turn_id": control.turn_id, "delta": final_text}
                break
            transitions.append(_transition("sampling_assistant", "executing_tools", "assistant_requested_tools"))
            if tool_round >= MAX_TOOL_PASSES:
                status = "halted"
                final_text = "Tool loop halted after max tool passes."
                transitions.append(_transition("executing_tools", "finalizing_answer", "max_tool_passes_reached"))
                yield {"type": "error", "turn_id": control.turn_id, "message": final_text, "metadata": {"max_tool_passes": MAX_TOOL_PASSES}}
                break
            tool_round += 1
            yield {"type": "status", "turn_id": control.turn_id, "phase": "executing_tools", "message": f"Running tools (round {tool_round})"}
            runtime_messages.append({"role": "assistant", "content": assistant.text or "", "tool_calls": [_openai_tool_call(call) for call in assistant.tool_calls]})
            round_results: list[ToolResult] = []

            for call in assistant.tool_calls:
                yield {"type": "tool_start", "turn_id": control.turn_id, "tool": call.as_dict()}
                progress_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

                def on_progress(event: dict[str, Any]) -> None:
                    progress_queue.put_nowait(event)

                task = asyncio.create_task(self.tool_executor.execute(call, control, progress_callback=on_progress))
                while not task.done():
                    try:
                        yield await asyncio.wait_for(progress_queue.get(), timeout=0.1)
                    except asyncio.TimeoutError:
                        continue
                while not progress_queue.empty():
                    yield progress_queue.get_nowait()
                record = await task
                result = record.result
                round_results.append(result)
                all_tool_results.append(result)
                yield {"type": "tool_result", "turn_id": control.turn_id, "tool_result": result.as_dict()}
                runtime_messages.append({"role": "tool", "tool_call_id": call.id, "name": result.name, "content": json.dumps(result.as_dict(), ensure_ascii=False)})
            tool_rounds.append({"tool_round": tool_round, "requested_tools": [call.as_dict() for call in assistant.tool_calls], "tool_results": [result.as_dict() for result in round_results]})
            transitions.append(_transition("executing_tools", "post_tool_decision", "tool_round_completed"))
            transitions.append(_transition("post_tool_decision", "sampling_assistant", "runtime_continuation_after_tools"))

        self.history.extend([{"role": "user", "content": user_input}, {"role": "assistant", "content": final_text}])
        turn_record = {"turn_id": control.turn_id, "status": status, "raw_user_input": user_input, "assistant_turns": assistant_turns, "tool_rounds": tool_rounds, "transitions": transitions, "final_assistant_text": final_text, "created_at": datetime.now().isoformat(timespec="seconds")}
        final_session = self.session_index.active() or self.session_index.create()
        self.session_index.append_turn_record(final_session["session_id"], turn_record)
        yield {"type": "done", "turn_id": control.turn_id, "assistant": final_text, "tool_results": [result.as_dict() for result in all_tool_results]}
        yield {"type": "session", "turn_id": control.turn_id, "session": self.session_index.snapshot()}


def _compaction_record(result: CompactionResult) -> dict[str, Any]:
    return {
        "summary": result.summary,
        "preserved_message_count": len(result.preserved_messages),
        "compacted_message_count": result.compacted_message_count,
        "estimated_tokens_before": result.estimated_tokens_before,
        "estimated_tokens_after": result.estimated_tokens_after,
        "reason": result.reason,
        "mode": result.mode,
        "created_at": result.created_at,
    }


def _prompt_tokens(parts: list[Any]) -> int:
    return sum(max(1, len(str(getattr(part, "body", ""))) // 4) for part in parts)


def _tool_schema_tokens(tool_schemas: list[dict[str, Any]]) -> int:
    try:
        return max(0, len(json.dumps(tool_schemas, ensure_ascii=False, default=str)) // 4)
    except TypeError:
        return max(0, len(str(tool_schemas)) // 4)


def _transition(src: str, dst: str, reason: str) -> dict[str, str]:
    return {"from": src, "to": dst, "reason": reason}


def _openai_tool_call(call: ToolCall) -> dict[str, Any]:
    return {"id": call.id, "type": "function", "function": {"name": call.name, "arguments": json.dumps(call.arguments, ensure_ascii=False)}}


def build_runtime(workspace_root: str | Path = ".", llm: Any | None = None, adapter_specs: list[Any] | None = None) -> AgentLoop:
    from .vimax_adapters import build_vimax_adapter_specs
    root = Path(workspace_root).resolve()
    session_index = SessionIndex(root)
    specs = adapter_specs if adapter_specs is not None else build_vimax_adapter_specs(root, session_index)
    registry = build_builtin_registry(root, session_index, specs)
    executor = ToolExecutor(registry, session_index)
    prompt_builder = PromptBuilder(root / "prompts", session_index, registry)
    resolved_llm = llm or OpenAICompatibleLLM()
    return AgentLoop(session_index, prompt_builder, registry, executor, resolved_llm, ContextCompactor(resolved_llm))
