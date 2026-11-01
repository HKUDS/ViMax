"""Concat job handler — merges multiple video clips using ffmpeg."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from vimax_image_worker.asset_downloader import download_objects
from vimax_image_worker.asset_uploader import upload_file
from vimax_image_worker.reporter import JobReporter
from vimax_image_worker.worker_retry import retry_backoff_seconds, should_retry

logger = logging.getLogger(__name__)


class ConcatJobInput(BaseModel):
    storage_keys: list[str]
    # Per-clip subtitle text aligned with storage_keys (null = skip that clip).
    # Present only when the concat node opts into burning subtitles.
    subtitles: list[str | None] | None = None


class ConcatJobCallback(BaseModel):
    event_channel: str
    upload_bucket: str
    upload_prefix: str


class ConcatJobPayload(BaseModel):
    job_id: str
    job_type: str
    input: ConcatJobInput
    callback: ConcatJobCallback
    cache_key: str
    timeout_ms: int = Field(default=120_000)
    attempt: int = 0


def _check_ffmpeg() -> bool:
    """Check if ffmpeg is available on the system."""
    return shutil.which("ffmpeg") is not None


def _probe_duration(path: Path) -> float:
    """Return the clip's real duration in seconds via ffprobe."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed on {path.name}: {result.stderr}")
    return float(result.stdout.strip())


def _format_srt_time(total_sec: float) -> str:
    ms = max(0, int(round(total_sec * 1000)))
    hours, rest = divmod(ms, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    seconds, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def _build_srt(subtitles: list[str | None], durations: list[float]) -> str:
    """Cue per clip: [clip start, clip start + min(clip duration, 8s)] so the
    text stays readable without spilling across shots."""
    lines: list[str] = []
    cursor = 0.0
    index = 1
    for text, duration in zip(subtitles, durations):
        if text and text.strip():
            end = cursor + min(duration, 8.0)
            lines.append(
                f"{index}\n{_format_srt_time(cursor)} --> {_format_srt_time(end)}\n{text.strip()}"
            )
            index += 1
        cursor += duration
    return "\n\n".join(lines) + "\n"


def _concat_videos(input_paths: list[Path], output_path: Path) -> None:
    """Concatenate videos using ffmpeg concat demuxer."""
    # Write concat file list
    concat_list = output_path.parent / "concat_list.txt"
    with open(concat_list, "w") as f:
        for p in input_paths:
            f.write(f"file '{Path(p).as_posix()}'\n")

    cmd = [
        "ffmpeg",
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(concat_list),
        "-c", "copy",
        str(output_path),
    ]
    logger.info("Running: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed: {result.stderr}")


def _burn_subtitles(input_path: Path, srt_path: Path, output_path: Path) -> None:
    """Re-encode once with the subtitles filter (libass). CJK rendering needs
    a CJK font in the image — fonts-noto-cjk is installed in the Dockerfile,
    or point SUBTITLE_FONT at a font family fontconfig knows."""
    font = os.environ.get("SUBTITLE_FONT", "Noto Sans CJK SC")
    style = f"FontName={font},FontSize=16,Outline=1,MarginV=28,Alignment=2"
    filter_arg = f"subtitles={srt_path.as_posix()}:force_style='{style}'"
    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-vf", filter_arg,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "copy", "-movflags", "+faststart",
        str(output_path),
    ]
    logger.info("Burning subtitles: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg subtitle burn failed: {result.stderr}")


async def _run_concat(payload: ConcatJobPayload, redis_client) -> None:
    reporter = JobReporter(redis_client, payload.callback.event_channel, payload.job_id)
    await reporter.started()

    if not _check_ffmpeg():
        raise RuntimeError("ffmpeg not found on system PATH")

    workdir = Path(tempfile.mkdtemp(prefix=f"vimax-concat-{payload.job_id}-"))
    try:
        storage_keys = payload.input.storage_keys
        if len(storage_keys) < 2:
            raise ValueError("Need at least 2 video clips to concatenate")

        await reporter.progress(10, f"Downloading {len(storage_keys)} video clips")

        # Download all videos
        local_paths = download_objects(
            storage_keys,
            workdir,
            bucket=payload.callback.upload_bucket,
        )

        subtitles = payload.input.subtitles
        output_path = workdir / f"{payload.job_id}_merged.mp4"
        if subtitles and any(text and text.strip() for text in subtitles):
            await reporter.progress(30, "Building subtitle track")
            durations = [await asyncio.to_thread(_probe_duration, p) for p in local_paths]
            srt_path = workdir / "subtitles.srt"
            srt_path.write_text(
                _build_srt(subtitles, durations), encoding="utf-8"
            )
            await reporter.progress(40, "Concatenating + burning subtitles")
            burned_path = workdir / f"{payload.job_id}_subtitled.mp4"
            await asyncio.to_thread(_concat_videos, local_paths, output_path)
            await asyncio.to_thread(_burn_subtitles, output_path, srt_path, burned_path)
            output_path = burned_path
        else:
            await reporter.progress(40, "Concatenating videos with ffmpeg")
            await asyncio.to_thread(_concat_videos, local_paths, output_path)

        await reporter.progress(80, "Uploading merged video")

        meta = upload_file(
            output_path,
            bucket=payload.callback.upload_bucket,
            prefix=payload.callback.upload_prefix,
        )

        await reporter.completed(
            {
                "storage_key": meta["storage_key"],
                "width": meta["width"],
                "height": meta["height"],
                "sha256": meta["sha256"],
                "mime_type": meta["mime_type"],
                "size_bytes": meta["size_bytes"],
            }
        )
    except Exception as exc:
        logger.exception("Concat job %s failed", payload.job_id)
        message = str(exc).lower()
        retryable = isinstance(exc, (TimeoutError, ConnectionError)) or any(
            token in message for token in ("timeout", "temporarily", "connection reset", "503", "502", "504")
        )
        if should_retry(payload.attempt, retryable):
            delay = retry_backoff_seconds(payload.attempt)
            await asyncio.sleep(delay)
            retry_payload = payload.model_copy(update={"attempt": payload.attempt + 1})
            reporter.requeue("vimax:queue:q.concat.std", retry_payload.model_dump(mode="json"))
            return
        await reporter.failed(
            error_code="concat.failed",
            error_message=str(exc),
            retryable=retryable,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def handle_concat_job(raw: dict[str, Any], redis_client) -> None:
    payload = ConcatJobPayload.model_validate(raw)
    asyncio.run(_run_concat(payload, redis_client))
