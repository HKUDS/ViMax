"""ViMax local GUI.

Run with:  uv run python app.py
"""
from __future__ import annotations

import asyncio
import glob
import os
import traceback
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import gradio as gr
from ruamel.yaml import YAML

from utils.gui_logging import install_once

CONFIGS_DIR = Path(__file__).parent / "configs"
IDEA_CONFIGS = sorted(str(p) for p in CONFIGS_DIR.glob("idea2video*.yaml"))
SCRIPT_CONFIGS = sorted(str(p) for p in CONFIGS_DIR.glob("script2video*.yaml"))
ALL_CONFIGS = sorted(str(p) for p in CONFIGS_DIR.glob("*.yaml"))

_yaml = YAML(typ="rt")
_yaml.preserve_quotes = True


# ---------- config helpers ----------

def load_yaml(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return _yaml.load(f)


def save_yaml(path: str, data: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        _yaml.dump(data, f)


def _get(d: Any, *keys: str, default: Any = "") -> Any:
    cur = d
    for k in keys:
        if cur is None or k not in cur:
            return default
        cur = cur[k]
    return "" if cur is None else cur


def _set(d: Any, value: Any, *keys: str) -> None:
    """Set nested key, creating dicts along the way. Empty string -> None."""
    if value == "":
        value = None
    cur = d
    for k in keys[:-1]:
        if k not in cur or cur[k] is None:
            cur[k] = {}
        cur = cur[k]
    cur[keys[-1]] = value


def _to_int_or_none(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


# ---------- pipeline run ----------

async def _run_pipeline(
    pipeline_kind: str,
    config_path: str,
    text_input: str,
    user_requirement: str,
    style: str,
) -> AsyncGenerator[tuple, None]:
    """Yield (logs, video_path_or_None, generate_btn_update)."""
    handler = install_once()
    queue: asyncio.Queue[str] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    handler.attach(queue, loop)

    log_lines: list[str] = []

    def render() -> str:
        return "\n".join(log_lines)

    log_lines.append(f"[gui] Starting {pipeline_kind} with config={config_path}")
    yield render(), None, gr.update(interactive=False)

    # Lazy imports so the GUI launches even if heavy deps are slow to import.
    try:
        if pipeline_kind == "idea2video":
            from pipelines.idea2video_pipeline import Idea2VideoPipeline
            pipeline = Idea2VideoPipeline.init_from_config(config_path=config_path)
            coro = pipeline(idea=text_input, user_requirement=user_requirement, style=style)
        else:
            from pipelines.script2video_pipeline import Script2VideoPipeline
            pipeline = Script2VideoPipeline.init_from_config(config_path=config_path)
            coro = pipeline(script=text_input, user_requirement=user_requirement, style=style)
    except Exception:
        log_lines.append("[gui] Failed to construct pipeline:")
        log_lines.append(traceback.format_exc())
        handler.detach()
        yield render(), None, gr.update(interactive=True)
        return

    working_dir = _get(load_yaml(config_path), "working_dir", default=None) or None
    task = asyncio.create_task(coro)

    while True:
        drained = False
        try:
            while True:
                msg = queue.get_nowait()
                log_lines.append(msg)
                drained = True
        except asyncio.QueueEmpty:
            pass

        if drained:
            yield render(), None, gr.update(interactive=False)

        if task.done():
            try:
                while True:
                    log_lines.append(queue.get_nowait())
            except asyncio.QueueEmpty:
                pass
            break

        await asyncio.sleep(0.2)

    exc = task.exception()
    if exc is not None:
        log_lines.append("[gui] Pipeline raised:")
        log_lines.append("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
        handler.detach()
        yield render(), None, gr.update(interactive=True)
        return

    video_path = _find_latest_mp4(working_dir) if working_dir else None
    if video_path:
        log_lines.append(f"[gui] Done. Video: {video_path}")
    else:
        log_lines.append("[gui] Done. No .mp4 found under working_dir.")

    handler.detach()
    yield render(), video_path, gr.update(interactive=True)


def _find_latest_mp4(working_dir: str) -> Optional[str]:
    if not os.path.isdir(working_dir):
        return None
    candidates = glob.glob(os.path.join(working_dir, "**", "*.mp4"), recursive=True)
    if not candidates:
        return None
    return max(candidates, key=os.path.getmtime)


# ---------- Settings tab logic ----------

SETTINGS_FIELDS = [
    # (label, *path)
    ("Chat: model", "chat_model", "init_args", "model"),
    ("Chat: model_provider", "chat_model", "init_args", "model_provider"),
    ("Chat: api_key", "chat_model", "init_args", "api_key"),
    ("Chat: base_url", "chat_model", "init_args", "base_url"),
    ("Chat: max_requests_per_minute", "chat_model", "max_requests_per_minute"),
    ("Chat: max_requests_per_day", "chat_model", "max_requests_per_day"),
    ("Image: class_path", "image_generator", "class_path"),
    ("Image: api_key", "image_generator", "init_args", "api_key"),
    ("Image: max_requests_per_minute", "image_generator", "max_requests_per_minute"),
    ("Image: max_requests_per_day", "image_generator", "max_requests_per_day"),
    ("Video: class_path", "video_generator", "class_path"),
    ("Video: api_key", "video_generator", "init_args", "api_key"),
    ("Video: max_requests_per_minute", "video_generator", "max_requests_per_minute"),
    ("Video: max_requests_per_day", "video_generator", "max_requests_per_day"),
    ("working_dir", "working_dir"),
]
NUMERIC_LABELS = {label for label, *_ in SETTINGS_FIELDS if "max_requests" in label}
SECRET_LABELS = {label for label, *_ in SETTINGS_FIELDS if "api_key" in label}


def load_settings(config_path: str) -> tuple:
    if not config_path:
        return tuple("" for _ in SETTINGS_FIELDS) + ("Pick a config file.",)
    try:
        data = load_yaml(config_path)
    except Exception as e:
        return tuple("" for _ in SETTINGS_FIELDS) + (f"Error loading: {e}",)
    values = []
    for _, *path in SETTINGS_FIELDS:
        v = _get(data, *path, default="")
        values.append("" if v is None else str(v))
    return tuple(values) + (f"Loaded {config_path}",)


def save_settings(config_path: str, *values: str) -> str:
    if not config_path:
        return "Pick a config file first."
    try:
        data = load_yaml(config_path)
    except Exception as e:
        return f"Error loading current YAML: {e}"
    if data is None:
        data = {}
    for (label, *path), value in zip(SETTINGS_FIELDS, values):
        if label in NUMERIC_LABELS:
            value = _to_int_or_none(value)
            _set(data, value, *path)
        else:
            _set(data, value, *path)
    try:
        save_yaml(config_path, data)
    except Exception as e:
        return f"Error saving: {e}"
    return f"Saved {config_path}"


# ---------- UI ----------

def build_ui() -> gr.Blocks:
    with gr.Blocks(title="ViMax") as demo:
        gr.Markdown("# ViMax — Local GUI")

        with gr.Tab("Idea → Video"):
            with gr.Row():
                with gr.Column(scale=1):
                    idea = gr.Textbox(label="Idea", lines=10, placeholder="Describe the video you want…")
                    idea_req = gr.Textbox(label="User requirement", lines=3)
                    idea_style = gr.Textbox(label="Style")
                    idea_cfg = gr.Dropdown(
                        choices=IDEA_CONFIGS,
                        value=IDEA_CONFIGS[0] if IDEA_CONFIGS else None,
                        label="Config file",
                    )
                    idea_btn = gr.Button("Generate", variant="primary")
                with gr.Column(scale=1):
                    idea_logs = gr.Textbox(label="Logs", lines=20, max_lines=20, autoscroll=True)
                    idea_video = gr.Video(label="Output")

            idea_btn.click(
                fn=lambda cfg, t, r, s: _run_pipeline("idea2video", cfg, t, r, s),
                inputs=[idea_cfg, idea, idea_req, idea_style],
                outputs=[idea_logs, idea_video, idea_btn],
            )

        with gr.Tab("Script → Video"):
            with gr.Row():
                with gr.Column(scale=1):
                    script = gr.Textbox(label="Script", lines=10, placeholder="Paste your script here…")
                    script_req = gr.Textbox(label="User requirement", lines=3)
                    script_style = gr.Textbox(label="Style")
                    script_cfg = gr.Dropdown(
                        choices=SCRIPT_CONFIGS,
                        value=SCRIPT_CONFIGS[0] if SCRIPT_CONFIGS else None,
                        label="Config file",
                    )
                    script_btn = gr.Button("Generate", variant="primary")
                with gr.Column(scale=1):
                    script_logs = gr.Textbox(label="Logs", lines=20, max_lines=20, autoscroll=True)
                    script_video = gr.Video(label="Output")

            script_btn.click(
                fn=lambda cfg, t, r, s: _run_pipeline("script2video", cfg, t, r, s),
                inputs=[script_cfg, script, script_req, script_style],
                outputs=[script_logs, script_video, script_btn],
            )

        with gr.Tab("Settings"):
            settings_cfg = gr.Dropdown(
                choices=ALL_CONFIGS,
                value=ALL_CONFIGS[0] if ALL_CONFIGS else None,
                label="Config file",
            )
            field_components = []
            for label, *_ in SETTINGS_FIELDS:
                kwargs = {"label": label}
                if label in SECRET_LABELS:
                    kwargs["type"] = "password"
                field_components.append(gr.Textbox(**kwargs))
            with gr.Row():
                load_btn = gr.Button("Reload from file")
                save_btn = gr.Button("Save", variant="primary")
            settings_status = gr.Markdown()

            settings_cfg.change(
                fn=load_settings,
                inputs=[settings_cfg],
                outputs=field_components + [settings_status],
            )
            load_btn.click(
                fn=load_settings,
                inputs=[settings_cfg],
                outputs=field_components + [settings_status],
            )
            save_btn.click(
                fn=save_settings,
                inputs=[settings_cfg] + field_components,
                outputs=[settings_status],
            )
            demo.load(
                fn=load_settings,
                inputs=[settings_cfg],
                outputs=field_components + [settings_status],
            )

    return demo


if __name__ == "__main__":
    build_ui().launch(server_name="127.0.0.1", inbrowser=True)
