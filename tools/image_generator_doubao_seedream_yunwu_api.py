# https://yunwu.apifox.cn/api-347960869

import asyncio
import logging
import aiohttp
from typing import List, Optional
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential
from utils.retry import after_func
from utils.image import image_path_to_b64
from interfaces.image_output import ImageOutput


class ImageGeneratorDoubaoSeedreamYunwuAPI:
    DEFAULT_BASE_URL = "https://yunwu.ai/v1/images/generations"

    def __init__(
        self,
        api_key: str,
        base_url: str = "",
        model: str = "doubao-seedream-4-0-250828",

    ):
        self.api_key = api_key
        # Platform/UI may store the vendor root (e.g. "https://host/v1/") —
        # this generator always posts to the images/generations path.
        root = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.base_url = root if root.endswith("/images/generations") else root + "/images/generations"
        self.model = model


    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, max=30),
        retry=retry_if_exception_type((aiohttp.ClientError, asyncio.TimeoutError)),
        reraise=True,
        after=after_func,
    )
    async def generate_single_image(
        self,
        prompt: str,
        reference_image_paths: List[str] = [],
        size: Optional[str] = None,
        **kwargs,
    ) -> ImageOutput:
        """
            size: [1024x1024, 4096x4096]
        """

        logging.info(f"Calling {self.model} to generate image...")

        image = [
            image_path_to_b64(path, mime=True) for path in reference_image_paths
        ]

        payload = {
            "model": self.model,
            "prompt": prompt,
            "sequential_image_generation": "disabled",  # "auto" or "disabled"
            # "sequential_image_generation_options": {
            #     "max_images": 1
            # },
            "response_format": "url",
            "size": size if size is not None else "1024x1024",
        }
        if len(image) > 0:
            payload["image"] = image

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
                        logging.error(f"image API failure — url={self.base_url} payload={ {k: (v if k != 'image' else f'[{len(v)} refs]') for k, v in payload.items()} }")
                        raise RuntimeError(f"image API {response.status}: {detail}")
        except Exception as e:
            logging.error(f"Error occurred while generating image: {e}")
            raise e
        async with aiohttp.ClientSession() as session:
            async with session.post(self.base_url, json=payload, headers=headers) as response:
                response_json = await response.json()
                if response.status >= 400:
                    raise RuntimeError(f"Image generation failed with HTTP {response.status}: {response_json}")

        # OpenAI-compatible endpoints return either a URL or inline b64_json
        # (gpt-image-* always returns b64_json).
        data0 = response_json['data'][0]
        if data0.get('url'):
            return ImageOutput(fmt="url", ext="png", data=data0['url'])
        return ImageOutput(fmt="b64", ext="png", data=data0['b64_json'])
