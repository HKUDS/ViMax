"""Audio worker — BRPOP from q.audio.std and dispatch.

Mirrors concat_main.py: the bridge LPUSHes bridge-shaped job payloads to
`vimax:queue:q.audio.std`, this worker BRPOPs them and hands each payload
to the audio handler together with a Redis-backed job reporter.
"""
from __future__ import annotations

import json
import logging
import os
import signal
import sys
from pathlib import Path

import redis
from dotenv import load_dotenv

from vimax_image_worker.audio_handler import handle_audio_job
from vimax_image_worker.reporter import JobReporter
from vimax_image_worker.reliable_queue import acknowledge, claim, recover_inflight

QUEUE_KEY = "vimax:queue:q.audio.std"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("audio-worker")


def setup() -> None:
    # TTS 等处理器要从 VIMAX_ROOT 导入 tools 包；与 video_main 一致的自举。
    load_dotenv()
    vimax_root = os.environ.get("VIMAX_ROOT", "..")
    resolved = Path(vimax_root).resolve()
    if str(resolved) not in sys.path:
        sys.path.insert(0, str(resolved))
    logger.info("VIMAX_ROOT=%s", resolved)


def main() -> None:
    setup()
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    client = redis.from_url(
        redis_url,
        decode_responses=True,
        socket_timeout=10,
        socket_connect_timeout=5,
    )

    logger.info("ViMax audio worker started, queue=%s", QUEUE_KEY)
    recover_inflight(client, QUEUE_KEY)

    running = True

    def shutdown(_signum, _frame):
        nonlocal running
        running = False
        logger.info("Shutting down audio worker...")

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while running:
        try:
            raw = claim(client, QUEUE_KEY)
        except redis.RedisError:
            logger.warning("Redis connection error on %s, reconnecting", QUEUE_KEY, exc_info=True)
            client = redis.from_url(
                redis_url,
                decode_responses=True,
                socket_timeout=10,
                socket_connect_timeout=5,
            )
            continue
        if raw is None:
            continue

        try:
            payload = json.loads(raw)
            reporter = JobReporter(client, payload["callback"]["event_channel"], payload["job_id"])
            import asyncio

            asyncio.run(handle_audio_job(payload, reporter))
        except Exception:
            logger.exception("Failed to process audio job")
        finally:
            acknowledge(client, QUEUE_KEY, raw)


if __name__ == "__main__":
    main()
