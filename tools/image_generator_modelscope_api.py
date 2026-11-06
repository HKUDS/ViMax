# https://www.modelscope.cn/docs — API-Inference, OpenAI-compatible
# /v1/images/generations (free tier: 2000 calls/day per user, ms- token).

import logging
from typing import List, Optional

import aiohttp
from tenacity import retry, stop_after_attempt

from utils.retry import after_func
from interfaces.image_output import ImageOutput


class ImageGeneratorModelScopeAPI:
    DEFAULT_BASE_URL = "https://api-inference.modelscope.cn"

    def __init__(
        self,
        api_key: str,
        base_url: str = "",
        model: str = "Qwen/Qwen-Image",
    ):
        self.api_key = api_key
        self.base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.model = model

    @retry(stop=stop_after_attempt(3), after=after_func)
    async def generate_single_image(
        self,
        prompt: str,
        reference_image_paths: List[str] = [],
        size: Optional[str] = None,
        **kwargs,
    ) -> ImageOutput:
        logging.info(f"Calling {self.model} to generate image...")

        payload = {
            "model": self.model,
            "prompt": prompt,
        }
        if size is not None:
            payload["size"] = size

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self.base_url}/v1/images/generations"

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as response:
                    response_json = await response.json()
                    if response.status >= 400 or "data" not in response_json:
                        err = response_json.get("error") if isinstance(response_json, dict) else None
                        detail = err.get("message", "") if isinstance(err, dict) else str(response_json)[:200]
                        logging.error(f"image API failure — url={url} payload={payload}")
                        raise RuntimeError(f"image API {response.status}: {detail}")
        except Exception as e:
            logging.error(f"Error occurred while generating image: {e}")
            raise e

        # ModelScope returns either a URL or inline b64_json depending on model.
        data0 = response_json["data"][0]
        if data0.get("url"):
            return ImageOutput(fmt="url", ext="png", data=data0["url"])
        return ImageOutput(fmt="b64", ext="png", data=data0["b64_json"])
