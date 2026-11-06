# https://wiki.agnes-ai.com/en/docs/agnes-image-25-flash

import logging
from typing import List, Optional

import aiohttp
from tenacity import retry, stop_after_attempt

from utils.retry import after_func
from utils.image import image_path_to_b64
from interfaces.image_output import ImageOutput


class ImageGeneratorAgnesAPI:
    """Agnes Image — OpenAI /images/generations shape with Agnes quirks:
    size is required, and response_format / reference image must sit inside
    a literal extra_body key (top-level response_format is rejected)."""

    DEFAULT_BASE_URL = "https://apihub.agnes-ai.com/v1"

    def __init__(
        self,
        api_key: str,
        base_url: str = "",
        model: str = "agnes-image-2.5-flash",
    ):
        self.api_key = api_key
        # Platform/UI may store the vendor root (e.g. "https://host/v1/") —
        # this generator always posts to the images/generations path.
        root = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.base_url = root if root.endswith("/images/generations") else root + "/images/generations"
        self.model = model

    @retry(stop=stop_after_attempt(3), after=after_func)
    async def generate_single_image(
        self,
        prompt: str,
        reference_image_paths: List[str] = [],
        size: Optional[str] = None,
        **kwargs,
    ) -> ImageOutput:
        """
            size: "1K"/"2K"/"3K"/"4K" or WxH (unsupported WxH is normalized
            server-side, e.g. 1920x1080 -> 1312x736)
        """

        logging.info(f"Calling {self.model} to generate image...")

        extra_body = {"response_format": "url"}
        if len(reference_image_paths) > 0:
            extra_body["image"] = [
                image_path_to_b64(path, mime=True) for path in reference_image_paths
            ]

        payload = {
            "model": self.model,
            "prompt": prompt,
            "size": size if size is not None else "1K",
            "extra_body": extra_body,
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(self.base_url, json=payload, headers=headers) as response:
                    response_json = await response.json()
                    if response.status >= 400 or 'data' not in response_json:
                        err = response_json.get('error') if isinstance(response_json, dict) else None
                        detail = err.get('message', '') if isinstance(err, dict) else str(response_json)[:200]
                        logging.error(f"image API failure — url={self.base_url} payload={ {k: (v if k != 'extra_body' else '[refs]') for k, v in payload.items()} }")
                        raise RuntimeError(f"image API {response.status}: {detail}")
        except Exception as e:
            logging.error(f"Error occurred while generating image: {e}")
            raise e

        data0 = response_json['data'][0]
        if data0.get('url'):
            return ImageOutput(fmt="url", ext="png", data=data0['url'])
        return ImageOutput(fmt="b64", ext="png", data=data0['b64_json'])
