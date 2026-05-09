"""ViMax local GUI — dark cinema aesthetic, Gradio 6.

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

_yaml = YAML(typ="rt")
_yaml.preserve_quotes = True


# ── YAML helpers ─────────────────────────────────────────────────────────────

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
    if value == "":
        value = None
    cur = d
    for k in keys[:-1]:
        if k not in cur or cur[k] is None:
            cur[k] = {}
        cur = cur[k]
    cur[keys[-1]] = value

def _to_int_or_none(v: Any) -> Optional[int]:
    try:
        return int(v) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


# ── Config read/write for the inline form ────────────────────────────────────

def read_config_fields(config_path: str) -> tuple:
    """Return (chat_model, chat_api_key, image_api_key, video_api_key, working_dir, status)."""
    if not config_path:
        return ("", "", "", "", "", "")
    try:
        d = load_yaml(config_path)
        return (
            str(_get(d, "chat_model", "init_args", "model", default="")),
            str(_get(d, "chat_model", "init_args", "api_key", default="")),
            str(_get(d, "image_generator", "init_args", "api_key", default="")),
            str(_get(d, "video_generator", "init_args", "api_key", default="")),
            str(_get(d, "working_dir", default="")),
            f"Loaded: {Path(config_path).name}",
        )
    except Exception as e:
        return ("", "", "", "", "", f"Error loading config: {e}")

def write_config_fields(
    config_path: str,
    chat_model: str,
    chat_api_key: str,
    image_api_key: str,
    video_api_key: str,
    working_dir: str,
) -> str:
    if not config_path:
        return "No config selected."
    try:
        d = load_yaml(config_path) or {}
        _set(d, chat_model,    "chat_model", "init_args", "model")
        _set(d, chat_api_key,  "chat_model", "init_args", "api_key")
        _set(d, image_api_key, "image_generator", "init_args", "api_key")
        _set(d, video_api_key, "video_generator", "init_args", "api_key")
        _set(d, working_dir,   "working_dir")
        save_yaml(config_path, d)
        return f"✓ Saved to {Path(config_path).name}"
    except Exception as e:
        return f"✗ Save failed: {e}"


# ── Pipeline runner ───────────────────────────────────────────────────────────

def _find_latest_mp4(working_dir: str) -> Optional[str]:
    if not os.path.isdir(working_dir):
        return None
    mp4s = glob.glob(os.path.join(working_dir, "**", "*.mp4"), recursive=True)
    return max(mp4s, key=os.path.getmtime) if mp4s else None


def _build_extra_requirements(
    pacing: str,
    max_scenes: int,
    max_shots: int,
    characters: str = "",
    setting: str = "",
    tone_notes: str = "",
) -> str:
    pacing_map = {
        "Fast-paced": "The video should be fast-paced with snappy cuts.",
        "Medium": "",
        "Slow / Cinematic": "The video should have a slow, cinematic pace with lingering shots.",
    }
    parts = [
        f"Maximum {int(max_scenes)} scenes.",
        f"Maximum {int(max_shots)} shots per scene.",
    ]
    pacing_note = pacing_map.get(pacing, "")
    if pacing_note:
        parts.append(pacing_note)
    if characters.strip():
        parts.append(f"Characters: {characters.strip()}")
    if setting.strip():
        parts.append(f"Setting: {setting.strip()}")
    if tone_notes.strip():
        parts.append(f"Tone: {tone_notes.strip()}")
    return " ".join(parts)


# ── Genre presets ─────────────────────────────────────────────────────────────
# Each entry: (label, style, pacing, max_scenes, max_shots, voice)
_GENRE_PRESETS = {
    "👻 Horror":     (
        "Dark, moody, low-key lighting, desaturated colors, film grain, Dutch angles, unsettling atmosphere",
        "Slow / Cinematic", 8, 10, "en-GB-RyanNeural",
    ),
    "🔍 Detective":  (
        "Film noir, high contrast, dimly lit rooms, cigarette smoke, 1940s urban aesthetic, rain-slicked streets",
        "Medium", 7, 8, "en-US-GuyNeural",
    ),
    "⚡ Thriller":   (
        "Tense, dramatic lighting, sharp shadows, extreme close-ups, handheld camera feel, cold blue palette",
        "Fast-paced", 6, 10, "en-US-EricNeural",
    ),
    "🚀 Sci-Fi":     (
        "Futuristic, neon-lit corridors, volumetric lighting, epic scale, practical effects aesthetic",
        "Medium", 8, 8, "en-US-AriaNeural",
    ),
    "💛 Romance":    (
        "Warm golden hour, soft focus, shallow depth of field, intimate framing, dreamy atmosphere",
        "Slow / Cinematic", 5, 6, "en-US-JennyNeural",
    ),
    "🎥 Documentary": (
        "Realistic, natural lighting, authentic, handheld cinema vérité style, observational",
        "Medium", 6, 8, "en-GB-SoniaNeural",
    ),
}


def _build_genre_row() -> tuple:
    """Render genre preset buttons. Returns buttons in _GENRE_PRESETS order."""
    gr.Markdown("**Genre preset** — one click fills style, pacing & scene settings")
    with gr.Row():
        btns = [
            gr.Button(label, size="sm", variant="secondary", elem_classes=["genre-btn"])
            for label in _GENRE_PRESETS
        ]
    return tuple(btns)


def _build_story_context_accordion() -> tuple:
    with gr.Accordion("📖  Story Context  (optional but recommended)", open=False):
        gr.Markdown(
            "Describe your story world once — appended to every generation so characters and setting stay consistent."
        )
        characters = gr.Textbox(
            label="Main characters",
            lines=2,
            placeholder="E.g. Sarah — 30s, cynical detective. Marcus — her nervous rookie partner.",
        )
        setting = gr.Textbox(
            label="Setting / world",
            lines=2,
            placeholder="E.g. 1940s rain-drenched Chicago. Gas-lit streets. Corrupt police department.",
        )
        tone_notes = gr.Textbox(
            label="Tone & mood notes",
            lines=1,
            placeholder="E.g. Slow-burn dread. Never show the monster directly.",
        )
    return characters, setting, tone_notes


def _build_production_accordion(prefix: str) -> tuple:
    with gr.Accordion("🎞  Production Settings", open=False):
        with gr.Row():
            resolution = gr.Dropdown(
                choices=["720p", "1080p", "4K"],
                value="1080p",
                label="Resolution",
            )
            aspect_ratio = gr.Dropdown(
                choices=["16:9  (Landscape)", "9:16  (Portrait / Reels)", "1:1  (Square)"],
                value="16:9  (Landscape)",
                label="Aspect ratio",
            )
        with gr.Row():
            shot_duration = gr.Slider(minimum=5, maximum=8, value=8, step=1, label="Shot duration (seconds each)")
            pacing = gr.Dropdown(
                choices=["Fast-paced", "Medium", "Slow / Cinematic"],
                value="Medium",
                label="Pacing",
            )
        with gr.Row():
            max_scenes = gr.Slider(minimum=1, maximum=20, value=5, step=1, label="Max scenes")
            max_shots = gr.Slider(minimum=1, maximum=30, value=8, step=1, label="Max shots per scene")
    return resolution, aspect_ratio, shot_duration, pacing, max_scenes, max_shots


_EDGE_VOICES = [
    "en-US-AriaNeural",
    "en-US-GuyNeural",
    "en-US-JennyNeural",
    "en-US-EricNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
    "en-AU-NatashaNeural",
    "en-CA-ClaraNeural",
]
_OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]


def _build_narration_accordion(prefix: str) -> tuple:
    with gr.Accordion("🎙  Narration & Audio", open=True):
        with gr.Row():
            enable_narration = gr.Checkbox(label="Add AI narration", value=False)
            enable_subtitles = gr.Checkbox(label="Burn subtitles", value=False)
        tts_engine = gr.Dropdown(
            choices=["Edge TTS (free)", "OpenAI TTS"],
            value="Edge TTS (free)",
            label="TTS engine",
        )
        voice = gr.Dropdown(
            choices=_EDGE_VOICES,
            value=_EDGE_VOICES[0],
            label="Narrator voice",
        )
        narration_key = gr.Textbox(
            label="OpenAI API key for TTS/Whisper  (Edge TTS doesn't need this)",
            type="password",
            placeholder="sk-... (only needed for OpenAI TTS or Whisper subtitles)",
        )
        music_file = gr.File(
            label="Background music  (MP3 / WAV, optional)",
            file_types=[".mp3", ".wav"],
        )
        music_volume = gr.Slider(minimum=0.0, maximum=1.0, value=0.25, step=0.05, label="Music volume")

        def _swap_voices(engine: str):
            if engine == "OpenAI TTS":
                return gr.Dropdown(choices=_OPENAI_VOICES, value=_OPENAI_VOICES[0])
            return gr.Dropdown(choices=_EDGE_VOICES, value=_EDGE_VOICES[0])

        tts_engine.change(fn=_swap_voices, inputs=[tts_engine], outputs=[voice])

    return enable_narration, tts_engine, voice, enable_subtitles, music_file, music_volume, narration_key


async def _run_pipeline(
    kind: str,
    config_path: str,
    text_input: str,
    user_requirement: str,
    style: str,
    chat_model: str,
    chat_api_key: str,
    image_api_key: str,
    video_api_key: str,
    resolution: str = "1080p",
    aspect_ratio: str = "16:9",
    shot_duration: int = 8,
    enable_narration: bool = False,
    tts_engine: str = "edge",
    voice: str = "en-US-AriaNeural",
    enable_subtitles: bool = False,
    music_path: Optional[str] = None,
    music_volume: float = 0.25,
    narration_api_key: str = "",
) -> AsyncGenerator:
    # Save API keys / model into the config before running
    if config_path:
        try:
            d = load_yaml(config_path) or {}
            if chat_model:    _set(d, chat_model,    "chat_model", "init_args", "model")
            if chat_api_key:  _set(d, chat_api_key,  "chat_model", "init_args", "api_key")
            if image_api_key: _set(d, image_api_key, "image_generator", "init_args", "api_key")
            if video_api_key: _set(d, video_api_key, "video_generator", "init_args", "api_key")
            save_yaml(config_path, d)
        except Exception:
            pass

    handler = install_once()
    queue: asyncio.Queue[str] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    handler.attach(queue, loop)
    log_lines: list[str] = []

    def logs() -> str:
        return "\n".join(log_lines)

    log_lines.append(f"▶ Starting {kind}  [{Path(config_path).name if config_path else 'no config'}]")
    yield logs(), None, gr.Button(interactive=False, value="⏳ Generating…")

    try:
        if kind == "idea2video":
            from pipelines.idea2video_pipeline import Idea2VideoPipeline
            pl = Idea2VideoPipeline.init_from_config(config_path=config_path)
            coro = pl(
                idea=text_input,
                user_requirement=user_requirement,
                style=style,
                resolution=resolution,
                aspect_ratio=aspect_ratio,
                shot_duration=shot_duration,
            )
        else:
            from pipelines.script2video_pipeline import Script2VideoPipeline
            pl = Script2VideoPipeline.init_from_config(config_path=config_path)
            coro = pl(
                script=text_input,
                user_requirement=user_requirement,
                style=style,
                resolution=resolution,
                aspect_ratio=aspect_ratio,
                shot_duration=shot_duration,
            )
    except Exception:
        log_lines.append("✗ Failed to build pipeline:\n" + traceback.format_exc())
        handler.detach()
        yield logs(), None, gr.Button(interactive=True, value="🎬 Generate")
        return

    working_dir: Optional[str] = None
    try:
        working_dir = _get(load_yaml(config_path), "working_dir", default=None) or None
    except Exception:
        pass

    task = asyncio.create_task(coro)

    while True:
        changed = False
        try:
            while True:
                log_lines.append(queue.get_nowait())
                changed = True
        except asyncio.QueueEmpty:
            pass
        if changed:
            yield logs(), None, gr.Button(interactive=False, value="⏳ Generating…")
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
        log_lines.append("✗ Pipeline error:\n" + "".join(
            traceback.format_exception(type(exc), exc, exc.__traceback__)))
        handler.detach()
        yield logs(), None, gr.Button(interactive=True, value="🎬 Generate")
        return

    raw_mp4 = task.result() if not task.exception() else None
    if not raw_mp4:
        raw_mp4 = _find_latest_mp4(working_dir) if working_dir else None

    if raw_mp4 and (enable_narration or enable_subtitles or music_path):
        from tools.postprocessor import PostProcessor
        log_lines.append("[gui] Running post-processing (narration / subtitles / music)...")
        yield logs(), None, gr.Button(interactive=False, value="⏳ Post-processing...")
        engine_key = "edge" if tts_engine.startswith("Edge") else "openai"
        pp = PostProcessor(openai_api_key=narration_api_key or chat_api_key)
        final_mp4 = await pp.process(
            video_path=raw_mp4,
            idea_or_script=text_input,
            style=style,
            enable_narration=enable_narration,
            voice=voice,
            tts_engine=engine_key,
            enable_subtitles=enable_subtitles,
            music_path=music_path,
            music_volume=music_volume,
        )
    else:
        final_mp4 = raw_mp4

    log_lines.append(f"✓ Done!{f'  Video → {final_mp4}' if final_mp4 else '  (no .mp4 found)'}")
    handler.detach()
    yield logs(), final_mp4, gr.Button(interactive=True, value="🎬 Generate")


async def run_idea2video(
    cfg, idea, req, style,
    model, chat_key, img_key, vid_key,
    characters, setting, tone_notes,
    resolution, aspect_ratio, shot_duration, pacing, max_scenes, max_shots,
    enable_narration, tts_engine, voice, enable_subtitles, music_file, music_volume, narration_key,
):
    resolution_val = resolution.split()[0]
    aspect_ratio_val = aspect_ratio.split()[0]
    extra_req = _build_extra_requirements(pacing, max_scenes, max_shots, characters, setting, tone_notes)
    full_req = f"{req}\n{extra_req}".strip() if req else extra_req
    async for chunk in _run_pipeline(
        "idea2video", cfg, idea, full_req, style,
        model, chat_key, img_key, vid_key,
        resolution_val, aspect_ratio_val, int(shot_duration),
        enable_narration, tts_engine, voice, enable_subtitles,
        music_file.name if music_file else None,
        music_volume,
        narration_key or chat_key,
    ):
        yield chunk


async def run_script2video(
    cfg, script, req, style,
    model, chat_key, img_key, vid_key,
    characters, setting, tone_notes,
    resolution, aspect_ratio, shot_duration, pacing, max_scenes, max_shots,
    enable_narration, tts_engine, voice, enable_subtitles, music_file, music_volume, narration_key,
):
    resolution_val = resolution.split()[0]
    aspect_ratio_val = aspect_ratio.split()[0]
    extra_req = _build_extra_requirements(pacing, max_scenes, max_shots, characters, setting, tone_notes)
    full_req = f"{req}\n{extra_req}".strip() if req else extra_req
    async for chunk in _run_pipeline(
        "script2video", cfg, script, full_req, style,
        model, chat_key, img_key, vid_key,
        resolution_val, aspect_ratio_val, int(shot_duration),
        enable_narration, tts_engine, voice, enable_subtitles,
        music_file.name if music_file else None,
        music_volume,
        narration_key or chat_key,
    ):
        yield chunk


# ── CSS ───────────────────────────────────────────────────────────────────────

FONTS = """
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
"""

CSS = """
/* ── Base ── */
*, *::before, *::after { box-sizing: border-box; }

