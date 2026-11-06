import logging
from typing import List, Optional
import asyncio
from google import genai
from google.genai import types
from google.genai.errors import ClientError
from interfaces.video_output import VideoOutput
from utils.rate_limiter import RateLimiter

# https://ai.google.dev/gemini-api/docs/video-generation?hl=zh-cn


class VideoGeneratorVeoGoogleAPI:
    def __init__(
        self,
        api_key: str,
        t2v_model: str = "veo-3.1-generate-preview",
        ff2v_model: str = "veo-3.1-generate-preview",
        flf2v_model: str = "veo-3.1-generate-preview",
        rate_limiter: Optional[RateLimiter] = None,
    ):
        self.api_key = api_key
        self.t2v_model = t2v_model
        self.ff2v_model = ff2v_model
        self.flf2v_model = flf2v_model
        self.rate_limiter = rate_limiter

        self.client = genai.Client(
            api_key=api_key,
        )

    async def generate_single_video(
        self,
        prompt: str,
        reference_image_paths: List[str],
        resolution: str = "1080p",
        aspect_ratio: str = "16:9",
        duration: int = 8,
        **kwargs,
    ) -> VideoOutput:

        params = {
            "prompt": prompt,
        }
        config_params = {
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
            "duration_seconds": duration,
        }
        if len(reference_image_paths) == 0:
            params["model"] = self.t2v_model
        elif len(reference_image_paths) == 1:
            params["model"] = self.ff2v_model
            params["image"] = types.Image.from_file(location=reference_image_paths[0])
        elif len(reference_image_paths) == 2:
            # First+last-frame ("flf2v") interpolation returns 400
            # INVALID_ARGUMENT ("Your use case is currently not supported")
            # on the public Gemini Developer API (it appears to require
            # Vertex AI / allowlisting). Fall back to first-frame-only so
            # the shot still renders instead of failing the pipeline; the
            # clip just is not pinned to the generated last frame.
            logging.warning(
                "Two reference images provided but first+last-frame video "
                "generation is not available on this API key; falling back "
                "to first-frame-only generation."
            )
            params["model"] = self.ff2v_model
            params["image"] = types.Image.from_file(location=reference_image_paths[0])
        else:
            raise ValueError("The number of reference images must be no more than 2")

        logging.info(f"Calling {params['model']} to generate video...")

        # Apply rate limiting if configured
        if self.rate_limiter:
            await self.rate_limiter.acquire()

        # Retry logic for rate limit errors
        max_retries = 3
        retry_delay = 5

        for attempt in range(max_retries):
            try:
                operation = self.client.models.generate_videos(
                    **params,
                    config=types.GenerateVideosConfig(**config_params),
                )
                break
            except ClientError as e:
                # google.genai.errors.ClientError exposes the HTTP status
                # as `.code`; `.status_code` does not exist, so this line
                # raised AttributeError and masked every real ClientError.
                if e.code == 429 and attempt < max_retries - 1:
                    wait_time = retry_delay * (2 ** attempt)
                    logging.warning(f"Rate limit hit (429), retrying in {wait_time}s... (attempt {attempt + 1}/{max_retries})")
                    await asyncio.sleep(wait_time)
                else:
                    raise

        while not operation.done:
            await asyncio.sleep(2)
            operation = self.client.operations.get(operation)
            logging.info(f"Video generation not completed, waiting 2 seconds...")

        # Check if operation completed successfully
        if operation.error:
            error_msg = f"Video generation failed: {operation.error}"
            logging.error(error_msg)
            raise RuntimeError(error_msg)

        if not operation.response:
            error_msg = "Video generation completed but no response received"
            logging.error(error_msg)
            raise RuntimeError(error_msg)

        if not hasattr(operation.response, 'generated_videos') or not operation.response.generated_videos:
            error_msg = "Video generation completed but no videos were generated"
            logging.error(error_msg)
            raise RuntimeError(error_msg)

        generated_video = operation.response.generated_videos[0]
        self.client.files.download(file=generated_video.video)

        video_output = VideoOutput(
            fmt="bytes",
            ext="mp4",
            data=generated_video.video.video_bytes,
        )
        return video_output
