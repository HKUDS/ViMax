from __future__ import annotations

import asyncio
import base64
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
import re
from typing import Any
from uuid import uuid4

from google import genai
from google.genai import types
from openai import APIConnectionError, APITimeoutError, AsyncOpenAI

from .config import llm_api_key, llm_base_url, llm_model, llm_provider
from .models import ToolCall


LLM_MAX_ATTEMPTS = 3
LLM_RETRY_BACKOFF_SECONDS = (1.0, 4.0)
LLM_REQUEST_TIMEOUT_SECONDS = 300.0


def _extract_retry_delay(exc: BaseException) -> float | None:
    msg = str(exc)
    match = re.search(r'retry in ([0-9.]+)s', msg, re.IGNORECASE)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    match_delay = re.search(r'retryDelay[\'":\s]+([0-9.]+)s?', msg, re.IGNORECASE)
    if match_delay:
        try:
            return float(match_delay.group(1))
        except ValueError:
            pass
    return None


def _is_retryable_llm_error(exc: BaseException) -> bool:
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(exc, "code", None)
    if status is not None:
        try:
            status = int(status)
        except (TypeError, ValueError):
            return False
        return status == 429 or status >= 500
    return isinstance(exc, (APIConnectionError, APITimeoutError))


class LLMResponseShapeError(RuntimeError):
    pass


@dataclass(slots=True)
class AssistantMessage:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    raw_message: dict[str, Any] = field(default_factory=dict)


class OpenAICompatibleLLM:
    def __init__(self, model: str | None = None, base_url: str | None = None, api_key: str | None = None) -> None:
        self.model = model or llm_model()
        self.base_url = base_url or llm_base_url()
        self.api_key = api_key or llm_api_key()
        if not self.api_key:
            raise RuntimeError("VIMAX_LLM_API_KEY is required for the agent LLM client")
        self.client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, timeout=LLM_REQUEST_TIMEOUT_SECONDS)

    async def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> AssistantMessage:
        shape_attempts = [
            {"tools": tools or None, "tool_choice": "auto" if tools else None},
            {"tools": tools or None, "tool_choice": "auto" if tools else None},
        ]
        if tools:
            shape_attempts.append({"tools": None, "tool_choice": None})

        last_shape_error: Exception | None = None
        for attempt in shape_attempts:
            try:
                response = await self._create_completion_with_retries(messages, attempt["tools"], attempt["tool_choice"])
                return _assistant_message_from_response(response)
            except LLMResponseShapeError as exc:
                last_shape_error = exc
                continue
        assert last_shape_error is not None
        raise last_shape_error

    async def _create_completion_with_retries(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None, tool_choice: str | None) -> Any:
        for attempt in range(LLM_MAX_ATTEMPTS):
            try:
                return await self._create_completion(messages, tools, tool_choice)
            except Exception as exc:
                if isinstance(exc, LLMResponseShapeError) or attempt == LLM_MAX_ATTEMPTS - 1 or not _is_retryable_llm_error(exc):
                    raise
                server_delay = _extract_retry_delay(exc)
                if server_delay is not None:
                    delay = max(1.0, server_delay + 1.0)
                else:
                    delay = LLM_RETRY_BACKOFF_SECONDS[min(attempt, len(LLM_RETRY_BACKOFF_SECONDS) - 1)]
                logging.warning("LLM call failed (%s); retrying in %.1fs (attempt %d/%d)", exc, delay, attempt + 1, LLM_MAX_ATTEMPTS)
                await asyncio.sleep(delay)

    async def _create_completion(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None, tool_choice: str | None) -> Any:
        clean_messages = []
        for m in messages:
            clean_m = {k: v for k, v in m.items() if not k.startswith("_") and k != "google_content"}
            clean_messages.append(clean_m)
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": clean_messages,
            "stream": False,
        }
        if tools:
            kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice
        return await self.client.chat.completions.create(**kwargs)


