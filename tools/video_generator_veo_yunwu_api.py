import logging
from typing import List, Optional
from PIL import Image
import asyncio
import aiohttp
import os
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


def _emit_progress(progress, stage: str, message: str, metadata: dict | None = None) -> None:
    if progress is not None:
        progress(stage, message, metadata or {})


class VideoGeneratorVeoYunwuAPI:
    def __init__(
        self,
        api_key: str,
        t2v_model: str = "veo3.1-fast",  # text to video
        ff2v_model: str = "veo3.1-fast",   # first frame to video
        flf2v_model: str = "veo2-fast-frames",  # first and last frame to video
        base_url: str = "https://yunwu.ai",
    ):
        """
        all models:
            veo2
            veo2-fast
            veo2-fast-frames
            veo2-fast-components
            veo2-pro
            veo3
            veo3-fast
            veo3-pro
            veo3-pro-frames
            veo3-fast-frames
            veo3-frames

        NOTE: veo3 does not support first and last frame to video generation.
        """
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.t2v_model = t2v_model
        self.ff2v_model = ff2v_model
        self.flf2v_model = flf2v_model

    async def generate_single_video(
        self,
        prompt: str = "",
        reference_image_paths: List[Image.Image] = [],
        aspect_ratio: str = "16:9",
        **kwargs,
    ) -> VideoOutput:
        progress = kwargs.get("progress")
        create_retries = _env_int("VIMAX_VIDEO_CREATE_RETRIES", 3)
        query_timeout_seconds = _env_float("VIMAX_VIDEO_QUERY_TIMEOUT_SECONDS", 600.0)
        request_timeout_seconds = _env_float("VIMAX_VIDEO_REQUEST_TIMEOUT_SECONDS", 60.0)
        poll_interval_seconds = _env_float("VIMAX_VIDEO_POLL_INTERVAL_SECONDS", 5.0)
        max_query_errors = _env_int("VIMAX_VIDEO_MAX_QUERY_ERRORS", 5)
        if len(reference_image_paths) == 0:
            model = self.t2v_model
        elif len(reference_image_paths) == 1:
            model = self.ff2v_model
        elif len(reference_image_paths) == 2:
            model = self.flf2v_model
        else:
            raise ValueError("The number of reference images must be no more than 2")

        logging.info(f"Calling {model} to generate video...")

        # 1. Create video generation task
        payload = {
            "prompt": prompt,
            "model": model,
            "images": [image_path_to_b64(image_path, mime=True) for image_path in reference_image_paths],
            "enhance_prompt": True,
        }
        # only veo3 supports aspect ratio setting
        if model.startswith("veo3"):
            payload["aspect_ratio"] = aspect_ratio

        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        url = f"{self.base_url}/v1/video/create"
        task_id = None
        last_create_error = None
        timeout = aiohttp.ClientTimeout(total=request_timeout_seconds)
        for attempt in range(1, create_retries + 1):
            try:
                _emit_progress(progress, "video_create", f"Creating video generation task with {model}", {"model": model, "attempt": attempt, "max_attempts": create_retries})
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(url, headers=headers, json=payload) as response:
                        response_payload = await response.json(content_type=None)
                        logging.debug(f"Response: {response_payload}")
                        if response.status >= 400:
                            raise RuntimeError(f"Video create failed with HTTP {response.status}: {response_payload}")
                        task_id = response_payload.get("id")
                        if not task_id:
                            raise RuntimeError(f"Video create response missing id: {response_payload}")
                        logging.info(f"Video generation task created successfully. Task ID: {task_id}")
                        _emit_progress(progress, "video_task_created", "Video generation task created", {"model": model, "task_id": task_id})
                        break
            except Exception as e:
                last_create_error = e
                logging.error(f"Error occurred while creating video generation task: {e}.")
                _emit_progress(progress, "video_create_error", f"Video create attempt {attempt} failed", {"model": model, "attempt": attempt, "error": str(e)})
                if attempt < create_retries:
                    await asyncio.sleep(1)
        if not task_id:
            raise RuntimeError(f"Video create failed after {create_retries} attempts: {last_create_error}")


        # 2. Query the video generation task until the video generation is completed
        headers = {
            'Accept': 'application/json',
            'Authorization': f'Bearer {self.api_key}',
        }

        deadline = asyncio.get_running_loop().time() + query_timeout_seconds if query_timeout_seconds > 0 else None
        query_errors = 0
        last_status = None
        while deadline is None or asyncio.get_running_loop().time() < deadline:
            try:
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.get(f"{self.base_url}/v1/video/query?id={task_id}", headers=headers) as response:
                        payload = await response.json(content_type=None)
                        logging.debug(f"Response: {payload}")
                        if response.status >= 400:
                            raise RuntimeError(f"Video query failed with HTTP {response.status}: {payload}")
                        status = payload.get("status")
                        if not status:
                            raise RuntimeError(f"Video query response missing status: {payload}")
                        query_errors = 0
            except Exception as e:
                query_errors += 1
                logging.error(f"Error occurred while querying video generation task: {e}.")
                _emit_progress(progress, "video_query_error", "Video query failed", {"model": model, "task_id": task_id, "error": str(e), "query_errors": query_errors, "max_query_errors": max_query_errors})
                if query_errors >= max_query_errors:
                    raise RuntimeError(f"Video query failed {query_errors} times for task {task_id}: {e}")
                await asyncio.sleep(poll_interval_seconds)
                continue

            if status == "completed":
                logging.info(f"Video generation completed successfully")
                video_url = payload.get("video_url")
                if not video_url:
                    raise RuntimeError(f"Video task completed without video_url: {payload}")
                _emit_progress(progress, "video_completed", "Video generation completed", {"model": model, "task_id": task_id})
                return VideoOutput(fmt="url", ext="mp4", data=video_url)
            elif status == "failed":
                logging.error(f"Video generation failed: \n{payload}")
                raise RuntimeError(f"Video generation failed for task {task_id}: {payload}")
            else:
                logging.info(f"Video generation status: {status}, waiting 1 second...")
                last_status = status
                _emit_progress(progress, "video_status", f"Video generation status: {status}", {"model": model, "task_id": task_id, "status": status})
                await asyncio.sleep(poll_interval_seconds)
                continue
        raise RuntimeError(f"Video generation timed out after {query_timeout_seconds:g}s for task {task_id}; last_status={last_status}")
