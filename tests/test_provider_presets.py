"""Unit tests for utils.provider_presets."""

import os
import unittest
from unittest.mock import patch

from utils.provider_presets import (
    PROVIDER_PRESETS,
    resolve_chat_model_config,
    detect_provider_from_env,
)


class TestProviderPresets(unittest.TestCase):
    """Tests for the PROVIDER_PRESETS registry."""

    def test_minimax_preset_exists(self):
        self.assertIn("minimax", PROVIDER_PRESETS)

    def test_minimax_preset_base_url(self):
        self.assertEqual(
            PROVIDER_PRESETS["minimax"]["base_url"],
            "https://api.minimax.io/v1",
        )

    def test_minimax_preset_env_key(self):
        self.assertEqual(PROVIDER_PRESETS["minimax"]["env_key"], "MINIMAX_API_KEY")

    def test_minimax_preset_default_model(self):
        self.assertEqual(PROVIDER_PRESETS["minimax"]["default_model"], "MiniMax-M3")

    def test_minimax_preset_has_models_list(self):
        models = PROVIDER_PRESETS["minimax"]["models"]
        self.assertIn("MiniMax-M3", models)
        self.assertIn("MiniMax-M2.7", models)
        self.assertIn("MiniMax-M2.7-highspeed", models)

    def test_minimax_preset_temperature_range(self):
        lo, hi = PROVIDER_PRESETS["minimax"]["temperature_range"]
        self.assertEqual(lo, 0.0)
        self.assertEqual(hi, 1.0)


class TestResolveChatModelConfig(unittest.TestCase):
    """Tests for resolve_chat_model_config()."""

    def test_unknown_provider_passes_through(self):
        args = {"model_provider": "openai", "model": "gpt-4", "base_url": "https://example.com"}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["model_provider"], "openai")
        self.assertEqual(result["model"], "gpt-4")
        self.assertEqual(result["base_url"], "https://example.com")

    def test_no_model_provider_passes_through(self):
        args = {"model": "gpt-4"}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["model"], "gpt-4")

    def test_minimax_rewrites_provider_to_openai(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M3", "api_key": "sk-test"}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["model_provider"], "openai")

    def test_minimax_sets_base_url(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M3", "api_key": "sk-test"}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["base_url"], "https://api.minimax.io/v1")

    def test_minimax_preserves_custom_base_url(self):
        args = {
            "model_provider": "minimax",
            "model": "MiniMax-M3",
            "api_key": "sk-test",
            "base_url": "https://custom-proxy.example.com/v1",
        }
        result = resolve_chat_model_config(args)
        self.assertEqual(result["base_url"], "https://custom-proxy.example.com/v1")

    def test_minimax_defaults_model(self):
        args = {"model_provider": "minimax", "api_key": "sk-test"}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["model"], "MiniMax-M3")

    def test_minimax_preserves_explicit_model(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M2.7-highspeed", "api_key": "sk-test"}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["model"], "MiniMax-M2.7-highspeed")

    @patch.dict(os.environ, {"MINIMAX_API_KEY": "env-key-123"})
    def test_minimax_reads_api_key_from_env(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M3"}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["api_key"], "env-key-123")

    def test_minimax_prefers_explicit_api_key_over_env(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M3", "api_key": "explicit-key"}
        with patch.dict(os.environ, {"MINIMAX_API_KEY": "env-key"}):
            result = resolve_chat_model_config(args)
        self.assertEqual(result["api_key"], "explicit-key")

    def test_minimax_clamps_temperature_above_max(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M3", "api_key": "sk", "temperature": 1.5}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["temperature"], 1.0)

    def test_minimax_clamps_temperature_below_min(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M3", "api_key": "sk", "temperature": -0.5}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["temperature"], 0.0)

    def test_minimax_passes_valid_temperature(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M3", "api_key": "sk", "temperature": 0.7}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["temperature"], 0.7)

    def test_minimax_temperature_zero_allowed(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M3", "api_key": "sk", "temperature": 0.0}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["temperature"], 0.0)

    def test_minimax_no_temperature_key(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M3", "api_key": "sk"}
        result = resolve_chat_model_config(args)
        self.assertNotIn("temperature", result)

    def test_minimax_temperature_none_ignored(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M3", "api_key": "sk", "temperature": None}
        result = resolve_chat_model_config(args)
        self.assertIsNone(result["temperature"])

    def test_original_dict_not_mutated(self):
        args = {"model_provider": "minimax", "model": "MiniMax-M3", "api_key": "sk"}
        resolve_chat_model_config(args)
        self.assertEqual(args["model_provider"], "minimax")

    def test_empty_model_string_gets_default(self):
        args = {"model_provider": "minimax", "model": "", "api_key": "sk"}
        result = resolve_chat_model_config(args)
        self.assertEqual(result["model"], "MiniMax-M3")


class TestDetectProviderFromEnv(unittest.TestCase):
    """Tests for detect_provider_from_env()."""

    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key"}, clear=False)
    def test_detects_minimax(self):
        self.assertEqual(detect_provider_from_env(), "minimax")

    @patch.dict(os.environ, {}, clear=True)
    def test_returns_none_when_no_keys(self):
        self.assertIsNone(detect_provider_from_env())


class TestConfigYAMLLoading(unittest.TestCase):
    """Test that MiniMax example config files are valid YAML."""

    def test_idea2video_minimax_yaml(self):
        import yaml
        path = os.path.join(os.path.dirname(__file__), "..", "configs", "idea2video_minimax.yaml")
        with open(path) as f:
            config = yaml.safe_load(f)
        self.assertEqual(config["chat_model"]["init_args"]["model_provider"], "minimax")
        self.assertEqual(config["chat_model"]["init_args"]["model"], "MiniMax-M3")

    def test_script2video_minimax_yaml(self):
        import yaml
        path = os.path.join(os.path.dirname(__file__), "..", "configs", "script2video_minimax.yaml")
        with open(path) as f:
            config = yaml.safe_load(f)
        self.assertEqual(config["chat_model"]["init_args"]["model_provider"], "minimax")
        self.assertEqual(config["chat_model"]["init_args"]["model"], "MiniMax-M3")


if __name__ == "__main__":
    unittest.main()
