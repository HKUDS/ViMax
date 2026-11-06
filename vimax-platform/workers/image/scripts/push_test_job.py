#!/usr/bin/env python3
"""Manual test: push one image.t2i job to Redis queue."""

from __future__ import annotations

import json
import os
import uuid

import redis
from dotenv import load_dotenv

load_dotenv()

payload = {
    "job_id": str(uuid.uuid4()),
    "job_type": "image.t2i",
    "model_id": "doubao-seedream-4-0",
    "credential": {
        "class_path": "tools.ImageGeneratorDoubaoSeedreamYunwuAPI",
        "api_key": os.environ["ARK_API_KEY"],
        "base_url": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
        "model": "doubao-seedream-4-0-250828",
    },
    "input": {
        "prompt": "A cinematic portrait of a cat astronaut, soft lighting",
        "size": "1024x1024",
    },
    "callback": {
        "event_channel": f"events:job:{uuid.uuid4()}",
        "upload_bucket": os.environ.get("S3_BUCKET", "vimax-assets"),
        "upload_prefix": "generated/test",
    },
    "cache_key": "manual-test",
    "timeout_ms": 120000,
}

payload["callback"]["event_channel"] = f"events:job:{payload['job_id']}"

client = redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379"))
client.lpush("vimax:queue:q.image.std", json.dumps(payload))
print("Queued job:", payload["job_id"])
