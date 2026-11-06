# https://docs.bigmodel.cn/api-reference/模型-api/图像生成

import logging
from typing import List, Optional

import aiohttp
from tenacity import retry, stop_after_attempt

from utils.retry import after_func
from interfaces.image_output import ImageOutput


class ImageGeneratorCogViewZhipuAPI:
    """CogView on Zhipu BigModel — `cogview-3-flash` is the free tier."""

    DEFAULT_BASE_URL = "https://open.bigmodel.cn"

    # Non-GLM models accept a fixed size set; snap arbitrary canvas sizes
    # (e.g. "1600x900") to the nearest allowed aspect.
    LANDSCAPE_SIZE = "1344x768"
    PORTRAIT_SIZE = "768x1344"
    SQUARE_SIZE = "1024x1024"

    def __init__(
        self,
        api_key: str,
        base_url: str = "",
        model: str = "cogview-3-flash",
    ):
        self.api_key = api_key
        self.base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.model = model

    def snap_size(self, size: Optional[str]) -> str:
        if not size:
            return self.SQUARE_SIZE
        try:
            width, height = (int(part) for part in size.lower().split("x"))
        except ValueError:
            return self.SQUARE_SIZE
        ratio = width / height
        if ratio > 1.2:
            return self.LANDSCAPE_SIZE
        if ratio < 1 / 1.2:
            return self.PORTRAIT_SIZE
        return self.SQUARE_SIZE

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
            "size": self.snap_size(size),
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self.base_url}/api/paas/v4/images/generations"

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

        return ImageOutput(fmt="url", ext="png", data=response_json["data"][0]["url"])
