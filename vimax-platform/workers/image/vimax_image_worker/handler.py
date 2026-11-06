"""Image job handler — bridges queue payload to ViMax ImageGenerator."""

from __future__ import annotations

import asyncio
import hashlib
import importlib
import inspect
import logging
import mimetypes
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Literal

import cv2
import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from pydantic import BaseModel, Field

from vimax_image_worker import compliance
from vimax_image_worker.asset_downloader import download_objects
from vimax_image_worker.asset_uploader import upload_file
from vimax_image_worker.reporter import JobReporter
from vimax_image_worker.text_renderer import render_text_layers
from vimax_image_worker.tracing import export_job_span

logger = logging.getLogger(__name__)

IMAGE_QUEUE_NAME = "q.image.std"
IMAGE_QUEUE_REDIS_KEY = f"vimax:queue:{IMAGE_QUEUE_NAME}"

# provider 瞬时失败（rate_limited/timeout）的重试预算：首次执行之外最多 2 次。
MAX_ATTEMPTS = 2
RETRY_BACKOFF_SECONDS = 3.0

PROMPT_METADATA_LIMIT = 512

EDIT_PROMPT_CONSTRAINTS = {
    "inpaint": "edit only the masked region, keep everything else pixel-identical",
    "outpaint": "extend the scene beyond the original frame naturally, keep the original subject unchanged",
    "replace_bg": "replace the background only, keep the product/subject pixel-identical",
}


class ImageJobCredential(BaseModel):
    class_path: str
    api_key: str
    base_url: str | None = None
    model: str | None = None
    label: str | None = None


class ImageTextLayer(BaseModel):
    text: str
    x: float
    y: float
    font_size: int
    color: str
    align: Literal["left", "center", "right"] = "left"
    font: str | None = None


class ImageJobInput(BaseModel):
    prompt: str
    size: str
    reference_storage_keys: list[str] | None = None
    source_storage_key: str | None = None
    mask_storage_key: str | None = None
    edit_op: Literal["inpaint", "outpaint", "remove_bg", "replace_bg"] | None = None
    seed: int | None = None
    text_layers: list[ImageTextLayer] | None = None
    compliance_platforms: list[str] | None = None


class ImageJobCallback(BaseModel):
    event_channel: str
    upload_bucket: str
    upload_prefix: str


class ImageJobPayload(BaseModel):
    job_id: str
    job_type: str
    model_id: str
    credential: ImageJobCredential
    fallback_credentials: list[ImageJobCredential] = Field(default_factory=list)
    input: ImageJobInput
    callback: ImageJobCallback
    cache_key: str
    timeout_ms: int = Field(default=120_000)
    attempt: int = 0
    traceparent: str | None = None


def retry_backoff_seconds(attempt: int) -> float:
    return RETRY_BACKOFF_SECONDS * (2**attempt)


def should_retry(attempt: int, retryable: bool) -> bool:
    return retryable and attempt < MAX_ATTEMPTS


def _accepted_kwargs(func, candidates: dict[str, Any]) -> dict[str, Any]:
    # Generators hardcode their endpoint; only pass kwargs they accept.
    params = inspect.signature(func).parameters
    return {k: v for k, v in candidates.items() if k in params}


def build_image_generator(credential: ImageJobCredential):
    module_path, cls_name = credential.class_path.rsplit(".", 1)
    cls = getattr(importlib.import_module(module_path), cls_name)
    candidates: dict[str, Any] = {"api_key": credential.api_key}
    if credential.base_url:
        candidates["base_url"] = credential.base_url
    if credential.model:
        candidates["model"] = credential.model
    init_args = _accepted_kwargs(cls.__init__, candidates)
    return cls(**init_args)


def compose_edit_prompt(prompt: str, edit_op: str | None) -> str:
    if edit_op is None:
        return prompt
    return f"{prompt}, {EDIT_PROMPT_CONSTRAINTS[edit_op]}"


def remove_background(img: Image.Image, threshold: int = 240) -> Image.Image:
    """Heuristic product cutout (remove_bg jobs skip the image model): pixels
    near white become transparent and only the largest opaque region survives."""
    rgba = np.array(img.convert("RGBA"))
    opaque = (~np.all(rgba[:, :, :3] >= threshold, axis=2)).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opaque, connectivity=8)
    if count > 1:
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        opaque = (labels == largest).astype(np.uint8)
    rgba[:, :, 3] = opaque * 255
    return Image.fromarray(rgba, "RGBA")