body, .gradio-container {
    background: #f5f7fa !important;
    font-family: 'Inter', system-ui, sans-serif !important;
    color: #111827 !important;
}

.gradio-container { max-width: 1400px !important; margin: 0 auto !important; padding: 0 1.5rem !important; }

/* ── Header ── */
#vimax-header {
    text-align: center;
    padding: 2rem 0 1.25rem;
    border-bottom: 2px solid #e5e7eb;
    margin-bottom: 1.5rem;
}
#vimax-header h1 {
    font-family: 'Inter', sans-serif !important;
    font-size: 2.2rem !important;
    font-weight: 700 !important;
    letter-spacing: -0.02em !important;
    color: #1e40af !important;
    margin: 0 !important;
    padding: 0 !important;
}
#vimax-header p {
    color: #6b7280 !important;
    font-size: 0.8rem !important;
    letter-spacing: 0.15em !important;
    text-transform: uppercase !important;
    margin-top: 0.35rem !important;
    font-weight: 500 !important;
}

/* ── Panels ── */
.left-panel, .right-panel {
    background: #ffffff !important;
    border: 1px solid #e5e7eb !important;
    border-radius: 12px !important;
    padding: 1.5rem !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06) !important;
}

/* ── Labels ── */
label span, .block label span {
    font-size: 0.78rem !important;
    font-weight: 600 !important;
    color: #374151 !important;
    letter-spacing: 0.01em !important;
}

