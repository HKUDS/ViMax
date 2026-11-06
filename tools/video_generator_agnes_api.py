# https://wiki.agnes-ai.com/en/docs/agnes-video-25

import asyncio
import logging
import time
from typing import List

import aiohttp
from interfaces.video_output import VideoOutput
from utils.image import image_path_to_b64


class VideoGeneratorAgnesAPI:
    """Agnes Video 2.5 — task creation posts to OpenAI-style POST /videos,
    but polling uses the provider-specific GET /agnesapi?video_id=...&model_name=...
    endpoint instead of GET /videos/{id}."""

    DEFAULT_BASE_URL = "https://apihub.agnes-ai.com/v1"
    POLL_INTERVAL_SECONDS = 2
    POLL_DEADLINE_SECONDS = 15 * 60

    def __init__(
        self,
        api_key: str,
        base_url: str = "",
        model: str = "agnes-video-2.5",
    ):
        self.api_key = api_key
        self.base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.model = model

    @property
    def query_url(self) -> str:
        # /agnesapi lives at the host root, outside the /v1 API root.
        root = self.base_url[:-3] if self.base_url.endswith("/v1") else self.base_url
        return f"{root.rstrip('/')}/agnesapi"

    async def create_video_generation_task(
        self,
        prompt: str,
        reference_image_paths: List[str],
        resolution: str = "720p",
        aspect_ratio: str = "16:9",
        fps: int = 16,
        duration: int = 5,
    ) -> str:
        """
        Create a video generation task and return the video_id used for polling.

        Args:
            prompt: Text prompt for video generation
            reference_image_paths: 0 images -> text mode; 1 -> keyframe first_frame;
                2 -> keyframe first+last frame
        """
        if len(reference_image_paths) > 2:
            raise ValueError("reference_image_paths must contain at most 2 images (first/last frame).")

        mode = "keyframe" if reference_image_paths else "text"
        logging.info(f"Calling {self.model} to generate video ({mode})...")

        # Agnes takes seconds as a string in 4..12 and size as "720P"/"1080P";
        # the platform's 480p tier and fps parameter have no Agnes equivalent.
        seconds = str(min(max(int(duration), 4), 12))
        size = {"720p": "720P", "1080p": "1080P"}.get((resolution or "").lower(), "720P")

        payload = {
            "model": self.model,
            "prompt": prompt,
            "mode": mode,
            "seconds": seconds,
            "size": size,
            "aspect_ratio": aspect_ratio,
        }
        if len(reference_image_paths) >= 1:
            payload["first_frame"] = image_path_to_b64(reference_image_paths[0], mime=True)
        if len(reference_image_paths) >= 2:
            payload["last_frame"] = image_path_to_b64(reference_image_paths[1], mime=True)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        # A bounded retry: infinite silent retrying hides auth/balance errors
        # and hammers the provider; the platform surfaces the failure instead.
        last_error: Exception | None = None
        for attempt in range(5):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(f"{self.base_url}/videos", headers=headers, json=payload) as response:
                        response_json = await response.json()
                        if response.status >= 400:
                            err = response_json.get("error") if isinstance(response_json, dict) else None
                            detail = err.get("message", "") if isinstance(err, dict) else str(response_json)[:200]
                            raise RuntimeError(f"video task create {response.status}: {detail}")
                        video_id = response_json.get("video_id") or response_json.get("id")
                        if not video_id:
                            raise RuntimeError(f"video task create: no video_id in response: {str(response_json)[:200]}")
            except Exception as e:
                last_error = e
                logging.error(f"Error occurred while creating video generation task (attempt {attempt + 1}/5): {e}")
                await asyncio.sleep(1 + attempt)
                continue
            break
        else:
            raise RuntimeError(f"video task creation failed after 5 attempts: {last_error}")

        logging.info(f"Video generation task created successfully. Video ID: {video_id}")
        return video_id

    async def query_video_generation_task(
        self,
        video_id: str,
    ) -> str:
        """
        Poll the task until completion and return the video URL.
        """
        url = f"{self.query_url}?video_id={video_id}&model_name={self.model}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
        }
        deadline = time.monotonic() + self.POLL_DEADLINE_SECONDS

        while True:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, headers=headers) as response:
                        response_json = await response.json()
            except Exception as e:
                logging.error(f"Error occurred while querying video generation task: {e}. Retrying in 1 seconds...")
                await asyncio.sleep(1)
                continue

            status = response_json.get("status")
            if status == "completed":
                video_url = response_json["url"]
                logging.info(f"Video generation completed successfully. Video URL: {video_url}")
                return video_url
            if status == "failed":
                logging.error(f"Video generation failed. Response: {response_json}")
                raise ValueError("Video generation failed.")
            if time.monotonic() > deadline:
                raise TimeoutError(f"video task {video_id} still {status!r} after {self.POLL_DEADLINE_SECONDS}s")
            logging.info(f"Video generation is still in progress ({response_json.get('progress')}%). Checking again in {self.POLL_INTERVAL_SECONDS} seconds...")
            await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

    async def generate_single_video(
        self,
        prompt: str,
        reference_image_paths: List[str],
        resolution: str = "720p",
        aspect_ratio: str = "16:9",
        fps: int = 16,
        duration: int = 5,
    ) -> VideoOutput:
        """
        Generate a single video by creating a task and waiting for completion.
        """
        video_id = await self.create_video_generation_task(
            prompt, reference_image_paths, resolution, aspect_ratio, fps, duration
        )
        video_url = await self.query_video_generation_task(video_id)
        return VideoOutput(fmt="url", ext="mp4", data=video_url)
