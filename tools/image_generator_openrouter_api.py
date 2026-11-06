from __future__ import annotations

import asyncio
import base64
import json
import os
from io import BytesIO
from typing import Any, List

import aiohttp
from PIL import Image
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from interfaces.image_output import ImageOutput
from tools.image_orientation import ensure_not_portrait, landscape_guard_requested
from utils.image import image_path_to_b64
from utils.rate_limiter import RateLimiter
from utils.retry import after_func


class OpenRouterImageAPIError(RuntimeError):
    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        super().__init__(f"OpenRouter image generation failed with HTTP {status_code}: {payload}")


def _request_timeout_seconds() -> float:
    raw = os.environ.get("VIMAX_IMAGE_REQUEST_TIMEOUT_SECONDS", "300")
    try:
        return max(1.0, float(raw))
    except ValueError:
        return 300.0


def _is_retryable_image_error(exc: BaseException) -> bool:
    if isinstance(exc, OpenRouterImageAPIError):
        return exc.status_code in {408, 409, 425, 429} or exc.status_code >= 500
    if isinstance(exc, (aiohttp.ClientError, asyncio.TimeoutError)):
        return True
    return isinstance(exc, ValueError) and "portrait-oriented" in str(exc)


class ImageGeneratorOpenRouterAPI:
    """Generate images through OpenRouter's dedicated Images API."""

    def __init__(
        self,
        api_key: str,
        model: str = "openai/gpt-image-2",
        base_url: str = "https://openrouter.ai/api/v1",
        quality: str = "auto",
        background: str = "auto",
        output_compression: int | None = None,
        rate_limiter: RateLimiter | None = None,
        http_referer: str = "",
        app_title: str = "ViMax",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.quality = quality
        self.background = background
        self.output_compression = output_compression
        self.rate_limiter = rate_limiter
        self.http_referer = http_referer
        self.app_title = app_title

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception(_is_retryable_image_error),
        after=after_func,
        reraise=True,
    )
    async def generate_single_image(
        self,
        prompt: str,
        reference_image_paths: List[str] | None = None,
        aspect_ratio: str | None = "16:9",
        **kwargs: Any,
    ) -> ImageOutput:
        references = list(reference_image_paths or [])
        if len(references) > 16:
            raise ValueError("OpenRouter GPT Image supports at most 16 reference images")
        if self.rate_limiter is not None:
            await self.rate_limiter.acquire()

        enforce_landscape = landscape_guard_requested(
            size=kwargs.get("size"),
            aspect_ratio=aspect_ratio,
            enforce_landscape=kwargs.get("enforce_landscape", True),
            allow_portrait=kwargs.get("allow_portrait", False),
        )
        request_prompt = _prompt_with_landscape_requirement(prompt, aspect_ratio) if enforce_landscape else prompt
        payload: dict[str, Any] = {
            "model": self.model,
            "prompt": request_prompt,
            "n": 1,
            "quality": kwargs.get("quality", self.quality),
            "background": kwargs.get("background", self.background),
        }
        compression = kwargs.get("output_compression", self.output_compression)
        if compression is not None:
            payload["output_compression"] = compression
        if references:
            payload["input_references"] = [
                {"type": "image_url", "image_url": {"url": image_path_to_b64(path, mime=True)}}
                for path in references
            ]

        progress = kwargs.get("progress")
        _emit_progress(
            progress,
            "image_generation",
            f"Generating image with {self.model}",
            {"model": self.model, "reference_count": len(references)},
        )
        timeout = aiohttp.ClientTimeout(total=_request_timeout_seconds())
        status, response = await _post_json(
            f"{self.base_url}/images",
            headers=self._headers(),
            payload=payload,
            timeout=timeout,
        )
        if status >= 400:
            raise OpenRouterImageAPIError(status, response)

        image, extension = _decode_image_response(response)
        if enforce_landscape:
            ensure_not_portrait(image)
        _emit_progress(
            progress,
            "image_completed",
            "OpenRouter image generation completed",
            {"model": self.model, "width": image.width, "height": image.height},
        )
        return ImageOutput(fmt="pil", ext=extension, data=image)

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


def _prompt_with_landscape_requirement(prompt: str, aspect_ratio: str | None) -> str:
    ratio = aspect_ratio or "16:9"
    return f"{prompt}\n\nComposition requirement: create a landscape image with an approximate {ratio} aspect ratio; the width must be greater than the height."


def _decode_image_response(payload: Any) -> tuple[Image.Image, str]:
    data = payload.get("data") if isinstance(payload, dict) else None
    item = data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else None
    encoded = item.get("b64_json") if item else None
    if not isinstance(encoded, str) or not encoded:
        raise ValueError(f"OpenRouter image response missing data[0].b64_json: {payload}")
    if encoded.startswith("data:"):
        encoded = encoded.split(",", 1)[-1]
    try:
        raw = base64.b64decode(encoded, validate=True)
        with Image.open(BytesIO(raw)) as opened:
            opened.load()
            image = opened.copy()
    except Exception as exc:
        raise ValueError("OpenRouter image response contained invalid image data") from exc
    media_type = item.get("media_type", "image/png")
    extension = {"image/jpeg": "jpg", "image/webp": "webp"}.get(media_type, "png")
    return image, extension


def _emit_progress(progress: Any, stage: str, message: str, metadata: dict[str, Any]) -> None:
    if progress is not None:
        progress(stage, message, metadata)


async def _post_json(
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: aiohttp.ClientTimeout,
) -> tuple[int, Any]:
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, headers=headers, json=payload) as response:
            text = await response.text()
            try:
                body = json.loads(text)
            except json.JSONDecodeError:
                body = {"message": text}
            return response.status, body
