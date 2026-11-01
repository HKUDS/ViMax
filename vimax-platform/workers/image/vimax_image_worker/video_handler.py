"""Video job handler — bridges queue payload to ViMax VideoGenerator."""

from __future__ import annotations

import asyncio
import importlib
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel, Field

from vimax_image_worker.asset_downloader import download_objects
from vimax_image_worker.asset_uploader import upload_file
from vimax_image_worker.reporter import JobReporter
from vimax_image_worker.worker_retry import retry_backoff_seconds, should_retry

logger = logging.getLogger(__name__)


class VideoJobCredential(BaseModel):
    class_path: str
    api_key: str
    base_url: str | None = None
    model: str | None = None
    label: str | None = None


class VideoJobInput(BaseModel):
    prompt: str
    first_frame_storage_key: str | None = None
    last_frame_storage_key: str | None = None
    duration_sec: int | None = None
    resolution: str | None = None
    aspect_ratio: str | None = None
    fps: int | None = None


class VideoJobCallback(BaseModel):
    event_channel: str
    upload_bucket: str
    upload_prefix: str


class VideoJobPayload(BaseModel):
    job_id: str
    job_type: str
    model_id: str
    credential: VideoJobCredential
    fallback_credentials: list[VideoJobCredential] = Field(default_factory=list)
    input: VideoJobInput
    callback: VideoJobCallback
    cache_key: str
    timeout_ms: int = Field(default=300_000)
    attempt: int = 0


def _build_video_generator(credential: VideoJobCredential):
    """Dynamically instantiate a VideoGenerator from class_path."""
    module_path, cls_name = credential.class_path.rsplit(".", 1)
    cls = getattr(importlib.import_module(module_path), cls_name)
    init_args: dict[str, Any] = {"api_key": credential.api_key}
    if credential.base_url:
        init_args["base_url"] = credential.base_url
    if credential.model:
        init_args["model"] = credential.model
    return cls(**init_args)


def _map_error(exc: Exception) -> tuple[str, str, bool]:
    message = str(exc).lower()
    if "rate" in message and "limit" in message:
        return "provider.rate_limited", str(exc), True
    # 免费档拥堵（Agnes 返回 queue full）与配额尽（余额 0）都按容量类
    # 处理：可重试且应切换备用模型。
    if "queue" in message or "quota" in message:
        return "provider.rate_limited", str(exc), True
    if "401" in message or "unauthorized" in message or "api key" in message:
        return "provider.invalid_api_key", str(exc), False
    if "timeout" in message:
        return "provider.timeout", str(exc), True
    return "worker.internal", str(exc), True


async def _run_video(payload: VideoJobPayload, redis_client) -> None:
    reporter = JobReporter(redis_client, payload.callback.event_channel, payload.job_id)
    await reporter.started()

    workdir = Path(tempfile.mkdtemp(prefix=f"vimax-video-{payload.job_id}-"))
    try:
        # Collect reference storage keys (first frame, last frame)
        ref_keys: list[str] = []
        if payload.input.first_frame_storage_key:
            ref_keys.append(payload.input.first_frame_storage_key)
        if payload.input.last_frame_storage_key:
            ref_keys.append(payload.input.last_frame_storage_key)

        ref_paths = download_objects(
            ref_keys,
            workdir,
            bucket=payload.callback.upload_bucket,
        )
        await reporter.progress(15, "Reference images downloaded")

        # Build prompt with motion context
        prompt = payload.input.prompt or "cinematic video, smooth motion"
        duration = payload.input.duration_sec or 5
        resolution = payload.input.resolution or "720p"
        aspect_ratio = payload.input.aspect_ratio or "16:9"
        fps = payload.input.fps or 16

        await reporter.progress(25, "Loading video generator")

        # 主模型 + 备用链：容量类失败（拥堵/限流/超时）依次降级尝试
        candidates = [payload.credential, *payload.fallback_credentials]
        output = None
        for idx, cred in enumerate(candidates):
            label = cred.label or cred.model or cred.class_path.rsplit(".", 1)[-1]
            await reporter.progress(
                35, f"Generating video ({duration}s, {resolution}, {aspect_ratio}) via {label}"
            )
            try:
                generator = _build_video_generator(cred)
                output = await generator.generate_single_video(
                    prompt=prompt,
                    reference_image_paths=ref_paths,
                    duration=duration,
                    resolution=resolution,
                    aspect_ratio=aspect_ratio,
                    fps=fps,
                )
                break
            except Exception as exc:
                code, message, _ = _map_error(exc)
                capacity = (
                    code in ("provider.rate_limited", "provider.timeout")
                    or "1305" in message
                    or "访问量过大" in message
                )
                if not capacity or idx == len(candidates) - 1:
                    raise
                logger.warning(
                    "Video job %s: model %s capacity-limited (%s), switching to fallback",
                    payload.job_id, label, message[:80],
                )
                await reporter.progress(
                    40, f"模型 {label} 容量不足，切换备用模型重试",
                )

        await reporter.progress(70, "Downloading video result")

        # Video generators return a URL; download the video file
        local_path = workdir / f"{payload.job_id}.mp4"
        if hasattr(output, "data") and str(output.data).startswith("http"):
            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.get(str(output.data))
                resp.raise_for_status()
                local_path.write_bytes(resp.content)
        elif hasattr(output, "save"):
            output.save(str(local_path))
        else:
            raise RuntimeError(f"Cannot extract video from output: {output}")

        await reporter.progress(85, "Uploading video result")
        meta = upload_file(
            local_path,
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
                "duration_sec": duration,
            }
        )
    except Exception as exc:
        logger.exception("Video job %s failed", payload.job_id)
        code, message, retryable = _map_error(exc)
        if should_retry(payload.attempt, retryable):
            delay = retry_backoff_seconds(payload.attempt)
            logger.warning("Video job %s failed (%s), retry %d in %.1fs", payload.job_id, code, payload.attempt + 1, delay)
            await asyncio.sleep(delay)
            retry_payload = payload.model_copy(update={"attempt": payload.attempt + 1})
            reporter.requeue("vimax:queue:q.video.std", retry_payload.model_dump(mode="json"))
            return
        await reporter.failed(
            error_code=code,
            error_message=message,
            retryable=retryable,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def handle_video_job(raw: dict[str, Any], redis_client) -> None:
    payload = VideoJobPayload.model_validate(raw)
    asyncio.run(_run_video(payload, redis_client))
