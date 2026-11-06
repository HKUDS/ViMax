from __future__ import annotations

import base64
from io import BytesIO
from typing import Any

from PIL import Image


def image_from_response_part(part: Any) -> Image.Image | None:
    inline_data = getattr(part, "inline_data", None)
    if inline_data is None and isinstance(part, dict):
        inline_data = part.get("inline_data")
    if inline_data is None:
        return None

    as_image = getattr(part, "as_image", None)
    if callable(as_image):
        image = as_image()
        if isinstance(image, Image.Image):
            return image

    data = _value(inline_data, "data")
    if data is None:
        return None
    if isinstance(data, str):
        if data.startswith("data:") and "," in data:
            data = data.split(",", 1)[1]
        data = base64.b64decode(data)
    if isinstance(data, bytearray):
        data = bytes(data)
    if not isinstance(data, bytes):
        return None
    return Image.open(BytesIO(data)).convert("RGB")


def _value(obj: Any, key: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)
