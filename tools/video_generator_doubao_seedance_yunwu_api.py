import logging
from typing import List, Literal
import asyncio
import aiohttp
from interfaces.video_output import VideoOutput
from utils.image import image_path_to_b64


class VideoGeneratorDoubaoSeedanceYunwuAPI:
    DEFAULT_BASE_URL = "https://yunwu.ai/volc/v1/contents/generations/tasks"

    def __init__(
        self,
        api_key: str,
        base_url: str = "",
        model: str = "",
        t2v_model: str = "doubao-seedance-1-0-lite-t2v-250428",
        ff2v_model: str = "doubao-seedance-1-0-lite-i2v-250428",
        flf2v_model: str = "doubao-seedance-1-0-lite-i2v-250428",
        max_create_attempts: int = 3,
        poll_interval: int = 2,
        max_poll_attempts: int = 300,
    ):
        self.api_key = api_key
        self.t2v_model = t2v_model
        self.ff2v_model = ff2v_model
        self.flf2v_model = flf2v_model
        self.max_create_attempts = max_create_attempts
        self.poll_interval = poll_interval
        self.max_poll_attempts = max_poll_attempts


    async def create_video_generation_task(
        self,
        prompt: str,
        reference_image_paths: List[str],
        resolution: Literal["480p", "720p", "1080p"] = "720p",
        aspect_ratio: str = "16:9",
        fps: Literal[16, 24] = 16,
        duration: Literal[5, 10] = 5,
    ) -> str:
        """
        Create a video generation task and return the task ID.
        
        Args:
            prompt: Text prompt for video generation
            reference_image_paths: List of 1 or 2 reference images
            
        Returns:
            Task ID string
        """
        if len(reference_image_paths) == 0:
            model = self.t2v_model
        elif len(reference_image_paths) == 1:
            model = self.ff2v_model
        elif len(reference_image_paths) == 2:
            model = self.flf2v_model
        else:
            raise ValueError("reference_image_paths must contain 1 or 2 images.")

        logging.info(f"Calling {model} to generate video...")

        url = self.base_url

        content = [
            {
                "type": "text",
                "text": prompt + f" --rs {resolution} --rt {aspect_ratio} --dur {duration}  --fps {fps}  --wm false --seed -1 --cf false"
            }
        ]
        if len(reference_image_paths) >= 1:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_path_to_b64(reference_image_paths[0])
                    },
                    "role": "first_frame",
                }
            )
        if len(reference_image_paths) >= 2:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_path_to_b64(reference_image_paths[1])
                    },
                    "role": "last_frame",
                }
            )

        payload = {
            "model": model,
            "content": content
        }

        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }

        last_error = None
        for attempt in range(1, self.max_create_attempts + 1):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(url, headers=headers, json=payload) as response:
                        response_json = await response.json()
                        http_status = response.status
                logging.debug(f"Response: {response_json}")
            except Exception as e:
                last_error = e
                logging.error(f"Error occurred while creating video generation task (attempt {attempt}/{self.max_create_attempts}): {e}")
                if attempt < self.max_create_attempts:
                    await asyncio.sleep(attempt)
                continue

            if http_status >= 400:
                message = f"Video generation task creation failed with HTTP {http_status}: {response_json}"
                if http_status < 500:
                    raise RuntimeError(message)
                last_error = RuntimeError(message)
                logging.error(f"{message} (attempt {attempt}/{self.max_create_attempts})")
                if attempt < self.max_create_attempts:
                    await asyncio.sleep(attempt)
                continue

            task_id = response_json.get("id")
            if not task_id:
                raise RuntimeError(f"Video generation task creation returned no task id: {response_json}")
            logging.info(f"Video generation task created successfully. Task ID: {task_id}")
            return task_id

        raise RuntimeError(f"Failed to create video generation task after {self.max_create_attempts} attempts.") from last_error

    async def query_video_generation_task(
        self,
        task_id: str,
    ) -> str:
        """
        Query the video generation task until completion and return the video URL.
        
        Args:
            task_id: Task ID to query
            
        Returns:
            Video URL string
        """
        url = f"{self.base_url}/{task_id}"
        headers = {
            'Authorization': f'Bearer {self.api_key}',
        }

        attempts = 0
        consecutive_errors = 0
        while True:
            if attempts >= self.max_poll_attempts:
                raise TimeoutError(f"Video generation did not complete after {attempts} polls.")
            attempts += 1

            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, headers=headers) as response:
                        response_json = await response.json()
                        http_status = response.status
            except Exception as e:
                consecutive_errors += 1
                if consecutive_errors >= 5:
                    raise RuntimeError(f"Querying video generation task failed {consecutive_errors} times in a row.") from e
                logging.error(f"Error occurred while querying video generation task: {e}. Retrying in {self.poll_interval} seconds...")
                await asyncio.sleep(self.poll_interval)
                continue
            consecutive_errors = 0

            if http_status >= 400:
                raise RuntimeError(f"Querying video generation task failed with HTTP {http_status}: {response_json}")

            status = response_json.get("status")
            if status == "succeeded":
                video_url = response_json["content"]["video_url"]
                logging.info(f"Video generation completed successfully. Video URL: {video_url}")
                return video_url
            elif status == "failed":
                logging.error(f"Video generation failed. Response: {response_json}")
                raise ValueError("Video generation failed.")
            else:
                logging.info(f"Video generation is still in progress. Checking again in {self.poll_interval} seconds...")
                await asyncio.sleep(self.poll_interval)

    async def generate_single_video(
        self,
        prompt: str,
        reference_image_paths: List[str],
        resolution: Literal["480p", "720p", "1080p"] = "720p",
        aspect_ratio: str = "16:9",
        fps: Literal[16, 24] = 16,
        duration: Literal[5, 10] = 5,
        **kwargs,
    ) -> VideoOutput:
        """
        Generate a single video by creating a task and waiting for completion.
        
        Args:
            prompt: Text prompt for video generation
            reference_image_paths: List of 1 or 2 reference images
            resolution: Resolution of the video
            aspect_ratio: Aspect ratio of the video
            fps: Frames per second of the video
            duration: Duration of the video
        Returns:
            VideoOutput containing the video URL
        """
        task_id = await self.create_video_generation_task(prompt, reference_image_paths, resolution, aspect_ratio, fps, duration)
        video_url = await self.query_video_generation_task(task_id)
        return VideoOutput(fmt="url", ext="mp4", data=video_url)

