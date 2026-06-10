import asyncio
import logging
import os
from typing import List
from urllib.parse import urljoin

import aiohttp

from interfaces.video_output import VideoOutput
from utils.image import image_path_to_b64


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.environ.get(name, str(default))))
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _emit_progress(progress, stage: str, message: str, metadata: dict | None = None) -> None:
    if progress is not None:
        progress(stage, message, metadata or {})


class VideoGeneratorOpenRouterAPI:
    def __init__(
        self,
        api_key: str,
        model: str = "google/veo-3.1-lite",
        base_url: str = "https://openrouter.ai/api/v1",
        http_referer: str = "",
        app_title: str = "ViMax",
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.http_referer = http_referer
        self.app_title = app_title

    async def generate_single_video(
        self,
        prompt: str = "",
        reference_image_paths: List[str] = [],
        aspect_ratio: str = "16:9",
        **kwargs,
    ) -> VideoOutput:
        progress = kwargs.get("progress")
        request_timeout_seconds = _env_float("VIMAX_VIDEO_REQUEST_TIMEOUT_SECONDS", 60.0)
        query_timeout_seconds = _env_float("VIMAX_VIDEO_QUERY_TIMEOUT_SECONDS", 600.0)
        poll_interval_seconds = _env_float("VIMAX_VIDEO_POLL_INTERVAL_SECONDS", 10.0)
        duration = _env_int("VIMAX_OPENROUTER_VIDEO_DURATION", 4)
        resolution = os.environ.get("VIMAX_OPENROUTER_VIDEO_RESOLUTION", "720p")
        generate_audio = _env_bool("VIMAX_OPENROUTER_GENERATE_AUDIO", True)

        payload = {
            "model": self.model,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "duration": duration,
            "resolution": resolution,
            "generate_audio": generate_audio,
        }
        frame_images = _frame_images(reference_image_paths)
        if frame_images:
            payload["frame_images"] = frame_images

        headers = self._headers()
        timeout = aiohttp.ClientTimeout(total=request_timeout_seconds)
        _emit_progress(progress, "video_create", f"Creating OpenRouter video generation task with {self.model}", {"model": self.model, "duration": duration, "resolution": resolution, "frame_count": len(frame_images)})

        create_status, create_payload = await _post_json(
            f"{self.base_url}/videos",
            headers=headers,
            payload=payload,
            timeout=timeout,
            hard_timeout_seconds=request_timeout_seconds,
        )
        if create_status >= 400:
            raise RuntimeError(f"OpenRouter video create failed with HTTP {create_status}: {create_payload}")
        job_id = create_payload.get("id")
        polling_url = create_payload.get("polling_url")
        if not job_id or not polling_url:
            raise RuntimeError(f"OpenRouter video create response missing id or polling_url: {create_payload}")
        _emit_progress(progress, "video_task_created", "OpenRouter video generation task created", {"model": self.model, "job_id": job_id, "status": create_payload.get("status")})

        poll_url = _absolute_url(self.base_url, polling_url)
        deadline = asyncio.get_running_loop().time() + query_timeout_seconds if query_timeout_seconds > 0 else None
        last_status = create_payload.get("status")
        last_payload = create_payload
        while deadline is None or asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(poll_interval_seconds)
            poll_status, poll_payload = await _get_json(
                poll_url,
                headers=headers,
                timeout=timeout,
                hard_timeout_seconds=request_timeout_seconds,
            )
            if poll_status >= 400:
                raise RuntimeError(f"OpenRouter video poll failed with HTTP {poll_status}: {poll_payload}")
            last_payload = poll_payload
            status = poll_payload.get("status")
            last_status = status
            _emit_progress(progress, "video_status", f"OpenRouter video generation status: {status}", {"model": self.model, "job_id": job_id, "status": status})

            if status == "completed":
                urls = poll_payload.get("unsigned_urls") or []
                if urls:
                    content_url = urls[0]
                else:
                    content_url = f"{self.base_url}/videos/{job_id}/content?index=0"
                _emit_progress(progress, "video_download_start", "Downloading OpenRouter video output", {"model": self.model, "job_id": job_id})
                download_status, data = await _get_bytes(
                    content_url,
                    headers=headers if _needs_authorization(content_url) else {},
                    timeout=timeout,
                    hard_timeout_seconds=request_timeout_seconds,
                )
                if download_status >= 400:
                    raise RuntimeError(f"OpenRouter video content download failed with HTTP {download_status}: {data[:500]!r}")
                _emit_progress(progress, "video_completed", "OpenRouter video generation completed and downloaded", {"model": self.model, "job_id": job_id})
                return VideoOutput(fmt="bytes", ext="mp4", data=data)
            if status in {"failed", "cancelled", "expired"}:
                raise RuntimeError(f"OpenRouter video generation {status} for job {job_id}: {poll_payload.get('error') or poll_payload}")

        raise RuntimeError(f"OpenRouter video generation timed out after {query_timeout_seconds:g}s for job {job_id}; last_status={last_status}; last_payload={last_payload}")

    def _headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if self.http_referer:
            headers["HTTP-Referer"] = self.http_referer
        if self.app_title:
            headers["X-OpenRouter-Title"] = self.app_title
        return headers


def _frame_images(reference_image_paths: List[str]) -> list[dict]:
    if len(reference_image_paths) > 2:
        raise ValueError("OpenRouter video generation supports at most first and last frame images")
    frame_types = ["first_frame", "last_frame"]
    return [
        {
            "type": "image_url",
            "image_url": {"url": image_path_to_b64(path, mime=True)},
            "frame_type": frame_types[index],
        }
        for index, path in enumerate(reference_image_paths)
    ]


def _absolute_url(base_url: str, url: str) -> str:
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return urljoin(f"{base_url.rstrip('/')}/", url.lstrip("/"))


def _needs_authorization(url: str) -> bool:
    return url.startswith("https://openrouter.ai/api/")


async def _post_json(url: str, *, headers: dict[str, str], payload: dict, timeout: aiohttp.ClientTimeout, hard_timeout_seconds: float) -> tuple[int, dict]:
    async def request() -> tuple[int, dict]:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, headers=headers, json=payload) as response:
                return response.status, await response.json(content_type=None)

    return await asyncio.wait_for(request(), timeout=hard_timeout_seconds + 5)


async def _get_json(url: str, *, headers: dict[str, str], timeout: aiohttp.ClientTimeout, hard_timeout_seconds: float) -> tuple[int, dict]:
    async def request() -> tuple[int, dict]:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=headers) as response:
                return response.status, await response.json(content_type=None)

    return await asyncio.wait_for(request(), timeout=hard_timeout_seconds + 5)


async def _get_bytes(url: str, *, headers: dict[str, str], timeout: aiohttp.ClientTimeout, hard_timeout_seconds: float) -> tuple[int, bytes]:
    async def request() -> tuple[int, bytes]:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=headers) as response:
                return response.status, await response.read()

    return await asyncio.wait_for(request(), timeout=hard_timeout_seconds + 5)
