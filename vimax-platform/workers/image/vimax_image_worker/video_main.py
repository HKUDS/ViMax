"""BullMQ-compatible Redis queue consumer for video generation jobs."""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
from pathlib import Path

import redis
from dotenv import load_dotenv

from vimax_image_worker.video_handler import handle_video_job
from vimax_image_worker.reliable_queue import acknowledge, claim, recover_inflight

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

QUEUE_NAME = "q.video.std"
QUEUE_KEY = f"vimax:queue:{QUEUE_NAME}"


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

    logger.info("ViMax video worker started, queue=%s", QUEUE_NAME)
    recover_inflight(client, QUEUE_KEY)

    running = True

    def shutdown(_signum, _frame):
        nonlocal running
        running = False
        logger.info("Shutting down video worker...")

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while running:
        try:
            raw = claim(client, QUEUE_KEY)
        except redis.RedisError:
            # Idle blocking connections get dropped by the server/NAT —
            # rebuild the client instead of taking the worker down.
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
            handle_video_job(payload, client)
        except Exception:
            logger.exception("Failed to process video job")
        finally:
            acknowledge(client, QUEUE_KEY, raw)


if __name__ == "__main__":
    main()
