import asyncio
import logging
from typing import List, Optional

import aiohttp

from interfaces.video_output import VideoOutput
from utils.image import image_path_to_b64
from utils.rate_limiter import RateLimiter


class VideoGeneratorOmniYunwuAPI:
    def __init__(
        self,
        api_key: str,
        t2v_model: str = "omni-flash",
        i2v_model: str = "omni-flash",
        base_url: str = "https://yunwu.ai",
        seconds: int = 8,
        enable_upsample: bool = False,
        enable_sample: Optional[bool] = None,
        poll_interval: int = 2,
        max_poll_attempts: Optional[int] = None,
        rate_limiter: Optional[RateLimiter] = None,
    ):
        self.api_key = api_key
        self.t2v_model = t2v_model
        self.i2v_model = i2v_model
        self.base_url = base_url.rstrip("/")
        self.seconds = seconds
        self.enable_upsample = enable_upsample
        self.enable_sample = enable_sample
        self.poll_interval = poll_interval
        self.max_poll_attempts = max_poll_attempts
        self.rate_limiter = rate_limiter

    def _headers(self) -> dict:
        return {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _image_uri(self, image_path: str) -> str:
        if image_path.startswith(("http://", "https://", "data:")):
            return image_path
        return image_path_to_b64(image_path, mime=True)

    def _build_payload(
        self,
        prompt: str,
        reference_image_paths: List[str],
        aspect_ratio: str,
        seconds: Optional[int],
        size: Optional[str],
        enable_upsample: Optional[bool],
        enable_sample: Optional[bool],
    ) -> dict:
        if len(reference_image_paths) > 3:
            raise ValueError("The number of reference images must be no more than 3")

        payload = {
            "model": self.t2v_model if len(reference_image_paths) == 0 else self.i2v_model,
            "prompt": prompt,
            "seconds": str(seconds or self.seconds),
        }

        if len(reference_image_paths) == 0:
            payload["type"] = 1
        elif len(reference_image_paths) <= 2:
            payload["type"] = 2
            payload["images"] = [self._image_uri(path) for path in reference_image_paths]
        else:
            payload["type"] = 3
            payload["images"] = [self._image_uri(path) for path in reference_image_paths]

        if aspect_ratio:
            payload["aspect_ratio"] = aspect_ratio
        if size:
            payload["size"] = size
        if enable_upsample is not None:
            payload["enable_upsample"] = enable_upsample
        if enable_sample is not None:
            payload["enable_sample"] = enable_sample

        return payload

    async def create_video_generation_task(
        self,
        prompt: str,
        reference_image_paths: List[str],
        aspect_ratio: str = "16:9",
        seconds: Optional[int] = None,
        size: Optional[str] = None,
        enable_upsample: Optional[bool] = None,
        enable_sample: Optional[bool] = None,
    ) -> tuple[str, str]:
        payload = self._build_payload(
            prompt=prompt,
            reference_image_paths=reference_image_paths,
            aspect_ratio=aspect_ratio,
            seconds=seconds,
            size=size,
            enable_upsample=self.enable_upsample if enable_upsample is None else enable_upsample,
            enable_sample=self.enable_sample if enable_sample is None else enable_sample,
        )

        logging.info("Calling %s to generate video...", payload["model"])

        if self.rate_limiter:
            await self.rate_limiter.acquire()

        url = f"{self.base_url}/v1/video/create"
        while True:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(url, headers=self._headers(), json=payload) as response:
                        response_json = await response.json()
                logging.debug("Response: %s", response_json)

                task_id = response_json["id"]
                logging.info("Video generation task created successfully. Task ID: %s", task_id)
                return task_id, payload["model"]
            except Exception as e:
                logging.error(
                    "Error occurred while creating video generation task: %s. Retrying in 1 second...",
                    e,
                )
                await asyncio.sleep(1)

    async def query_video_generation_task(self, task_id: str, model: str) -> str:
        url = f"{self.base_url}/v1/video/query"
        params = {"id": task_id, "model": model}

        attempts = 0
        while True:
            if self.max_poll_attempts is not None and attempts >= self.max_poll_attempts:
                raise TimeoutError(f"Video generation did not complete after {attempts} polls.")
            attempts += 1

            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, headers=self._headers(), params=params) as response:
                        response_json = await response.json()
                logging.debug("Response: %s", response_json)
            except Exception as e:
                logging.error(
                    "Error occurred while querying video generation task: %s. Retrying in %s seconds...",
                    e,
                    self.poll_interval,
                )
                await asyncio.sleep(self.poll_interval)
                continue

            status = response_json.get("status")
            if status == "completed":
                detail = response_json.get("detail") or {}
                video_url = (
                    response_json.get("video_url")
                    or detail.get("upsample_video_url")
                    or detail.get("video_url")
                )
                if not video_url:
                    raise RuntimeError(f"Video generation completed without a video URL: {response_json}")
                logging.info("Video generation completed successfully. Video URL: %s", video_url)
                return video_url

            if status in {"failed", "error"}:
                raise RuntimeError(f"Video generation failed: {response_json}")

            logging.info("Video generation status: %s, waiting %s seconds...", status, self.poll_interval)
            await asyncio.sleep(self.poll_interval)

    async def generate_single_video(
        self,
        prompt: str,
        reference_image_paths: List[str],
        aspect_ratio: str = "16:9",
        seconds: Optional[int] = None,
        size: Optional[str] = None,
        enable_upsample: Optional[bool] = None,
        enable_sample: Optional[bool] = None,
        **kwargs,
    ) -> VideoOutput:
        task_id, model = await self.create_video_generation_task(
            prompt=prompt,
            reference_image_paths=reference_image_paths,
            aspect_ratio=aspect_ratio,
            seconds=seconds,
            size=size,
            enable_upsample=enable_upsample,
            enable_sample=enable_sample,
        )
        video_url = await self.query_video_generation_task(task_id, model)
        return VideoOutput(fmt="url", ext="mp4", data=video_url)


class VideoGeneratorOminiYunwuAPI(VideoGeneratorOmniYunwuAPI):
    """Backward-compatible alias for the common "omini" spelling."""
