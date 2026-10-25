import base64
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from PIL import Image
from google.genai import errors
from interfaces.image_output import ImageOutput
from tools.image_generator_nanobanana_google_api import ImageGeneratorNanobananaGoogleAPI


def _encoded_png_bytes(size: tuple[int, int] = (16, 9)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", size, "blue").save(buffer, format="PNG")
    return buffer.getvalue()


class GoogleImageGeneratorTests(unittest.IsolatedAsyncioTestCase):
    async def test_generate_single_image(self):
        generator = ImageGeneratorNanobananaGoogleAPI(api_key="secret-key", model="gemini-nano-banana-2.1")
        
        img_bytes = _encoded_png_bytes((160, 90))
        fake_part = SimpleNamespace(
            text=None,
            inline_data=SimpleNamespace(data=img_bytes),
            as_image=lambda: Image.new("RGB", (160, 90), "blue")
        )
        fake_candidate = SimpleNamespace(content=SimpleNamespace(parts=[fake_part]))
        fake_response = SimpleNamespace(candidates=[fake_candidate])

        mock_generate = AsyncMock(return_value=fake_response)
        generator.client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock_generate)))

        result = await generator.generate_single_image(
            prompt="A futuristic hospital ward",
            aspect_ratio="16:9",
        )

        self.assertIsInstance(result, ImageOutput)
        self.assertEqual(result.ext, "png")
        self.assertEqual(result.fmt, "pil")
        self.assertEqual(result.data.size, (160, 90))

        mock_generate.assert_called_once()
        kwargs = mock_generate.call_args.kwargs
        self.assertEqual(kwargs["model"], "gemini-nano-banana-2.1")
        self.assertIn("A futuristic hospital ward", kwargs["contents"])

    async def test_retry_on_429_rate_limit(self):
        generator = ImageGeneratorNanobananaGoogleAPI(api_key="secret-key", model="gemini-nano-banana-2.1")

        img_bytes = _encoded_png_bytes((160, 90))
        fake_part = SimpleNamespace(
            text=None,
            inline_data=SimpleNamespace(data=img_bytes),
            as_image=lambda: Image.new("RGB", (160, 90), "blue")
        )
        fake_candidate = SimpleNamespace(content=SimpleNamespace(parts=[fake_part]))
        success_response = SimpleNamespace(candidates=[fake_candidate])

        # Simulate 429 error on first call, success on second
        rate_limit_err = errors.ClientError(code=429, response_json={"error": "Rate limit exceeded"})
        mock_generate = AsyncMock(side_effect=[rate_limit_err, success_response])
        generator.client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock_generate)))

        with patch("asyncio.sleep", AsyncMock()):
            result = await generator.generate_single_image(prompt="test retry")

        self.assertIsInstance(result, ImageOutput)
        self.assertEqual(mock_generate.await_count, 2)


if __name__ == "__main__":
    unittest.main()