/* ── Inputs & textareas ── */
textarea, input[type="text"], input[type="password"] {
    background: #ffffff !important;
    border: 1px solid #d1d5db !important;
    border-radius: 8px !important;
    color: #111827 !important;
    font-size: 0.9rem !important;
    transition: border-color 0.15s, box-shadow 0.15s !important;
}
textarea:focus, input[type="text"]:focus, input[type="password"]:focus {
    border-color: #3b82f6 !important;
    outline: none !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15) !important;
}

/* ── Log output — monospace dark-on-light ── */
#idea-logs textarea, #script-logs textarea {
    font-family: 'JetBrains Mono', monospace !important;
    font-size: 0.78rem !important;
    line-height: 1.65 !important;
    color: #1f2937 !important;
    background: #f9fafb !important;
    border-color: #e5e7eb !important;
}

/* ── Generate button — blue, prominent ── */
#idea-generate-btn, #script-generate-btn {
    background: #1d4ed8 !important;
    border: none !important;
    border-radius: 8px !important;
    color: #ffffff !important;
    font-size: 0.95rem !important;
    font-weight: 600 !important;
    padding: 0.75rem 1.5rem !important;
    width: 100% !important;
    cursor: pointer !important;
    transition: background 0.15s, transform 0.1s, box-shadow 0.15s !important;
    margin-top: 0.5rem !important;
    box-shadow: 0 2px 8px rgba(29, 78, 216, 0.3) !important;
    letter-spacing: 0.01em !important;
}
#idea-generate-btn:hover:not(:disabled), #script-generate-btn:hover:not(:disabled) {
    background: #1e40af !important;
    transform: translateY(-1px) !important;
    box-shadow: 0 4px 12px rgba(29, 78, 216, 0.4) !important;
}
#idea-generate-btn:disabled, #script-generate-btn:disabled {
    background: #93c5fd !important;
    cursor: not-allowed !important;
    transform: none !important;
    box-shadow: none !important;
}

