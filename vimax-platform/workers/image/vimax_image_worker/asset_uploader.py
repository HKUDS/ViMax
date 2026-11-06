"""Upload generated assets (images and videos) to S3-compatible storage."""

from __future__ import annotations

import hashlib
import mimetypes
import os
from pathlib import Path

import boto3
from PIL import Image
from PIL import UnidentifiedImageError


def _s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT", "http://localhost:9000"),
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY", "minioadmin"),
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY", "minioadmin"),
        region_name=os.environ.get("S3_REGION", "us-east-1"),
    )


def upload_file(local_path: Path, *, bucket: str, prefix: str) -> dict:
    data = local_path.read_bytes()
    sha256 = hashlib.sha256(data).hexdigest()

    try:
        with Image.open(local_path) as img:
            width, height = img.size
        mime_type = "image/png"
    except (UnidentifiedImageError, OSError):
        # Not an image (e.g. an .mp4 from a video job) — PIL gives no
        # dimensions here; width/height stay null for video assets.
        width = height = None
        mime_type = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"

    key = f"{prefix.rstrip('/')}/{local_path.name}"
    client = _s3_client()
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=mime_type,
    )

    return {
        "storage_key": key,
        "width": width,
        "height": height,
        "sha256": sha256,
        "mime_type": mime_type,
        "size_bytes": len(data),
    }
