from __future__ import annotations

import base64
import os
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from .models import ToolResult


SUPPORTED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


class ViewImageHandler:
    def __init__(self, workspace_root: str | Path, session_index: Any) -> None:
        self.workspace_root = Path(workspace_root).resolve()
        self.session_index = session_index

    def __call__(self, args: dict[str, Any]) -> ToolResult:
        try:
            session = self.session_index.get_or_create_active()
            session_root = self.session_index.working_dir(session["session_id"]).resolve()
            path = _resolve_session_path(self.workspace_root, session_root, args["path"])
            image, original_size = _load_image(path)
            try:
                data_url, display = _encode_for_model(
                    image,
                    max_dimension=_env_int("VIMAX_IMAGE_VIEW_MAX_DIMENSION", 1568, minimum=256),
                    max_bytes=_env_int("VIMAX_IMAGE_VIEW_MAX_BYTES", 5_000_000, minimum=100_000),
                )
            finally:
                image.close()
        except (OSError, ValueError) as exc:
            return ToolResult("view_image", False, str(exc), {"error_type": "invalid_input"})

        relative = path.relative_to(session_root).as_posix()
        workspace_path = path.relative_to(self.workspace_root).as_posix()
        metadata = {
            "path": relative,
            "workspace_path": workspace_path,
            "session_id": session["session_id"],
            "mime_type": display["mime_type"],
            "original_bytes": path.stat().st_size,
            "original_width": original_size[0],
            "original_height": original_size[1],
            "display_width": display["width"],
            "display_height": display["height"],
            "display_bytes": display["bytes"],
            "camera_metadata": _read_camera_metadata(path),
        }
        return ToolResult(
            "view_image",
            True,
            f"Image loaded for visual inspection: {relative} ({original_size[0]}x{original_size[1]}).",
            metadata,
            model_content=[{"type": "image_url", "image_url": {"url": data_url, "detail": "high"}}],
        )


def _resolve_session_path(workspace_root: Path, session_root: Path, raw: Any) -> Path:
    text = str(raw).strip()
    if not text:
        raise ValueError("view_image path is required")
    supplied = Path(text)
    if supplied.is_absolute():
        path = supplied.resolve()
    elif supplied.parts and supplied.parts[0] == ".working_dir":
        path = (workspace_root / supplied).resolve()
    else:
        path = (session_root / supplied).resolve()
    if path != session_root and session_root not in path.parents:
        raise ValueError(f"Image path escapes active session workspace: {text}")
    if not path.exists():
        raise ValueError(f"Image not found in active session: {text}")
    if not path.is_file():
        raise ValueError(f"Image path is not a file: {text}")
    return path


def _load_image(path: Path) -> tuple[Image.Image, tuple[int, int]]:
    if path.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
        raise ValueError(f"Unsupported image type: {path.suffix or '<none>'}")
    try:
        with Image.open(path) as source:
            source.seek(0)
            original_size = source.size
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.load()
            return image, original_size
    except Exception as exc:
        raise ValueError(f"Cannot decode image {path.name}: {exc}") from exc


def _encode_for_model(image: Image.Image, *, max_dimension: int, max_bytes: int) -> tuple[str, dict[str, Any]]:
    rendered = image.copy()
    try:
        rendered.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
        quality = 90
        payload = b""
        while quality >= 35:
            buffer = BytesIO()
            rendered.save(buffer, format="JPEG", quality=quality, optimize=True)
            payload = buffer.getvalue()
            if len(payload) <= max_bytes:
                break
            quality -= 10
        while len(payload) > max_bytes and min(rendered.size) > 320:
            rendered.thumbnail(
                (max(320, int(rendered.width * 0.8)), max(320, int(rendered.height * 0.8))),
                Image.Resampling.LANCZOS,
            )
            buffer = BytesIO()
            rendered.save(buffer, format="JPEG", quality=55, optimize=True)
            payload = buffer.getvalue()
        if len(payload) > max_bytes:
            raise ValueError(f"Image cannot be reduced below configured {max_bytes} byte limit")
        encoded = base64.b64encode(payload).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}", {
            "mime_type": "image/jpeg",
            "width": rendered.width,
            "height": rendered.height,
            "bytes": len(payload),
        }
    finally:
        rendered.close()


def _read_camera_metadata(path: Path) -> dict[str, Any]:
    try:
        with Image.open(path) as source:
            exif = source.getexif()
    except Exception:
        return {}
    if not exif:
        return {}
    metadata: dict[str, Any] = {}
    for tag, name in {271: "make", 272: "model", 42036: "lens_model"}.items():
        value = exif.get(tag)
        if value:
            metadata[name] = str(value).strip()
    focal_length = _numeric_exif_value(exif.get(37386))
    if focal_length is not None:
        metadata["focal_length_mm"] = round(focal_length, 2)
    equivalent = _numeric_exif_value(exif.get(41989))
    if equivalent is not None:
        metadata["focal_length_35mm_equivalent"] = round(equivalent, 2)
    return metadata


def _numeric_exif_value(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if isinstance(value, tuple) and len(value) == 2:
            denominator = float(value[1])
            return float(value[0]) / denominator if denominator else None
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _env_int(name: str, default: int, *, minimum: int) -> int:
    try:
        return max(minimum, int(os.environ.get(name, str(default))))
    except ValueError:
        return default
