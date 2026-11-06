# ModelScope API-Inference, Qwen-Image-Edit-2509 (free tier, daily quota shared
# with other ModelScope calls). Edit models run as async tasks: submit with
# X-ModelScope-Async-Mode, then poll /v1/tasks/{task_id} with the
# X-ModelScope-Task-Type header (without it the endpoint 404s).
# Reference images go as base64 data URIs in `images` (1-3 per task).

import asyncio
import logging
from typing import List, Optional

import aiohttp

from interfaces.image_output import ImageOutput
from utils.image import image_path_to_b64


class ImageGeneratorQwenImageEditModelScopeAPI:
    """Qwen-Image-Edit-2509 on ModelScope — multi-reference image editing."""

    DEFAULT_BASE_URL = "https://api-inference.modelscope.cn"
    # Provider limit for multi-image edit (Qwen-Image-Edit-2509: 1-3 images).
    MAX_REFERENCES = 3
    # 24 polls x 5s ≈ 120s, matching the image job timeout_ms default.
    DEFAULT_MAX_POLL_ATTEMPTS = 24

    LANDSCAPE_SIZE = "1344x768"
    PORTRAIT_SIZE = "768x1344"
    SQUARE_SIZE = "1024x1024"

    def __init__(
        self,
        api_key: str,
        base_url: str = "",
        model: str = "Qwen/Qwen-Image-Edit-2509",
        poll_interval: float = 5,
        max_poll_attempts: Optional[int] = None,
    ):
        self.api_key = api_key
        self.base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.model = model
        self.poll_interval = poll_interval
        self.max_poll_attempts = max_poll_attempts or self.DEFAULT_MAX_POLL_ATTEMPTS

    def snap_size(self, size: Optional[str]) -> str:
        if not size:
            return self.SQUARE_SIZE
        try:
            width, height = (int(part) for part in size.lower().split("x"))
        except ValueError:
            return self.SQUARE_SIZE
        ratio = width / height
        if ratio > 1.2:
            return self.LANDSCAPE_SIZE
        if ratio < 1 / 1.2:
            return self.PORTRAIT_SIZE
        return self.SQUARE_SIZE

    def build_payload(
        self,
        prompt: str,
        reference_image_paths: List[str],
        size: Optional[str] = None,
    ) -> dict:
        refs = reference_image_paths[: self.MAX_REFERENCES]
        if len(reference_image_paths) > self.MAX_REFERENCES:
            logging.warning(
                "%s accepts at most %d reference images, dropping the rest",
                self.model,
                self.MAX_REFERENCES,
            )
        payload = {
            "model": self.model,
            "prompt": prompt,
            "images": [image_path_to_b64(p, mime=True) for p in refs],
        }
        if size is not None:
            payload["size"] = self.snap_size(size)
        return payload

    async def create_edit_task(
        self,
        prompt: str,
        reference_image_paths: List[str],
        size: Optional[str] = None,
    ) -> str:
        payload = self.build_payload(prompt, reference_image_paths, size)
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-ModelScope-Async-Mode": "true",
        }
        url = f"{self.base_url}/v1/images/generations"

        logging.info("Calling %s to edit image...", self.model)
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as response:
                response_json = await response.json()
                if response.status >= 400:
                    err = response_json.get("error") if isinstance(response_json, dict) else None
                    detail = err.get("message", "") if isinstance(err, dict) else str(response_json)[:200]
                    logging.error("image API failure — url=%s status=%s", url, response.status)
                    raise RuntimeError(f"image API {response.status}: {detail}")

        task_id = response_json.get("task_id") if isinstance(response_json, dict) else None
        if not task_id:
            raise RuntimeError(f"image API returned no task_id: {str(response_json)[:200]}")
        logging.info("Edit task created: %s", task_id)
        return task_id

    async def query_edit_task(self, task_id: str) -> str:
        url = f"{self.base_url}/v1/tasks/{task_id}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "X-ModelScope-Task-Type": "image_generation",
        }

        for attempt in range(1, self.max_poll_attempts + 1):
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as response:
                    response_json = await response.json()
                    if response.status >= 400:
                        raise RuntimeError(f"task API {response.status}: {str(response_json)[:200]}")

            status = response_json.get("task_status")
            if status == "SUCCEED":
                images = response_json.get("output_images") or []
                if not images:
                    raise RuntimeError(f"edit task succeeded without images: {str(response_json)[:200]}")
                logging.info("Image edit completed: %s", images[0])
                return images[0]
            if status == "FAILED":
                raise RuntimeError(f"image task failed: {str(response_json)[:200]}")

            logging.info("Edit task %s status: %s (%d/%d)", task_id, status, attempt, self.max_poll_attempts)
            await asyncio.sleep(self.poll_interval)

        raise TimeoutError(f"Edit task {task_id} did not complete after {self.max_poll_attempts} polls.")

    async def generate_single_image(
        self,
        prompt: str,
        reference_image_paths: List[str] = [],
        size: Optional[str] = None,
        **kwargs,
    ) -> ImageOutput:
        if not reference_image_paths:
            raise ValueError("Qwen-Image-Edit requires at least one reference image")
        task_id = await self.create_edit_task(prompt, reference_image_paths, size)
        image_url = await self.query_edit_task(task_id)
        return ImageOutput(fmt="url", ext="png", data=image_url)
