import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from agent_runtime.llm import OpenAICompatibleLLM


class AgentLLMTests(unittest.IsolatedAsyncioTestCase):
    async def test_string_response_retries_before_clear_error(self):
        llm = OpenAICompatibleLLM(model="test", base_url="https://example.invalid/v1", api_key="test-key")
        create = AsyncMock(side_effect=["data: [DONE]", "bad response"])
        llm.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with self.assertRaisesRegex(RuntimeError, "returned a string"):
            await llm.complete([], [])
        self.assertEqual(create.await_count, 2)

    async def test_string_response_retry_can_recover(self):
        llm = OpenAICompatibleLLM(model="test", base_url="https://example.invalid/v1", api_key="test-key")
        create = AsyncMock(side_effect=["data: [DONE]", {"choices": [{"message": {"content": "recovered", "tool_calls": []}}]}])
        llm.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        message = await llm.complete([], [])
        self.assertEqual(message.text, "recovered")
        self.assertEqual(create.await_count, 2)

    async def test_tool_request_falls_back_to_plain_chat_after_bad_tool_responses(self):
        llm = OpenAICompatibleLLM(model="test", base_url="https://example.invalid/v1", api_key="test-key")
        create = AsyncMock(side_effect=[
            "data: [DONE]",
            "data: [DONE]",
            {"choices": [{"message": {"content": "plain fallback", "tool_calls": []}}]},
        ])
        llm.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        message = await llm.complete([], [{"type": "function", "function": {"name": "x", "parameters": {}}}])
        self.assertEqual(message.text, "plain fallback")
        self.assertEqual(create.await_count, 3)
        self.assertIsNone(create.await_args_list[-1].kwargs.get("tools"))

    async def test_dict_response_is_accepted(self):
        llm = OpenAICompatibleLLM(model="test", base_url="https://example.invalid/v1", api_key="test-key")
        llm.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value={
            "choices": [{"message": {"content": "hello", "tool_calls": []}}]
        }))))
        message = await llm.complete([], [])
        self.assertEqual(message.text, "hello")

    async def test_thought_signature_and_extra_content_preserved(self):
        from agent_runtime.loop import _openai_tool_call
        llm = OpenAICompatibleLLM(model="test", base_url="https://example.invalid/v1", api_key="test-key")
        llm.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value={
            "choices": [{
                "message": {
                    "content": None,
                    "tool_calls": [{
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "test_func", "arguments": "{}"},
                        "extra_content": {"google": {"thought_signature": "sig_abc123"}}
                    }]
                }
            }]
        }))))
        message = await llm.complete([], [])
        self.assertEqual(len(message.tool_calls), 1)
        tc = message.tool_calls[0]
        self.assertEqual(tc.extra_content, {"google": {"thought_signature": "sig_abc123"}})
        reconstructed = _openai_tool_call(tc)
        self.assertEqual(reconstructed.get("extra_content"), {"google": {"thought_signature": "sig_abc123"}})


    async def test_google_genai_llm_handles_text_and_tools(self):
        from agent_runtime.llm import GoogleGenAILLM
        llm = GoogleGenAILLM(model="gemini-3.8-flash", api_key="test-key")
        
        fake_part_fc = SimpleNamespace(
            text=None,
            function_call=SimpleNamespace(name="my_tool", args={"query": "test"}, id="call-123")
        )
        fake_candidate = SimpleNamespace(content=SimpleNamespace(parts=[fake_part_fc]))
        fake_response = SimpleNamespace(candidates=[fake_candidate])

        create_mock = AsyncMock(return_value=fake_response)
        llm.client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=create_mock)))

        message = await llm.complete(
            [
                {"role": "system", "content": "You are helpful."},
                {"role": "user", "content": "search test"}
            ],
            tools=[{"type": "function", "function": {"name": "my_tool", "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "additionalProperties": False,
            }}}]
        )
        self.assertEqual(len(message.tool_calls), 1)
        self.assertEqual(message.tool_calls[0].name, "my_tool")
        self.assertEqual(message.tool_calls[0].arguments, {"query": "test"})
        self.assertIn("google_content", message.raw_message)

        # Verify additionalProperties was stripped from the tool schema passed to Gemini
        config_passed = create_mock.call_args.kwargs["config"]
        tool_decl = config_passed.tools[0]
        fn_decl = getattr(tool_decl, "function_declarations", None)[0]
        params = getattr(fn_decl, "parameters", None)
        if isinstance(params, dict):
            self.assertNotIn("additionalProperties", params)
            self.assertNotIn("additional_properties", params)
        elif hasattr(params, "properties"):
            self.assertIsNone(getattr(params, "additional_properties", None))

    async def test_google_genai_llm_does_not_retry_on_400(self):
        from agent_runtime.llm import GoogleGenAILLM
        from google.genai import errors
        llm = GoogleGenAILLM(model="gemini-3.8-flash", api_key="test-key")

        err = errors.ClientError(code=400, response_json={"error": "Bad request"})
        create_mock = AsyncMock(side_effect=err)
        llm.client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=create_mock)))

        with self.assertRaises(errors.ClientError):
            await llm.complete([], [])
        self.assertEqual(create_mock.await_count, 1)

    async def test_google_genai_llm_retries_on_429(self):
        from agent_runtime.llm import GoogleGenAILLM
        from google.genai import errors
        llm = GoogleGenAILLM(model="gemini-3.8-flash", api_key="test-key")

        err = errors.ClientError(code=429, response_json={
            "error": {
                "message": "Quota exceeded on Tier 1. Please retry in 22.900385424s.",
                "details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "22s"}]
            }
        })
        fake_part = SimpleNamespace(text="Success after retry", function_call=None)
        fake_candidate = SimpleNamespace(content=SimpleNamespace(parts=[fake_part]))
        success_response = SimpleNamespace(candidates=[fake_candidate])

        create_mock = AsyncMock(side_effect=[err, success_response])
        llm.client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=create_mock)))

        slept = []
        with patch("asyncio.sleep", AsyncMock(side_effect=lambda s: slept.append(s))):
            message = await llm.complete([], [])
        self.assertEqual(message.text, "Success after retry")
        self.assertEqual(create_mock.await_count, 2)
        # Verify it slept for the requested retryDelay + buffer (~23.9s) rather than 1.0s
        self.assertTrue(len(slept) == 1)
        self.assertAlmostEqual(slept[0], 23.900385424, places=1)


if __name__ == "__main__":
    unittest.main()
