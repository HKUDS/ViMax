# OpenAI-compatible TTS endpoint (POST /v1/audio/speech).
# Works with aggregators (yunwu.ai) and any vendor exposing the same shape.

import logging
from typing import Optional

import aiohttp
from tenacity import retry, stop_after_attempt

from utils.retry import after_func


class TtsGeneratorOpenAIAPI:
    DEFAULT_BASE_URL = "https://yunwu.ai/v1/audio/speech"

    def __init__(
        self,
        api_key: str,
        base_url: str = "",
        model: str = "tts-1",
        voice: str = "alloy",
        speed: Optional[float] = None,
    ):
        self.api_key = api_key
        # Accept both the endpoint root ("https://host") and the full path.
        root = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.base_url = root if root.endswith("/audio/speech") else root + "/v1/audio/speech"
        self.model = model
        self.voice = voice
        self.speed = speed

    @retry(stop=stop_after_attempt(3), after=after_func)
    async def synthesize(self, text: str, output_path: str) -> None:
        """Synthesize `text` into an mp3 file at `output_path`."""
        if not text.strip():
            raise ValueError("TTS input text is empty")

        payload: dict = {
            "model": self.model,
            "input": text,
            "voice": self.voice,
            "response_format": "mp3",
        }
        if self.speed is not None:
            payload["speed"] = self.speed

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        timeout = aiohttp.ClientTimeout(total=120)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(self.base_url, json=payload, headers=headers) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    raise RuntimeError(f"TTS request failed ({resp.status}): {body[:300]}")
                audio = await resp.read()

        if len(audio) < 100:
            raise RuntimeError(f"TTS returned suspiciously small audio ({len(audio)} bytes)")

        with open(output_path, "wb") as f:
            f.write(audio)
        logging.info("TTS synthesized %s chars -> %s (%s bytes)", len(text), output_path, len(audio))
