"""Download reference images from S3-compatible storage."""

from __future__ import annotations

import os
from pathlib import Path

import boto3


def _s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT", "http://localhost:9000"),
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY", "minioadmin"),
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY", "minioadmin"),
        region_name=os.environ.get("S3_REGION", "us-east-1"),
    )


def download_objects(keys: list[str], workdir: Path, bucket: str | None = None) -> list[str]:
    if not keys:
        return []

    bucket_name = bucket or os.environ.get("S3_BUCKET", "vimax-assets")
    client = _s3_client()
    paths: list[str] = []

    for index, key in enumerate(keys):
        suffix = Path(key).suffix or ".png"
        local_path = workdir / f"ref_{index}{suffix}"
        client.download_file(bucket_name, key, str(local_path))
        paths.append(str(local_path))

    return paths
