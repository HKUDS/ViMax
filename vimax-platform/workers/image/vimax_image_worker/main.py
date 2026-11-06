"""BullMQ-compatible Redis queue consumer for image generation jobs."""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
from pathlib import Path

import redis
from dotenv import load_dotenv

from vimax_image_worker.handler import IMAGE_QUEUE_NAME, IMAGE_QUEUE_REDIS_KEY, handle_image_job
from vimax_image_worker.reliable_queue import acknowledge, claim, recover_inflight

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def setup_vimax_path() -> None:
    vimax_root = os.environ.get("VIMAX_ROOT", "..")
    resolved = Path(vimax_root).resolve()
    if str(resolved) not in sys.path:
        sys.path.insert(0, str(resolved))


def main() -> None:
    load_dotenv()
    setup_vimax_path()

    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    client = redis.from_url(
        redis_url,
        decode_responses=True,
        socket_timeout=10,
        socket_connect_timeout=5,
    )

    logger.info("ViMax image worker started, queue=%s", IMAGE_QUEUE_NAME)
    recover_inflight(client, IMAGE_QUEUE_REDIS_KEY)

    running = True

    def shutdown(_signum, _frame):
        nonlocal running
        running = False
        logger.info("Shutting down...")

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while running:
        try:
            raw = claim(client, IMAGE_QUEUE_REDIS_KEY)
        except redis.RedisError:
            # Idle blocking connections get dropped by the server/NAT —
            # rebuild the client instead of taking the worker down.
            logger.warning("Redis connection error on %s, reconnecting", IMAGE_QUEUE_REDIS_KEY, exc_info=True)
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
            handle_image_job(payload, client)
        except Exception:
            logger.exception("Failed to process job")
        finally:
            acknowledge(client, IMAGE_QUEUE_REDIS_KEY, raw)


if __name__ == "__main__":
    main()