def png_ai_metadata(prompt: str) -> PngInfo:
    info = PngInfo()
    info.add_text("AI-Generated", "true")
    info.add_text("Prompt", prompt[:PROMPT_METADATA_LIMIT])
    return info


def _asset_output(meta: dict) -> dict:
    return {
        key: meta[key]
        for key in ("storage_key", "width", "height", "sha256", "mime_type", "size_bytes")
    }


async def _run_generation_job(payload: ImageJobPayload, workdir: Path, reporter: JobReporter) -> dict:
    spec = payload.input
    await reporter.progress(20, "Downloading references")

    if spec.edit_op == "remove_bg":
        if not spec.source_storage_key:
            raise ValueError("remove_bg requires source_storage_key")
        (source_path,) = download_objects(
            [spec.source_storage_key], workdir, payload.callback.upload_bucket
        )
        with Image.open(source_path) as img:
            output = remove_background(img)
    else:
        model_edit = spec.edit_op in ("inpaint", "outpaint", "replace_bg")
        keys: list[str] = []
        slots: dict[str, int] = {}
        if model_edit and spec.source_storage_key:
            slots["source"] = len(keys)
            keys.append(spec.source_storage_key)
        if model_edit and spec.mask_storage_key:
            slots["mask"] = len(keys)
            keys.append(spec.mask_storage_key)
        slots["refs"] = len(keys)
        keys.extend(spec.reference_storage_keys or [])

        paths = download_objects(keys, workdir, bucket=payload.callback.upload_bucket)
        ref_paths = paths[slots["refs"] :]
        mask_path = paths[slots["mask"]] if "mask" in slots else None

        await reporter.progress(20, "Loading image generator")

        prompt = compose_edit_prompt(spec.prompt, spec.edit_op)
        options: dict[str, Any] = {}
        if spec.seed is not None:
            options["seed"] = spec.seed
        if mask_path is not None:
            options["mask_path"] = mask_path

        # 主模型 + 备用链：容量类失败（拥堵/限流/配额尽）依次降级尝试
        candidates = [payload.credential, *payload.fallback_credentials]
        output = None
        for idx, cred in enumerate(candidates):
            label = cred.label or cred.model or cred.class_path.rsplit(".", 1)[-1]
            await reporter.progress(40, f"Calling image model via {label}")
            try:
                generator = build_image_generator(cred)
                # 各模型接受的 kwargs 不同（如 seed/mask），逐候选过滤
                call_options = _accepted_kwargs(generator.generate_single_image, options)
                output = await generator.generate_single_image(
                    prompt=prompt,
                    reference_image_paths=ref_paths,
                    size=spec.size,
                    **call_options,
                )
                break
            except Exception as exc:
                code, message, _ = _map_error(exc)
                capacity = code in ("provider.rate_limited", "provider.timeout")
                if not capacity or idx == len(candidates) - 1:
                    raise
                logger.warning(
                    "Image job %s: model %s capacity-limited (%s), switching to fallback",
                    payload.job_id, label, message[:80],
                )
                await reporter.progress(
                    45, f"模型 {label} 容量不足，切换备用模型重试",
                )

    local_path = workdir / f"{payload.job_id}.png"
    # ImageOutput.save(path) 不收 pnginfo —— 先落盘再用 PIL 回写 AI 元数据。
    output.save(str(local_path))
    with Image.open(local_path) as img:
        img.save(local_path, pnginfo=png_ai_metadata(spec.prompt))

    await reporter.progress(80, "Uploading result")
    meta = upload_file(
        local_path,
        bucket=payload.callback.upload_bucket,
        prefix=payload.callback.upload_prefix,
    )
    return _asset_output(meta)


