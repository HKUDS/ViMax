# https://docs.bigmodel.cn/api-reference/模型-api/视频生成异步
# https://docs.bigmodel.cn/api-reference/模型-api/查询异步结果

import asyncio
import logging
from typing import List, Optional

import aiohttp

from interfaces.video_output import VideoOutput
from utils.image import image_path_to_b64

# cogvideox-2/cogvideox-flash accept a fixed size set (CogVideoX-3 adds 4K).
SIZE_BY_RESOLUTION = {
    ("480p", "16:9"): "720x480",
    ("480p", "9:16"): "720x1280",
    ("480p", "1:1"): "1024x1024",
    ("720p", "16:9"): "1280x720",
    ("720p", "9:16"): "720x1280",
    ("720p", "1:1"): "1024x1024",
    ("1080p", "16:9"): "1920x1080",
    ("1080p", "9:16"): "1080x1920",
    ("1080p", "1:1"): "1024x1024",
}
PROMPT_LIMIT = 512


class VideoGeneratorCogVideoXZhipuAPI:
    """CogVideoX on Zhipu BigModel — async submit + poll; `cogvideox-flash`
    is the free tier (T2V and single-image I2V, 5s clips)."""

    DEFAULT_BASE_URL = "https://open.bigmodel.cn"

    def __init__(
        self,
        api_key: str,
        base_url: str = "",
        model: str = "cogvideox-flash",
        quality: str = "speed",
        with_audio: bool = False,
        poll_interval: int = 5,
        max_poll_attempts: Optional[int] = 96,
        # 拥堵退避 = poll_interval*6：10 次×30 秒×2 轮 ≈ 单模型 10 分钟上限。
        # 串行 worker 里一个 job 霸占队列数小时会把后面全部任务堵死，
        # 宁可尽早失败让用户稍后重试。
        submit_max_attempts: int = 10,
        generate_max_attempts: int = 2,
    ):
        self.api_key = api_key
        self.base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.model = model
        self.quality = quality
        self.with_audio = with_audio
        self.poll_interval = poll_interval
        self.max_poll_attempts = max_poll_attempts
        self.submit_max_attempts = submit_max_attempts
        self.generate_max_attempts = generate_max_attempts

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

    def build_payload(
        self,
        prompt: str,
        reference_image_paths: List[str],
        resolution: Optional[str],
        aspect_ratio: Optional[str],
        fps: Optional[int],
    ) -> dict:
        payload = {
            "model": self.model,
            "prompt": prompt[:PROMPT_LIMIT],
            "quality": self.quality,
            "with_audio": self.with_audio,
            "size": SIZE_BY_RESOLUTION.get(
                (resolution or "720p", aspect_ratio or "16:9"), "1280x720"
            ),
            "fps": 60 if (fps or 30) >= 60 else 30,
        }
        if reference_image_paths:
            # cogvideox-flash takes a single first-frame image.
            payload["image_url"] = self._image_uri(reference_image_paths[0])
        return payload

    async def create_video_task(
        self,
        prompt: str,
        reference_image_paths: List[str],
        resolution: Optional[str] = None,
        aspect_ratio: Optional[str] = None,
        fps: Optional[int] = None,
    ) -> str:
        payload = self.build_payload(prompt, reference_image_paths, resolution, aspect_ratio, fps)

        logging.info("Calling %s to generate video...", payload["model"])

        url = f"{self.base_url}/api/paas/v4/videos/generations"
        last_error: Optional[Exception] = None
        for attempt in range(self.submit_max_attempts):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(url, headers=self._headers(), json=payload) as response:
                        response_json = await response.json()
                logging.debug("Response: %s", response_json)

                task_id = response_json.get("id")
                if not task_id:
                    # 免费档拥堵（429/1305 等）返回无 id 的错误体——把真实
                    # 原因带出去，别让 KeyError 'id' 吞掉诊断线索。
                    raise RuntimeError(f"submit rejected (HTTP body): {str(response_json)[:200]}")
                logging.info("Video generation task created successfully. Task ID: %s", task_id)
                return task_id
            except Exception as e:
                last_error = e
                congested = "1305" in str(e) or "访问量过大" in str(e)
                # 拥堵窗口常持续几十分钟：1305 用长退避慢慢等；其他错误
                # （429 限频等）按常规轮询间隔退避。
                wait = self.poll_interval * 6 if congested else self.poll_interval
                logging.error(
                    "Error occurred while creating video generation task (attempt %d/%d): %s. Retrying in %s seconds...",
                    attempt + 1,
                    self.submit_max_attempts,
                    e,
                    wait,
                )
                await asyncio.sleep(wait)
        raise RuntimeError(
            f"Video generation submit failed after {self.submit_max_attempts} attempts: {last_error}"
        )

    async def query_video_task(self, task_id: str) -> str:
        url = f"{self.base_url}/api/paas/v4/async-result/{task_id}"

        attempts = 0
        while True:
            if self.max_poll_attempts is not None and attempts >= self.max_poll_attempts:
                raise TimeoutError(
                    f"Video generation poll timeout after {attempts} attempts (task {task_id})"
                )
            attempts += 1

            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, headers=self._headers()) as response:
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

            status = response_json.get("task_status")
            if status == "SUCCESS":
                video_result = response_json.get("video_result") or []
                video_url = video_result[0].get("url") if video_result else None
                if not video_url:
                    raise RuntimeError(f"Video generation succeeded without a video URL: {response_json}")
                logging.info("Video generation completed successfully. Video URL: %s", video_url)
                return video_url

            if status == "FAIL":
                raise RuntimeError(f"Video generation failed: {response_json}")

            logging.info("Video generation status: %s, waiting %s seconds...", status, self.poll_interval)
            await asyncio.sleep(self.poll_interval)

    async def generate_single_video(
        self,
        prompt: str,
        reference_image_paths: List[str],
        resolution: Optional[str] = None,
        aspect_ratio: Optional[str] = None,
        fps: Optional[int] = None,
        **kwargs,
    ) -> VideoOutput:
        # 免费档偶发任务级 FAIL（「网络错误」code 1234）或长时间挂起——
        # 整体重新提交，有限次内自愈，避免单次抖动废掉整个管线。
        last_error: Optional[Exception] = None
        for attempt in range(1, self.generate_max_attempts + 1):
            if attempt > 1:
                await asyncio.sleep(self.poll_interval * 2)
            try:
                task_id = await self.create_video_task(
                    prompt=prompt,
                    reference_image_paths=reference_image_paths,
                    resolution=resolution,
                    aspect_ratio=aspect_ratio,
                    fps=fps,
                )
                video_url = await self.query_video_task(task_id)
                return VideoOutput(fmt="url", ext="mp4", data=video_url)
            except (RuntimeError, TimeoutError) as e:
                last_error = e
                logging.warning(
                    "Video generation attempt %d/%d failed: %s",
                    attempt,
                    self.generate_max_attempts,
                    e,
                )
        raise last_error
