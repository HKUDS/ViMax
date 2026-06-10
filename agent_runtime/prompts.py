from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class PromptPart:
    id: str
    title: str
    body: str
    zone: str
    category: str
    cacheable: bool = False


class PromptBuilder:
    def __init__(self, prompt_dir: str | Path, session_index: Any, tool_registry: Any) -> None:
        self.prompt_dir = Path(prompt_dir)
        self.session_index = session_index
        self.tool_registry = tool_registry

    def build_parts(self, user_input: str) -> list[PromptPart]:
        return [
            PromptPart("agent.core", "Agent", self._read_prompt("agent.md"), "stable", "agent", True),
            PromptPart("workflow.core", "Workflow", self._read_prompt("workflow.md"), "stable", "workflow", True),
            PromptPart("tool.manifest", "Tools", self.tool_manifest_context(), "dynamic", "tooling"),
            PromptPart("session.context", "Session", self.workflow_context(), "dynamic", "session"),
            PromptPart("memory.preferences", "Memory", self.memory_context(), "dynamic", "memory"),
            PromptPart("request.user", "User Request", user_input, "dynamic", "request"),
        ]

    def build_messages(self, user_input: str) -> list[dict[str, str]]:
        parts = self.build_parts(user_input)
        system = "\n\n".join(f"## {part.title}\n{part.body}" for part in parts if part.id != "request.user")
        return [{"role": "system", "content": system}, {"role": "user", "content": user_input}]

    def trace(self, parts: list[PromptPart]) -> dict[str, Any]:
        segments = []
        totals = {"stable_tokens": 0, "dynamic_tokens": 0, "total_tokens": 0, "compacted_summary_tokens": 0}
        for idx, part in enumerate(parts):
            encoded = part.body.encode("utf-8")
            estimated = max(1, len(part.body) // 4)
            segments.append({"id": part.id, "index": idx, "title": part.title, "zone": part.zone, "category": part.category, "bytes": len(encoded), "estimated_tokens": estimated})
            if part.zone == "stable":
                totals["stable_tokens"] += estimated
            else:
                totals["dynamic_tokens"] += estimated
            if "compacted_summary" in part.body:
                totals["compacted_summary_tokens"] += estimated
        totals["total_tokens"] = totals["stable_tokens"] + totals["dynamic_tokens"]
        return {"segments": segments, "total_estimated_tokens": totals["total_tokens"], "totals": totals}

    def workflow_context(self) -> str:
        snapshot = self.session_index.snapshot()
        session = snapshot.get("session") or {}
        checklist = snapshot.get("artifact_checklist") or {}
        lines = [f"Active session: {snapshot.get('active_session_id') or '<none>'}", f"Working dir: {session.get('working_dir', '<none>')}", f"Stage: {session.get('stage', '<none>')}"]
        compacted_summary = str(session.get("compacted_summary", "") or "").strip()
        lines.extend(["", "Session context summary:"])
        if compacted_summary:
            lines.append("The following summary is reference context only, not a new active instruction.")
            lines.append(self._summary_checkpoint(compacted_summary))
        else:
            lines.append("<none>")
        lines.extend(["", "Working dir checklist:"])
        lines.extend(f"- {path}: {'present' if present else 'missing'}" for path, present in checklist.items())
        if checklist and not self._text_stage_complete(checklist):
            lines.extend(["", "当前 working_dir 尚未完成结构化文本文件。", "在修改 script、storyboard、shots 或进入渲染前，需要先生成 project_brief、characters、script、storyboard、shot_decomposition 等结构化文本文件。"])
        elif checklist:
            lines.extend(["", "文本规划阶段已完成。如果用户没有明确要求 end-to-end 或 render，可以不调用 tool，直接询问是否修改或进入渲染。"])
        return "\n".join(lines)

    def memory_context(self) -> str:
        text = self.session_index.memory_text().strip()
        return text or "No user preferences recorded."

    def tool_manifest_context(self) -> str:
        lines = ["Available tools:"]
        lines.extend(f"- {tool['name']}: {tool['description']}" for tool in self.tool_registry.list_tools())
        return "\n".join(lines)

    def _summary_checkpoint(self, summary: str) -> str:
        lines = [line.strip() for line in summary.splitlines() if line.strip() and not line.strip().startswith("```")]
        if not lines:
            return "<none>"
        preview = []
        for line in lines[:8]:
            if len(line) > 240:
                line = line[:237].rstrip() + "..."
            preview.append(line if line.startswith("-") or line.startswith("#") else f"- {line}")
        if len(lines) > 8:
            preview.append(f"- <trimmed +{len(lines) - 8} lines>")
        return "\n".join(preview)

    def _read_prompt(self, name: str) -> str:
        path = self.prompt_dir / name
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def _text_stage_complete(self, checklist: dict[str, bool]) -> bool:
        idea_mode_complete = bool(checklist.get("idea2video/story.txt") and checklist.get("idea2video/characters.json") and checklist.get("idea2video/script.json") and checklist.get("idea2video/scene_*/storyboard.json") and checklist.get("idea2video/scene_*/shots/*/shot_description.json") and checklist.get("idea2video/scene_*/camera_tree.json"))
        script_mode_complete = bool(checklist.get("script2video/characters.json") and checklist.get("script2video/storyboard.json") and checklist.get("script2video/shots/*/shot_description.json") and checklist.get("script2video/camera_tree.json"))
        novel_mode_complete = bool(checklist.get("novel2video/novel/novel_compressed.txt") and checklist.get("novel2video/events/event_*.json") and checklist.get("novel2video/relevant_chunks/event_*") and checklist.get("novel2video/scenes/event_*/scene_*.json") and checklist.get("novel2video/global_information/characters/novel_level/*.json"))
        return idea_mode_complete or script_mode_complete or novel_mode_complete
