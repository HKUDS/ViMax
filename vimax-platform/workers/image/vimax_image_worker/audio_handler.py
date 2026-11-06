"""Audio worker handler — dispatches by job_type.

- audio.tts:      real voiceover synthesis via a TTS generator (tools.TtsGeneratorOpenAIAPI)
- audio.generate: MVP stub that returns a silent WAV (音效/配乐占位)
"""
import importlib
import inspect
import logging
import shutil
import struct
import tempfile
from pathlib import Path
from typing import Any

from vimax_image_worker.reporter import JobReporter
from vimax_image_worker.asset_uploader import upload_file

log = logging.getLogger("audio-handler")


def _generate_silent_wav(duration_sec: int = 3, sample_rate: int = 44100) -> bytes:
    """Generate a silent WAV file."""
    num_samples = duration_sec * sample_rate
    data_size = num_samples * 2  # 16-bit mono
    header = b'RIFF'
    header += (36 + data_size).to_bytes(4, 'little')
    header += b'WAVE'
    header += b'fmt '
    header += (16).to_bytes(4, 'little')
    header += struct.pack('<H', 1)  # PCM
    header += struct.pack('<H', 1)  # mono
    header += struct.pack('<I', sample_rate)
    header += struct.pack('<I', sample_rate * 2)  # byte rate
    header += struct.pack('<H', 2)  # block align
    header += struct.pack('<H', 16)  # bits per sample
    header += b'data'
    header += data_size.to_bytes(4, 'little')

    samples = b'\x00\x00' * num_samples
    return header + samples


def _build_tts_generator(credential: dict[str, Any]):
    """Dynamic-import a TTS generator from its class_path (same contract as
    image/video generators: api_key + optional base_url/model)."""
    class_path = credential.get("class_path") or "tools.TtsGeneratorOpenAIAPI"
    module_path, cls_name = class_path.rsplit(".", 1)
    cls = getattr(importlib.import_module(module_path), cls_name)
    candidates: dict[str, Any] = {"api_key": credential.get("api_key")}
    if credential.get("base_url"):
        candidates["base_url"] = credential["base_url"]
    if credential.get("model"):
        candidates["model"] = credential["model"]
    # Generators own their parameter surface; only pass kwargs they accept.
    accepted = inspect.signature(cls.__init__).parameters
    init_args = {k: v for k, v in candidates.items() if k in accepted}
    return cls(**init_args)


async def _run_tts(payload: dict, reporter: JobReporter) -> None:
    text = (payload["input"].get("text") or payload["input"].get("prompt") or "").strip()
    if not text:
        raise ValueError("TTS input text is empty")

    credential = payload.get("credential") or {}
    api_key = (credential.get("api_key") or "").strip()
    if not api_key:
        raise ValueError(
            "Missing TTS api_key in job credential; configure a TTS model in Settings > Models"
        )

    await reporter.progress(20, "Loading TTS generator")
    generator = _build_tts_generator(credential)
    generator.voice = payload["input"].get("voice") or getattr(generator, "voice", "alloy")

    callback = payload["callback"]
    workdir = Path(tempfile.mkdtemp(prefix=f"vimax-tts-{payload['job_id']}-"))
    local_path = workdir / f"{payload['job_id']}.mp3"
    try:
        await reporter.progress(50, "Synthesizing voiceover")
        await generator.synthesize(text, str(local_path))

        await reporter.progress(80, "Uploading audio")
        meta = upload_file(local_path, bucket=callback["upload_bucket"], prefix=callback["upload_prefix"])
        await reporter.completed({
            "storage_key": meta["storage_key"],
            "width": 0,
            "height": 0,
            "sha256": meta["sha256"],
            "mime_type": meta["mime_type"] or "audio/mpeg",
            "size_bytes": meta["size_bytes"],
        })
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def _run_silent_stub(payload: dict, reporter: JobReporter) -> None:
    """音效/配乐 MVP：静音占位，保持既有行为。"""
    duration = payload["input"].get("duration_sec", 3)
    callback = payload["callback"]

    wav_data = _generate_silent_wav(duration)
    workdir = tempfile.mkdtemp(prefix=f"vimax-audio-{payload['job_id']}-")
    local_path = Path(workdir) / f"{payload['job_id']}.wav"
    with open(local_path, "wb") as f:
        f.write(wav_data)

    meta = upload_file(local_path, bucket=callback["upload_bucket"], prefix=callback["upload_prefix"])
    local_path.unlink()
    Path(workdir).rmdir()

    await reporter.completed({
        "storage_key": meta["storage_key"],
        "width": 0,
        "height": 0,
        "sha256": meta["sha256"],
        "mime_type": "audio/wav",
        "size_bytes": meta["size_bytes"],
        "duration_sec": duration,
    })


async def handle_audio_job(payload: dict, reporter: JobReporter):
    """Dispatch an audio job by job_type."""
    await reporter.started()

    job_type = payload.get("job_type", "audio.generate")
    try:
        if job_type == "audio.tts":
            await _run_tts(payload, reporter)
        else:
            await _run_silent_stub(payload, reporter)
    except Exception as e:
        log.exception("Audio job %s failed", payload.get("job_id"))
        await reporter.failed(error_code="worker.internal", error_message=str(e), retryable=False)
