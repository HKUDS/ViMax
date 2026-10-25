from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from utils.image_selection import image_candidate_count_from_config

DEFAULT_LLM_MODEL = "gpt-5.5"
DEFAULT_LLM_MODEL_PROVIDER = "openai"
DEFAULT_LLM_BASE_URL = "https://yunwu.ai/v1"
DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview"
DEFAULT_IMAGE_BASE_URL = "https://yunwu.ai"
DEFAULT_VIDEO_MODEL = "veo3.1-fast"
DEFAULT_VIDEO_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_MODEL_PROVIDER = "openai"
DEFAULT_RERANKER_MODEL = "BAAI/bge-reranker-v2-m3"


@lru_cache(maxsize=4)
def load_agent_config(workspace_root: str | Path = ".") -> dict[str, Any]:
    path = Path(workspace_root).resolve() / "configs" / "agent.local.yaml"
    if not path.exists():
        return {}
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise RuntimeError(f"Invalid configs/agent.local.yaml: {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("configs/agent.local.yaml must be a YAML mapping")
    return payload


def config_value(section: str, key: str, env_names: list[str], default: str = "", workspace_root: str | Path = ".") -> str:
    for env_name in env_names:
        value = os.environ.get(env_name)
        if value:
            return value
    section_payload = load_agent_config(workspace_root).get(section, {})
    if isinstance(section_payload, dict):
        value = section_payload.get(key)
        if isinstance(value, str) and value:
            return value
    return default


def llm_provider(workspace_root: str | Path = ".") -> str:
    for env_name in ["VIMAX_LLM_PROVIDER", "VIMAX_LLM_MODEL_PROVIDER"]:
        env_val = os.environ.get(env_name)
        if env_val:
            p = env_val.strip().lower()
            if p in ("google", "google_genai", "gemini"):
                return "google"
            return p
    section_payload = load_agent_config(workspace_root).get("llm", {})
    if isinstance(section_payload, dict):
        provider = section_payload.get("provider")
        if isinstance(provider, str) and provider:
            p = provider.strip().lower()
            if p in ("google", "google_genai", "gemini"):
                return "google"
            return p
        model_provider = section_payload.get("model_provider")
        if isinstance(model_provider, str) and model_provider:
            p = model_provider.strip().lower()
            if p in ("google", "google_genai", "gemini"):
                return "google"
    base = llm_base_url(workspace_root)
    if base and ("googleapis.com" not in base or "openai" in base):
        return "openai"
    if "googleapis.com" in base:
        return "google"
    return "openai"


def llm_model(workspace_root: str | Path = ".") -> str:
    return config_value("llm", "model", ["VIMAX_LLM_MODEL"], DEFAULT_LLM_MODEL, workspace_root)


def llm_model_provider(workspace_root: str | Path = ".") -> str:
    return config_value("llm", "model_provider", ["VIMAX_LLM_MODEL_PROVIDER"], DEFAULT_LLM_MODEL_PROVIDER, workspace_root)


def llm_base_url(workspace_root: str | Path = ".") -> str:
    section_payload = load_agent_config(workspace_root).get("llm", {})
    if isinstance(section_payload, dict):
        p = section_payload.get("provider") or section_payload.get("model_provider")
        if p and p.strip().lower() in ("google", "google_genai", "gemini"):
            return config_value("llm", "base_url", ["VIMAX_LLM_BASE_URL"], "", workspace_root)
    return config_value("llm", "base_url", ["VIMAX_LLM_BASE_URL"], DEFAULT_LLM_BASE_URL, workspace_root)


def llm_api_key(workspace_root: str | Path = ".") -> str:
    return config_value("llm", "api_key", ["VIMAX_LLM_API_KEY", "VIMAX_API_KEY"], "", workspace_root)


def image_model(workspace_root: str | Path = ".") -> str:
    return config_value("image", "model", ["VIMAX_IMAGE_MODEL"], DEFAULT_IMAGE_MODEL, workspace_root)


def image_base_url(workspace_root: str | Path = ".") -> str:
    section_payload = load_agent_config(workspace_root).get("image", {})
    if isinstance(section_payload, dict):
        p = section_payload.get("provider")
        if p and p.strip().lower() in ("google", "google_genai", "gemini"):
            return config_value("image", "base_url", ["VIMAX_IMAGE_BASE_URL"], "", workspace_root)
    return config_value("image", "base_url", ["VIMAX_IMAGE_BASE_URL"], DEFAULT_IMAGE_BASE_URL, workspace_root)


def image_api_key(workspace_root: str | Path = ".") -> str:
    return config_value("image", "api_key", ["VIMAX_IMAGE_API_KEY", "VIMAX_LLM_API_KEY", "VIMAX_API_KEY"], llm_api_key(workspace_root), workspace_root)


def image_num_candidates(workspace_root: str | Path = ".") -> int:
    return image_candidate_count_from_config(load_agent_config(workspace_root))



def embedding_model(workspace_root: str | Path = ".") -> str:
    return config_value("embedding", "model", ["VIMAX_EMBEDDING_MODEL"], DEFAULT_EMBEDDING_MODEL, workspace_root)


def embedding_model_provider(workspace_root: str | Path = ".") -> str:
    return config_value("embedding", "model_provider", ["VIMAX_EMBEDDING_MODEL_PROVIDER"], DEFAULT_EMBEDDING_MODEL_PROVIDER, workspace_root)


def embedding_base_url(workspace_root: str | Path = ".") -> str:
    return config_value("embedding", "base_url", ["VIMAX_EMBEDDING_BASE_URL"], "", workspace_root)


def embedding_api_key(workspace_root: str | Path = ".") -> str:
    return config_value("embedding", "api_key", ["VIMAX_EMBEDDING_API_KEY"], "", workspace_root)


def reranker_model(workspace_root: str | Path = ".") -> str:
    return config_value("reranker", "model", ["VIMAX_RERANKER_MODEL"], DEFAULT_RERANKER_MODEL, workspace_root)


def reranker_base_url(workspace_root: str | Path = ".") -> str:
    return config_value("reranker", "base_url", ["VIMAX_RERANKER_BASE_URL"], "", workspace_root)


def reranker_api_key(workspace_root: str | Path = ".") -> str:
    return config_value("reranker", "api_key", ["VIMAX_RERANKER_API_KEY"], "", workspace_root)


def video_model(workspace_root: str | Path = ".") -> str:
    return config_value("video", "model", ["VIMAX_VIDEO_MODEL"], DEFAULT_VIDEO_MODEL, workspace_root)


def video_base_url(workspace_root: str | Path = ".") -> str:
    section_payload = load_agent_config(workspace_root).get("video", {})
    if isinstance(section_payload, dict):
        p = section_payload.get("provider")
        if p and p.strip().lower() in ("google", "google_genai", "gemini"):
            return config_value("video", "base_url", ["VIMAX_VIDEO_BASE_URL"], "", workspace_root)
    return config_value("video", "base_url", ["VIMAX_VIDEO_BASE_URL"], DEFAULT_VIDEO_BASE_URL, workspace_root)


def video_api_key(workspace_root: str | Path = ".") -> str:
    return config_value("video", "api_key", ["VIMAX_VIDEO_API_KEY", "VIMAX_LLM_API_KEY", "VIMAX_API_KEY"], llm_api_key(workspace_root), workspace_root)


def api_provider_from_base_url(base_url: str) -> str:
    normalized = base_url.strip().lower()
    if "openrouter.ai" in normalized:
        return "openrouter"
    if "yunwu.ai" in normalized:
        return "yunwu"
    if "googleapis.com" in normalized or "google" in normalized:
        return "google"
    return ""


def image_provider(workspace_root: str | Path = ".") -> str:
    section_payload = load_agent_config(workspace_root).get("image", {})
    if isinstance(section_payload, dict):
        provider = section_payload.get("provider")
        if isinstance(provider, str) and provider:
            return provider.strip().lower()
    base = image_base_url(workspace_root)
    return api_provider_from_base_url(base)


def video_provider(workspace_root: str | Path = ".") -> str:
    section_payload = load_agent_config(workspace_root).get("video", {})
    if isinstance(section_payload, dict):
        provider = section_payload.get("provider")
        if isinstance(provider, str) and provider:
            return provider.strip().lower()
    base = video_base_url(workspace_root)
    return api_provider_from_base_url(base)


def aspect_ratio(workspace_root: str | Path = ".") -> str:
    env_ratio = os.environ.get("VIMAX_ASPECT_RATIO") or os.environ.get("VIMAX_VIDEO_ASPECT_RATIO") or os.environ.get("VIMAX_IMAGE_ASPECT_RATIO")
    if env_ratio:
        return env_ratio.strip()
    cfg = load_agent_config(workspace_root)
    video_ratio = cfg.get("video", {}).get("aspect_ratio") if isinstance(cfg.get("video"), dict) else None
    if video_ratio:
        return str(video_ratio).strip()
    image_ratio = cfg.get("image", {}).get("aspect_ratio") if isinstance(cfg.get("image"), dict) else None
    if image_ratio:
        return str(image_ratio).strip()
    render_ratio = cfg.get("render", {}).get("aspect_ratio") if isinstance(cfg.get("render"), dict) else None
    if render_ratio:
        return str(render_ratio).strip()
    top_ratio = cfg.get("aspect_ratio")
    if top_ratio:
        return str(top_ratio).strip()
    return "16:9"


def image_dimensions_for_aspect_ratio(ratio: str) -> str:
    ratio_clean = ratio.strip().lower()
    if ratio_clean in ("9:16", "9/16", "portrait"):
        return "900x1600"
    if ratio_clean in ("1:1", "1/1", "square"):
        return "1024x1024"
    if ratio_clean in ("4:3", "4/3"):
        return "1200x900"
    if ratio_clean in ("3:4", "3/4"):
        return "900x1200"
    return "1600x900"