async def _run_text_job(payload: ImageJobPayload, workdir: Path, reporter: JobReporter) -> dict:
    spec = payload.input
    if not spec.source_storage_key or not spec.text_layers:
        raise ValueError("image.text requires source_storage_key and text_layers")
    await reporter.progress(20, "Downloading source")
    (source_path,) = download_objects(
        [spec.source_storage_key], workdir, payload.callback.upload_bucket
    )

    with Image.open(source_path) as img:
        rendered = render_text_layers(img, [layer.model_dump() for layer in spec.text_layers])

    local_path = workdir / f"{payload.job_id}.png"
    rendered.save(str(local_path), pnginfo=png_ai_metadata(spec.prompt))

    await reporter.progress(80, "Uploading result")
    meta = upload_file(
        local_path,
        bucket=payload.callback.upload_bucket,
        prefix=payload.callback.upload_prefix,
    )
    return _asset_output(meta)


async def _run_compliance_job(payload: ImageJobPayload, workdir: Path, reporter: JobReporter) -> dict:
    """Compliance jobs produce no new binary, but the TS completed-event schema
    requires the full asset envelope — echo the source's real storage metadata."""
    spec = payload.input
    if not spec.source_storage_key:
        raise ValueError("image.compliance requires source_storage_key")
    await reporter.progress(20, "Downloading source")
    (source_path,) = download_objects(
        [spec.source_storage_key], workdir, payload.callback.upload_bucket
    )

    with Image.open(source_path) as img:
        reports = compliance.evaluate_platforms(img, spec.compliance_platforms or [])
        width, height = img.size
    data = Path(source_path).read_bytes()

    return {
        "storage_key": spec.source_storage_key,
        "width": width,
        "height": height,
        "sha256": hashlib.sha256(data).hexdigest(),
        "mime_type": mimetypes.guess_type(source_path)[0] or "image/png",
        "size_bytes": len(data),
        "result": {"reports": reports},
    }


async def _run(payload: ImageJobPayload, redis_client) -> None:
    reporter = JobReporter(redis_client, payload.callback.event_channel, payload.job_id)
    await reporter.started()

    started_ms = time.time() * 1000
    status = "completed"
    trace_attrs = {
        "job_id": payload.job_id,
        "job_type": payload.job_type,
        "attempt": str(payload.attempt),
    }

    workdir = Path(tempfile.mkdtemp(prefix=f"vimax-{payload.job_id}-"))
    try:
        if payload.job_type == "image.text":
            output = await _run_text_job(payload, workdir, reporter)
        elif payload.job_type == "image.compliance":
            output = await _run_compliance_job(payload, workdir, reporter)
        else:
            output = await _run_generation_job(payload, workdir, reporter)
        await reporter.completed(output)
    except Exception as exc:
        logger.exception("Job %s failed", payload.job_id)
        code, message, retryable = _map_error(exc)
        status = "failed"
        trace_attrs["error_code"] = code
        if should_retry(payload.attempt, retryable):
            delay = retry_backoff_seconds(payload.attempt)
            logger.warning(
                "Job %s failed (%s), retry %d/%d in %.1fs",
                payload.job_id,
                code,
                payload.attempt + 1,
                MAX_ATTEMPTS,
                delay,
            )
            await asyncio.sleep(delay)
            retry_payload = payload.model_copy(update={"attempt": payload.attempt + 1})
            redis_client.lpush(IMAGE_QUEUE_REDIS_KEY, retry_payload.model_dump_json())
            return
        await reporter.failed(
            error_code=code,
            error_message=message,
            retryable=retryable,
        )
    finally:
        export_job_span(
            payload.traceparent,
            job_id=payload.job_id,
            status=status,
            started_ms=started_ms,
            attributes=trace_attrs,
        )
        shutil.rmtree(workdir, ignore_errors=True)


def _map_error(exc: Exception) -> tuple[str, str, bool]:
    message = str(exc).lower()
    if "rate" in message and "limit" in message:
        return "provider.rate_limited", str(exc), True
    # 免费档拥堵（provider 返回 queue full）与配额尽（余额 0）都按容量类
    # 处理：可重试且应切换备用模型。
    if "queue" in message or "quota" in message:
        return "provider.rate_limited", str(exc), True
    if "401" in message or "unauthorized" in message or "api key" in message:
        return "provider.invalid_api_key", str(exc), False
    if "timeout" in message:
        return "provider.timeout", str(exc), True
    if "content" in message and "policy" in message:
        return "provider.content_policy_violation", str(exc), False
    return "worker.internal", str(exc), True


def handle_image_job(raw: dict[str, Any], redis_client) -> None:
    payload = ImageJobPayload.model_validate(raw)
    asyncio.run(_run(payload, redis_client))
