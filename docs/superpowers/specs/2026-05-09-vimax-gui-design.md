# ViMax GUI — Design

## Goal

Add a local web GUI to ViMax so users can run the `idea2video` and `script2video` pipelines and edit pipeline configs without touching Python files or YAML by hand.

## Non-goals (v1)

- Intermediate artifact previews (storyboards, per-shot images, per-scene clips).
- Run history / gallery.
- Re-running individual pipeline stages.
- Auth, multi-user, remote deployment. The app targets `localhost`.
- Concurrent runs. One run at a time per tab.

## Stack

- **Gradio** for the UI. Launched via `uv run python app.py` (or `gradio app.py` for hot-reload).
- **ruamel.yaml** to read/write configs while preserving comments and key order.
- No changes to existing pipelines or `tools/`. The GUI imports and calls them.

## File layout

```
app.py                ← Gradio UI + run orchestration (new)
utils/gui_logging.py  ← logging handler that pushes records to an asyncio.Queue (new)
configs/*.yaml        ← edited in-place by the Settings tab (existing)
pyproject.toml        ← add gradio, ruamel.yaml deps (existing)
```

## UI

Three tabs in a single Gradio Blocks app.

### Tab 1: Idea → Video

- `idea` — Textbox, ~10 rows.
- `user_requirement` — Textbox, ~3 rows.
- `style` — Textbox, single line.
- `config_path` — Dropdown over `configs/idea2video*.yaml` (defaults to `configs/idea2video.yaml`).
- `Generate` — Button. Disabled while a run is in progress on this tab.
- `logs` — Textbox, monospace, autoscroll, ~25 rows.
- `output_video` — `gr.Video` component, shown when run completes.

### Tab 2: Script → Video

Identical layout to Tab 1 except:
- `script` instead of `idea`.
- `config_path` is over `configs/script2video*.yaml`.

### Tab 3: Settings

- `config_path` — Dropdown over all four `configs/*.yaml`. Selecting a file loads its values into the form.
- Form fields, grouped:
  - **Chat model**: `model`, `model_provider`, `api_key` (password field), `base_url`, `max_requests_per_minute`, `max_requests_per_day`.
  - **Image generator**: `class_path`, `api_key`, `max_requests_per_minute`, `max_requests_per_day`.
  - **Video generator**: `class_path`, `api_key`, `max_requests_per_minute`, `max_requests_per_day`.
  - **Working dir**: `working_dir`.
- `Save` — Button. Writes the form back to the selected YAML using `ruamel.yaml` (round-trip mode) so comments and ordering survive. Shows a "Saved" toast on success, error message on failure.

Empty string in a numeric or optional field is written back as YAML `null` (matches the existing convention where `api_key:` is left blank).

## Running a pipeline

1. User clicks Generate.
2. Handler is an `async def` generator. It:
   a. Disables the Generate button and clears the log/video components.
   b. Installs a `QueueLogHandler` on the root logger (added once, idempotent).
   c. Constructs the pipeline: `Idea2VideoPipeline.init_from_config(config_path=…)` (or `Script2VideoPipeline`).
   d. Schedules `pipeline(idea=…, user_requirement=…, style=…)` (or `script=…`) as an `asyncio.Task`.
   e. Loops: drain the queue, append to an accumulating log string, `yield` the log to the textbox. When the queue is empty, `await asyncio.sleep(0.1)` and check whether the task is done. Exit the loop when the task is done AND the queue is drained.
   f. If the task raised, append the traceback to the log; do not crash the UI.
   g. On success, locate the produced video file under the pipeline's `working_dir` (most recent `.mp4` by mtime, recursive) and yield it to `output_video`.
   h. Re-enables the Generate button.

3. The same `QueueLogHandler` instance is shared across runs but each run gets its own `asyncio.Queue` set on the handler before the run starts. (Single-run-at-a-time guarantees no cross-talk.)

## Logging

`utils/gui_logging.py` exposes:

- `class QueueLogHandler(logging.Handler)` — formats records and `put_nowait`s them onto a `queue: asyncio.Queue[str]` attribute. The attribute is reassigned per run.
- `install_once()` — adds the handler to the root logger if not already attached, sets level to INFO.

The handler uses the asyncio queue's thread-safe analogue via `loop.call_soon_threadsafe(queue.put_nowait, msg)` so it works even if pipeline code logs from worker threads.

## Config editing

`load_config(path) -> CommentedMap` and `save_config(path, data)` in `app.py` (or a small helper module if it grows). Round-trip via `ruamel.yaml.YAML(typ="rt")`. Form fields read/write known dotted paths (e.g. `chat_model.init_args.model`); unknown keys in the YAML are preserved untouched.

If a config file lacks a section that the form expects, we render the field empty and create the section on save.

## Error handling

- Bad YAML on Settings load → show error message in a Markdown component, leave form empty.
- Pipeline raises → traceback appended to log textbox, no video shown, button re-enabled.
- No `.mp4` found after success → log a warning, leave video component empty.

## Dependencies to add

In `pyproject.toml`:
- `gradio` (>=4)
- `ruamel.yaml`

## Out of scope / future

- Streaming intermediate artifacts from `working_dir` into the UI.
- Remembering the last-used inputs across restarts.
- Run history with thumbnails.
- Sharing via Gradio's `share=True` link (trivial to enable later but not on by default).
