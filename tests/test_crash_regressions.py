"""Regression tests for small crash bugs in helper stringification paths."""

import unittest

from agent_runtime.context_compactor import ContextCompactor
from interfaces.shot_description import ShotBriefDescription


class TestContextCompactorToolCallPreview(unittest.TestCase):
    def test_fallback_summary_handles_tool_call_messages(self):
        compactor = ContextCompactor(None, token_threshold=200, buffer_tokens=0, preserve_last_n=2, summary_max_chars=2000)
        messages = [
            {"role": "user", "content": "list the files"},
            {"role": "assistant", "content": "", "tool_calls": [{"id": "c1", "function": {"name": "list_files", "arguments": "{}"}}]},
        ]
        summary = compactor._fallback_summary(messages, [], "", "test")
        self.assertIn("[tool calls]", summary)
        self.assertIn("list_files", summary)


class TestShotBriefDescriptionStr(unittest.TestCase):
    def test_str_uses_existing_fields(self):
        shot = ShotBriefDescription(
            idx=0,
            is_last=False,
            cam_idx=1,
            visual_desc="<Alice> waves at the camera.",
            audio_desc="[Speaker] Alice (Happy): Hello!",
        )
        text = str(shot)
        self.assertIn("Shot 0", text)
        self.assertIn("Camera Index: 1", text)
        self.assertIn("<Alice> waves at the camera.", text)
        self.assertIn("[Speaker] Alice (Happy): Hello!", text)


if __name__ == "__main__":
    unittest.main()