/* ── Save config button — subtle grey ── */
#idea-save-btn, #script-save-btn {
    background: #f3f4f6 !important;
    border: 1px solid #d1d5db !important;
    border-radius: 6px !important;
    color: #374151 !important;
    font-size: 0.8rem !important;
    font-weight: 500 !important;
    padding: 0.45rem 0.9rem !important;
    cursor: pointer !important;
    transition: background 0.15s, border-color 0.15s !important;
}
#idea-save-btn:hover, #script-save-btn:hover {
    background: #e5e7eb !important;
    border-color: #9ca3af !important;
}

/* ── Genre preset buttons ── */
.genre-btn button {
    font-size: 0.78rem !important;
    font-weight: 600 !important;
    padding: 0.35rem 0.6rem !important;
    border-radius: 20px !important;
    border: 1.5px solid #d1d5db !important;
    background: #f9fafb !important;
    color: #374151 !important;
    cursor: pointer !important;
    transition: background 0.12s, border-color 0.12s, transform 0.1s !important;
    white-space: nowrap !important;
}
.genre-btn button:hover {
    background: #eff6ff !important;
    border-color: #3b82f6 !important;
    color: #1d4ed8 !important;
    transform: translateY(-1px) !important;
}

/* ── Video player ── */
video { border-radius: 8px !important; border: 1px solid #e5e7eb !important; }

/* ── Scrollbars ── */
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: #f1f5f9; }
::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
"""


# ── UI builder ───────────────────────────────────────────────────────────────

def _config_accordion(prefix: str, configs: list[str]) -> tuple:
    """Returns (cfg_dd, chat_model, chat_key, img_key, vid_key, save_btn, status_md)."""
    with gr.Accordion("⚙  Model & API Keys", open=True):
        cfg_dd = gr.Dropdown(
            choices=configs,
            value=configs[0] if configs else None,
            label="Config preset",
        )
        chat_model = gr.Textbox(
            label="Chat model name",
            placeholder="e.g. google/gemini-2.5-flash-lite-preview-09-2025",
        )
        with gr.Row():
            chat_key = gr.Textbox(label="Chat API key", type="password", placeholder="sk-…")
        with gr.Row():
            img_key = gr.Textbox(label="Image generator API key", type="password", placeholder="API key")
            vid_key = gr.Textbox(label="Video generator API key", type="password", placeholder="API key")
        with gr.Row():
            save_btn = gr.Button("Save to config file", elem_id=f"{prefix}-save-btn", scale=1)
            save_status = gr.Markdown(elem_id=f"{prefix}-status")

    return cfg_dd, chat_model, chat_key, img_key, vid_key, save_btn, save_status


def _wire_genre_buttons(btns, style_box, pacing_dd, max_scenes_sl, max_shots_sl, voice_dd):
    """Attach click handlers for all genre preset buttons."""
    for btn, (label, preset_style, preset_pacing, preset_scenes, preset_shots, preset_voice) in zip(
        btns, _GENRE_PRESETS.values()
    ):
        # capture loop variables
        def _make_handler(s, p, sc, sh, v):
            def _handler():
                return (
                    gr.Textbox(value=s),
                    gr.Dropdown(value=p),
                    gr.Slider(value=sc),
                    gr.Slider(value=sh),
                    gr.Dropdown(value=v),
                )
            return _handler
        btn.click(
            fn=_make_handler(preset_style, preset_pacing, preset_scenes, preset_shots, preset_voice),
            inputs=[],
            outputs=[style_box, pacing_dd, max_scenes_sl, max_shots_sl, voice_dd],
        )


def build_ui() -> gr.Blocks:
    with gr.Blocks(title="ViMax") as demo:
        # Header
        with gr.Column(elem_id="vimax-header"):
            gr.HTML("<h1>ViMax</h1><p>Agentic AI Video Generation</p>")

        # State for working_dir from config
        working_dir_state = gr.State("")

        # ── Tab: Idea → Video ─────────────────────────────────────────────
        with gr.Tab("🎬  Idea → Video"):
            with gr.Row(equal_height=False):
                # Left: inputs + config
                with gr.Column(scale=1, min_width=380, elem_classes=["left-panel"]):
                    idea_genre_btns = _build_genre_row()
                    gr.Markdown("### Your idea")
                    idea_txt = gr.Textbox(
                        label="",
                        lines=7,
                        placeholder="Describe the video you want to create…\n\nE.g. A detective finds a cryptic note in a dead man's coat pocket on a rainy Chicago night in 1947.",
                    )
                    idea_chars, idea_setting, idea_tone = _build_story_context_accordion()
                    idea_req = gr.Textbox(
                        label="Extra requirements  (optional)",
                        lines=2,
                        placeholder="E.g. End on a cliffhanger. Don't reveal the killer's face.",
                    )
                    idea_style = gr.Textbox(
                        label="Visual style",
                        placeholder="E.g. Cinematic, realistic, golden hour lighting",
                    )
                    idea_res, idea_ar, idea_dur, idea_pacing, idea_max_scenes, idea_max_shots = \
                        _build_production_accordion("idea")
                    idea_narr, idea_tts, idea_voice, idea_subs, idea_music, idea_mvol, idea_nkey = \
                        _build_narration_accordion("idea")
                    gr.HTML("<hr style='border-color:#e5e7eb;margin:1rem 0'>")
                    (idea_cfg, idea_model, idea_chat_key,
                     idea_img_key, idea_vid_key,
                     idea_save_btn, idea_save_status) = _config_accordion("idea", IDEA_CONFIGS)

                    idea_btn = gr.Button(
                        "🎬  Generate Video",
                        variant="primary",
                        elem_id="idea-generate-btn",
                    )

                # Right: logs + output
                with gr.Column(scale=1, min_width=380, elem_classes=["right-panel"]):
                    gr.Markdown("### Output")
                    idea_video = gr.Video(label="", show_label=False)
                    idea_logs = gr.Textbox(
                        label="Pipeline log",
                        lines=16,
                        elem_id="idea-logs",
                        interactive=False,
                    )

            _wire_genre_buttons(idea_genre_btns, idea_style, idea_pacing, idea_max_scenes, idea_max_shots, idea_voice)

            # Wire up config load on dropdown change
            idea_cfg.change(
                fn=read_config_fields,
                inputs=[idea_cfg],
                outputs=[idea_model, idea_chat_key, idea_img_key, idea_vid_key,
                         working_dir_state, idea_save_status],
            )
            idea_save_btn.click(
                fn=write_config_fields,
                inputs=[idea_cfg, idea_model, idea_chat_key, idea_img_key, idea_vid_key,
                        working_dir_state],
                outputs=[idea_save_status],
            )
            idea_btn.click(
                fn=run_idea2video,
                inputs=[
                    idea_cfg, idea_txt, idea_req, idea_style,
                    idea_model, idea_chat_key, idea_img_key, idea_vid_key,
                    idea_chars, idea_setting, idea_tone,
                    idea_res, idea_ar, idea_dur, idea_pacing, idea_max_scenes, idea_max_shots,
                    idea_narr, idea_tts, idea_voice, idea_subs, idea_music, idea_mvol, idea_nkey,
                ],
                outputs=[idea_logs, idea_video, idea_btn],
            )
            # Pre-load config fields when page opens
            demo.load(
                fn=read_config_fields,
                inputs=[idea_cfg],
                outputs=[idea_model, idea_chat_key, idea_img_key, idea_vid_key,
                         working_dir_state, idea_save_status],
            )

        # ── Tab: Script → Video ───────────────────────────────────────────
        with gr.Tab("📄  Script → Video"):
            with gr.Row(equal_height=False):
                with gr.Column(scale=1, min_width=380, elem_classes=["left-panel"]):
                    script_genre_btns = _build_genre_row()
                    gr.Markdown("### Your script")
                    script_txt = gr.Textbox(
                        label="",
                        lines=10,
                        placeholder="EXT. LOCATION — DAY\n\nPaste or write your screenplay here.\nCharacter dialogue, scene descriptions, action lines…",
                    )
                    script_chars, script_setting, script_tone = _build_story_context_accordion()
                    script_req = gr.Textbox(
                        label="Extra requirements  (optional)",
                        lines=2,
                        placeholder="E.g. Fast-paced, no more than 15 shots.",
                    )
                    script_style = gr.Textbox(
                        label="Visual style",
                        placeholder="E.g. Anime, noir, 8mm film grain",
                    )
                    script_res, script_ar, script_dur, script_pacing, script_max_scenes, script_max_shots = \
                        _build_production_accordion("script")
                    script_narr, script_tts, script_voice, script_subs, script_music, script_mvol, script_nkey = \
                        _build_narration_accordion("script")
                    gr.HTML("<hr style='border-color:#e5e7eb;margin:1rem 0'>")
                    (script_cfg, script_model, script_chat_key,
                     script_img_key, script_vid_key,
                     script_save_btn, script_save_status) = _config_accordion("script", SCRIPT_CONFIGS)

                    script_btn = gr.Button(
                        "🎬  Generate Video",
                        variant="primary",
                        elem_id="script-generate-btn",
                    )

                with gr.Column(scale=1, min_width=380, elem_classes=["right-panel"]):
                    gr.Markdown("### Output")
                    script_video = gr.Video(label="", show_label=False)
                    script_logs = gr.Textbox(
                        label="Pipeline log",
                        lines=16,
                        elem_id="script-logs",
                        interactive=False,
                    )

            _wire_genre_buttons(script_genre_btns, script_style, script_pacing, script_max_scenes, script_max_shots, script_voice)

            script_cfg.change(
                fn=read_config_fields,
                inputs=[script_cfg],
                outputs=[script_model, script_chat_key, script_img_key, script_vid_key,
                         working_dir_state, script_save_status],
            )
            script_save_btn.click(
                fn=write_config_fields,
                inputs=[script_cfg, script_model, script_chat_key, script_img_key, script_vid_key,
                        working_dir_state],
                outputs=[script_save_status],
            )
            script_btn.click(
                fn=run_script2video,
                inputs=[
                    script_cfg, script_txt, script_req, script_style,
                    script_model, script_chat_key, script_img_key, script_vid_key,
                    script_chars, script_setting, script_tone,
                    script_res, script_ar, script_dur, script_pacing, script_max_scenes, script_max_shots,
                    script_narr, script_tts, script_voice, script_subs, script_music, script_mvol, script_nkey,
                ],
                outputs=[script_logs, script_video, script_btn],
            )
            demo.load(
                fn=read_config_fields,
                inputs=[script_cfg],
                outputs=[script_model, script_chat_key, script_img_key, script_vid_key,
                         working_dir_state, script_save_status],
            )

    return demo


if __name__ == "__main__":
    build_ui().queue().launch(server_name="127.0.0.1", inbrowser=True, css=CSS, head=FONTS)