def _sanitize_tool_schema(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {
            k: _sanitize_tool_schema(v)
            for k, v in obj.items()
            if k not in ("additionalProperties", "additional_properties")
        }
    if isinstance(obj, list):
        return [_sanitize_tool_schema(x) for x in obj]
    return obj


class GoogleGenAILLM:
    """Native Google GenAI SDK LLM client."""

    def __init__(self, model: str | None = None, api_key: str | None = None) -> None:
        self.model = model or llm_model()
        self.api_key = api_key or llm_api_key()
        if not self.api_key:
            raise RuntimeError("VIMAX_LLM_API_KEY is required for the Google GenAI LLM client")
        self.client = genai.Client(api_key=self.api_key)

    async def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> AssistantMessage:
        system_instruction: str | None = None
        contents: list[types.Content] = []

        for msg in messages:
            role = msg.get("role")
            if role == "system":
                system_instruction = msg.get("content") or ""
                continue

            if role == "user":
                content = msg.get("content")
                parts = []
                if isinstance(content, str):
                    if content:
                        parts.append(types.Part.from_text(text=content))
                elif isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict):
                            if item.get("type") == "text":
                                parts.append(types.Part.from_text(text=item.get("text", "")))
                            elif item.get("type") == "image_url":
                                url = item.get("image_url", {}).get("url", "")
                                if url.startswith("data:"):
                                    header, b64data = url.split(",", 1)
                                    mime = header.split(";")[0].split(":")[1]
                                    data = base64.b64decode(b64data)
                                    parts.append(types.Part.from_bytes(data=data, mime_type=mime))
                if parts:
                    contents.append(types.Content(role="user", parts=parts))

            elif role == "assistant":
                raw_google = msg.get("_raw_message", {}).get("google_content") or msg.get("google_content")
                if raw_google and isinstance(raw_google, types.Content):
                    contents.append(raw_google)
                else:
                    parts = []
                    if msg.get("content"):
                        parts.append(types.Part.from_text(text=msg["content"]))
                    for tc in msg.get("tool_calls", []):
                        fn = tc.get("function", {})
                        name = fn.get("name")
                        args = fn.get("arguments", {})
                        if isinstance(args, str):
                            try:
                                args = json.loads(args)
                            except Exception:
                                args = {}
                        parts.append(types.Part.from_function_call(name=name, args=args))
                    if parts:
                        contents.append(types.Content(role="model", parts=parts))

            elif role == "tool":
                name = msg.get("name", "")
                content_raw = msg.get("content", "")
                try:
                    resp = json.loads(content_raw) if isinstance(content_raw, str) else content_raw
                except Exception:
                    resp = {"output": content_raw}
                if not isinstance(resp, dict):
                    resp = {"output": resp}
                part = types.Part.from_function_response(name=name, response=resp)
                contents.append(types.Content(role="user", parts=[part]))

        google_tools = None
        if tools:
            fn_decls = []
            for t in tools:
                fn = t.get("function", {})
                fn_decls.append({
                    "name": fn.get("name"),
                    "description": fn.get("description", ""),
                    "parameters": _sanitize_tool_schema(fn.get("parameters", {})),
                })
            if fn_decls:
                google_tools = [{"function_declarations": fn_decls}]

        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            tools=google_tools,
        )

        for attempt in range(LLM_MAX_ATTEMPTS):
            try:
                res = await self.client.aio.models.generate_content(
                    model=self.model,
                    contents=contents,
                    config=config,
                )
                break
            except Exception as exc:
                if attempt == LLM_MAX_ATTEMPTS - 1 or not _is_retryable_llm_error(exc):
                    raise
                server_delay = _extract_retry_delay(exc)
                if server_delay is not None:
                    delay = max(1.0, server_delay + 1.0)
                else:
                    delay = LLM_RETRY_BACKOFF_SECONDS[min(attempt, len(LLM_RETRY_BACKOFF_SECONDS) - 1)]
                logging.warning("Google LLM call failed (%s); retrying in %.1fs (attempt %d/%d)", exc, delay, attempt + 1, LLM_MAX_ATTEMPTS)
                await asyncio.sleep(delay)

        text_parts = []
        calls: list[ToolCall] = []
        candidate_content = None

        if res.candidates and len(res.candidates) > 0:
            candidate = res.candidates[0]
            candidate_content = candidate.content
            if candidate_content and candidate_content.parts:
                for part in candidate_content.parts:
                    if getattr(part, "text", None):
                        text_parts.append(part.text)
                    if getattr(part, "function_call", None):
                        fc = part.function_call
                        calls.append(
                            ToolCall(
                                id=getattr(fc, "id", None) or f"call_{uuid4().hex[:8]}",
                                name=fc.name,
                                arguments=dict(fc.args or {}),
                            )
                        )

        full_text = "".join(text_parts)
        raw_msg = {
            "role": "assistant",
            "content": full_text,
            "google_content": candidate_content,
        }
        return AssistantMessage(text=full_text, tool_calls=calls, raw_message=raw_msg)


def build_llm(workspace_root: str | Path = ".") -> Any:
    if llm_provider(workspace_root) == "google":
        return GoogleGenAILLM(model=llm_model(workspace_root), api_key=llm_api_key(workspace_root))
    return OpenAICompatibleLLM()


def _assistant_message_from_response(response: Any) -> AssistantMessage:
    message = _extract_message(response)
    text = _message_value(message, "content") or ""
    calls: list[ToolCall] = []
    for call in _message_value(message, "tool_calls") or []:
        function = _message_value(call, "function") or {}
        try:
            arguments = json.loads(_message_value(function, "arguments") or "{}")
        except json.JSONDecodeError:
            arguments = {}
        extra_content = _message_value(call, "extra_content")
        if hasattr(extra_content, "model_dump"):
            extra_content = extra_content.model_dump()
        calls.append(
            ToolCall(
                id=_message_value(call, "id") or f"tool-{uuid4().hex[:12]}",
                name=_message_value(function, "name"),
                arguments=arguments,
                extra_content=extra_content,
            )
        )
    return AssistantMessage(text=text, tool_calls=calls, raw_message=_dump_message(message))


def _extract_message(response: Any) -> Any:
    if isinstance(response, str):
        try:
            response = json.loads(response)
        except json.JSONDecodeError as exc:
            raise LLMResponseShapeError(f"LLM provider returned a string instead of a chat completion object: {response[:300]}") from exc
    choices = _message_value(response, "choices")
    if not choices:
        raise LLMResponseShapeError(f"LLM provider response missing choices: {str(response)[:500]}")
    first_choice = choices[0]
    message = _message_value(first_choice, "message")
    if message is None:
        raise LLMResponseShapeError(f"LLM provider response missing choice.message: {str(response)[:500]}")
    return message


def _message_value(obj: Any, key: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(key)
    val = getattr(obj, key, None)
    if val is None:
        if hasattr(obj, "model_extra") and isinstance(obj.model_extra, dict):
            val = obj.model_extra.get(key)
        elif hasattr(obj, "__pydantic_extra__") and isinstance(obj.__pydantic_extra__, dict):
            val = obj.__pydantic_extra__.get(key)
    return val


def _dump_message(message: Any) -> dict[str, Any]:
    if isinstance(message, dict):
        return message
    if hasattr(message, "model_dump"):
        return message.model_dump()
    return {"content": str(message)}
