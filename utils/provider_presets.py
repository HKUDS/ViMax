"""
Provider preset system for ViMax chat model configuration.

Supports auto-detection and resolution of LLM provider settings,
allowing users to specify a provider name (e.g., ``minimax``) instead
of manually configuring base_url and model details.
"""

import os
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Provider presets
# ---------------------------------------------------------------------------

PROVIDER_PRESETS: Dict[str, Dict[str, Any]] = {
    "minimax": {
        "base_url": "https://api.minimax.io/v1",
        "env_key": "MINIMAX_API_KEY",
        "default_model": "MiniMax-M3",
        "models": [
            "MiniMax-M3",
            "MiniMax-M2.7",
            "MiniMax-M2.7-highspeed",
        ],
        "temperature_range": (0.0, 1.0),
    },
    "atlas": {
        "base_url": "https://api.atlascloud.ai/v1",
        "env_key": "ATLASCLOUD_API_KEY",
        "default_model": "deepseek-ai/deepseek-v4-pro",
        "models": [
            "anthropic/claude-haiku-4.5-20251001",
            "anthropic/claude-opus-4.8",
            "anthropic/claude-sonnet-4.6",
            "openai/gpt-5.4",
            "openai/gpt-5.5",
            "google/gemini-3.1-flash-lite",
            "google/gemini-3.1-pro-preview",
            "google/gemini-3.5-flash",
            "qwen/qwen2.5-7b-instruct",
            "Qwen/Qwen3-235B-A22B-Instruct-2507",
            "qwen/qwen3-235b-a22b-thinking-2507",
            "qwen/qwen3-30b-a3b",
            "Qwen/Qwen3-30B-A3B-Instruct-2507",
            "qwen/qwen3-30b-a3b-thinking-2507",
            "qwen/qwen3-32b",
            "qwen/qwen3-8b",
            "Qwen/Qwen3-Coder",
            "qwen/qwen3-coder-next",
            "qwen/qwen3-max-2026-01-23",
            "Qwen/Qwen3-Next-80B-A3B-Instruct",
            "Qwen/Qwen3-Next-80B-A3B-Thinking",
            "Qwen/Qwen3-VL-235B-A22B-Instruct",
            "qwen/qwen3-vl-235b-a22b-thinking",
            "qwen/qwen3-vl-30b-a3b-instruct",
            "qwen/qwen3-vl-30b-a3b-thinking",
            "qwen/qwen3-vl-8b-instruct",
            "qwen/qwen3.5-122b-a10b",
            "qwen/qwen3.5-27b",
            "qwen/qwen3.5-35b-a3b",
            "qwen/qwen3.5-397b-a17b",
            "qwen/qwen3.6-35b-a3b",
            "qwen/qwen3.6-plus",
            "deepseek-ai/deepseek-ocr",
            "deepseek-ai/deepseek-r1-0528",
            "deepseek-ai/DeepSeek-V3-0324",
            "deepseek-ai/DeepSeek-V3.1",
            "deepseek-ai/DeepSeek-V3.1-Terminus",
            "deepseek-ai/deepseek-v3.2",
            "deepseek-ai/DeepSeek-V3.2-Exp",
            "deepseek-ai/deepseek-v4-flash",
            "deepseek-ai/deepseek-v4-pro",
            "moonshotai/Kimi-K2-Instruct",
            "moonshotai/Kimi-K2-Instruct-0905",
            "moonshotai/Kimi-K2-Thinking",
            "moonshotai/kimi-k2.5",
            "moonshotai/kimi-k2.6",
            "zai-org/GLM-4.6",
            "zai-org/glm-4.7",
            "zai-org/glm-5",
            "zai-org/glm-5-turbo",
            "zai-org/glm-5.1",
            "zai-org/glm-5v-turbo",
            "MiniMaxAI/MiniMax-M2",
            "minimaxai/minimax-m2.1",
            "minimaxai/minimax-m2.5",
            "minimaxai/minimax-m2.7",
            "xai/grok-4.3",
            "kwaipilot/kat-coder-pro-v2",
            "owl",
        ],
        "temperature_range": (0.0, 2.0),
    },
}


def resolve_chat_model_config(init_args: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve provider presets and return final ``init_chat_model`` kwargs.

    If ``model_provider`` matches a known preset (e.g. ``minimax``), the
    returned dict will have:

    * ``model_provider`` rewritten to ``"openai"`` (OpenAI-compatible API)
    * ``base_url`` filled in from the preset when not already set
    * ``api_key`` sourced from the environment when not already set
    * ``model`` defaulted to the preset's default model when not already set
    * ``temperature`` clamped to the provider's supported range

    For unknown providers the dict is returned unchanged.
    """
    args = dict(init_args)  # shallow copy
    provider = args.get("model_provider", "openai")

    preset = PROVIDER_PRESETS.get(provider)
    if preset is None:
        return args

    # base_url
    if not args.get("base_url"):
        args["base_url"] = preset["base_url"]

    # api_key – fall back to env var
    if not args.get("api_key"):
        env_key = preset.get("env_key", "")
        env_val = os.environ.get(env_key, "")
        if env_val:
            args["api_key"] = env_val
            logger.info("Using %s API key from environment variable %s", provider, env_key)

    # default model
    if not args.get("model"):
        args["model"] = preset["default_model"]
        logger.info("Defaulting to model %s for provider %s", args["model"], provider)

    # temperature clamping
    temp_range = preset.get("temperature_range")
    if temp_range and "temperature" in args and args["temperature"] is not None:
        lo, hi = temp_range
        original = args["temperature"]
        args["temperature"] = max(lo, min(hi, original))
        if args["temperature"] != original:
            logger.warning(
                "Clamped temperature %.2f -> %.2f for provider %s",
                original, args["temperature"], provider,
            )

    # rewrite to openai-compatible provider for LangChain
    args["model_provider"] = "openai"

    return args


def detect_provider_from_env() -> Optional[str]:
    """Return the name of a provider whose API key is found in the environment.

    Checks ``PROVIDER_PRESETS`` in definition order and returns the first
    match, or ``None`` if no key is set.
    """
    for name, preset in PROVIDER_PRESETS.items():
        env_key = preset.get("env_key", "")
        if env_key and os.environ.get(env_key):
            return name
    return None
