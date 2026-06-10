# https://ai.google.dev/gemini-api/docs/image-generation?hl=zh-cn

import logging
from PIL import Image
from typing import List, Optional
from google import genai
from google.genai import types
from tenacity import retry, stop_after_attempt
from interfaces.image_output import ImageOutput
from utils.retry import after_func


class ImageGeneratorNanobananaYunwuAPI:
    def __init__(
        self,
        api_key: str,
        model: str = "gemini-2.5-flash-image-preview",
        base_url: str = "https://yunwu.ai",
    ):
        self.client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                base_url=base_url.rstrip("/"),
                api_version="v1beta",
            ),
        )
        self.model = model


    @retry(stop=stop_after_attempt(3), after=after_func)
    async def generate_single_image(
        self,
        prompt: str,
        reference_image_paths: List[str] = [],
        aspect_ratio: Optional[str] = "16:9",
        **kwargs,
    ) -> ImageOutput:
        """
            aspect_ratio: The aspect ratio of the image.
        """

        logging.info(f"Calling {self.model} to generate image...")

        reference_images = [Image.open(path) for path in reference_image_paths]

        response = await self.client.aio.models.generate_content(
            model=self.model,
            contents=reference_images + [prompt],
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio=aspect_ratio,
                ),
            ),
        )

        image = None
        text = ""
        for part in response.candidates[0].content.parts:
            if part.text is not None:
                text += part.text
            elif part.inline_data is not None:
                image = part.as_image()

        if image is None:
            logging.error(f"No image generated. The response text is: {text}")
            raise ValueError(f"Error occurred while generating image.")

        return ImageOutput(fmt="pil", ext="png", data=image)
