from __future__ import annotations

import os
from typing import Any

from PIL import Image


def landscape_guard_requested(*, size: Any = None, aspect_ratio: Any = None, enforce_landscape: Any = True, allow_portrait: Any = False) -> bool:
    if bool(allow_portrait):
        return False
    if bool(enforce_landscape):
        return True
    parsed = _parse_size(size)
    if parsed and parsed[0] > parsed[1]:
        return True
    parsed_ratio = _parse_size(aspect_ratio)
    return bool(parsed_ratio and parsed_ratio[0] > parsed_ratio[1])


def ensure_not_portrait(image: Image.Image, *, tolerance: float | None = None) -> None:
    width, height = image.size
    if width <= 0 or height <= 0:
        return
    threshold = tolerance if tolerance is not None else _portrait_tolerance()
    if height > width * threshold:
        raise ValueError(f"Generated image is portrait-oriented ({width}x{height}); retrying for a landscape frame")


def _portrait_tolerance() -> float:
    raw = os.environ.get("VIMAX_IMAGE_PORTRAIT_RETRY_TOLERANCE", "1.05")
    try:
        return max(1.0, float(raw))
    except ValueError:
        return 1.05


def _parse_size(size: Any) -> tuple[int, int] | None:
    if not isinstance(size, str):
        return None
    normalized = size.lower()
    separator = "x" if "x" in normalized else ":" if ":" in normalized else ""
    if not separator:
        return None
    left, right = normalized.split(separator, 1)
    try:
        width = int(left.strip())
        height = int(right.strip())
    except ValueError:
        return None
    if width <= 0 or height <= 0:
        return None
    return width, height
