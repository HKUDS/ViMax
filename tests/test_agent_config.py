import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

from agent_runtime.config import (
    api_provider_from_base_url,
    embedding_api_key,
    embedding_base_url,
    embedding_model,
    embedding_model_provider,
    image_api_key,
    image_base_url,
    image_model,
    llm_api_key,
    llm_base_url,
    llm_model,
    llm_model_provider,
    load_agent_config,
    reranker_api_key,
    reranker_base_url,
    reranker_model,
    video_api_key,
    video_base_url,
    video_model,
    video_provider,
)


class AgentConfigTests(unittest.TestCase):
    def setUp(self):
        load_agent_config.cache_clear()

    def tearDown(self):
        load_agent_config.cache_clear()

    def test_reads_agent_local_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_dir = Path(tmp) / "configs"
            config_dir.mkdir()
            (config_dir / "agent.local.yaml").write_text(yaml.safe_dump({
                "llm": {"model_provider": "openai", "model": "config-llm", "base_url": "https://config.test/v1", "api_key": "config-key"},
                "image": {"model": "config-image", "base_url": "https://image.test", "api_key": "image-key"},
                "video": {"model": "config-video", "base_url": "https://openrouter.ai/api/v1", "api_key": "video-key"},
                "embedding": {"model_provider": "openai", "model": "config-embedding", "base_url": "https://embedding.test/v1", "api_key": "embedding-key"},
                "reranker": {"model": "config-reranker", "base_url": "https://reranker.test", "api_key": "reranker-key"},
            }), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(llm_model(tmp), "config-llm")
                self.assertEqual(llm_model_provider(tmp), "openai")
                self.assertEqual(llm_base_url(tmp), "https://config.test/v1")
                self.assertEqual(llm_api_key(tmp), "config-key")
                self.assertEqual(image_model(tmp), "config-image")
                self.assertEqual(image_base_url(tmp), "https://image.test")
                self.assertEqual(image_api_key(tmp), "image-key")
                self.assertEqual(video_model(tmp), "config-video")
                self.assertEqual(video_provider(tmp), "openrouter")
                self.assertEqual(video_base_url(tmp), "https://openrouter.ai/api/v1")
                self.assertEqual(video_api_key(tmp), "video-key")
                self.assertEqual(embedding_model_provider(tmp), "openai")
                self.assertEqual(embedding_model(tmp), "config-embedding")
                self.assertEqual(embedding_base_url(tmp), "https://embedding.test/v1")
                self.assertEqual(embedding_api_key(tmp), "embedding-key")
                self.assertEqual(reranker_model(tmp), "config-reranker")
                self.assertEqual(reranker_base_url(tmp), "https://reranker.test")
                self.assertEqual(reranker_api_key(tmp), "reranker-key")

    def test_environment_overrides_agent_local_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_dir = Path(tmp) / "configs"
            config_dir.mkdir()
            (config_dir / "agent.local.yaml").write_text(yaml.safe_dump({"llm": {"model": "config-llm", "api_key": "config-key"}}), encoding="utf-8")
            with patch.dict(os.environ, {"VIMAX_LLM_MODEL": "env-llm", "VIMAX_LLM_MODEL_PROVIDER": "openai", "VIMAX_LLM_API_KEY": "env-key", "VIMAX_VIDEO_BASE_URL": "https://openrouter.ai/api/v1", "VIMAX_EMBEDDING_MODEL": "env-embedding", "VIMAX_EMBEDDING_BASE_URL": "https://env-embedding.test/v1", "VIMAX_EMBEDDING_API_KEY": "env-embedding-key", "VIMAX_RERANKER_MODEL": "env-reranker", "VIMAX_RERANKER_BASE_URL": "https://env-reranker.test", "VIMAX_RERANKER_API_KEY": "env-reranker-key"}, clear=True):
                self.assertEqual(llm_model(tmp), "env-llm")
                self.assertEqual(llm_model_provider(tmp), "openai")
                self.assertEqual(llm_api_key(tmp), "env-key")
                self.assertEqual(video_provider(tmp), "openrouter")
                self.assertEqual(video_base_url(tmp), "https://openrouter.ai/api/v1")
                self.assertEqual(embedding_model(tmp), "env-embedding")
                self.assertEqual(embedding_base_url(tmp), "https://env-embedding.test/v1")
                self.assertEqual(embedding_api_key(tmp), "env-embedding-key")
                self.assertEqual(reranker_model(tmp), "env-reranker")
                self.assertEqual(reranker_base_url(tmp), "https://env-reranker.test")
                self.assertEqual(reranker_api_key(tmp), "env-reranker-key")

    def test_image_and_video_keys_fall_back_to_llm_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_dir = Path(tmp) / "configs"
            config_dir.mkdir()
            (config_dir / "agent.local.yaml").write_text(yaml.safe_dump({"llm": {"api_key": "shared-key"}}), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(image_api_key(tmp), "shared-key")
                self.assertEqual(video_api_key(tmp), "shared-key")

    def test_video_provider_is_inferred_from_base_url(self):
        self.assertEqual(api_provider_from_base_url("https://openrouter.ai/api/v1"), "openrouter")
        self.assertEqual(api_provider_from_base_url("https://yunwu.ai/v1"), "yunwu")
        self.assertEqual(api_provider_from_base_url("https://example.com/v1"), "")


if __name__ == "__main__":
    unittest.main()
