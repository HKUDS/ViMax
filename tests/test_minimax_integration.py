"""Integration tests for MiniMax provider support.

These tests verify provider preset resolution and default pipeline config
loading. They mock the LangChain factory so no real API calls are made.

Heavy multimedia dependencies (moviepy, scenedetect, cv2, google-genai,
etc.) are stubbed at the module level so the pipeline modules can be
imported in a lightweight test environment.
"""

import importlib
import os
import sys
import types
import unittest
from unittest.mock import patch, MagicMock

# ---- stub heavy deps before any project imports ----
_STUB_MODULES = [
    "moviepy", "cv2", "scenedetect", "scenedetect.detectors",
    "PIL", "PIL.Image",
    "faiss",
    "google", "google.genai", "google.genai.types", "google.genai.errors",
    "langchain_community", "langchain_community.vectorstores",
    "langchain_community.vectorstores.FAISS",
]
_saved = {}
for _mod in _STUB_MODULES:
    _saved[_mod] = sys.modules.get(_mod)
    mock = MagicMock()
    # Give stub a __spec__ so importlib.util.find_spec() works
    mock.__spec__ = importlib.machinery.ModuleSpec(_mod, None)
    mock.__path__ = []
    sys.modules[_mod] = mock

from utils.provider_presets import resolve_chat_model_config


class TestPipelineConfigResolution(unittest.TestCase):
    """Integration: config dict -> resolve -> init_chat_model kwargs."""

    def _make_minimax_config(self, **overrides):
        base = {
            "model": "MiniMax-M3",
            "model_provider": "minimax",
            "api_key": "test-key",
        }
        base.update(overrides)
        return base

    def test_full_minimax_config_resolution(self):
        config = self._make_minimax_config()
        resolved = resolve_chat_model_config(config)
        self.assertEqual(resolved["model_provider"], "openai")
        self.assertEqual(resolved["base_url"], "https://api.minimax.io/v1")
        self.assertEqual(resolved["model"], "MiniMax-M3")
        self.assertEqual(resolved["api_key"], "test-key")

    def test_minimax_highspeed_model(self):
        config = self._make_minimax_config(model="MiniMax-M2.7-highspeed")
        resolved = resolve_chat_model_config(config)
        self.assertEqual(resolved["model"], "MiniMax-M2.7-highspeed")
        self.assertEqual(resolved["model_provider"], "openai")

    def test_minimax_m27_model(self):
        config = self._make_minimax_config(model="MiniMax-M2.7")
        resolved = resolve_chat_model_config(config)
        self.assertEqual(resolved["model"], "MiniMax-M2.7")

    @patch.dict(os.environ, {"MINIMAX_API_KEY": "env-api-key"})
    def test_env_key_fallback_in_config(self):
        config = {
            "model": "MiniMax-M3",
            "model_provider": "minimax",
        }
        resolved = resolve_chat_model_config(config)
        self.assertEqual(resolved["api_key"], "env-api-key")

    def test_openrouter_config_unchanged(self):
        """Existing OpenRouter configs must not be affected."""
        config = {
            "model": "google/gemini-2.5-flash-lite-preview-09-2025",
            "model_provider": "openai",
            "api_key": "or-key",
            "base_url": "https://openrouter.ai/api/v1",
        }
        resolved = resolve_chat_model_config(config)
        self.assertEqual(resolved["model_provider"], "openai")
        self.assertEqual(resolved["base_url"], "https://openrouter.ai/api/v1")
        self.assertEqual(resolved["model"], "google/gemini-2.5-flash-lite-preview-09-2025")

    def test_init_chat_model_receives_openai_provider(self):
        """Verify that resolved kwargs have model_provider='openai'."""
        config = self._make_minimax_config()
        resolved = resolve_chat_model_config(config)
        self.assertEqual(resolved["model_provider"], "openai")
        self.assertEqual(resolved["base_url"], "https://api.minimax.io/v1")
        self.assertEqual(resolved["model"], "MiniMax-M3")

    def test_temperature_clamping_in_pipeline_flow(self):
        config = self._make_minimax_config(temperature=2.0)
        resolved = resolve_chat_model_config(config)
        self.assertEqual(resolved["temperature"], 1.0)

    def test_extra_kwargs_preserved(self):
        config = self._make_minimax_config(max_tokens=4096, top_p=0.9)
        resolved = resolve_chat_model_config(config)
        self.assertEqual(resolved["max_tokens"], 4096)
        self.assertEqual(resolved["top_p"], 0.9)


class TestPipelineInitFromConfig(unittest.TestCase):
    """Integration: full pipeline init_from_config with provider configs."""

    @patch("pipelines.idea2video_pipeline.init_chat_model")
    @patch("pipelines.idea2video_pipeline.RenderBackend.from_config")
    def test_idea2video_pipeline_minimax_config(self, mock_backend, mock_init):
        mock_model = MagicMock()
        mock_init.return_value = mock_model
        mock_backend.return_value = MagicMock(image_generator=MagicMock(), video_generator=MagicMock())

        from pipelines.idea2video_pipeline import Idea2VideoPipeline
        pipeline = Idea2VideoPipeline.init_from_config("configs/idea2video_minimax.yaml")

        mock_init.assert_called_once()
        call_kwargs = mock_init.call_args[1]
        self.assertEqual(call_kwargs["model_provider"], "openai")
        self.assertEqual(call_kwargs["base_url"], "https://api.minimax.io/v1")
        self.assertEqual(call_kwargs["model"], "MiniMax-M3")

    @patch("pipelines.script2video_pipeline.init_chat_model")
    @patch("pipelines.script2video_pipeline.RenderBackend.from_config")
    def test_script2video_pipeline_minimax_config(self, mock_backend, mock_init):
        mock_model = MagicMock()
        mock_init.return_value = mock_model
        mock_backend.return_value = MagicMock(image_generator=MagicMock(), video_generator=MagicMock())

        from pipelines.script2video_pipeline import Script2VideoPipeline
        pipeline = Script2VideoPipeline.init_from_config("configs/script2video_minimax.yaml")

        mock_init.assert_called_once()
        call_kwargs = mock_init.call_args[1]
        self.assertEqual(call_kwargs["model_provider"], "openai")
        self.assertEqual(call_kwargs["base_url"], "https://api.minimax.io/v1")
        self.assertEqual(call_kwargs["model"], "MiniMax-M3")
    """Integration: full pipeline init_from_config with default configs."""

    @patch("pipelines.idea2video_pipeline.init_chat_model")
    @patch("pipelines.idea2video_pipeline.RenderBackend.from_config")
    def test_existing_openrouter_config_still_works(self, mock_backend, mock_init):
        mock_model = MagicMock()
        mock_init.return_value = mock_model
        mock_backend.return_value = MagicMock(image_generator=MagicMock(), video_generator=MagicMock())

        from pipelines.idea2video_pipeline import Idea2VideoPipeline
        pipeline = Idea2VideoPipeline.init_from_config("configs/idea2video.yaml")

        mock_init.assert_called_once()
        call_kwargs = mock_init.call_args[1]
        self.assertEqual(call_kwargs["model_provider"], "openai")
        self.assertEqual(call_kwargs["base_url"], "https://openrouter.ai/api/v1")


if __name__ == "__main__":
    unittest.main()
