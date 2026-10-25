import asyncio
import base64
import logging
import re
from typing import Any, Callable, List, Optional

from google import genai
from google.genai import errors, types
from interfaces.video_output import VideoOutput
from utils.rate_limiter import RateLimiter

# https://ai.google.dev/gemini-api/docs/video-generation


def _sanitize_error_text(err: Any) -> str:
    """Sanitize error messages to prevent leaking API keys or internal tokens."""
    msg = str(err)
    msg = re.sub(r'AIza[0-9A-Za-z_\-]{30,}', '[REDACTED_KEY]', msg)
    msg = re.sub(r'AQ\.[0-9A-Za-z_\-]{20,}', '[REDACTED_KEY]', msg)
    msg = re.sub(r'([?&](?:key|api_key|apiKey)=)[^&\s"\'<>()]+', r'\1[REDACTED]', msg)
    return msg


def _emit_progress(callback: Optional[Callable[..., None]], stage: str, message: str, metadata: Optional[dict[str, Any]] = None) -> None:
    if not callback:
        return
    try:
        callback(stage, message, metadata or {})
    except Exception as exc:
        logging.warning("Failed to emit video progress (%s): %s", stage, exc)


class VideoGeneratorVeoGoogleAPI:
    """Google video generator supporting Gemini Omni Flash (Interactions API) and legacy Veo models."""

    def __init__(
        self,
        api_key: str,
        t2v_model: str = "gemini-omni-1.1-flash",
        ff2v_model: str = "gemini-omni-1.1-flash",
        flf2v_model: str = "gemini-omni-1.1-flash",
        rate_limiter: Optional[RateLimiter] = None,
    ):
        self.api_key = api_key
        self.t2v_model = t2v_model
        self.ff2v_model = ff2v_model
        self.flf2v_model = flf2v_model
        self.rate_limiter = rate_limiter

        self.client = genai.Client(api_key=api_key)

    async def _generate_omni_video(
        self,
        prompt: str,
        reference_image_paths: List[str],
        resolution: str = "720p",
        aspect_ratio: str = "16:9",
        duration: int = 8,
        **kwargs,
    ) -> VideoOutput:
        model = self.ff2v_model if reference_image_paths else self.t2v_model
        progress_cb = kwargs.get("progress")
        _emit_progress(progress_cb, "video_create", f"Creating Google Omni video task with {model}", {
            "model": model,
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
            "duration": duration,
            "reference_count": len(reference_image_paths),
        })

        if self.rate_limiter:
            await self.rate_limiter.acquire()

        max_retries = 3
        retry_delay = 5.0

        def _do_omni_call() -> bytes:
            input_parts: list[dict[str, Any]] = []
            prompt_prefix = ""

            if len(reference_image_paths) == 1:
                uploaded = self.client.files.upload(file=reference_image_paths[0])
                input_parts.append({
                    "type": "image",
                    "uri": uploaded.uri,
                    "mime_type": uploaded.mime_type or "image/png",
                })
                if "<FIRST_FRAME>" not in prompt:
                    prompt_prefix = "<FIRST_FRAME> "
            elif len(reference_image_paths) >= 2:
                up1 = self.client.files.upload(file=reference_image_paths[0])
                input_parts.append({
                    "type": "image",
                    "uri": up1.uri,
                    "mime_type": up1.mime_type or "image/png",
                })
                up2 = self.client.files.upload(file=reference_image_paths[1])
                input_parts.append({
                    "type": "image",
                    "uri": up2.uri,
                    "mime_type": up2.mime_type or "image/png",
                })
                if "<FIRST_FRAME>" not in prompt and "<LAST_FRAME>" not in prompt:
                    prompt_prefix = "<FIRST_FRAME> <LAST_FRAME> "

            full_prompt = f"{prompt_prefix}{prompt}".strip()
            input_parts.append({"type": "text", "text": full_prompt})

            # Clamp duration to Gemini Omni Flash bounds (3 to 10 seconds)
            clamped_duration = min(max(int(duration), 3), 10)
            response_format: dict[str, Any] = {
                "type": "video",
                "aspect_ratio": aspect_ratio,
                "duration": clamped_duration,
            }
            if resolution in ("360p", "720p", "1080p", "4k"):
                response_format["resolution"] = resolution

            interaction = self.client.interactions.create(
                model=model,
                input=input_parts,
                response_format=response_format,
            )
            output_video = getattr(interaction, "output_video", None)
            if not output_video:
                raise RuntimeError(f"Omni video generation failed: {getattr(interaction, 'errors', None) or 'no output video'}")

            if getattr(output_video, "data", None):
                return base64.b64decode(output_video.data)
            elif getattr(output_video, "uri", None):
                return self.client.files.download(file=output_video.uri)
            else:
                raise RuntimeError("Omni video generation returned video with neither data nor uri")

        for attempt in range(max_retries):
            try:
                video_bytes = await asyncio.to_thread(_do_omni_call)
                break
            except (errors.APIError, errors.ClientError) as exc:
                code = getattr(exc, "code", None)
                if code == 429 and attempt < max_retries - 1:
                    wait_time = retry_delay * (2 ** attempt)
                    logging.warning("Google Omni video rate limited (429); retrying in %.1fs (attempt %d/%d)", wait_time, attempt + 1, max_retries)
                    await asyncio.sleep(wait_time)
                else:
                    raise RuntimeError(_sanitize_error_text(exc)) from exc
            except Exception as exc:
                raise RuntimeError(_sanitize_error_text(exc)) from exc

        _emit_progress(progress_cb, "video_completed", "Google Omni video generated successfully", {"model": model})
        return VideoOutput(
            fmt="bytes",
            ext="mp4",
            data=video_bytes,
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
        target_model = self.ff2v_model if reference_image_paths else self.t2v_model
        if "omni" in target_model.lower():
            return await self._generate_omni_video(
                prompt=prompt,
                reference_image_paths=reference_image_paths,
                resolution=resolution,
                aspect_ratio=aspect_ratio,
                duration=duration,
                **kwargs,
            )

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
